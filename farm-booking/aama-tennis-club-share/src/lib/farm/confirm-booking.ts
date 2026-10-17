import "server-only";
import { newId } from "@/lib/db/uuid";
import { reminderAtForVisit, reminderDedupeKey } from "@/lib/farm/reminders";
import { queueMadouWorkCard } from "@/lib/line/madou-group-queue";
import { queueSalesSyncEvent } from "@/lib/sales/queue";

export type ConfirmBookingResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_requested" };

// 待接待(requested)→confirmed的唯一入口。審查明確要求：admin後台明確按「確認」
// (status/route.ts)跟現場人員透過claim「我來接待」自動確認(claim.ts)不能是兩套
// 不一致的SQL——這裡統一原本只存在於status/route.ts confirm分支裡的side
// effects：atomic狀態轉換＋稽核紀錄＋day-before提醒入列＋麻豆群confirmed卡＋
// Sales同步，兩個呼叫端共用同一份邏輯。
export async function confirmBooking(db: D1Database, bookingId: string, actorType: "staff" | "line_webhook", actorId: string): Promise<ConfirmBookingResult> {
  const now = new Date().toISOString();
  const result = await db
    .prepare("UPDATE farm_bookings SET booking_status = 'confirmed', version = version + 1, updated_at = ? WHERE id = ? AND booking_status = 'requested' AND cancelled_at IS NULL")
    .bind(now, bookingId)
    .run();

  if (!result.meta.changes) {
    const row = await db.prepare("SELECT id FROM farm_bookings WHERE id = ?").bind(bookingId).first<{ id: string }>();
    return { ok: false, reason: row ? "not_requested" : "not_found" };
  }

  await db
    .prepare(
      `INSERT INTO farm_audit_log (id, entity_type, entity_id, actor_type, actor_id, action, from_state, to_state, reason, created_at)
       VALUES (?, 'farm_booking', ?, ?, ?, 'confirm', 'requested', 'confirmed', '', ?)`,
    )
    .bind(newId(), bookingId, actorType, actorId, now)
    .run();

  const before = await db
    .prepare(
      `SELECT slot_id, customer_member_id, visit_version, booking_number, group_name,
              adult_count, child_count, infant_count, total_people, plant_count, meal_count, vegetarian_meal_count
       FROM farm_bookings WHERE id = ?`,
    )
    .bind(bookingId)
    .first<{
      slot_id: string; customer_member_id: string | null; visit_version: number;
      booking_number: string; group_name: string | null;
      adult_count: number; child_count: number; infant_count: number; total_people: number;
      plant_count: number; meal_count: number; vegetarian_meal_count: number;
    }>();
  // 狀態轉換本身已經成功提交——下面這些是附屬通知，理論上不會查不到剛更新的
  // 同一筆資料，但萬一發生也不該讓已經成功的狀態轉換回報成失敗。
  if (!before) return { ok: true };

  const slot = await db
    .prepare(`SELECT s.starts_at, s.ends_at, e.name AS experience_name FROM farm_slots s JOIN farm_experiences e ON e.id = s.experience_id WHERE s.id = ?`)
    .bind(before.slot_id)
    .first<{ starts_at: string; ends_at: string; experience_name: string }>();

  if (before.customer_member_id && slot) {
    const scheduledAt = reminderAtForVisit(slot.starts_at).toISOString();
    const retryKey = reminderDedupeKey(bookingId, before.visit_version);
    await db
      .prepare(
        `INSERT OR IGNORE INTO farm_notification_outbox
         (id, booking_id, channel, notification_type, recipient_id, content_snapshot_json, retry_key, status, attempt_count, scheduled_at, next_attempt_at, created_at)
         VALUES (?, ?, 'line', 'day_before_reminder', ?, ?, ?, 'queued', 0, ?, ?, ?)`,
      )
      .bind(
        newId(), bookingId, before.customer_member_id,
        JSON.stringify({ bookingId, visitVersion: before.visit_version, note: "LINE Messaging API credentials not configured — this row queues, actual send is BLOCKED until credentials exist. See jobs/reminders route." }),
        retryKey, scheduledAt, scheduledAt, now,
      )
      .run();
  }
  if (slot) {
    await queueMadouWorkCard(db, before.visit_version, {
      eventKind: "confirmed",
      visitVersion: before.visit_version,
      booking: {
        bookingId, bookingNumber: before.booking_number, groupName: before.group_name,
        experience: slot.experience_name, startsAt: slot.starts_at, endsAt: slot.ends_at,
        adultCount: before.adult_count, childCount: before.child_count, infantCount: before.infant_count,
        totalPeople: before.total_people, plantCount: before.plant_count, mealCount: before.meal_count,
        vegetarianMealCount: before.vegetarian_meal_count,
      },
    });
  }
  await queueSalesSyncEvent(db, bookingId, "booking_confirmed");
  return { ok: true };
}
