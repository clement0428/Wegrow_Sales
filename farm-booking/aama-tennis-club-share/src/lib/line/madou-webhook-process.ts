import "server-only";
import { claimBooking } from "@/lib/farm/claim";
import { composePrepDetailText, type WorkCardBooking } from "./madou-group-text";

export type MadouActorMember = { id: string; display_name: string; role: string };
export type MadouPostbackAction = "claim" | "view_prep" | "report_issue";
export type MadouProcessResult = { replyText: string };

// Shared DB logic for the three Madou-group postback actions — called once
// synchronously from the webhook handler (src/app/api/line/webhook/route.ts,
// for low-latency replies), and again later from the retry worker
// (src/app/api/jobs/madou-group/route.ts) for any attempt that threw the
// first time. LINE never redelivers an event that already got HTTP 200, so
// if nothing retries a failed first attempt, the action is lost forever —
// this function is written to be safely re-runnable (claim is already
// idempotent via its own atomic UPDATE; report_issue's audit-log insert is
// the one genuinely non-idempotent action here, but it's only reached if the
// webhook's own event-level dedupe already prevented a second attempt for
// the same LINE event — a retry is a second attempt at the SAME undelivered
// event, not a duplicate delivery).
//
// Does not call the LINE API itself — callers decide how to deliver
// replyText (reply token for the fast synchronous path; a group push for the
// retry path, since the original reply token is long expired by then).
// eventId is the originating LINE webhookEventId — threaded through so the
// one genuinely non-idempotent side effect here (report_issue's audit-log
// insert) can be keyed on it and made safe to re-run (INSERT OR IGNORE),
// since this function is called both from the webhook's own synchronous
// attempt and again from the retry worker for anything that failed —
// without this, a retried report_issue produced a second audit-log row for
// the same real-world report (found by review, confirmed by re-reading the
// code: the insert used a fresh random id with no dedupe key at all).
export async function processMadouPostbackAction(
  db: D1Database,
  action: MadouPostbackAction,
  bookingId: string,
  expectedVisitVersion: number | null,
  member: MadouActorMember,
  eventId: string,
): Promise<MadouProcessResult> {
  // 2026-10-19 Clement決定：麻豆現場群本身的verified group membership（已通過
  // LINE簽章驗證、source.groupId比對正式MADOU_GROUP_ID、source.userId存在）就是
  // 這三個動作唯一需要的授權——不再檢查member.role。這個function只會從
  // webhook-event-processor.ts(已做過上述三項驗證)跟它的retry worker被呼叫
  // （見本檔開頭說明），authenticated網站端的接單按鈕走完全不同的路徑
  // （/api/farm/admin/bookings/[id]/claim/route.ts自己呼叫requireStaff()+
  // canClaimBooking()，直接呼叫claim.ts的claimBooking，完全不經過這支function）
  // ——relax這裡的角色檢查不影響網站端仍然需要真正staff權限才能操作。
  if (action === "claim") {
    // A missing/unparseable `v` must REJECT, not silently skip the version
    // check — passing `undefined` through to claimBooking (its sentinel for
    // "no version check requested," used by the admin-UI route which has no
    // card version to compare against) would let a malformed or stripped
    // postback bypass the whole point of the version check. Found by review:
    // the previous version did exactly `expectedVisitVersion ?? undefined`,
    // which converts "missing" into "don't check" instead of "reject."
    if (expectedVisitVersion === null) {
      return { replyText: "此工作卡版本遺失或格式不正確，請使用最新訊息重新接單。" };
    }
    const result = await claimBooking(db, bookingId, member.id, "line_webhook", expectedVisitVersion);
    if (result.ok) return { replyText: `已由 ${member.display_name} 接單。` };
    if (result.reason === "already_claimed") return { replyText: `已有人接單：${result.claimedByName ?? "未知"}` };
    if (result.reason === "cancelled") return { replyText: "這筆預約已取消，無法接單。" };
    if (result.reason === "stale_card") return { replyText: "此工作卡已過期（預約已有更新），請用最新訊息重新接單。" };
    return { replyText: "找不到這筆預約。" };
  }

  if (action === "view_prep") {
    const booking = await fetchWorkCardBooking(db, bookingId);
    return { replyText: booking ? composePrepDetailText(booking) : "找不到這筆預約。" };
  }

  // report_issue — audit_log keeps the general action trail (same convention
  // as every other state transition in this codebase); farm_booking_issues
  // is the actual visible to-do staff see in the admin backend, since
  // review correctly pointed out audit_log alone means nobody ever sees
  // the report unless they go digging in raw logs. Both ids are derived
  // from eventId (not a random newId()) + INSERT OR IGNORE, so a
  // retried/duplicate-processed event never creates a second ticket for
  // the same real-world report.
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO farm_audit_log (id, entity_type, entity_id, actor_type, actor_id, action, from_state, to_state, reason, created_at)
       VALUES (?, 'farm_booking', ?, 'line_webhook', ?, 'report_issue', NULL, NULL, '現場透過麻豆群回報問題', ?)`,
    )
    .bind(`madou-report-${eventId}`, bookingId, member.id, nowIso)
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO farm_booking_issues (id, booking_id, reported_by_member_id, note, status, created_at)
       VALUES (?, ?, ?, '現場透過麻豆群回報問題', 'open', ?)`,
    )
    .bind(`madou-issue-${eventId}`, bookingId, member.id, nowIso)
    .run();
  return { replyText: "已記錄，將由管理員確認處理。" };
}

async function fetchWorkCardBooking(db: D1Database, bookingId: string): Promise<WorkCardBooking | null> {
  const row = await db
    .prepare(
      `SELECT b.id AS booking_id, b.booking_number, b.group_name, b.adult_count, b.child_count, b.infant_count,
              b.total_people, b.plant_count, b.meal_count, b.vegetarian_meal_count,
              s.starts_at, s.ends_at, e.name AS experience_name
       FROM farm_bookings b
       JOIN farm_slots s ON s.id = b.slot_id
       JOIN farm_experiences e ON e.id = s.experience_id
       WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<{
      booking_id: string; booking_number: string; group_name: string | null;
      adult_count: number; child_count: number; infant_count: number; total_people: number;
      plant_count: number; meal_count: number; vegetarian_meal_count: number;
      starts_at: string; ends_at: string; experience_name: string;
    }>();
  if (!row) return null;
  return {
    bookingId: row.booking_id, bookingNumber: row.booking_number, groupName: row.group_name,
    experience: row.experience_name, startsAt: row.starts_at, endsAt: row.ends_at,
    adultCount: row.adult_count, childCount: row.child_count, infantCount: row.infant_count,
    totalPeople: row.total_people, plantCount: row.plant_count, mealCount: row.meal_count,
    vegetarianMealCount: row.vegetarian_meal_count,
  };
}
