// Shared retry/backoff schedule for any queued-outbox consumer (LINE
// reminders, Sales sync, …) — same escalation curve, same cutoff, so two
// independent retry systems don't drift into different behavior for no reason.
const BACKOFF_MINUTES = [5, 15, 60, 240, 720]; // 5min, 15min, 1hr, 4hr, capped 12hr

export function nextAttemptDelayMinutes(attemptCountBeforeThisFailure: number): number {
  const index = Math.min(attemptCountBeforeThisFailure, BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[index];
}

export const MAX_SEND_ATTEMPTS = 6;
