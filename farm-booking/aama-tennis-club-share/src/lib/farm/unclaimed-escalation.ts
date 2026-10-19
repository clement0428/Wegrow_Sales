import "server-only";
import { newId } from "@/lib/db/uuid";
import { getUnclaimedEscalationMinutes } from "@/lib/farm/settings";
import { MADOU_GROUP_RECIPIENT_ID } from "@/lib/line/madou-group-queue";
import type { WorkCardBooking } from "@/lib/line/madou-group-text";

type UnclaimedRow = {
  id: string;
  booking_number: string;
  group_name: string | null;
  confirmed_at: string;
  visit_version: number;
  adult_count: number;
  child_count: number;
  infant_count: number;
  total_people: number;
  plant_count: number;
  meal_count: number;
  vegetarian_meal_count: number;
  starts_at: string;
  ends_at: string;
  experience_name: string;
};

export type EscalationCandidate = { booking: WorkCardBooking; visitVersion: number; waitingMinutes: number };

// 門檻沒設定＝停用，連查詢都不做（跟reminders/madou-group job既有的
// 「缺設定就整段不進」原則一致）。每個(booking_id, visit_version)只升級一次——
// 持續未接單的狀況由後台「未接單清單」常駐顯示等待分鐘數負責，不是靠LINE群組
// 反覆催促洗版。
export async function findUnclaimedEscalationCandidates(db: D1Database, now: Date): Promise<EscalationCandidate[]> {
  const minutes = await getUnclaimedEscalationMinutes(db);
  if (minutes === null) return [];

  const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();
  const result = await db
    .prepare(
      `SELECT b.id, b.booking_number, b.group_name, b.confirmed_at, b.visit_version,
              b.adult_count, b.child_count, b.infant_count, b.total_people,
              b.plant_count, b.meal_count, b.vegetarian_meal_count,
              s.starts_at, s.ends_at, e.name AS experience_name
       FROM farm_bookings b
       JOIN farm_slots s ON s.id = b.slot_id
       JOIN farm_experiences e ON e.id = s.experience_id
       WHERE b.booking_status = 'confirmed' AND b.cancelled_at IS NULL AND b.claimed_by_member_id IS NULL
         AND b.confirmed_at IS NOT NULL AND datetime(b.confirmed_at) <= datetime(?)
         AND NOT EXISTS (
           SELECT 1 FROM farm_notification_outbox o
           WHERE o.retry_key = 'madou:unclaimed-escalation:' || b.id || ':' || b.visit_version
         )
       LIMIT 50`,
    )
    .bind(cutoff)
    .all<UnclaimedRow>();

  return (result.results ?? []).map((r) => ({
    visitVersion: r.visit_version,
    waitingMinutes: Math.max(0, Math.floor((now.getTime() - Date.parse(r.confirmed_at)) / 60000)),
    booking: {
      bookingId: r.id, bookingNumber: r.booking_number, groupName: r.group_name,
      experience: r.experience_name, startsAt: r.starts_at, endsAt: r.ends_at,
      adultCount: r.adult_count, childCount: r.child_count, infantCount: r.infant_count,
      totalPeople: r.total_people, plantCount: r.plant_count, mealCount: r.meal_count,
      vegetarianMealCount: r.vegetarian_meal_count,
    },
  }));
}

export function unclaimedEscalationRetryKey(bookingId: string, visitVersion: number): string {
  return `madou:unclaimed-escalation:${bookingId}:${visitVersion}`;
}

export async function queueUnclaimedEscalations(db: D1Database, candidates: EscalationCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  const now = new Date().toISOString();
  const statements = candidates.map((c) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO farm_notification_outbox
         (id, booking_id, channel, notification_type, recipient_id, content_snapshot_json, retry_key, status, attempt_count, scheduled_at, next_attempt_at, created_at)
         VALUES (?, ?, 'line_group', 'madou_unclaimed_escalation', ?, ?, ?, 'queued', 0, ?, ?, ?)`,
      )
      .bind(
        newId(), c.booking.bookingId, MADOU_GROUP_RECIPIENT_ID,
        JSON.stringify({ booking: c.booking, visitVersion: c.visitVersion, waitingMinutes: c.waitingMinutes }),
        unclaimedEscalationRetryKey(c.booking.bookingId, c.visitVersion),
        now, now, now,
      ),
  );
  const results = await db.batch(statements);
  return results.filter((r) => r.meta.changes > 0).length;
}
