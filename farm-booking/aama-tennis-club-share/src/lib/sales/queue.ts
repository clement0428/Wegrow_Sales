import "server-only";
import { newId } from "@/lib/db/uuid";

// Queue a Sales-sync event for a booking. retry_key = bookingId:eventType so
// the same event can never be queued twice for the same booking (matches
// spec: "重複事件不重建客戶或訂單") — INSERT OR IGNORE makes this idempotent
// even if called twice for the same transition.
export async function queueSalesSyncEvent(
  db: D1Database,
  bookingId: string,
  eventType: "booking_created" | "booking_confirmed" | "booking_cancelled",
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO farm_sales_sync_outbox
       (id, booking_id, event_type, retry_key, status, attempt_count, scheduled_at, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
    )
    .bind(newId(), bookingId, eventType, `${bookingId}:${eventType}`, now, now, now)
    .run();
}
