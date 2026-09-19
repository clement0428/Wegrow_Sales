import { describe, expect, it } from "vitest";
import { computePaymentSummary } from "@/lib/farm/payment-summary";

describe("computePaymentSummary", () => {
  it("no records: fully outstanding, nothing refundable", () => {
    const s = computePaymentSummary(1800, false, []);
    expect(s).toMatchObject({ amountReceived: 0, amountRefunded: 0, netReceived: 0, trueOutstanding: 1800, overpaidAmount: 0, refundableAmount: 0 });
  });

  it("partial payment: outstanding is the remainder, nothing overpaid", () => {
    const s = computePaymentSummary(1800, false, [{ recordType: "payment", amountTwd: 1000 }]);
    expect(s.trueOutstanding).toBe(800);
    expect(s.overpaidAmount).toBe(0);
    expect(s.refundableAmount).toBe(1000);
  });

  it("overpayment shows as overpaidAmount, never a negative trueOutstanding", () => {
    const s = computePaymentSummary(1800, false, [{ recordType: "payment", amountTwd: 2000 }]);
    expect(s.trueOutstanding).toBe(0);
    expect(s.overpaidAmount).toBe(200);
    expect(s.amountOutstanding).toBe(-200);
  });

  it("refund reduces netReceived and refundableAmount, increases outstanding", () => {
    const s = computePaymentSummary(1800, false, [
      { recordType: "payment", amountTwd: 1000 },
      { recordType: "refund", amountTwd: 200 },
    ]);
    expect(s.netReceived).toBe(800);
    expect(s.refundableAmount).toBe(800);
    expect(s.trueOutstanding).toBe(1000);
  });

  it("refundableAmount never goes negative even if refunds somehow exceed payments", () => {
    const s = computePaymentSummary(1800, false, [
      { recordType: "payment", amountTwd: 100 },
      { recordType: "refund", amountTwd: 300 },
    ]);
    expect(s.refundableAmount).toBe(0);
  });

  it("cancelled booking: adjustedAmountDue is 0 for display, but amountDue (the historical snapshot) is untouched", () => {
    const s = computePaymentSummary(1800, true, []);
    expect(s.amountDue).toBe(1800);
    expect(s.adjustedAmountDue).toBe(0);
    expect(s.bookingCancelled).toBe(true);
  });

  it("cancellation never auto-generates a refund — records list is caller-controlled, summary just reflects whatever records exist", () => {
    const s = computePaymentSummary(1800, true, [{ recordType: "payment", amountTwd: 1000 }]);
    expect(s.amountRefunded).toBe(0);
    expect(s.netReceived).toBe(1000);
  });
});
