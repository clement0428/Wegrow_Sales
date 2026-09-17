export const STANDARD_TICKET_RATE_BPS = 10_000;
export const HOLIDAY_TICKET_RATE_BPS = 12_000;

function taipeiWeekday(isoDateTime: string) {
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(isoDateTime));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

function taipeiTime(isoDateTime: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(isoDateTime));
}

export function isContactRequiredDay(isoDateTime: string) {
  return [0, 5, 6].includes(taipeiWeekday(isoDateTime));
}

export function isDirectBookingSlot(startsAt: string, endsAt: string) {
  const day = taipeiWeekday(startsAt);
  return [2, 3, 4].includes(day) && taipeiTime(startsAt) === "14:00" && taipeiTime(endsAt) === "18:00";
}

export function isAllowedBookingSlot(startsAt: string, endsAt: string) {
  return isDirectBookingSlot(startsAt, endsAt);
}

export function ticketRateBpsForSlot(startsAt: string) {
  return isContactRequiredDay(startsAt) ? HOLIDAY_TICKET_RATE_BPS : STANDARD_TICKET_RATE_BPS;
}
