import { taipeiISO } from "@/lib/time";

export type EventStatus = "open" | "settled" | "cancelled";
export type DisplayStatus = "接龍中" | "已截止" | "結算中" | "結算完成" | "已取消";

type SettleCounts = { attended_count?: number; paid_count?: number };

export function deriveEventStatus(
  e: { status: EventStatus; registration_deadline: string } & SettleCounts,
  now: Date,
): DisplayStatus {
  if (e.status === "cancelled") return "已取消";
  if (e.status === "settled") {
    const attended = e.attended_count ?? 0;
    const paid = e.paid_count ?? 0;
    return attended > 0 && paid >= attended ? "結算完成" : "結算中";
  }
  return now.getTime() < new Date(e.registration_deadline).getTime() ? "接龍中" : "已截止";
}

export function eventEndAt(e: { event_date: string; end_time: string }): Date {
  return new Date(taipeiISO(e.event_date, e.end_time));
}

export function isPast(e: { event_date: string; end_time: string }, now: Date): boolean {
  return now.getTime() > eventEndAt(e).getTime();
}
