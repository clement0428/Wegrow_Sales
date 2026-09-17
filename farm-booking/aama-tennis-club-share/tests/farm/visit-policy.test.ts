import { describe, expect, it } from "vitest";
import {
  isAllowedBookingSlot,
  isContactRequiredDay,
  isDirectBookingSlot,
  ticketRateBpsForSlot,
} from "@/lib/farm/visit-policy";

describe("farm visit schedule policy", () => {
  it("allows direct booking only Tuesday through Thursday from 14:00 to 18:00", () => {
    expect(isDirectBookingSlot("2026-09-22T14:00:00+08:00", "2026-09-22T18:00:00+08:00")).toBe(true);
    expect(isDirectBookingSlot("2026-09-24T14:00:00+08:00", "2026-09-24T18:00:00+08:00")).toBe(true);
    expect(isDirectBookingSlot("2026-09-22T09:00:00+08:00", "2026-09-22T13:00:00+08:00")).toBe(false);
  });

  it("requires customer service on Friday, Saturday and Sunday", () => {
    expect(isContactRequiredDay("2026-09-18T14:00:00+08:00")).toBe(true);
    expect(isContactRequiredDay("2026-09-19T14:00:00+08:00")).toBe(true);
    expect(isContactRequiredDay("2026-09-20T14:00:00+08:00")).toBe(true);
  });

  it("keeps Monday closed and applies the holiday rate to contact days", () => {
    expect(isAllowedBookingSlot("2026-09-21T14:00:00+08:00", "2026-09-21T18:00:00+08:00")).toBe(false);
    expect(isAllowedBookingSlot("2026-09-18T14:00:00+08:00", "2026-09-18T18:00:00+08:00")).toBe(false);
    expect(ticketRateBpsForSlot("2026-09-18T14:00:00+08:00")).toBe(12_000);
    expect(ticketRateBpsForSlot("2026-09-22T14:00:00+08:00")).toBe(10_000);
  });
});
