"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import type { EventStatus } from "@/lib/domain/event-status";

function bust(eventId: string) {
  revalidatePath("/"); revalidatePath("/me"); revalidatePath(`/events/${eventId}`); revalidatePath(`/manage/${eventId}`);
}

async function loadOpenEvent(eventId: string): Promise<{ capacity: number; organizer_id: string; deadlinePassed: boolean }> {
  const db = await getDb();
  const evt = await db.prepare("SELECT capacity, status, registration_deadline, organizer_id FROM events WHERE id=?").bind(eventId).first<{ capacity: number; status: EventStatus; registration_deadline: string; organizer_id: string }>();
  if (!evt) throw new Error("場次不存在");
  if (evt.status !== "open") throw new Error("場次已結算或取消");
  return {
    capacity: evt.capacity,
    organizer_id: evt.organizer_id,
    deadlinePassed: new Date(evt.registration_deadline).getTime() <= Date.now(),
  };
}

async function insertSeatFor(memberId: string, eventId: string, capacity: number, attempt = 0): Promise<void> {
  const db = await getDb();
  const dup = await db.prepare("SELECT 1 FROM registrations WHERE event_id=? AND member_id=?").bind(eventId, memberId).first();
  if (dup) throw new Error("已經報名過了");
  try {
    await db.prepare(`
      INSERT INTO registrations (id, event_id, member_id, status, seat_no)
      SELECT ?, ?, ?,
        CASE WHEN COALESCE(MAX(seat_no), 0) + 1 <= ? THEN 'confirmed' ELSE 'waitlisted' END,
        COALESCE(MAX(seat_no), 0) + 1
      FROM registrations WHERE event_id = ?
    `).bind(newId(), eventId, memberId, capacity, eventId).run();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error).message)) && attempt < 3) return insertSeatFor(memberId, eventId, capacity, attempt + 1);
    throw e;
  }
}

async function removeAndReflow(memberId: string, eventId: string, capacity: number): Promise<void> {
  const db = await getDb();
  const row = await db.prepare("SELECT seat_no FROM registrations WHERE event_id=? AND member_id=?").bind(eventId, memberId).first<{ seat_no: number }>();
  if (!row) throw new Error("你沒有報名這場");
  await db.batch([
    db.prepare("DELETE FROM registrations WHERE event_id=? AND member_id=?").bind(eventId, memberId),
    db.prepare("UPDATE registrations SET seat_no = seat_no - 1 WHERE event_id=? AND seat_no > ?").bind(eventId, row.seat_no),
    db.prepare("UPDATE registrations SET status = CASE WHEN seat_no <= ? THEN 'confirmed' ELSE 'waitlisted' END WHERE event_id=?").bind(capacity, eventId),
  ]);
}

export async function register(eventId: string): Promise<void> {
  const me = await requireMember();
  const { capacity } = await loadOpenEvent(eventId);
  await insertSeatFor(me.id, eventId, capacity);
  bust(eventId);
}

export async function cancel(eventId: string): Promise<void> {
  const me = await requireMember();
  const { capacity, organizer_id, deadlinePassed } = await loadOpenEvent(eventId);
  const isOrganizer = organizer_id === me.id;
  if (deadlinePassed && !isOrganizer && !isAdmin(me)) throw new Error("報名截止後不能退出，請聯絡開場者");
  await removeAndReflow(me.id, eventId, capacity);
  bust(eventId);
}

async function assertOrganizer(eventId: string) {
  const me = await requireMember();
  const db = await getDb();
  const evt = await db.prepare("SELECT capacity, status, organizer_id FROM events WHERE id=?").bind(eventId).first<{ capacity: number; status: EventStatus; organizer_id: string }>();
  if (!evt) throw new Error("場次不存在");
  if (evt.organizer_id !== me.id && !isAdmin(me)) throw new Error("沒有權限");
  return { me, capacity: evt.capacity, status: evt.status };
}

export async function organizerAdd(eventId: string, memberId: string): Promise<void> {
  const { capacity, status } = await assertOrganizer(eventId);
  if (status !== "open") throw new Error("場次已結算或取消");
  await insertSeatFor(memberId, eventId, capacity);
  bust(eventId);
}

export async function organizerRemove(eventId: string, memberId: string): Promise<void> {
  const { capacity, status } = await assertOrganizer(eventId);
  if (status !== "open") throw new Error("場次已結算或取消");
  await removeAndReflow(memberId, eventId, capacity);
  bust(eventId);
}

export async function addAttendeeToEvent(eventId: string, opts: { memberId?: string; guestName?: string }): Promise<void> {
  const me = await requireMember();
  const db = await getDb();
  const evt = await db.prepare("SELECT organizer_id FROM events WHERE id=?").bind(eventId).first<{ organizer_id: string }>();
  if (!evt) throw new Error("場次不存在");
  if (evt.organizer_id !== me.id && !isAdmin(me)) throw new Error("沒有權限");

  let memberId = opts.memberId;
  if (opts.guestName) {
    const name = opts.guestName.trim();
    if (!name) throw new Error("請輸入名稱");
    if (name.length > 30) throw new Error("名稱過長");
    memberId = newId();
    await db.prepare("INSERT INTO members (id, line_user_id, display_name, role) VALUES (?, ?, ?, 'member')")
      .bind(memberId, `guest-${memberId}`, name).run();
  }
  if (!memberId) throw new Error("需要成員");

  const dup = await db.prepare("SELECT 1 FROM registrations WHERE event_id=? AND member_id=?").bind(eventId, memberId).first();
  if (!dup) {
    for (let i = 0; i < 3; i++) {
      try {
        await db.prepare(`
          INSERT INTO registrations (id, event_id, member_id, status, seat_no)
          SELECT ?, ?, ?,
            CASE WHEN COALESCE(MAX(seat_no), 0) + 1 <= (SELECT capacity FROM events WHERE id = ?) THEN 'confirmed' ELSE 'waitlisted' END,
            COALESCE(MAX(seat_no), 0) + 1
          FROM registrations WHERE event_id = ?
        `).bind(newId(), eventId, memberId, eventId, eventId).run();
        break;
      } catch (e) {
        if (i === 2 || !/UNIQUE/i.test(String((e as Error).message))) throw e;
      }
    }
  }
  bust(eventId);
}

