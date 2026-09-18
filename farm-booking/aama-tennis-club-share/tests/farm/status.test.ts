import { describe, expect, it } from "vitest";
import { bucketOf, stepIndexOf, type BucketInput } from "@/lib/farm/status";

function row(overrides: Partial<BucketInput>): BucketInput {
  return {
    booking_status: "requested",
    payment_status: "not_open",
    hold_expires_at: null,
    cancelled_at: null,
    arrived_at: null,
    completed_at: null,
    ...overrides,
  };
}

const NOW = "2026-09-18T12:00:00.000Z";

describe("bucketOf", () => {
  it("cancelled wins over everything else, even if also completed", () => {
    expect(bucketOf(row({ cancelled_at: "2026-09-17T00:00:00.000Z", completed_at: "2026-09-17T00:00:00.000Z" }), NOW)).toBe("cancelled");
  });

  it("completed wins over arrived", () => {
    expect(bucketOf(row({ completed_at: "2026-09-18T11:00:00.000Z", arrived_at: "2026-09-18T10:00:00.000Z" }), NOW)).toBe("completed");
  });

  it("arrived wins over confirmed", () => {
    expect(bucketOf(row({ booking_status: "confirmed", arrived_at: "2026-09-18T10:00:00.000Z" }), NOW)).toBe("arrived");
  });

  it("a failed payment is an exception regardless of booking_status", () => {
    expect(bucketOf(row({ booking_status: "confirmed", payment_status: "failed" }), NOW)).toBe("exception");
  });

  it("pending_payment with a live hold is pending_payment", () => {
    expect(bucketOf(row({ booking_status: "pending_payment", hold_expires_at: "2026-09-18T13:00:00.000Z" }), NOW)).toBe("pending_payment");
  });

  it("pending_payment with an expired hold nobody cleaned up is an exception", () => {
    expect(bucketOf(row({ booking_status: "pending_payment", hold_expires_at: "2026-09-18T11:00:00.000Z" }), NOW)).toBe("exception");
  });

  it("confirmed maps to confirmed", () => {
    expect(bucketOf(row({ booking_status: "confirmed" }), NOW)).toBe("confirmed");
  });

  it("requested maps to hold", () => {
    expect(bucketOf(row({ booking_status: "requested" }), NOW)).toBe("hold");
  });
});

describe("stepIndexOf", () => {
  it("hold/pending_payment/exception all sit at the confirm/payment step", () => {
    expect(stepIndexOf("hold")).toBe(2);
    expect(stepIndexOf("pending_payment")).toBe(2);
    expect(stepIndexOf("exception")).toBe(2);
  });

  it("advances monotonically through confirmed -> arrived -> completed", () => {
    expect(stepIndexOf("confirmed")).toBeLessThan(stepIndexOf("arrived"));
    expect(stepIndexOf("arrived")).toBeLessThan(stepIndexOf("completed"));
  });

  it("cancelled is off the normal track", () => {
    expect(stepIndexOf("cancelled")).toBe(-1);
  });
});
