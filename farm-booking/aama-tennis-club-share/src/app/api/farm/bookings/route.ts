import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { calculateVisitPrice } from "@/lib/farm/pricing";
import { findBooking, listMemberBookings } from "@/lib/farm/repository";
import { getCurrentMember } from "@/lib/auth/current-member";
import { isAllowedBookingSlot, ticketRateBpsForSlot } from "@/lib/farm/visit-policy";
import { queueSalesSyncEvent } from "@/lib/sales/queue";
import { redeemAdoptionEligibilityNonce } from "@/lib/farm/adoption-eligibility";
import { ELIGIBILITY_SESSION_COOKIE, checkEligibilitySession, markEligibilitySessionUsed } from "@/lib/farm/eligibility-session";
import { taipeiDateIso } from "@/lib/farm/taipei-date";
import { queueMadouWorkCard } from "@/lib/line/madou-group-queue";

// Orbit那端回的reason要分成兩類給客戶看：一類是「這次驗證session本身失效了」
// （過期、被用過、日期對不上、根本找不到）——這些都該導回「請重新驗證」而不是
// 「你不符合資格」，因為這跟客戶真實的認養身分無關，只是token的時效/狀態問題；
// 另一類才是核對過真實身分跟合約後「確實不符合」。系統性故障（503）又是第三類，
// 不能跟任一類混在一起說成「資格未通過」。
const STALE_ELIGIBILITY_REASONS = new Set([
  "nonce_not_found", "nonce_expired", "nonce_already_consumed", "visit_date_mismatch",
]);

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
  // 認養客戶免費參訪（2026-10-17修正）：不再接受客戶自行填寫email——email只是
  // 查詢鍵不是身分證明，任何人填別人的email就能冒用別人的認養資格。改成
  // eligibilityNonce：客戶必須先在/api/farm/eligibility/start+Orbit真實登入走過
  // 一輪nonce交換（見farm/eligibility-session.ts），這裡只接收那個已經被Orbit
  // 核發過、尚未使用的nonce。省略此欄位完全不影響既有付費/人工確認流程。
  eligibilityNonce: z.string().min(16).max(200).optional(),
});

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
    `SELECT s.starts_at, s.ends_at, e.name AS experience_name
     FROM farm_slots s JOIN farm_experiences e ON e.id = s.experience_id
     WHERE s.id = ? LIMIT 1`,
  ).bind(input.slotId).first<{ starts_at: string; ends_at: string; experience_name: string }>();
  if (!slot || !isAllowedBookingSlot(slot.starts_at, slot.ends_at)) {
    return Response.json({ error: "這個時段不符合農場開放規則，請重新選擇。" }, { status: 400 });
  }
  const ticketRateBps = ticketRateBpsForSlot(slot.starts_at);

  // 認養客戶免費參訪（2026-10-17修正：nonce交換取代email自填）：只在客戶帶著
  // eligibilityNonce送出時才核對資格——省略這個欄位完全不影響既有付費/人工確認
  // 流程。資格核對以「所選參訪日期」為準，不是以今天為準。
  //
  // 2026-10-17二次修正：
  // (a) session binding——nonce要連同HttpOnly cookie一起驗證，跨瀏覽器/只拿到
  //     URL裡的nonce字串兌換不了。
  // (b) redemptionId直接重用idempotencyKey——這支handler本來就把它當成「同一次
  //     booking建立嘗試」的身分，Orbit跟本機這一層的資格使用狀態都用同一把key
  //     判斷是不是retry，不是重新核發也不是永久拒絕。
  // (c) used_at延後到booking INSERT真正成功之後才標記（往下看），不是redeem
  //     成功就馬上標記——否則booking建立失敗時retry會被這裡的「已使用」擋死，
  //     即使Orbit那端已經正確允許同一個redemptionId重試。
  // (d) 區分「驗證session本身失效」(reason屬於STALE_ELIGIBILITY_REASONS，應該
  //     導回重新驗證)、「服務打不通」(503)、「核對過真的不符合資格」三種，不能
  //     混在同一句「資格未通過」裡。
  let isAdoptionFreeVisit = false;
  let adoptionSourceOrganizationId: string | null = null;
  let adoptionSourceContractId: string | null = null;
  if (input.eligibilityNonce) {
    if (input.plantCount > 0 || input.mealCount > 0) {
      return Response.json({ error: "認養客戶免費參訪暫不支援加購植栽或餐飲，如有需求請聯絡現場協助安排。" }, { status: 400 });
    }
    const visitDateIso = taipeiDateIso(slot.starts_at);
    const redemptionId = input.idempotencyKey;
    const sessionToken = (await cookies()).get(ELIGIBILITY_SESSION_COOKIE)?.value ?? null;

    let localSession;
    try {
      localSession = await checkEligibilitySession(db, input.eligibilityNonce, visitDateIso, sessionToken, redemptionId);
    } catch {
      return Response.json({ error: "免費資格驗證暫時無法使用，請改用一般付費預約，或聯絡威果官方 LINE 協助確認。", code: "eligibility_feature_unavailable" }, { status: 503 });
    }
    if (!localSession.ok) {
      const message = localSession.reason === "session_mismatch"
        ? "請在同一個瀏覽器完成免費參訪資格驗證，再送出這筆預約。"
        : "免費參訪資格驗證已過期或已使用，請重新登入認養企業帳號再驗證一次。";
      return Response.json({ error: message, code: `eligibility_session_${localSession.reason}` }, { status: 403 });
    }

    const eligibility = await redeemAdoptionEligibilityNonce(input.eligibilityNonce, visitDateIso, redemptionId);
    if (!eligibility.ok) {
      return Response.json({ error: "認養資格查詢服務暫時無法使用，請稍後再試，或聯絡客服協助確認。", code: "eligibility_service_unavailable" }, { status: 503 });
    }
    if (!eligibility.eligible) {
      if (STALE_ELIGIBILITY_REASONS.has(eligibility.reason)) {
        return Response.json({
          error: "免費參訪資格驗證已過期或已使用，請重新登入認養企業帳號再驗證一次。",
          code: "eligibility_session_stale", reason: eligibility.reason,
        }, { status: 403 });
      }
      return Response.json({
        error: "核對後這個帳號目前不符合所選參訪日期的認養免費資格，如需協助請聯絡威果確認邀請或合約範圍。",
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
  let result;
  try {
    result = await db.prepare(`
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // idempotency_key是UNIQUE——雙擊/並發重送撞到同一把key時，D1會丟這個約束
    // 違反錯誤，不是真正的系統錯誤。這是我們自己的約束正確擋下重複INSERT，補一次
    // 跟頂部一樣的擁有者核對再回傳既有預約，而不是讓它變成未處理的500。
    if (message.includes("UNIQUE constraint failed") && message.includes("idempotency_key")) {
      const dup = await db.prepare(
        "SELECT contact_phone, lookup_code, customer_member_id FROM farm_bookings WHERE idempotency_key = ?",
      ).bind(input.idempotencyKey).first<{ contact_phone: string; lookup_code: string; customer_member_id: string | null }>();
      if (dup) {
        if (dup.customer_member_id !== (member?.id ?? null)) {
          return Response.json({ error: "這個預約代碼無法驗證擁有者，請重新送出預約。", code: "idempotency_owner_mismatch" }, { status: 409 });
        }
        if (input.eligibilityNonce) await markEligibilitySessionUsed(db, input.eligibilityNonce, input.idempotencyKey).catch(() => {});
        const existingBooking = await findBooking(dup.contact_phone, dup.lookup_code);
        return Response.json({ booking: existingBooking, duplicate: true });
      }
    }
    throw error;
  }

  if (!result.meta.changes) {
    return Response.json({
      error: "這個時段的名額剛被其他預約使用，請重新選擇場次。",
      code: "capacity_changed",
    }, { status: 409 });
  }

  // 免費資格要在booking真正建立成功之後才標記成「已使用」（見checkEligibilitySession/
  // markEligibilitySessionUsed的註解）——redeem成功但這裡capacity_changed/上面
  // 例外失敗的話，不會卡死這個nonce，同一個idempotencyKey retry還能正常走一次。
  if (isAdoptionFreeVisit && input.eligibilityNonce) {
    await markEligibilitySessionUsed(db, input.eligibilityNonce, input.idempotencyKey);
  }

  await queueSalesSyncEvent(db, id, "booking_created");
  // 2026-10-17審查：待接待預約一建立就要讓現場看到，不能等admin明確confirm才發卡
  // ——否則是「先確認才發卡」的循環。visit_version在這個時間點就是初始值1（booking
  // 剛建立，從未改期過）。
  await queueMadouWorkCard(db, 1, {
    eventKind: "pending",
    visitVersion: 1,
    booking: {
      bookingId: id, bookingNumber: number, groupName: input.groupName || null,
      experience: slot.experience_name, startsAt: slot.starts_at, endsAt: slot.ends_at,
      adultCount: input.adultCount, childCount: input.childCount, infantCount: input.infantCount,
      totalPeople, plantCount: input.plantCount, mealCount: input.mealCount,
      vegetarianMealCount: input.vegetarianMealCount,
    },
  });

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
