import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { calculateVisitPrice } from "@/lib/farm/pricing";
import { findBooking, listMemberBookings } from "@/lib/farm/repository";
import { getCurrentMember } from "@/lib/auth/current-member";
import { isAllowedBookingSlot, ticketRateBpsForSlot } from "@/lib/farm/visit-policy";
import { queueSalesSyncEvent } from "@/lib/sales/queue";
import { checkAdoptionVisitEligibility } from "@/lib/farm/adoption-eligibility";

const createSchema = z.object({
  slotId: z.string().min(1).max(100),
  adultCount: z.number().int().min(1).max(50),
  childCount: z.number().int().min(0).max(50),
  infantCount: z.number().int().min(0).max(50),
  plantCount: z.number().int().min(0).max(50),
  mealCount: z.number().int().min(0).max(50),
  vegetarianMealCount: z.number().int().min(0).max(50).default(0),
  contactName: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^09\d{8}$/),
  groupName: z.string().trim().max(100).default(""),
  note: z.string().trim().max(1000).default(""),
  idempotencyKey: z.string().uuid(),
  // 認養客戶免費參訪：email是farm-booking(LINE身分)跟Orbit企業認養入口(email身分)
  // 唯一的橋接鍵，沒有既有連結可以沿用（見adoption-eligibility.ts）。省略此欄位
  // 完全不影響既有付費/人工確認流程——這是新增能力，不是取代既有流程。
  email: z.string().trim().toLowerCase().email().max(200).optional(),
});

function taipeiDateIso(isoDateTime: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(isoDateTime));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function makeLookupCode() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
}

