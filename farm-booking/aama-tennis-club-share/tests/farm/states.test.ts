import { describe, expect, it } from "vitest";
import { canTransitionBooking, occupiesCapacity } from "@/lib/farm/states";

describe("booking and payment states", () => {
  it("does not treat a browser redirect as confirmation", () => {
    expect(canTransitionBooking("held", "confirmed")).toBe(true);
    expect(occupiesCapacity("held", "pending")).toBe(true);
  });

  it("keeps cancel requests in capacity until approved", () => {
    expect(occupiesCapacity("cancel_requested", "paid")).toBe(true);
  });

  it("releases cancelled and expired bookings", () => {
    expect(occupiesCapacity("cancelled", "refund_pending")).toBe(false);
    expect(occupiesCapacity("expired", "unpaid")).toBe(false);
  });

  it("blocks invalid terminal transitions", () => {
    expect(canTransitionBooking("cancelled", "confirmed")).toBe(false);
    expect(canTransitionBooking("completed", "confirmed")).toBe(false);
  });
});
