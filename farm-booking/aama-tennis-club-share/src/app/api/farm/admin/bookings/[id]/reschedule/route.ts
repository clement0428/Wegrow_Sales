import { z } from "zod";
import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { reminderAtForVisit, reminderDedupeKey } from "@/lib/farm/reminders";

const bodySchema = z.object({
  newSlotId: z.string().min(1).max(100),
  reason: z.string().trim().max(500).optional().default(""),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await requireAdmin();
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "請求格式錯誤" }, { status: 400 });
  const { newSlotId, reason } = parsed.data;

  const db = await getDb();
  const now = new Date().toISOString();

  const before = await db
    .prepare("SELECT slot_id, total_people, booking_status, cancelled_at, arrived_at, completed_at, customer_member_id, visit_version FROM farm_bookings WHERE id = ?")
    .bind(id)
    .first<{
      slot_id: string; total_people: number; booking_status: string;
      cancelled_at: string | null; arrived_at: string | null; completed_at: string | null;
      customer_member_id: string | null; visit_version: number;
    }>();
  if (!before) return Response.json({ error: "找不到這筆預約" }, { status: 404 });
  if (newSlotId === before.slot_id) return Response.json({ error: "新時段和目前時段相同" }, { status: 400 });

  // Same atomic-conditional-update discipline as /api/farm/bookings (create)
  // and the status-transition route: the WHERE clause (not the `before` read
  // above, which is only for a friendlier pre-check) is what actually
  // prevents a race — re-checks the new slot's capacity as of the moment of
  // the write. `slot_id != ?` (bound to newSlotId) re-guards against a
  // concurrent request already having moved this booking to the same target
  // between the read above and this write. This booking's own row is never
  // counted in the target slot's capacity subqueries below since, at the
  // instant this WHERE evaluates, its slot_id still points at the OLD slot.
  // visit_version increments so any queued reminder tied to the old date's
  // dedupe key never collides with a new one.
  const result = await db
    .prepare(
      `
    UPDATE farm_bookings
    SET slot_id = ?, visit_version = visit_version + 1, version = version + 1, updated_at = ?
    WHERE id = ?
      AND cancelled_at IS NULL AND arrived_at IS NULL AND completed_at IS NULL
      AND slot_id != ?
      AND EXISTS (
        SELECT 1 FROM farm_slots s
        JOIN farm_capacity_policies p ON p.id = s.capacity_policy_id
        WHERE s.id = ?
          AND s.status = 'open'
          AND datetime(s.starts_at) > datetime(?)
          AND datetime(s.booking_cutoff_at) > datetime(?)
          AND (
            SELECT COUNT(*) FROM farm_bookings b2
            WHERE b2.slot_id = s.id AND (
              b2.booking_status IN ('requested','confirmed') OR
              (b2.booking_status = 'pending_payment' AND datetime(b2.hold_expires_at) > datetime(?))
            )
          ) < p.max_groups
          AND (
            SELECT COALESCE(SUM(b2.total_people), 0) FROM farm_bookings b2
            WHERE b2.slot_id = s.id AND (
              b2.booking_status IN ('requested','confirmed') OR
              (b2.booking_status = 'pending_payment' AND datetime(b2.hold_expires_at) > datetime(?))
            )
          ) + ? <= CASE (
            SELECT COUNT(*) + 1 FROM farm_bookings b2
            WHERE b2.slot_id = s.id AND (
              b2.booking_status IN ('requested','confirmed') OR
              (b2.booking_status = 'pending_payment' AND datetime(b2.hold_expires_at) > datetime(?))
            )
          )
            WHEN 1 THEN p.limit_one_group
            WHEN 2 THEN p.limit_two_groups
            WHEN 3 THEN p.limit_three_groups
            ELSE 0
          END
      )
  `,
    )
    .bind(newSlotId, now, id, newSlotId, newSlotId, now, now, now, now, before.total_people, now)
    .run();

  if (!result.meta.changes) {
    return Response.json(
      { error: "新時段名額不足，或這筆預約狀態不允許改期（已取消／已報到／已完成）。", code: "reschedule_failed" },
      { status: 409 },
    );
  }

  const after = await db
    .prepare("SELECT visit_version FROM farm_bookings WHERE id = ?")
    .bind(id)
    .first<{ visit_version: number }>();
  const newVisitVersion = after?.visit_version ?? before.visit_version + 1;

  await db
    .prepare(
      `INSERT INTO farm_audit_log (id, entity_type, entity_id, actor_type, actor_id, action, from_state, to_state, reason, created_at)
       VALUES (?, 'farm_booking', ?, 'staff', ?, 'reschedule', ?, ?, ?, ?)`,
    )
    .bind(newId(), id, member.id, before.slot_id, newSlotId, reason, now)
    .run();

  // The old date's queued reminder (if any) is no longer valid — cancel it,
  // same as the cancel-booking action does, rather than let it fire for a
  // visit that no longer happens on that day.
  await db
    .prepare("UPDATE farm_notification_outbox SET status = 'cancelled' WHERE booking_id = ? AND status = 'queued'")
    .bind(id)
    .run();

  // If the booking was already confirmed, re-queue a day-before reminder for
  // the new date (mirrors the confirm-action queueing in the status route).
  if (before.booking_status === "confirmed" && before.customer_member_id) {
    const slot = await db.prepare("SELECT starts_at FROM farm_slots WHERE id = ?").bind(newSlotId).first<{ starts_at: string }>();
    if (slot) {
      const scheduledAt = reminderAtForVisit(slot.starts_at).toISOString();
      const retryKey = reminderDedupeKey(id, newVisitVersion);
      await db
        .prepare(
          `INSERT OR IGNORE INTO farm_notification_outbox
           (id, booking_id, channel, notification_type, recipient_id, content_snapshot_json, retry_key, status, attempt_count, scheduled_at, next_attempt_at, created_at)
           VALUES (?, ?, 'line', 'day_before_reminder', ?, ?, ?, 'queued', 0, ?, ?, ?)`,
        )
        .bind(
          newId(),
          id,
          before.customer_member_id,
          JSON.stringify({ bookingId: id, visitVersion: newVisitVersion, note: "LINE Messaging API credentials not configured — this row queues, actual send is BLOCKED until credentials exist. See jobs/reminders route." }),
          retryKey,
          scheduledAt,
          scheduledAt,
          now,
        )
        .run();
    }
  }

  return Response.json({ ok: true, bookingId: id, newSlotId });
}
