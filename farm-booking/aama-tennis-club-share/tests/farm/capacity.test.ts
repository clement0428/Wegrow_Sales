import { describe, expect, it } from "vitest";
import { canFit, evaluateCapacity, maxNewGroupSize } from "@/lib/farm/capacity";

// 2026-09-18: flat rule approved by Clement, overrides the old tiered
// 1-team/50, 2-team/30, 3-team/15 rule entirely: every session caps at 30
// total people AND at most 2 groups, not tiered by group count. Test IDs
// below map to the C01-C13 capacity cases in
// 20260918_WeGrow_Booking_Claude_Implementation.md where the pure
// capacity function can express the case; concurrency-specific cases
// (C07-C10) depend on the real D1 atomic INSERT and are not re-tested here
// — see docs/booking-calendar-implementation.md for that gap.
describe("farm capacity: flat 30-people / 2-group rule", () => {
  const cases: Array<[number[], number, boolean, string]> = [
    [[], 30, true, "C01: empty session, add one group of 30"],
    [[], 31, false, "C02: empty session, add one group of 31"],
    [[20], 10, true, "C03: 20 + 10 = 30, two groups"],
    [[20], 11, false, "C04: 20 + 11 = 31 exceeds the flat 30 limit"],
    [[5, 5], 1, false, "C05: already 2 groups (10 people total) — a 3rd group is rejected regardless of size"],
    [[30], 1, false, "second group rejected once the flat total is already at 30"],
    [[15], 15, true, "15 + 15 = 30 exactly, two groups"],
    [[15], 16, false, "15 + 16 = 31 exceeds the flat 30 limit"],
    [[10, 5], 15, false, "already 2 groups — no 3rd group allowed even if total would stay <=30"],
    [[], 50, false, "the OLD single-group limit (50) must now be rejected — this is the regression case for the old tiered rule"],
  ];

  it.each(cases)("existing %j plus %i => %s (%s)", (existing, incoming, accepted) => {
    expect(canFit(existing, incoming)).toBe(accepted);
  });

  it("C06: growing an existing group is evaluated as its own new total, not as an extra group", () => {
    // Modelled by evaluating the OTHER active groups plus the resized group's
    // new total (application layer excludes the group being edited from
    // `existing`, then calls canFit with its new size) — capacity.ts itself
    // is group-identity-agnostic, so this just confirms the arithmetic: one
    // group at 20 growing to 30 alongside nothing else is still one group.
    expect(canFit([], 30)).toBe(true);
    expect(canFit([], 31)).toBe(false);
  });

  it("reports the actual limit for the resulting group count", () => {
    expect(evaluateCapacity([20, 10])).toMatchObject({ accepted: true, groupCount: 2, totalPeople: 30, limit: 30 });
  });

  it("rejects a would-be 3rd group with reason max_groups, not over_total_limit", () => {
    expect(evaluateCapacity([5, 5, 1]).reason).toBe("max_groups");
  });

  it("rejects invalid sizes", () => {
    expect(evaluateCapacity([0]).reason).toBe("invalid_group");
    expect(evaluateCapacity([1.5]).reason).toBe("invalid_group");
  });

  it("computes the next group's maximum against the flat 30 limit, not the old tiered 50/30/15", () => {
    expect(maxNewGroupSize([])).toBe(30);
    expect(maxNewGroupSize([20])).toBe(10);
    expect(maxNewGroupSize([5, 5])).toBe(0); // already 2 groups — no 3rd group at any size
    expect(maxNewGroupSize([25])).toBe(5);
  });
});
