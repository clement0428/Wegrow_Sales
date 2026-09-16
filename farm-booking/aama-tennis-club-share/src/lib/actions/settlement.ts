"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import { computeSettlement } from "@/lib/domain/settlement";

async function assertOrganizer(eventId: string) {
  const me = await requireMember();
  const db = await getDb();
  const evt = await db.prepare("SELECT organizer_id, status FROM events WHERE id=?").bind(eventId).first<{ organizer_id: string; status: string }>();
  if (!evt) throw new Error("場次不存在");
  if (evt.organizer_id !== me.id && !isAdmin(me)) throw new Error("沒有權限");
  return { me, db, event: evt };
}
const bust = (id: string) => { revalidatePath(`/manage/${id}`); revalidatePath(`/events/${id}`); revalidatePath("/me"); revalidatePath("/stats"); revalidatePath("/"); };

export async function settleEvent(eventId: string, raw: unknown): Promise<void> {
  const { db } = await assertOrganizer(eventId);
  const v = z.object({
    finalTotal: z.coerce.number().int().min(0),
    attendedMemberIds: z.array(z.string().min(1)).min(1, "到場人數不可為 0"),
  }).parse(raw);
  const { perPerson } = computeSettlement(v);
  const placeholders = v.attendedMemberIds.map(() => "?").join(",");
  const nowIso = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE registrations
      SET attended = CASE WHEN member_id IN (${placeholders}) THEN 1 ELSE 0 END,
          amount_due = CASE WHEN member_id IN (${placeholders}) THEN ? ELSE 0 END,
          paid_at = CASE WHEN member_id IN (${placeholders}) THEN paid_at ELSE NULL END,
          paid_amount = CASE WHEN member_id IN (${placeholders}) THEN paid_amount ELSE NULL END,
          paid_marked_by = CASE WHEN member_id IN (${placeholders}) THEN paid_marked_by ELSE NULL END
      WHERE event_id=?`)
      .bind(
        ...v.attendedMemberIds, ...v.attendedMemberIds, perPerson,
        ...v.attendedMemberIds, ...v.attendedMemberIds, ...v.attendedMemberIds,
        eventId,
      ),
    db.prepare("UPDATE events SET status='settled', final_total=?, settled_at=?, updated_at=? WHERE id=?")
      .bind(v.finalTotal, nowIso, nowIso, eventId),
  ]);
  bust(eventId);
}

export async function markPaid(eventId: string, memberId: string): Promise<void> {
  const { me, db, event } = await assertOrganizer(eventId);
  if (event.status !== "settled") throw new Error("尚未結算");
  const reg = await db.prepare("SELECT amount_due FROM registrations WHERE event_id=? AND member_id=?").bind(eventId, memberId).first<{ amount_due: number | null }>();
  if (!reg) throw new Error("找不到報名");
  await db.prepare("UPDATE registrations SET paid_at=?, paid_amount=?, paid_marked_by=? WHERE event_id=? AND member_id=?")
    .bind(new Date().toISOString(), reg.amount_due ?? 0, me.id, eventId, memberId).run();
  bust(eventId);
}

export async function unmarkPaid(eventId: string, memberId: string): Promise<void> {
  const { db } = await assertOrganizer(eventId);
  await db.prepare("UPDATE registrations SET paid_at=NULL, paid_amount=NULL, paid_marked_by=NULL WHERE event_id=? AND member_id=?")
    .bind(eventId, memberId).run();
  bust(eventId);
}

export async function reopenSettlement(eventId: string): Promise<void> {
  await assertOrganizer(eventId);
  const db = await getDb();
  await db.batch([
    db.prepare("UPDATE events SET status='open', final_total=NULL, settled_at=NULL, updated_at=? WHERE id=?")
      .bind(new Date().toISOString(), eventId),
    db.prepare("UPDATE registrations SET attended=NULL, amount_due=NULL, paid_at=NULL, paid_amount=NULL, paid_marked_by=NULL WHERE event_id=?")
      .bind(eventId),
  ]);
  bust(eventId);
}

