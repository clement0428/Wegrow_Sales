const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function reminderAtForVisit(visitStartIso: string, reminderHour = 18): Date {
  const visit = new Date(visitStartIso);
  if (Number.isNaN(visit.getTime())) throw new Error("無效的來訪時間");
  const taipei = new Date(visit.getTime() + TAIPEI_OFFSET_MS);
  const reminderUtc = Date.UTC(
    taipei.getUTCFullYear(),
    taipei.getUTCMonth(),
    taipei.getUTCDate() - 1,
    reminderHour - 8,
    0,
    0,
  );
  return new Date(reminderUtc);
}

export function reminderDedupeKey(bookingId: string, visitVersion: number): string {
  return `${bookingId}:visit:${visitVersion}:day_before`;
}
