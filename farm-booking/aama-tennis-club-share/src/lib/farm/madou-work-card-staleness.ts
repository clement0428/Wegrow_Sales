import type { MadouWorkCardSnapshot } from "@/lib/line/madou-group-queue";

export type CurrentBookingState = { cancelled_at: string | null; visit_version: number };

// A queued work-card row is superseded (should be marked 'cancelled' instead
// of sent) if, by send time, the booking has since been cancelled (and this
// row isn't itself the cancellation notice) or a newer reschedule has
// already bumped visit_version past what this row was composed against —
// the newer event's own row carries the up-to-date content instead.
// Pure/testable without D1; the caller (jobs/madou-group/route.ts) is
// responsible for fetching `current` right before deciding whether to send.
export function isSupersededWorkCard(snapshot: MadouWorkCardSnapshot, current: CurrentBookingState | null): boolean {
  if (!current) return false; // booking vanished entirely — fail open, let the send attempt itself surface the error
  if (current.cancelled_at && snapshot.eventKind !== "cancelled") return true;
  if (current.visit_version > snapshot.visitVersion) return true;
  return false;
}
