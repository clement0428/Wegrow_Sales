import { describe, expect, it } from "vitest";
import { calculateVisitPrice } from "@/lib/farm/pricing";

describe("farm visit pricing", () => {
  it("keeps the admission amount when no add-ons are selected", () => {
    expect(calculateVisitPrice({ people: 2, plantCount: 0, mealCount: 0 })).toEqual({
      ticketSubtotalTwd: 600,
      addOnSubtotalTwd: 0,
      creditAppliedTwd: 0,
      creditRemainingTwd: 600,
      totalTwd: 600,
    });
  });

  it("applies admission credit without reducing the total below admission", () => {
    expect(calculateVisitPrice({ people: 30, plantCount: 30, mealCount: 30 })).toEqual({
      ticketSubtotalTwd: 9000,
      addOnSubtotalTwd: 18000,
      creditAppliedTwd: 9000,
      creditRemainingTwd: 0,
      totalTwd: 18000,
    });
  });

  it("leaves unused same-day credit when add-ons cost less than admission", () => {
    expect(calculateVisitPrice({ people: 2, plantCount: 1, mealCount: 0 })).toEqual({
      ticketSubtotalTwd: 600,
      addOnSubtotalTwd: 250,
      creditAppliedTwd: 250,
      creditRemainingTwd: 350,
      totalTwd: 600,
    });
  });
});