function makeBookingNumber() {
  const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  return `WG-${date}-${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "預約資料不完整", issues: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;
  const totalPeople = input.adultCount + input.childCount + input.infantCount;
  // 30 here is the flat per-session cap (2026-09-18 rule): even a single
  // group can never exceed it, so this fails fast with a clear message
  // instead of falling through to the generic capacity_changed 409 from
  // the DB check below.
  if (totalPeople > 30 || input.plantCount > totalPeople || input.mealCount > totalPeople) {
    return Response.json({ error: "人數或加購數量超出可接受範圍" }, { status: 400 });
  }
  if (input.vegetarianMealCount > input.mealCount) {
    return Response.json({ error: "素食份數不可超過餐飲總份數" }, { status: 400 });
  }

  const db = await getDb();
  const member = await getCurrentMember();
  // 冪等回傳也需確認預約擁有者（2026-10-17審查）：idempotencyKey是client產生的
  // UUID，正常情況下同一瀏覽器session重送會帶同一把key、同一個member/anonymous
  // 狀態；如果key相符但擁有者對不上（猜測/盜用key的情況），不能把別人的預約資料
  // 原封不動回傳——回409請對方重新送出，不當成「這就是你的預約」直接洩漏。
  const prior = await db.prepare(
    "SELECT contact_phone, lookup_code, customer_member_id FROM farm_bookings WHERE idempotency_key = ?",
  ).bind(input.idempotencyKey).first<{ contact_phone: string; lookup_code: string; customer_member_id: string | null }>();
  if (prior) {
    if (prior.customer_member_id !== (member?.id ?? null)) {
      return Response.json({ error: "這個預約代碼無法驗證擁有者，請重新送出預約。", code: "idempotency_owner_mismatch" }, { status: 409 });
    }
    const existing = await findBooking(prior.contact_phone, prior.lookup_code);
    return Response.json({ booking: existing, duplicate: true });
  }

  const slot = await db.prepare(
    "SELECT starts_at, ends_at FROM farm_slots WHERE id = ? LIMIT 1",
  ).bind(input.slotId).first<{ starts_at: string; ends_at: string }>();
  if (!slot || !isAllowedBookingSlot(slot.starts_at, slot.ends_at)) {
    return Response.json({ error: "這個時段不符合農場開放規則，請重新選擇。" }, { status: 400 });
  }
  const ticketRateBps = ticketRateBpsForSlot(slot.starts_at);

  // 認養客戶免費參訪（2026-10-17）：只在客戶主動提供email時才核對資格——省略
  // email完全不影響既有付費/人工確認流程。資格核對以「所選參訪日期」為準，不是
  // 以今天為準；查不到資格或服務本身打不通，一律不自動轉收費，直接拒絕這次送出
  // 並清楚告知原因，交由Clement邀請／人工確認處理，不悄悄當成一般付費訂單。
  let isAdoptionFreeVisit = false;
  let adoptionSourceOrganizationId: string | null = null;
  let adoptionSourceContractId: string | null = null;
  if (input.email) {
    if (input.plantCount > 0 || input.mealCount > 0) {
      return Response.json({ error: "認養客戶免費參訪暫不支援加購植栽或餐飲，如有需求請聯絡現場協助安排。" }, { status: 400 });
    }
    const visitDateIso = taipeiDateIso(slot.starts_at);
    const eligibility = await checkAdoptionVisitEligibility(input.email, visitDateIso);
    if (!eligibility.ok) {
      return Response.json({ error: "認養資格查詢服務暫時無法使用，請稍後再試，或聯絡客服協助確認。", code: "eligibility_service_unavailable" }, { status: 503 });
    }
    if (!eligibility.eligible) {
      return Response.json({
        error: "這個email目前不符合所選參訪日期的認養免費資格，如需協助請聯絡威果確認邀請或合約範圍。",
        code: "not_eligible_for_free_visit",
        reason: eligibility.reason,
      }, { status: 403 });
    }
    isAdoptionFreeVisit = true;
    adoptionSourceOrganizationId = eligibility.sourceOrganizationId;
    adoptionSourceContractId = eligibility.sourceContractId;
  }

  const price = isAdoptionFreeVisit
    ? { ticketUnitPriceTwd: 0, ticketSubtotalTwd: 0, addOnSubtotalTwd: 0, creditAppliedTwd: 0, creditRemainingTwd: 0, totalTwd: 0 }
    : calculateVisitPrice({
      people: totalPeople,
      plantCount: input.plantCount,
      mealCount: input.mealCount,
      ticketRateBps,
    });
  const id = newId();
  const number = makeBookingNumber();
  const code = makeLookupCode();
  const now = new Date().toISOString();
  const ticketSnapshot = JSON.stringify({
    status: isAdoptionFreeVisit ? "adoption_free_visit" : "approved_booking_price",
    priceSource: isAdoptionFreeVisit ? "adoption_visit" : "standard_rate",
    ...(isAdoptionFreeVisit ? { adoptionSourceOrganizationId, adoptionSourceContractId } : {}),
    ticketRateBps,
    people: totalPeople,
    plantCount: input.plantCount,
    mealCount: input.mealCount,
    vegetarianMealCount: input.vegetarianMealCount,
    ...price,
  });

  // A single conditional INSERT keeps capacity checking and reservation creation atomic in D1.
  const result = await db.prepare(`
    INSERT INTO farm_bookings (
      id, booking_number, lookup_code, slot_id, customer_member_id, contact_name, contact_phone, group_name,
      adult_count, child_count, infant_count, total_people, plant_count, meal_count, vegetarian_meal_count,
      customer_note, amount_twd, booking_status, payment_status, hold_expires_at,
      ticket_snapshot_json, policy_snapshot_json, idempotency_key, created_at, updated_at
    )
    SELECT ?, ?, ?, s.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           'requested', ?, NULL, ?,
           json_object(
             'capacityPolicyId', p.id,
             'maxGroups', p.max_groups,
             'limitOneGroup', p.limit_one_group,
             'limitTwoGroups', p.limit_two_groups,
             'limitThreeGroups', p.limit_three_groups
           ), ?, ?, ?
    FROM farm_slots s
    JOIN farm_capacity_policies p ON p.id = s.capacity_policy_id
    WHERE s.id = ? AND s.status = 'open'
      AND datetime(s.starts_at) > datetime(?)
      AND datetime(s.booking_cutoff_at) > datetime(?)
      AND (
        SELECT COUNT(*) FROM farm_bookings b
        WHERE b.slot_id = s.id AND (
          b.booking_status IN ('requested','confirmed') OR
          (b.booking_status = 'pending_payment' AND datetime(b.hold_expires_at) > datetime(?))
        )
      ) < p.max_groups
      AND (
        SELECT COALESCE(SUM(b.total_people), 0) FROM farm_bookings b
        WHERE b.slot_id = s.id AND (
          b.booking_status IN ('requested','confirmed') OR
          (b.booking_status = 'pending_payment' AND datetime(b.hold_expires_at) > datetime(?))
        )
      ) + ? <= CASE (
        SELECT COUNT(*) + 1 FROM farm_bookings b
        WHERE b.slot_id = s.id AND (
          b.booking_status IN ('requested','confirmed') OR
          (b.booking_status = 'pending_payment' AND datetime(b.hold_expires_at) > datetime(?))
        )
      )
        WHEN 1 THEN p.limit_one_group
        WHEN 2 THEN p.limit_two_groups
        WHEN 3 THEN p.limit_three_groups
        ELSE 0
      END
  `).bind(
    id, number, code, member?.id ?? null, input.contactName, input.phone, input.groupName,
    input.adultCount, input.childCount, input.infantCount, totalPeople,
    input.plantCount, input.mealCount, input.vegetarianMealCount, input.note, price.totalTwd,
    // 免費認養參訪用「不需付款」，不是"not_open"(尚未開放付款)——後者在前台/查詢
    // API會顯示「尚未開放付款」文字，對一筆金額本來就是0、永遠不會有付款流程的
    // 預約講這句話是錯的訊息。這個欄位沒有CHECK約束(已核對0006 migration)，
    // 加新值不需要migration。
    isAdoptionFreeVisit ? "not_required" : "not_open",
    ticketSnapshot, input.idempotencyKey, now, now, input.slotId,
    now, now, now, now, totalPeople, now,
  ).run();

  if (!result.meta.changes) {
    return Response.json({
      error: "這個時段的名額剛被其他預約使用，請重新選擇場次。",
      code: "capacity_changed",
    }, { status: 409 });
  }

  await queueSalesSyncEvent(db, id, "booking_created");

  const booking = await findBooking(input.phone, code);
  return Response.json({
    booking,
    payment: isAdoptionFreeVisit
      ? { enabled: false, status: "費用：免費" }
      : { enabled: false, status: "尚未開放付款" },
    message: isAdoptionFreeVisit
      ? "已收到預約，確認接待後通知您。"
      : "已收到預約申請，農場確認後會透過 LINE 或電話聯繫。",
  }, { status: 201 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("mine") === "1") {
    const member = await getCurrentMember();
    if (!member) return Response.json({ error: "尚未使用 LINE 登入" }, { status: 401 });
    return Response.json({
      bookings: await listMemberBookings(member.id),
      member: { displayName: member.display_name },
      payment: { enabled: false, status: "尚未開放付款" },
    });
  }
  const phone = (url.searchParams.get("phone") ?? "").replace(/\D/g, "");
  const code = (url.searchParams.get("code") ?? "").trim();
  if (!/^09\d{8}$/.test(phone) || !/^[A-Za-z0-9]{8}$/.test(code)) {
    return Response.json({ error: "請輸入手機號碼與 8 碼查詢碼" }, { status: 400 });
  }
  const booking = await findBooking(phone, code);
  if (!booking) return Response.json({ error: "找不到符合的預約" }, { status: 404 });
  // 免費認養預約查詢時不該顯示「尚未開放付款」——那句話暗示以後會要付款，
  // 但這筆金額本來就是0、永遠不會有付款流程。
  const isFree = booking.paymentStatus === "not_required";
  return Response.json({ booking, payment: isFree ? { enabled: false, status: "費用：免費" } : { enabled: false, status: "尚未開放付款" } });
}
