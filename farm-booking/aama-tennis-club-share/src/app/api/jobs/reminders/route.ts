import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { composeDayBeforeReminderText } from "@/lib/line/reminder-text";
import { MAX_SEND_ATTEMPTS, nextAttemptDelayMinutes, sendLinePushMessage } from "@/lib/line/messaging";

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

// Real outbox consumer — was previously a stub that only ever returned
// "not_configured" with processed:0. Runs its full logic (query due rows,
// skip stale/cancelled bookings, resolve the LINE user id, compose the
// message, retry with backoff) regardless of whether
// LINE_MESSAGING_ACCESS_TOKEN is set; only the final network call is gated
// on the credential, and its absence is recorded as a real per-row failure
// (blockedNoCredentials), not silently skipped or faked as success.
export async function POST(request: Request) {
  const expected = process.env.JOB_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !sameSecret(actual, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = await getDb();
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
    ORDER BY datetime(o.next_attempt_at)
    LIMIT 50
  `,
    )
    .bind(now)
    .all<DueRow>();

  const rows = due.results ?? [];
  const accessToken = env.LINE_MESSAGING_ACCESS_TOKEN;

  let sent = 0;
  let cancelledStale = 0;
  let blockedNoCredentials = 0;
  let blockedNoRecipient = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.cancelled_at) {
      await db.prepare("UPDATE farm_notification_outbox SET status = 'cancelled' WHERE id = ?").bind(row.id).run();
      cancelledStale += 1;
      continue;
    }
    if (!row.line_user_id) {
      // Permanent failure — no amount of retrying resolves a missing LINE
      // identity on the member row; needs a human to look at it.
      await db
        .prepare("UPDATE farm_notification_outbox SET status = 'failed', last_error = ? WHERE id = ?")
        .bind("recipient_has_no_line_user_id", row.id)
        .run();
      blockedNoRecipient += 1;
      continue;
    }
    if (!accessToken) {
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db
        .prepare("UPDATE farm_notification_outbox SET attempt_count = attempt_count + 1, last_error = ?, next_attempt_at = ? WHERE id = ?")
        .bind("line_messaging_access_token_not_configured", next, row.id)
        .run();
      blockedNoCredentials += 1;
      continue;
    }

    const text = composeDayBeforeReminderText({
      experience: row.experience, startsAt: row.starts_at, endsAt: row.ends_at, bookingNumber: row.booking_number,
    });
    const result = await sendLinePushMessage(accessToken, row.line_user_id, [{ type: "text", text }]);
    if (result.ok) {
      await db
        .prepare("UPDATE farm_notification_outbox SET status = 'sent', accepted_at = ?, attempt_count = attempt_count + 1 WHERE id = ?")
        .bind(new Date().toISOString(), row.id)
        .run();
      sent += 1;
    } else {
      const attemptsAfter = row.attempt_count + 1;
      const permanentlyFailed = attemptsAfter >= MAX_SEND_ATTEMPTS;
      const delayMinutes = nextAttemptDelayMinutes(row.attempt_count);
      const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
      await db
        .prepare(
          `UPDATE farm_notification_outbox
           SET attempt_count = ?, last_error = ?, next_attempt_at = ?, status = ?
           WHERE id = ?`,
        )
        .bind(attemptsAfter, `${result.status}: ${result.error}`, next, permanentlyFailed ? "failed" : "queued", row.id)
        .run();
      failed += 1;
    }
  }

  return Response.json({
    mode: accessToken ? "processing" : "credentials_not_configured",
    dueCount: rows.length,
    sent, cancelledStale, blockedNoCredentials, blockedNoRecipient, failed,
  });
}
