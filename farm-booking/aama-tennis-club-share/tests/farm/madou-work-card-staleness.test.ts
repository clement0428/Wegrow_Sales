import { describe, expect, it } from "vitest";
import { isSupersededWorkCard } from "@/lib/farm/madou-work-card-staleness";
import type { MadouWorkCardSnapshot } from "@/lib/line/madou-group-queue";

const booking: MadouWorkCardSnapshot["booking"] = {
  bookingId: "B-1", bookingNumber: "WG-1", groupName: null, experience: "草莓溫室參訪",
  startsAt: "2026-10-20T01:00:00.000Z", endsAt: "2026-10-20T03:00:00.000Z",
  adultCount: 1, childCount: 0, infantCount: 0, totalPeople: 1, plantCount: 0, mealCount: 0, vegetarianMealCount: 0,
};

function snapshot(overrides: Partial<MadouWorkCardSnapshot>): MadouWorkCardSnapshot {
  return { eventKind: "confirmed", visitVersion: 1, booking, ...overrides };
}

describe("isSupersededWorkCard", () => {
  it("is not superseded when the booking's current state still matches the snapshot", () => {
    expect(isSupersededWorkCard(snapshot({ visitVersion: 1 }), { cancelled_at: null, visit_version: 1 })).toBe(false);
  });

  it("a confirmed/rescheduled card is superseded once the booking has since been cancelled", () => {
    expect(isSupersededWorkCard(snapshot({ eventKind: "confirmed", visitVersion: 1 }), { cancelled_at: "2026-10-19T00:00:00.000Z", visit_version: 1 })).toBe(true);
    expect(isSupersededWorkCard(snapshot({ eventKind: "rescheduled", visitVersion: 1 }), { cancelled_at: "2026-10-19T00:00:00.000Z", visit_version: 1 })).toBe(true);
  });

  it("the cancellation notice itself is never treated as superseded by the cancellation it announces", () => {
    expect(isSupersededWorkCard(snapshot({ eventKind: "cancelled", visitVersion: 1 }), { cancelled_at: "2026-10-19T00:00:00.000Z", visit_version: 1 })).toBe(false);
  });

  it("is superseded once a later reschedule has bumped visit_version past what this row was composed against", () => {
    expect(isSupersededWorkCard(snapshot({ eventKind: "confirmed", visitVersion: 1 }), { cancelled_at: null, visit_version: 2 })).toBe(true);
  });

  it("fails open (not superseded) when the booking can no longer be found at all", () => {
    expect(isSupersededWorkCard(snapshot({ visitVersion: 1 }), null)).toBe(false);
  });
});
