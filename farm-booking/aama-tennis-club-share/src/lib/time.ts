export const TZ = "Asia/Taipei";

/** "HH:mm" 或 "HH:mm:ss" → "HH:mm" */
export function hm(time: string): string {
  return time.slice(0, 5);
}

export function taipeiISO(date: string, time: string): string {
  return `${date}T${hm(time)}:00+08:00`;
}

export function defaultDeadline(date: string, startTime: string): string {
  const d = new Date(taipeiISO(date, startTime));
  d.setUTCDate(d.getUTCDate() - 1);
  return `${taipeiDateString(d)}T${hm(startTime)}:00+08:00`;
}

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

export function taipeiParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}

export function taipeiDateString(d: Date): string {
  return taipeiParts(d).date;
}

/** ISO → "2026/09/20 19:00" */
export function formatTaipei(iso: string): string {
  const { date, time } = taipeiParts(new Date(iso));
  return `${date.replaceAll("-", "/")} ${time}`;
}

export const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** "2026-09-20" → { day: "20", weekday: "週日", month: "9月" } */
export function dateParts(date: string) {
  const d = new Date(`${date}T00:00:00+08:00`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return { day: String(Number(date.slice(8, 10))), weekday: WEEKDAYS[idx], month: `${Number(date.slice(5, 7))}月` };
}
