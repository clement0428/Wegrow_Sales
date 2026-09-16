import "server-only";
import { getDb } from "./client";
import type { EventRow, Member, Registration, Venue } from "./types";
import type { AttendanceRow } from "@/lib/domain/stats";
import type { EventStatus } from "@/lib/domain/event-status";

export type MemberLite = Pick<Member, "id" | "display_name" | "picture_url">;
export type OrganizerWithBank = MemberLite & {
  bank_code: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_holder: string | null;
};
export type EventWithCounts = EventRow & { venue: Venue; organizer: OrganizerWithBank; confirmed_count: number; waitlist_count: number; attended_count: number; paid_count: number };
export type RegistrationWithMember = Registration & { member: MemberLite };

type FlatEventRow = {
  id: string; title: string; event_date: string; start_time: string; end_time: string;
  venue_id: string; capacity: number; registration_deadline: string;
  estimated_total: number | null; final_total: number | null; status: EventStatus;
  organizer_id: string; settled_at: string | null; note: string | null;
  created_at: string; updated_at: string;
  v_id: string; v_name: string; v_address: string | null; v_is_active: number; v_created_by: string | null;
  o_id: string; o_display_name: string; o_picture_url: string | null; o_bank_code: string | null; o_bank_name: string | null; o_bank_account: string | null; o_bank_holder: string | null;
  confirmed_count: number; waitlist_count: number; attended_count: number; paid_count: number;
};

function mapEventRow(r: FlatEventRow): EventWithCounts {
  return {
    id: r.id, title: r.title, event_date: r.event_date, start_time: r.start_time, end_time: r.end_time,
    venue_id: r.venue_id, capacity: r.capacity, registration_deadline: r.registration_deadline,
    estimated_total: r.estimated_total, final_total: r.final_total, status: r.status,
    organizer_id: r.organizer_id, settled_at: r.settled_at, note: r.note,
    created_at: r.created_at, updated_at: r.updated_at,
    venue: { id: r.v_id, name: r.v_name, address: r.v_address, is_active: r.v_is_active, created_by: r.v_created_by },
    organizer: { id: r.o_id, display_name: r.o_display_name, picture_url: r.o_picture_url, bank_code: r.o_bank_code, bank_name: r.o_bank_name, bank_account: r.o_bank_account, bank_holder: r.o_bank_holder },
    confirmed_count: r.confirmed_count, waitlist_count: r.waitlist_count, attended_count: r.attended_count, paid_count: r.paid_count,
  };
}

const EVENT_SELECT = `
  e.id, e.title, e.event_date, e.start_time, e.end_time, e.venue_id, e.capacity,
  e.registration_deadline, e.estimated_total, e.final_total, e.status, e.organizer_id,
  e.settled_at, e.note, e.created_at, e.updated_at,
  v.id AS v_id, v.name AS v_name, v.address AS v_address, v.is_active AS v_is_active, v.created_by AS v_created_by,
  o.id AS o_id, o.display_name AS o_display_name, o.picture_url AS o_picture_url, o.bank_code AS o_bank_code, o.bank_name AS o_bank_name, o.bank_account AS o_bank_account, o.bank_holder AS o_bank_holder,
  (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'confirmed') AS confirmed_count,
  (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'waitlisted') AS waitlist_count,
  (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.attended = 1) AS attended_count,
  (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.attended = 1 AND r.paid_at IS NOT NULL) AS paid_count
`;

export async function listEvents(): Promise<EventWithCounts[]> {
  const db = await getDb();
  const rs = await db.prepare(`
    SELECT ${EVENT_SELECT}
    FROM events e JOIN venues v ON v.id = e.venue_id JOIN members o ON o.id = e.organizer_id
    WHERE e.status != 'cancelled'
    ORDER BY e.event_date, e.start_time
  `).all<FlatEventRow>();
  return (rs.results ?? []).map(mapEventRow);
}

export async function listEventsByOrganizer(memberId: string | null): Promise<EventWithCounts[]> {
  const db = await getDb();
  const stmt = memberId
    ? db.prepare(`SELECT ${EVENT_SELECT}
        FROM events e JOIN venues v ON v.id = e.venue_id JOIN members o ON o.id = e.organizer_id
        WHERE e.organizer_id = ?
        ORDER BY e.event_date DESC, e.start_time`).bind(memberId)
    : db.prepare(`SELECT ${EVENT_SELECT}
        FROM events e JOIN venues v ON v.id = e.venue_id JOIN members o ON o.id = e.organizer_id
        ORDER BY e.event_date DESC, e.start_time`);
  const rs = await stmt.all<FlatEventRow>();
  return (rs.results ?? []).map(mapEventRow);
}

