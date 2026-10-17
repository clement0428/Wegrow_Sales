import "server-only";
import { newId } from "@/lib/db/uuid";
import { confirmBooking } from "@/lib/farm/confirm-booking";

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "already_claimed"; claimedByName: string | null }
  | { ok: false; reason: "stale_card"; currentVisitVersion: number };

// Shared by the authenticated admin-UI claim endpoint and the Madou-group
// webhook's "我接單" postback — same atomic-conditional-update discipline as every
// other booking state transition (see status/route.ts, reschedule/route.ts):
// the WHERE clause, not a prior SELECT, is what actually prevents two staff from
// both winning the claim (規格第4.2節).
//
// expectedVisitVersion: a LINE work-card's "我接單" button carries the
// visit_version that was current when that card was composed. If the booking
// has since been rescheduled (visit_version incremented, claim released), the
// old card's button must NOT be able to silently claim the booking at its new
// date — found via real curl testing against local D1, not a hypothetical.
// Passing undefined skips the check entirely (admin-UI route doesn't carry a
// card version to compare against, so it keeps its original behavior).
export async function claimBooking(
  db: D1Database,
  bookingId: string,
  memberId: string,
  actorType: "staff" | "line_webhook" = "staff",
  expectedVisitVersion?: number,
): Promise<ClaimResult> {
  const now = new Date().toISOString();
  const versionClause = expectedVisitVersion === undefined ? "" : "AND visit_version = ?";
  const bindArgs = expectedVisitVersion === undefined ? [memberId, now, bookingId] : [memberId, now, bookingId, expectedVisitVersion];
  const result = await db
    .prepare(
      `UPDATE farm_bookings
       SET claimed_by_member_id = ?, claimed_at = ?
       WHERE id = ? AND cancelled_at IS NULL AND claimed_by_member_id IS NULL ${versionClause}`,
    )
    .bind(...bindArgs)
    .run();

  if (!result.meta.changes) {
    const current = await db
      .prepare(
        `SELECT b.claimed_by_member_id, m.display_name, b.cancelled_at, b.visit_version
         FROM farm_bookings b LEFT JOIN members m ON m.id = b.claimed_by_member_id
         WHERE b.id = ?`,
      )
      .bind(bookingId)
      .first<{ claimed_by_member_id: string | null; display_name: string | null; cancelled_at: string | null; visit_version: number }>();
    if (!current) return { ok: false, reason: "not_found" };
    if (current.cancelled_at) return { ok: false, reason: "cancelled" };
    if (current.claimed_by_member_id === null && expectedVisitVersion !== undefined && current.visit_version !== expectedVisitVersion) {
      return { ok: false, reason: "stale_card", currentVisitVersion: current.visit_version };
    }
    return { ok: false, reason: "already_claimed", claimedByName: current.display_name };
  }

  await db
    .prepare(
      `INSERT INTO farm_audit_log (id, entity_type, entity_id, actor_type, actor_id, action, from_state, to_state, reason, created_at)
       VALUES (?, 'farm_booking', ?, ?, ?, 'claim', 'unclaimed', 'claimed', '', ?)`,
    )
    .bind(newId(), bookingId, actorType, memberId, now)
    .run();

  // 2026-10-17審查：接待現場認領一筆仍在requested(待接待)狀態的預約，必須直接
  // 完成確認——不能留在「已認領但仍是requested」這種中間狀態，否則就是「先認領
  // 才confirmed」造成客戶永遠收不到成立通知的循環。confirmBooking()本身只對
  // booking_status='requested'生效，如果這筆早就被admin後台confirm過，這裡會
  // 安靜no-op(not_requested)，不影響claim本身已經成功的結果。
  await confirmBooking(db, bookingId, actorType, memberId);

  return { ok: true };
}
