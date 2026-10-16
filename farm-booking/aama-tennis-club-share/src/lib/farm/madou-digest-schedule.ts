// Pure scheduling helpers for the Madou group daily digest — PDF suggests
// 前一天17:00 as an initial default, explicitly marked 待設定值 (not an agreed
// business rule) per the 20261016 handoff §4.2. Kept as a parameter, not baked in,
// so changing it later doesn't need touching the job route itself.
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function toTaipei(date: Date): Date {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS);
}

export function taipeiDateString(date: Date): string {
  const t = toTaipei(date);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isDigestDue(now: Date, triggerHour = 17): boolean {
  return toTaipei(now).getUTCHours() >= triggerHour;
}

// "Tomorrow" relative to `now`, in Taipei calendar terms.
export function digestTargetDateIso(now: Date): string {
  const t = toTaipei(now);
  const tomorrow = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
  const y = tomorrow.getUTCFullYear();
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
