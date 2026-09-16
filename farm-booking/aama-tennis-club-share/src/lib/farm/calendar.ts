export type FarmCalendarEvent = {
  bookingId: string;
  startsAt: string;
  endsAt: string;
  summary: string;
  location: string;
  description: string;
};

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function toIcsTaipei(value: string): string {
  return value.replace(/[-:]/g, "").slice(0, 15);
}

export function buildFarmCalendar(event: FarmCalendarEvent, generatedAt = new Date()): string {
  const stamp = generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WeGrow//Farm Booking//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(event.bookingId)}@wegrow-farm`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Taipei:${toIcsTaipei(event.startsAt)}`,
    `DTEND;TZID=Asia/Taipei:${toIcsTaipei(event.endsAt)}`,
    `SUMMARY:${escapeIcs(event.summary)}`,
    `LOCATION:${escapeIcs(event.location)}`,
    `DESCRIPTION:${escapeIcs(event.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
