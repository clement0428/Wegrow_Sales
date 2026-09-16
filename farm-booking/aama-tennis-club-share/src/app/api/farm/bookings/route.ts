import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { calculateVisitPrice } from "@/lib/farm/pricing";
import { findBooking, listMemberBookings } from "@/lib/farm/repository";
import { getCurrentMember } from "@/lib/auth/current-member";

const createSchema = z.object({
  slotId: z.string().min(1).max(100),
  adultCount: z.number().int().min(1).max(50),
  childCount: z.number().int().min(0).max(50),
  infantCount: z.number().int().min(0).max(50),
  plantCount: z.number().int().min(0).max(50),
  mealCount: z.number().int().min(0).max(50),
  contactName: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^09\d{8}$/),
  groupName: z.string().trim().max(100).default(""),
  note: z.string().trim().max(1000).default(""),
  idempotencyKey: z.string().uuid(),
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
  if (totalPeople > 50 || input.plantCount > totalPeople || input.mealCount > totalPeople) {
    return Response.json({ error: "人數或加購數量超出可接受範圍" }, { status: 400 });
  }

  const db = await getDb();
  const member = await getCurrentMember();
  const prior = await db.prepare(
    "SELECT contact_phone, lookup_code FROM farm_bookings WHERE idempotency_key = ?",
  ).bind(input.idempotencyKey).first<{ contact_phone: string; lookup_code: string }>();
  if (prior) {
    const existing = await findBooking(prior.contact_phone, prior.lookup_code);
    return Response.json({ booking: existing, duplicate: true });
  }

  const price = calculateVisitPrice({ people: totalPeople, plantCount: input.plantCount, mealCount: input.mealCount });
  const id = newId();
  const number = makeBookingNumber();
  const code = makeLookupCode();
  const now = new Date().toISOString();
  const ticketSnapshot = JSON.stringify({
    status: "reference_price_pending_approval",
    people: totalPeople,
    plantCount: input.plantCount,
    mealCount: input.mealCount,
    ...price,
  });

  // A single conditional INSERT keeps capacity checking and reservation creation atomic in D1.
  const result = await db.prepare(`
    INSERT INTO farm_bookings (
      id, booking_number, lookup_code, slot_id, customer_member_id, contact_name, contact_phone, group_name,
      adult_count, child_count, infant_count, total_people, plant_count, meal_count,
      customer_note, amount_twd, booking_status, payment_status, hold_expires_at,
      ticket_snapshot_json, policy_snapshot_json, idempotency_key, created_at, updated_at
    )
    SELECT ?, ?, ?, s.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           'requested', 'not_open', NULL, ?,
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
    input.plantCount, input.mealCount, input.note, price.totalTwd,
    ticketSnapshot, input.idempotencyKey, now, now, input.slotId,
    now, now, now, now, totalPeople, now,
  ).run();

  if (!result.meta.changes) {
    return Response.json({
      error: "這個時段的名額剛被其他預約使用，請重新選擇場次。",
      code: "capacity_changed",
    }, { status: 409 });
  }

  const booking = await findBooking(input.phone, code);
  return Response.json({
    booking,
    payment: { enabled: false, status: "尚未開放付款" },
    message: "已收到預約申請，農場確認後會透過 LINE 或電話聯繫。",
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
  return Response.json({ booking, payment: { enabled: false, status: "尚未開放付款" } });
}
