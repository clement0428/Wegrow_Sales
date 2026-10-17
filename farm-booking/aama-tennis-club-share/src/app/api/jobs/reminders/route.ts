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
  const accessToken = env.LINE_MESSAGING_ACCESS_TOKEN;
  const leaseOwner = runId;

  let sent = 0;
  let cancelledStale = 0;
  let blockedNoCredentials = 0;
  let blockedNoRecipient = 0;
  let failed = 0;
  const errorCodes = new Set<string>();

  // 2026-10-17審查發現的真實D1額度問題：原本accessToken檢查寫在per-row迴圈
  // 「裡面」，代表即使一開始就知道沒設定憑證，還是會查出所有due rows、逐筆
  // claim+UPDATE（attempt_count+1）才放棄——這張表在憑證沒設定的這段期間完全
  // 是可預期的「一定失敗」，卻每個tick都在寫。改成在查due rows「之前」就先判斷：
  // 完全沒設定時，一筆都不碰，不查、不claim、不寫，連next_attempt_at都不動——
  // 不是「重試次數到了標failed放棄」（那樣會永久丟掉真實客戶這筆通知，憑證之後
  // 修好也不會再送），而是「沒設定時根本不嘗試」，額度成本是零，業務資料原封
  // 不動，哪天真的設定好了，下一個tick立刻正常撿起來處理。
  if (!accessToken) {
    await completeJobRun(db, runId, { dueCount: 0, sent: 0, failed: 0, blocked: 0 }, null, "no_credentials_skipped_entirely");
    return Response.json({ mode: "credentials_not_configured", dueCount: 0, sent, cancelledStale, blockedNoCredentials, blockedNoRecipient, failed, runId });
  }

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
    // 行前提醒的拜訪時間若已經過去才被處理到（例如憑證中斷了一段時間才修好，
    // 累積的舊佇列一次湧入），不能補送一則「明天見」卻是過去式的提醒——直接
    // 標cancelled，不浪費一次真實LINE API呼叫送出錯誤內容。
    if (new Date(row.starts_at).getTime() <= Date.now()) {
      await db.prepare("UPDATE farm_notification_outbox SET status = 'cancelled', last_error = 'visit_already_passed', leased_until = NULL WHERE id = ?").bind(row.id).run();
      cancelledStale += 1;
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

  await completeJobRun(db, runId, { dueCount: rows.length, sent, failed, blocked: blockedNoRecipient }, oldestPendingSeconds, errorCodes.size ? Array.from(errorCodes).join(",") : null);

  return Response.json({
    mode: "processing",
    dueCount: rows.length,
    sent, cancelledStale, blockedNoRecipient, failed,
    runId,
  });
}
