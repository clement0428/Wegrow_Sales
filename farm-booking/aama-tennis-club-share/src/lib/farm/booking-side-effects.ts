import "server-only";
import { queueSalesSyncEvent } from "@/lib/sales/queue";
import { queueMadouWorkCard } from "@/lib/line/madou-group-queue";
import { markEligibilitySessionUsed } from "@/lib/farm/eligibility-session";

type BookingSideEffectsRow = {
  id: string; booking_number: string; slot_id: string; group_name: string | null;
  adult_count: number; child_count: number; infant_count: number; total_people: number;
  plant_count: number; meal_count: number; vegetarian_meal_count: number;
  payment_status: string; booking_status: string; cancelled_at: string | null; visit_version: number;
};

// 2026-10-18二次修正：原本不管booking現在實際是什麼狀態，一律補一張
// eventKind:'pending', visitVersion:1 的卡——如果booking在「INSERT成功、
// outbox寫入失敗」這個空窗期之後，已經被confirm或cancel過，這裡重建的卡會是
// 過期內容，誤導現場。改成讀取booking「現在」的真實狀態決定要補哪一種卡。
function currentWorkCardEventKind(row: BookingSideEffectsRow): "pending" | "confirmed" | "cancelled" {
  if (row.cancelled_at) return "cancelled";
  if (row.booking_status === "confirmed") return "confirmed";
  return "pending";
}

// 這支函式有兩種呼叫情境，都依賴queueSalesSyncEvent/queueMadouWorkCard本身
// INSERT OR IGNORE＋決定性retry_key的冪等設計（已經成功過的是no-op，真正漏掉
// 的才會補上，不會重複建立）：
// 1. /api/farm/bookings的idempotencyKey重複偵測路徑——客戶自己重新整理頁面
//    重試時呼叫。
// 2. /api/jobs/madou-group每個tick執行的對帳掃描（見reconcileMissingWorkCards）
//    ——即使客戶完全不再操作，近期建立的預約如果缺工作卡，也會在下一個tick
//    （最多15分鐘內）被自動補上，不依賴客戶重試。
export async function ensureBookingSideEffectsQueued(
  db: D1Database, bookingId: string, eligibilityNonce?: string, idempotencyKey?: string,
): Promise<void> {
  const booking = await db
    .prepare(
      `SELECT b.id, b.booking_number, b.slot_id, b.group_name, b.adult_count, b.child_count, b.infant_count,
              b.total_people, b.plant_count, b.meal_count, b.vegetarian_meal_count, b.payment_status,
              b.booking_status, b.cancelled_at, b.visit_version
       FROM farm_bookings b WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<BookingSideEffectsRow>();
  if (!booking) return;
  const slot = await db
    .prepare(`SELECT s.starts_at, s.ends_at, e.name AS experience_name FROM farm_slots s JOIN farm_experiences e ON e.id = s.experience_id WHERE s.id = ?`)
    .bind(booking.slot_id)
    .first<{ starts_at: string; ends_at: string; experience_name: string }>();
  if (!slot) return;

  if (booking.payment_status === "not_required" && eligibilityNonce && idempotencyKey) {
    await markEligibilitySessionUsed(db, eligibilityNonce, idempotencyKey).catch(() => {});
  }
  await queueSalesSyncEvent(db, booking.id, "booking_created");

  const eventKind = currentWorkCardEventKind(booking);
  if (eventKind === "pending" && booking.visit_version !== 1) {
    // booking還在'requested'（沒confirm/cancel），但visit_version已經>1代表
    // 期間改期過——改期的work card需要oldStartsAt（改期前的時段），這裡補不出
    // 這個歷史資訊，重建一張「假裝從未改期」的pending卡會是錯的。沒有安全的
    // 自動補法，寧可略過讓人工發現，不要塞一張內容錯誤的卡。
    return;
  }
  await queueMadouWorkCard(db, eventKind === "pending" ? 1 : booking.visit_version, {
    eventKind,
    visitVersion: eventKind === "pending" ? 1 : booking.visit_version,
    booking: {
      bookingId: booking.id, bookingNumber: booking.booking_number, groupName: booking.group_name,
      experience: slot.experience_name, startsAt: slot.starts_at, endsAt: slot.ends_at,
      adultCount: booking.adult_count, childCount: booking.child_count, infantCount: booking.infant_count,
      totalPeople: booking.total_people, plantCount: booking.plant_count, mealCount: booking.meal_count,
      vegetarianMealCount: booking.vegetarian_meal_count,
    },
  });
}

// 對帳掃描：不依賴客戶重試，每個madou-group job tick主動找「最近建立、現在
// 這個狀態應該要有一張工作卡、但outbox裡完全沒有這張卡（不管queued/sent/
// failed/cancelled哪種狀態）」的預約，呼叫ensureBookingSideEffectsQueued()
// 補上。限定「最近」（預設72小時內）是為了不要每個tick都全表掃描——如果
// 超過這個窗口還沒補上，代表已經不是「系統暫時性錯誤」能解釋的情況，需要
// 人工介入，不該讓自動對帳無限期重試舊資料。
const RECONCILE_WINDOW_HOURS = 72;

export async function reconcileMissingWorkCards(db: D1Database): Promise<{ scanned: number; recovered: number }> {
  const since = new Date(Date.now() - RECONCILE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const candidates = await db
    .prepare(
      `SELECT b.id, b.visit_version, b.cancelled_at, b.booking_status
       FROM farm_bookings b
       WHERE b.created_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM farm_notification_outbox o
           WHERE o.booking_id = b.id AND o.notification_type = 'madou_work_card_event'
             AND o.retry_key = b.id || ':madou:' ||
                 (CASE WHEN b.cancelled_at IS NOT NULL THEN b.visit_version
                       WHEN b.booking_status = 'confirmed' THEN b.visit_version
                       ELSE 1 END)
                 || ':work_card:' ||
                 (CASE WHEN b.cancelled_at IS NOT NULL THEN 'cancelled'
                       WHEN b.booking_status = 'confirmed' THEN 'confirmed'
                       ELSE 'pending' END)
         )
       LIMIT 20`,
    )
    .bind(since)
    .all<{ id: string; visit_version: number; cancelled_at: string | null; booking_status: string }>();
  const rows = candidates.results ?? [];
  for (const row of rows) {
    await ensureBookingSideEffectsQueued(db, row.id);
  }
  return { scanned: rows.length, recovered: rows.length };
}
