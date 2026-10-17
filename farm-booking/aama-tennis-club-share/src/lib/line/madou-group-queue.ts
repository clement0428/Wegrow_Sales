import "server-only";
import { newId } from "@/lib/db/uuid";
import {
  composeDailyDigestText, madouDigestDedupeKey, madouWorkCardDedupeKey,
  type DailyDigestBooking, type WorkCardBooking, type WorkCardEventKind,
} from "./madou-group-text";

// Sentinel recipient_id — farm_notification_outbox.recipient_id normally FKs
// (informally; no DB-level FK since members can be deleted) to a members row via
// jobs/reminders' join, but a LINE group isn't a member. channel='line_group' is
// what tells the Madou-group job to treat recipient_id as this constant instead of
// looking it up in members.
export const MADOU_GROUP_RECIPIENT_ID = "madou_group";

export type MadouWorkCardSnapshot = {
  eventKind: WorkCardEventKind;
  booking: WorkCardBooking;
  visitVersion: number; // embedded in the card's button postback data; the job
  // consumer also uses it to detect a newer event superseding this one before send.
  oldStartsAt?: string; // only set for eventKind === "rescheduled"
};

// INSERT OR IGNORE on the versioned+event-kind-scoped retry_key: calling this
// twice for the same (booking, visitVersion, eventKind) is a no-op, same
// idempotency guarantee queueSalesSyncEvent already relies on.
export async function queueMadouWorkCard(db: D1Database, visitVersion: number, snapshot: MadouWorkCardSnapshot): Promise<void> {
  const now = new Date().toISOString();
  const retryKey = madouWorkCardDedupeKey(snapshot.booking.bookingId, visitVersion, snapshot.eventKind);
  await db
    .prepare(
      `INSERT OR IGNORE INTO farm_notification_outbox
       (id, booking_id, channel, notification_type, recipient_id, content_snapshot_json, retry_key, status, attempt_count, scheduled_at, next_attempt_at, created_at)
       VALUES (?, ?, 'line_group', 'madou_work_card_event', ?, ?, ?, 'queued', 0, ?, ?, ?)`,
    )
    .bind(newId(), snapshot.booking.bookingId, MADOU_GROUP_RECIPIENT_ID, JSON.stringify(snapshot), retryKey, now, now, now)
    .run();
}

// The reply/ack to a staff member's postback action is a notification, not
// the business action itself — the action (claim/report_issue) already
// committed durably before this is ever called. If the fast path (reply
// token, or a retry-worker group push) fails to deliver, that must not be
// silently lost: queue it into the same durable, already-retried outbox the
// job route drains, keyed by eventId so calling this twice for the same
// event is a no-op.
//
// Returns a PREPARED (not yet executed) statement rather than running it,
// so the caller can put it in the same db.batch([...]) as the
// farm_line_webhook_events "mark processed" UPDATE. Found by review (round
// 2): marking an event 'processed' and then separately queuing the result
// as two independent awaits left a real crash window — a kill between them
// left the event permanently 'processed' (never retried) with the human
// ack lost forever. db.batch() commits both statements as a single D1
// transaction: either both land or neither does, so a crash mid-way leaves
// the event 'queued' for the retry worker to safely redo (idempotent either
// way — see processMadouPostbackAction).
export function buildQueueMadouWebhookResultStatement(db: D1Database, eventId: string, text: string): D1PreparedStatement {
  const now = new Date().toISOString();
  return db
    .prepare(
      `INSERT OR IGNORE INTO farm_notification_outbox
       (id, booking_id, channel, notification_type, recipient_id, content_snapshot_json, retry_key, status, attempt_count, scheduled_at, next_attempt_at, created_at)
       VALUES (?, NULL, 'line_group', 'madou_webhook_result', ?, ?, ?, 'queued', 0, ?, ?, ?)`,
    )
    .bind(newId(), MADOU_GROUP_RECIPIENT_ID, JSON.stringify({ text }), `madou:webhook-result:${eventId}`, now, now, now);
}

// Convenience wrapper for call sites that don't need batched atomicity
// (none currently — kept so a future simple caller doesn't have to know
// about the batch-statement variant).
export async function queueMadouWebhookResult(db: D1Database, eventId: string, text: string): Promise<void> {
  await buildQueueMadouWebhookResultStatement(db, eventId, text).run();
}

type TomorrowBookingRow = {
  booking_number: string;
  group_name: string | null;
  starts_at: string;
  total_people: number;
  claimed_by_name: string | null;
};

// Producer half of the daily digest (consumer half sends whatever's queued, same
// as any other outbox row — see jobs/madou-group/route.ts). booking_id is
// deliberately NULL here: the digest spans every booking for the date, not one.
// Idempotent per calendar date via INSERT OR IGNORE on the date-scoped retry_key —
// returns whether this call actually created the row (false if already enqueued
// today, or if it's not due yet).
export async function queueDailyDigestIfDue(db: D1Database, now: Date): Promise<boolean> {
  const { isDigestDue, digestTargetDateIso } = await import("@/lib/farm/madou-digest-schedule");
  if (!isDigestDue(now)) return false;
  const targetDate = digestTargetDateIso(now);
  const retryKey = madouDigestDedupeKey(targetDate);

  const rows = await db
    .prepare(
      `SELECT b.booking_number, b.group_name, s.starts_at, b.total_people, m.display_name AS claimed_by_name
       FROM farm_bookings b
       JOIN farm_slots s ON s.id = b.slot_id
       LEFT JOIN members m ON m.id = b.claimed_by_member_id
       WHERE b.booking_status = 'confirmed' AND b.cancelled_at IS NULL
         AND date(s.starts_at, '+8 hours') = ?
       ORDER BY s.starts_at`,
    )
    .bind(targetDate)
    .all<TomorrowBookingRow>();

  const digestBookings: DailyDigestBooking[] = (rows.results ?? []).map((r) => ({
    bookingNumber: r.booking_number, groupName: r.group_name, startsAt: r.starts_at,
    totalPeople: r.total_people, claimedByName: r.claimed_by_name,
  }));
  const text = composeDailyDigestText(targetDate, digestBookings);
  const nowIso = now.toISOString();

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO farm_notification_outbox
       (id, booking_id, channel, notification_type, recipient_id, content_snapshot_json, retry_key, status, attempt_count, scheduled_at, next_attempt_at, created_at)
       VALUES (?, NULL, 'line_group', 'madou_daily_digest', ?, ?, ?, 'queued', 0, ?, ?, ?)`,
    )
    .bind(newId(), MADOU_GROUP_RECIPIENT_ID, JSON.stringify({ targetDate, text }), retryKey, nowIso, nowIso, nowIso)
    .run();
  return result.meta.changes > 0;
}
