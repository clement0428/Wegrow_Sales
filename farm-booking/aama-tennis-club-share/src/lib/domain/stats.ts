import { isPast } from "@/lib/domain/event-status";
import type { EventStatus } from "@/lib/domain/event-status";

export type AttendanceRow = {
  member_id: string;
  event_status: EventStatus;
  reg_status: "confirmed" | "waitlisted";
  attended: boolean | null;
  event_date: string;
  end_time: string;
};

export function countsAsAttended(r: AttendanceRow, now: Date): boolean {
  if (r.event_status === "cancelled") return false;
  if (r.event_status === "settled") return r.attended === true;
  return r.reg_status === "confirmed" && isPast(r, now);
}

export function computeAttendance(rows: AttendanceRow[], now: Date): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (countsAsAttended(r, now)) m.set(r.member_id, (m.get(r.member_id) ?? 0) + 1);
  return m;
}

export type LeaderMember = { id: string; display_name: string; picture_url: string | null };
export type LeaderboardEntry = { rank: number; count: number; member: LeaderMember };

export function buildLeaderboard(counts: Map<string, number>, members: LeaderMember[]): LeaderboardEntry[] {
  return members
    .filter((m) => (counts.get(m.id) ?? 0) > 0)
    .map((m) => ({ member: m, count: counts.get(m.id)! }))
    .sort((a, b) => b.count - a.count || a.member.display_name.localeCompare(b.member.display_name, "zh-Hant"))
    .map((x, i) => ({ rank: i + 1, ...x }));
}
