import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { classifyLineError } from "@/lib/line/error-classification";
import {
  composeWorkCardCancelledText, composeWorkCardMessage, composeWorkCardPendingMessage, composeWorkCardRescheduledMessage,
} from "@/lib/line/madou-group-text";
import { buildQueueMadouWebhookResultStatement, queueDailyDigestIfDue, type MadouWorkCardSnapshot } from "@/lib/line/madou-group-queue";
import { MAX_SEND_ATTEMPTS, nextAttemptDelayMinutes, sendLinePushMessage, type LineMessage } from "@/lib/line/messaging";
import { processMadouPostbackAction, type MadouPostbackAction } from "@/lib/line/madou-webhook-process";
import { isSupersededWorkCard, type CurrentBookingState } from "@/lib/farm/madou-work-card-staleness";
import { claimRow } from "@/lib/outbox/claim";
import { startJobRun, completeJobRun } from "@/lib/outbox/job-run";

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type DueRow = { id: string; booking_id: string | null; notification_type: string; content_snapshot_json: string; attempt_count: number };

// Re-verify the booking's current state right before sending — the queued
// content_snapshot_json is whatever was true at enqueue time, which can be
// stale by send time (cancel or a second reschedule racing with an
// already-queued, not-yet-sent row). Returns null for the digest (no single
// booking_id) or when the booking no longer exists.
async function currentBookingState(db: D1Database, bookingId: string | null): Promise<CurrentBookingState | null> {
  if (!bookingId) return null;
  return db.prepare("SELECT cancelled_at, visit_version, booking_status FROM farm_bookings WHERE id = ?").bind(bookingId).first<CurrentBookingState>();
}

