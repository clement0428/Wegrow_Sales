import type { EventStatus } from "@/lib/domain/event-status";
export type Theme = "clay" | "hard" | "grass";
export type Member = { id: string; line_user_id: string; display_name: string; picture_url: string | null; role: "member" | "admin"; created_at: string; last_login_at: string; theme_preference: Theme; bank_code: string | null; bank_name: string | null; bank_account: string | null; bank_holder: string | null };
export type Venue = { id: string; name: string; address: string | null; is_active: number; created_by: string | null };
export type EventRow = { id: string; title: string; event_date: string; start_time: string; end_time: string; venue_id: string; capacity: number; registration_deadline: string; estimated_total: number | null; final_total: number | null; status: EventStatus; organizer_id: string; settled_at: string | null; note: string | null; created_at: string; updated_at: string };
export type Registration = { id: string; event_id: string; member_id: string; status: "confirmed" | "waitlisted"; seat_no: number; attended: number | null; amount_due: number | null; paid_at: string | null; paid_amount: number | null; paid_marked_by: string | null; created_at: string };