export async function getEvent(id: string): Promise<EventWithCounts | null> {
  const db = await getDb();
  const row = await db.prepare(`
    SELECT ${EVENT_SELECT}
    FROM events e JOIN venues v ON v.id = e.venue_id JOIN members o ON o.id = e.organizer_id
    WHERE e.id = ?
  `).bind(id).first<FlatEventRow>();
  return row ? mapEventRow(row) : null;
}

export async function listRegistrations(eventId: string): Promise<RegistrationWithMember[]> {
  const db = await getDb();
  const rs = await db.prepare(`
    SELECT r.*, m.id AS m_id, m.display_name AS m_display_name, m.picture_url AS m_picture_url
    FROM registrations r JOIN members m ON m.id = r.member_id
    WHERE r.event_id = ?
    ORDER BY r.status ASC, r.seat_no ASC
  `).bind(eventId).all<Registration & { m_id: string; m_display_name: string; m_picture_url: string | null }>();
  return (rs.results ?? []).map((r) => {
    const { m_id, m_display_name, m_picture_url, ...rest } = r;
    return { ...(rest as Registration), member: { id: m_id, display_name: m_display_name, picture_url: m_picture_url } };
  });
}

export async function listActiveVenues(): Promise<Venue[]> {
  const db = await getDb();
  const rs = await db.prepare("SELECT * FROM venues WHERE is_active = 1 ORDER BY name").all<Venue>();
  return rs.results ?? [];
}
export async function listAllVenues(): Promise<Venue[]> {
  const db = await getDb();
  const rs = await db.prepare("SELECT * FROM venues ORDER BY is_active DESC, name").all<Venue>();
  return rs.results ?? [];
}
export async function listMembers(): Promise<MemberLite[]> {
  const db = await getDb();
  const rs = await db.prepare("SELECT id, display_name, picture_url FROM members ORDER BY display_name").all<MemberLite>();
  return rs.results ?? [];
}

type FlatMyRegRow = FlatEventRow & {
  r_id: string; r_event_id: string; r_member_id: string; r_status: Registration["status"];
  r_seat_no: number; r_attended: number | null; r_amount_due: number | null;
  r_paid_at: string | null; r_paid_amount: number | null; r_paid_marked_by: string | null; r_created_at: string;
};

export type MyRegistration = Registration & { event: EventWithCounts };
export async function listMyRegistrations(memberId: string): Promise<MyRegistration[]> {
  const db = await getDb();
  // registrations and events both have id/status/created_at columns; r.* would collide with
  // EVENT_SELECT's unprefixed e.* columns and get silently overwritten, so registration columns
  // are explicitly aliased with an r_ prefix (same pattern as listRegistrations' m_ prefix).
  const rs = await db.prepare(`
    SELECT r.id AS r_id, r.event_id AS r_event_id, r.member_id AS r_member_id, r.status AS r_status,
           r.seat_no AS r_seat_no, r.attended AS r_attended, r.amount_due AS r_amount_due,
           r.paid_at AS r_paid_at, r.paid_amount AS r_paid_amount, r.paid_marked_by AS r_paid_marked_by,
           r.created_at AS r_created_at,
           ${EVENT_SELECT}
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    JOIN venues v ON v.id = e.venue_id
    JOIN members o ON o.id = e.organizer_id
    WHERE r.member_id = ?
  `).bind(memberId).all<FlatMyRegRow>();
  return (rs.results ?? []).map((r) => {
    const reg: Registration = {
      id: r.r_id, event_id: r.r_event_id, member_id: r.r_member_id, status: r.r_status,
      seat_no: r.r_seat_no, attended: r.r_attended, amount_due: r.r_amount_due,
      paid_at: r.r_paid_at, paid_amount: r.r_paid_amount, paid_marked_by: r.r_paid_marked_by, created_at: r.r_created_at,
    };
    return { ...reg, event: mapEventRow(r) };
  });
}

export async function listAttendanceRows(): Promise<AttendanceRow[]> {
  const db = await getDb();
  const rs = await db.prepare(`
    SELECT r.member_id, r.status AS reg_status, r.attended,
           e.status AS event_status, e.event_date, e.end_time
    FROM registrations r JOIN events e ON e.id = r.event_id
  `).all<{ member_id: string; reg_status: "confirmed" | "waitlisted"; attended: number | null; event_status: EventStatus; event_date: string; end_time: string }>();
  return (rs.results ?? []).map((r) => ({
    member_id: r.member_id, reg_status: r.reg_status,
    attended: r.attended === null ? null : r.attended === 1,
    event_status: r.event_status, event_date: r.event_date, end_time: r.end_time,
  }));
}

export async function sumPaid(): Promise<number> {
  const db = await getDb();
  const row = await db.prepare("SELECT COALESCE(SUM(paid_amount), 0) AS total FROM registrations WHERE paid_at IS NOT NULL").first<{ total: number }>();
  return row?.total ?? 0;
}
