import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { classifyLineError } from "@/lib/line/error-classification";
import {
  composeWorkCardCancelledText, composeWorkCardMessage, composeWorkCardRescheduledText,
  type WorkCardBooking, type WorkCardEventKind,
} from "@/lib/line/madou-group-text";
import { queueDailyDigestIfDue } from "@/lib/line/madou-group-queue";
import { MAX_SEND_ATTEMPTS, nextAttemptDelayMinutes, sendLinePushMessage, type LineMessage } from "@/lib/line/messaging";
import { claimRow } from "@/lib/outbox/claim";
import { startJobRun, completeJobRun } from "@/lib/outbox/job-run";

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type DueRow = { id: string; notification_type: string; content_snapshot_json: string; attempt_count: number };

function buildMessages(notificationType: string, snapshotJson: string): LineMessage[] | null {
  const snapshot = JSON.parse(snapshotJson) as
    | { eventKind: WorkCardEventKind; booking: WorkCardBooking; oldStartsAt?: string }
    | { targetDate: string; text: string };

  if (notificationType === "madou_daily_digest" && "text" in snapshot) {
    return [{ type: "text", text: snapshot.text }];
  }
  if (notificationType === "madou_work_card_event" && "eventKind" in snapshot) {
    if (snapshot.eventKind === "confirmed") return [composeWorkCardMessage(snapshot.booking)];
    if (snapshot.eventKind === "rescheduled" && snapshot.oldStartsAt) {
      return [{ type: "text", text: composeWorkCardRescheduledText(snapshot.booking, snapshot.oldStartsAt) }];
    }
    if (snapshot.eventKind === "cancelled") return [{ type: "text", text: composeWorkCardCancelledText(snapshot.booking) }];
  }
  return null;
}

// Consumer half — same claim/lease + backoff + job-run-logging discipline as
// jobs/reminders/route.ts, just targeting a LINE group instead of a member.
// Producer half for the daily digest (queueDailyDigestIfDue) runs first on every
// tick so a single cron schedule covers both without a second trigger.
export async function POST(request: Request) {
  const expected = process.env.JOB_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !sameSecret(actual, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const triggerSource = request.headers.get("x-trigger-source") === "cron" ? "cron" : "manual";

  const db = await getDb();
  const runId = await startJobRun(db, "madou-group", triggerSource);
  const now = new Date();
  const nowIso = now.toISOString();

  const digestQueued = await queueDailyDigestIfDue(db, now);

  const due = await db
    .prepare(
      `SELECT id, notification_type, content_snapshot_json, attempt_count
       FROM farm_notification_outbox
       WHERE status = 'queued' AND channel = 'line_group'
         AND datetime(next_attempt_at) <= datetime(?)
         AND (leased_until IS NULL OR datetime(leased_until) < datetime(?))
       ORDER BY datetime(next_attempt_at)
       LIMIT 50`,
    )
    .bind(nowIso, nowIso)
    .all<DueRow>();

  const rows = due.results ?? [];
  const accessToken = env.LINE_MESSAGING_ACCESS_TOKEN;
  const groupId = env.MADOU_GROUP_ID;
  const leaseOwner = runId;

  let sent = 0;
  let failed = 0;
  let blockedNoCredentials = 0;
  let blockedNoGroup = 0;
  const errorCodes = new Set<string>();

  for (const row of rows) {
    const claimed = await claimRow(db, "farm_notification_outbox", row.id, leaseOwner);
    if (!claimed) continue;

    if (!groupId) {
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db.prepare("UPDATE farm_notification_outbox SET attempt_count = attempt_count + 1, last_error = ?, next_attempt_at = ?, leased_until = NULL WHERE id = ?")
        .bind("madou_group_id_not_configured", next, row.id).run();
      blockedNoGroup += 1;
      errorCodes.add("no_group_id");
      continue;
    }
    if (!accessToken) {
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db.prepare("UPDATE farm_notification_outbox SET attempt_count = attempt_count + 1, last_error = ?, next_attempt_at = ?, leased_until = NULL WHERE id = ?")
        .bind("line_messaging_access_token_not_configured", next, row.id).run();
      blockedNoCredentials += 1;
      errorCodes.add("no_credentials");
      continue;
    }

    const messages = buildMessages(row.notification_type, row.content_snapshot_json);
    if (!messages) {
      await db.prepare("UPDATE farm_notification_outbox SET status = 'failed', last_error = ?, leased_until = NULL WHERE id = ?")
        .bind("unrecognized_notification_payload", row.id).run();
      failed += 1;
      errorCodes.add("bad_payload");
      continue;
    }

    const result = await sendLinePushMessage(accessToken, groupId, messages, row.id);
    if (result.ok) {
      await db.prepare("UPDATE farm_notification_outbox SET status = 'sent', accepted_at = ?, attempt_count = attempt_count + 1, leased_until = NULL WHERE id = ?")
        .bind(new Date().toISOString(), row.id).run();
      sent += 1;
    } else {
      const errorClass = classifyLineError(result.status);
      const attemptsAfter = row.attempt_count + 1;
      const permanentlyFailed = errorClass === "credential" || errorClass === "permanent" || attemptsAfter >= MAX_SEND_ATTEMPTS;
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db
        .prepare(
          `UPDATE farm_notification_outbox
           SET attempt_count = ?, last_error = ?, next_attempt_at = ?, status = ?, leased_until = NULL
           WHERE id = ?`,
        )
        .bind(attemptsAfter, `[${errorClass}] ${result.status}: ${result.error}`, next, permanentlyFailed ? "failed" : "queued", row.id)
        .run();
      failed += 1;
      errorCodes.add(`${errorClass}:${result.status}`);
    }
  }

  const oldestPending = await db
    .prepare("SELECT MIN(datetime(next_attempt_at)) AS oldest FROM farm_notification_outbox WHERE status = 'queued' AND channel = 'line_group'")
    .first<{ oldest: string | null }>();
  const oldestPendingSeconds = oldestPending?.oldest
    ? Math.max(0, Math.floor((Date.now() - new Date(oldestPending.oldest).getTime()) / 1000))
    : null;

  const blocked = blockedNoCredentials + blockedNoGroup;
  await completeJobRun(db, runId, { dueCount: rows.length, sent, failed, blocked }, oldestPendingSeconds, errorCodes.size ? Array.from(errorCodes).join(",") : null);

  return Response.json({
    mode: accessToken && groupId ? "processing" : "credentials_not_configured",
    digestQueued, dueCount: rows.length, sent, blockedNoCredentials, blockedNoGroup, failed, runId,
  });
}