function buildMessages(notificationType: string, snapshotJson: string): LineMessage[] | null {
  const snapshot = JSON.parse(snapshotJson) as MadouWorkCardSnapshot | { targetDate: string; text: string } | { text: string };

  if ((notificationType === "madou_daily_digest" || notificationType === "madou_webhook_result") && "text" in snapshot) {
    return [{ type: "text", text: snapshot.text }];
  }
  if (notificationType === "madou_work_card_event" && "eventKind" in snapshot) {
    if (snapshot.eventKind === "pending") return [composeWorkCardPendingMessage(snapshot.booking, snapshot.visitVersion)];
    if (snapshot.eventKind === "confirmed") return [composeWorkCardMessage(snapshot.booking, snapshot.visitVersion)];
    if (snapshot.eventKind === "rescheduled" && snapshot.oldStartsAt) {
      return [composeWorkCardRescheduledMessage(snapshot.booking, snapshot.oldStartsAt, snapshot.visitVersion)];
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
  const accessToken = env.LINE_MESSAGING_ACCESS_TOKEN;
  const groupId = env.MADOU_GROUP_ID;
  const leaseOwner = runId;

  // Phase 0: retry webhook postback actions that threw on their first
  // synchronous attempt (see src/app/api/line/webhook/route.ts). LINE never
  // redelivers an event that already got HTTP 200, so this is the only
  // mechanism that can ever recover one of these — a P0 gap found by review
  // in the first version of this feature (dedupe row was written before the
  // action ran, with no retry path at all for a thrown error).
  const retryDue = await db
    .prepare(
      `SELECT id, action, booking_id, actor_member_id, visit_version_param, attempt_count
       FROM farm_line_webhook_events
       WHERE status = 'queued'
         AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime(?))
         AND (leased_until IS NULL OR datetime(leased_until) < datetime(?))
       ORDER BY datetime(next_attempt_at)
       LIMIT 50`,
    )
    .bind(nowIso, nowIso)
    .all<{ id: string; action: string; booking_id: string; actor_member_id: string; visit_version_param: number | null; attempt_count: number }>();

  let webhookRetried = 0;
  let webhookDeadLettered = 0;
  for (const row of retryDue.results ?? []) {
    const claimed = await claimRow(db, "farm_line_webhook_events", row.id, leaseOwner);
    if (!claimed) continue;
    const member = await db.prepare("SELECT id, display_name, role FROM members WHERE id = ?").bind(row.actor_member_id).first<{ id: string; display_name: string; role: string }>();
    const nowIso2 = new Date().toISOString();
    if (!member) {
      // Actor no longer exists — can't safely re-attribute the action to anyone.
      await db.prepare("UPDATE farm_line_webhook_events SET status = 'dead_letter', leased_until = NULL, error = 'actor_member_missing', updated_at = ? WHERE id = ?").bind(nowIso2, row.id).run();
      webhookDeadLettered += 1;
      continue;
    }
    try {
      const result = await processMadouPostbackAction(db, row.action as MadouPostbackAction, row.booking_id, row.visit_version_param, member, row.id);
      // Mark processed AND enqueue the delayed result as one atomic D1
      // batch — the original reply token is long expired by retry time, so
      // queuing a durable push is the only delivery path here, and it must
      // not be possible for a crash to leave the event 'processed' with the
      // result silently dropped (same bug class as the sync path above).
      await db.batch([
        db.prepare("UPDATE farm_line_webhook_events SET status = 'processed', leased_until = NULL, updated_at = ? WHERE id = ?").bind(nowIso2, row.id),
        buildQueueMadouWebhookResultStatement(db, row.id, `[延遲處理] ${result.replyText}`),
      ]);
      webhookRetried += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attemptsAfter = row.attempt_count + 1;
      const terminal = attemptsAfter >= MAX_SEND_ATTEMPTS;
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db
        .prepare("UPDATE farm_line_webhook_events SET status = ?, attempt_count = ?, error = ?, next_attempt_at = ?, leased_until = NULL, updated_at = ? WHERE id = ?")
        .bind(terminal ? "dead_letter" : "queued", attemptsAfter, message, next, nowIso2, row.id)
        .run();
      if (terminal) webhookDeadLettered += 1;
    }
  }

  const digestQueued = await queueDailyDigestIfDue(db, now);

  // 2026-10-17審查發現的同一類D1額度問題（同reminders/sales-sync）：下面這段
  // !groupId／!accessToken檢查原本寫在per-row迴圈「裡面」，代表即使一開始就
  // 知道這兩個設定缺一，還是會把所有due的line_group通知逐筆claim+UPDATE
  // （attempt_count+1）才放棄——這段期間是百分之百可預期的失敗，卻每個tick都在
  // 寫。改成查due「之前」先判斷：缺任何一個就整段迴圈完全不進，一筆都不碰，
  // 業務資料原封不動，設定補齊後下一個tick正常處理。Phase 0（webhook retry）
  // 跟digest排程本身不依賴這兩個設定（只是寫入queue，不是直接呼叫LINE API），
  // 所以維持在這個判斷之前執行。
  if (!groupId || !accessToken) {
    await completeJobRun(db, runId, { dueCount: 0, sent: 0, failed: 0, blocked: 0 }, null, !groupId ? "no_group_id_skipped_entirely" : "no_credentials_skipped_entirely");
    return Response.json({
      mode: "credentials_not_configured",
      digestQueued, dueCount: 0, sent: 0, superseded: 0, blockedNoCredentials: 0, blockedNoGroup: 0, failed: 0,
      webhookRetryDueCount: (retryDue.results ?? []).length, webhookRetried, webhookDeadLettered,
      runId,
    });
  }

  const due = await db
    .prepare(
      `SELECT id, booking_id, notification_type, content_snapshot_json, attempt_count
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

  let sent = 0;
  let failed = 0;
  let superseded = 0;
  const errorCodes = new Set<string>();

  for (const row of rows) {
    const claimed = await claimRow(db, "farm_notification_outbox", row.id, leaseOwner);
    if (!claimed) continue;

    // Re-verify the booking's current state before sending anything tied to a
    // single booking (digest rows have booking_id NULL and skip this) — the
    // queued snapshot can be stale by the time this row is actually sent
    // (e.g. cancelled, or reschedule-d again, after this row was queued but
    // before it was picked up). Sending a superseded card would tell the
    // group something that's no longer true.
    if (row.notification_type === "madou_work_card_event") {
      const snapshot = JSON.parse(row.content_snapshot_json) as MadouWorkCardSnapshot;
      const current = await currentBookingState(db, row.booking_id);
      if (isSupersededWorkCard(snapshot, current)) {
        await db.prepare("UPDATE farm_notification_outbox SET status = 'cancelled', last_error = ?, leased_until = NULL WHERE id = ?")
          .bind("superseded_by_newer_booking_state", row.id).run();
        superseded += 1;
        continue;
      }
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

  await completeJobRun(db, runId, { dueCount: rows.length, sent, failed, blocked: 0 }, oldestPendingSeconds, errorCodes.size ? Array.from(errorCodes).join(",") : null);

  return Response.json({
    mode: "processing",
    digestQueued, dueCount: rows.length, sent, superseded, failed,
    webhookRetryDueCount: (retryDue.results ?? []).length, webhookRetried, webhookDeadLettered,
    runId,
  });
}
