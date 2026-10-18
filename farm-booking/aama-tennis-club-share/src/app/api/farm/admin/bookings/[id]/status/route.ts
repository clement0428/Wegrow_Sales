import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canCheckIn, isAdmin, requireStaff } from "@/lib/auth/current-member";
import type { Member } from "@/lib/db/types";
import type { StaffRole } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { confirmBooking } from "@/lib/farm/confirm-booking";
import { queueMadouWorkCard } from "@/lib/line/madou-group-queue";
import { queueSalesSyncEvent } from "@/lib/sales/queue";

const bodySchema = z.object({
  action: z.enum(["confirm", "cancel", "check_in", "complete"]),
  reason: z.string().trim().max(500).optional().default(""),
});

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Actor = { type: "staff"; member: Member & { role: StaffRole } } | { type: "service" };

// 2026-10-18新增：service secret只開放給"cancel"這一個動作——這是給沒有真人
// 員工LINE session可用時（受控的自動化驗收、緊急維運）的窄範圍授權，不是一般
// 管理員登入的替代品，也刻意不開放confirm/check_in/complete這些需要真人在場
// 判斷的動作。稽核紀錄actor_type寫'service'，不冒用任何真人員工的身分。
async function resolveActor(request: Request, action: string): Promise<Actor> {
  if (action === "cancel") {
    const authHeader = request.headers.get("authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceSecret = process.env.FARM_BOOKING_ADMIN_SERVICE_SECRET;
    if (serviceSecret && bearer && sameSecret(bearer, serviceSecret)) {
      return { type: "service" };
    }
  }
  const member = await requireStaff();
  return { type: "staff", member };
}

// Each action's atomic precondition, enforced in the UPDATE's WHERE clause
// (not "read state, then decide, then write") so two concurrent admin
// actions on the same booking can't both apply — matches the same
// atomic-conditional-update discipline already used for capacity checks in
// /api/farm/bookings.
// version increments on every transition — this is the "monotonic
// booking_version" Sales' sync contract uses to reject out-of-order events
// (a previously-unused column that's existed since migration 0006).
// 'confirm' is handled separately via confirmBooking() (see below) — it's
// shared with claim.ts's auto-confirm-on-claim path, so it can't live in
// this generic table without duplicating that logic in two places.
const TRANSITIONS: Record<string, { set: string; where: string; from: string; to: string }> = {
  cancel: {
    set: "cancelled_at = ?, version = version + 1, updated_at = ?",
    where: "cancelled_at IS NULL AND arrived_at IS NULL",
    from: "*",
    to: "cancelled",
  },
  check_in: {
    set: "arrived_at = ?, version = version + 1, updated_at = ?",
    where: "booking_status = 'confirmed' AND cancelled_at IS NULL AND arrived_at IS NULL",
    from: "confirmed",
    to: "arrived",
  },
  complete: {
    set: "completed_at = ?, version = version + 1, updated_at = ?",
    where: "arrived_at IS NOT NULL AND completed_at IS NULL",
    from: "arrived",
    to: "completed",
  },
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "請求格式錯誤" }, { status: 400 });
  const { action, reason } = parsed.data;

  const actor = await resolveActor(request, action);

  // 接待員只能「報到」（規格第4節：接待員可讀所需資訊、報到與工作單）；
  // confirm／cancel／complete 影響容量或退款層級的決定，僅限管理員。
  // service帳號只走得到這裡時action必定是'cancel'（resolveActor已經限制），
  // 不需要另外跑角色檢查——secret本身就是授權邊界。
  if (actor.type === "staff") {
    const allowed = action === "check_in" ? canCheckIn(actor.member) : isAdmin(actor.member);
    if (!allowed) return Response.json({ error: "此角色無法執行這個動作" }, { status: 403 });
  }

  const db = await getDb();
  const now = new Date().toISOString();

  if (action === "confirm") {
    if (actor.type !== "staff") return Response.json({ error: "此角色無法執行這個動作" }, { status: 403 });
    const result = await confirmBooking(db, id, "staff", actor.member.id);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409;
      const error = result.reason === "not_found"
        ? "找不到這筆預約"
        : "這筆預約目前的狀態不允許「confirm」這個動作，可能已被其他管理員異動過，請重新整理。";
      return Response.json({ error, code: result.reason === "not_found" ? undefined : "state_conflict" }, { status });
    }
    return Response.json({ ok: true, action, bookingId: id });
  }

  const transition = TRANSITIONS[action];

  const before = await db
    .prepare(
      `SELECT booking_status, cancelled_at, arrived_at, completed_at, customer_member_id, visit_version, slot_id,
              booking_number, group_name, adult_count, child_count, infant_count, total_people,
              plant_count, meal_count, vegetarian_meal_count
       FROM farm_bookings WHERE id = ?`,
    )
    .bind(id)
    .first<{
      booking_status: string;
      cancelled_at: string | null;
      arrived_at: string | null;
      completed_at: string | null;
      customer_member_id: string | null;
      visit_version: number;
      slot_id: string;
      booking_number: string;
      group_name: string | null;
      adult_count: number;
      child_count: number;
      infant_count: number;
      total_people: number;
      plant_count: number;
      meal_count: number;
      vegetarian_meal_count: number;
    }>();
  if (!before) return Response.json({ error: "找不到這筆預約" }, { status: 404 });

  // action's own params bound first (1 or 2 `?` in `set`), then id last.
  const setParamCount = (transition.set.match(/\?/g) ?? []).length;
  const setParams = setParamCount === 2 ? [now, now] : [now];
  const result = await db
    .prepare(`UPDATE farm_bookings SET ${transition.set} WHERE id = ? AND (${transition.where})`)
    .bind(...setParams, id)
    .run();

  if (!result.meta.changes) {
    return Response.json(
      { error: `這筆預約目前的狀態不允許「${action}」這個動作，可能已被其他管理員異動過，請重新整理。`, code: "state_conflict" },
      { status: 409 },
    );
  }

  await db
    .prepare(
      `INSERT INTO farm_audit_log (id, entity_type, entity_id, actor_type, actor_id, action, from_state, to_state, reason, created_at)
       VALUES (?, 'farm_booking', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(), id, actor.type, actor.type === "staff" ? actor.member.id : null, action,
      transition.from === "*" ? before.booking_status : transition.from, transition.to, reason, now,
    )
    .run();

  if (action === "cancel") {
    // 規格「改期取消舊提醒」：this booking's own reminder(s) should stop, not
    // send after the visit no longer exists. Mark rather than delete, for
    // the same audit-trail reason bookings themselves are never deleted.
    await db
      .prepare("UPDATE farm_notification_outbox SET status = 'cancelled' WHERE booking_id = ? AND status = 'queued'")
      .bind(id)
      .run();
    // 現場認領失效，不是靠AI猜員工還有沒有空——規格第4.2節「改期後不默認原接待
    // 人有空」同樣適用於取消。
    await db
      .prepare("UPDATE farm_bookings SET claimed_by_member_id = NULL, claimed_at = NULL, claim_released_at = ? WHERE id = ?")
      .bind(now, id)
      .run();
    const slot = await db
      .prepare("SELECT starts_at FROM farm_slots WHERE id = ?")
      .bind(before.slot_id)
      .first<{ starts_at: string }>();
    if (slot) {
      await queueMadouWorkCard(db, before.visit_version, {
        eventKind: "cancelled",
        visitVersion: before.visit_version,
        booking: {
          bookingId: id, bookingNumber: before.booking_number, groupName: before.group_name,
          experience: "", startsAt: slot.starts_at, endsAt: slot.starts_at,
          adultCount: before.adult_count, childCount: before.child_count, infantCount: before.infant_count,
          totalPeople: before.total_people, plantCount: before.plant_count, mealCount: before.meal_count,
          vegetarianMealCount: before.vegetarian_meal_count,
        },
      });
    }
    await queueSalesSyncEvent(db, id, "booking_cancelled");
  }

  return Response.json({ ok: true, action, bookingId: id });
}
