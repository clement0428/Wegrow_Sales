"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import { eventInputSchema } from "@/lib/schemas/event";


function bust(id?: string) {
  revalidatePath("/"); revalidatePath("/manage");
  if (id) { revalidatePath(`/events/${id}`); revalidatePath(`/manage/${id}`); }
}

async function insertSeatAtomic(db: D1Database, eventId: string, memberId: string, capacity: number, attempt = 0): Promise<void> {
  const id = newId();
  try {
    await db.prepare(`
      INSERT INTO registrations (id, event_id, member_id, status, seat_no)
      SELECT ?, ?, ?,
        CASE WHEN COALESCE(MAX(seat_no), 0) + 1 <= ? THEN 'confirmed' ELSE 'waitlisted' END,
        COALESCE(MAX(seat_no), 0) + 1
      FROM registrations WHERE event_id = ?
    `).bind(id, eventId, memberId, capacity, eventId).run();
  } catch (e) {
    const msg = String((e as Error).message ?? "");
    if (/UNIQUE/i.test(msg) && attempt < 3) return insertSeatAtomic(db, eventId, memberId, capacity, attempt + 1);
    throw e;
  }
}

export async function createEvent(raw: unknown): Promise<{ id: string }> {
  const me = await requireMember();
  const v = eventInputSchema.parse(raw);
  const db = await getDb();
  const id = newId();
  await db.prepare(`INSERT INTO events (id, title, event_date, start_time, end_time, venue_id, capacity, registration_deadline, estimated_total, note, organizer_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`)
    .bind(id, v.title, v.event_date, v.start_time, v.end_time, v.venue_id, v.capacity, `${v.registration_deadline}:00+08:00`,
          v.estimated_total ?? null, v.note ?? null, me.id).run();
  await insertSeatAtomic(db, id, me.id, v.capacity);
  bust(id);
  return { id };
}

async function requireOrganizerOrAdmin(eventId: string) {
  const me = await requireMember();
  const db = await getDb();
  const row = await db.prepare("SELECT organizer_id, status, capacity FROM events WHERE id = ?").bind(eventId).first<{ organizer_id: string; status: string; capacity: number }>();
  if (!row) throw new Error("場次不存在");
  if (row.organizer_id !== me.id && !isAdmin(me)) throw new Error("沒有權限");
  return { me, db, event: row };
}

export async function updateEvent(eventId: string, raw: unknown): Promise<void> {
  const { db, event } = await requireOrganizerOrAdmin(eventId);
  if (event.status !== "open") throw new Error("已結算或取消的場次不可編輯");
  const v = eventInputSchema.parse(raw);
  await db.prepare(`UPDATE events SET title=?, event_date=?, start_time=?, end_time=?, registration_deadline=?, venue_id=?, capacity=?, estimated_total=?, note=?, updated_at=?
     WHERE id=?`)
    .bind(v.title, v.event_date, v.start_time, v.end_time, `${v.registration_deadline}:00+08:00`, v.venue_id, v.capacity,
          v.estimated_total ?? null, v.note ?? null, new Date().toISOString(), eventId).run();
  if (v.capacity !== event.capacity) {
    await db.prepare(`UPDATE registrations SET status = CASE WHEN seat_no <= ? THEN 'confirmed' ELSE 'waitlisted' END WHERE event_id = ?`)
      .bind(v.capacity, eventId).run();
  }
  bust(eventId);
}

export async function cancelEvent(eventId: string): Promise<void> {
  const { db, event } = await requireOrganizerOrAdmin(eventId);
  if (event.status === "settled") throw new Error("已結算的場次不可取消");
  await db.prepare("UPDATE events SET status='cancelled', updated_at=? WHERE id=?").bind(new Date().toISOString(), eventId).run();
  bust(eventId);
}
