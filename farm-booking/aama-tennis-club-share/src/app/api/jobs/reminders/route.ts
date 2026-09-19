import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { composeDayBeforeReminderText } from "@/lib/line/reminder-text";
import { MAX_SEND_ATTEMPTS, nextAttemptDelayMinutes, sendLinePushMessage } from "@/lib/line/messaging";
import { classifyLineError } from "@/lib/line/error-classification";
import { claimRow } from "@/lib/outbox/claim";
import { startJobRun, completeJobRun } from "@/lib/outbox/job-run";

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type DueRow = {
  id: string;
  booking_id: string;
  recipient_id: string;
  attempt_count: number;
  cancelled_at: string | null;
  line_user_id: string | null;
  experience: string;
  starts_at: string;
  ends_at: string;
  booking_number: string;
};

// Real outbox consumer with claim/lease (avoids two concurrent invocations —
// overlapping cron fires, or cron + a manual call — double-sending the same
// row) and a persistent run log (farm_job_runs) so "did this actually run"
// is a query, not a guess from terminal output.
export async function POST(request: Request) {
  const expected = process.env.JOB_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !sameSecret(actual, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const triggerSource = request.headers.get("x-trigger-source") === "cron" ? "cron" : "manual";

  const db = await getDb();
  const runId = await startJobRun(db, "reminders", triggerSource);
  const now = new Date().toISOString();
  const due = await db
    .prepare(
      `
    SELECT o.id, o.booking_id, o.recipient_id, o.attempt_count, b.cancelled_at,
           m.line_user_id, e.name AS experience, s.starts_at, s.ends_at, b.booking_number
    FROM farm_notification_outbox o
    JOIN farm_bookings b ON b.id = o.booking_id
    JOIN farm_slots s ON s.id = b.slot_id
    JOIN farm_experiences e ON e.id = s.experience_id
    LEFT JOIN members m ON m.id = o.recipient_id
    WHERE o.status = 'queued' AND o.channel = 'line'
      AND datetime(o.next_attempt_at) <= datetime(?)
      AND (o.leased_until IS NULL OR datetime(o.leased_until) < datetime(?))
    ORDER BY datetime(o.next_attempt_at)
    LIMIT 50
  `,
    )
    .bind(now, now)
    .all<DueRow>();

  const rows = due.results ?? [];
  const accessToken = env.LINE_MESSAGING_ACCESS_TOKEN;
  const leaseOwner = runId;

  let sent = 0;
  let cancelledStale = 0;
  let blockedNoCredentials = 0;
  let blockedNoRecipient = 0;
  let failed = 0;
  const errorCodes = new Set<string>();

  for (const row of rows) {
    const claimed = await claimRow(db, "farm_notification_outbox", row.id, leaseOwner);
    if (!claimed) continue; // another concurrent run already has this row

    if (row.cancelled_at) {
      await db.prepare("UPDATE farm_notification_outbox SET status = 'cancelled', leased_until = NULL WHERE id = ?").bind(row.id).run();
      cancelledStale += 1;
      continue;
    }
    if (!row.line_user_id) {
      // Permanent failure — no amount of retrying resolves a missing LINE
      // identity on the member row; needs a human to look at it.
      await db
        .prepare("UPDATE farm_notification_outbox SET status = 'failed', last_error = ?, leased_until = NULL WHERE id = ?")
        .bind("recipient_has_no_line_user_id", row.id)
        .run();
      blockedNoRecipient += 1;
      errorCodes.add("no_recipient");
      continue;
    }
    if (!accessToken) {
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db
        .prepare("UPDATE farm_notification_outbox SET attempt_count = attempt_count + 1, last_error = ?, next_attempt_at = ?, leased_until = NULL WHERE id = ?")
        .bind("line_messaging_access_token_not_configured", next, row.id)
        .run();
      blockedNoCredentials += 1;
      errorCodes.add("no_credentials");
      continue;
    }

    const text = composeDayBeforeReminderText({
      experience: row.experience, startsAt: row.starts_at, endsAt: row.ends_at, bookingNumber: row.booking_number,
    });
    const result = await sendLinePushMessage(accessToken, row.line_user_id, [{ type: "text", text }], row.id);
    if (result.ok) {
      await db
        .prepare("UPDATE farm_notification_outbox SET status = 'sent', accepted_at = ?, attempt_count = attempt_count + 1, leased_until = NULL WHERE id = ?")
        .bind(new Date().toISOString(), row.id)
        .run();
      sent += 1;
    } else {
      const errorClass = classifyLineError(result.status);
      const attemptsAfter = row.attempt_count + 1;
      // 憑證錯誤／永久錯誤：不再重試，直接進需人工處理；限流/暫時性錯誤才用
      // 既有backoff重試，重試次數用完才永久失敗。
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
    .prepare("SELECT MIN(datetime(next_attempt_at)) AS oldest FROM farm_notification_outbox WHERE status = 'queued' AND channel = 'line'")
    .first<{ oldest: string | null }>();
  const oldestPendingSeconds = oldestPending?.oldest
    ? Math.max(0, Math.floor((Date.now() - new Date(oldestPending.oldest).getTime()) / 1000))
    : null;

  const blocked = blockedNoCredentials + blockedNoRecipient;
  await completeJobRun(db, runId, { dueCount: rows.length, sent, failed, blocked }, oldestPendingSeconds, errorCodes.size ? Array.from(errorCodes).join(",") : null);

  return Response.json({
    mode: accessToken ? "processing" : "credentials_not_configured",
    dueCount: rows.length,
    sent, cancelledStale, blockedNoCredentials, blockedNoRecipient, failed,
    runId,
  });
}
