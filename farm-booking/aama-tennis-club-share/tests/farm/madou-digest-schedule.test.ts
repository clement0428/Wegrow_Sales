import { describe, expect, it } from "vitest";
import { digestTargetDateIso, isDigestDue, taipeiDateString } from "@/lib/farm/madou-digest-schedule";

describe("taipeiDateString", () => {
  it("converts a UTC instant to its Taipei calendar date", () => {
    // 2026-10-15T16:30:00Z = 2026-10-16 00:30 Taipei
    expect(taipeiDateString(new Date("2026-10-15T16:30:00Z"))).toBe("2026-10-16");
  });
});

describe("isDigestDue", () => {
  it("is false before the trigger hour in Taipei time", () => {
    // 08:00Z = 16:00 Taipei, before the default 17:00 trigger
    expect(isDigestDue(new Date("2026-10-15T08:00:00Z"))).toBe(false);
  });

  it("is true at/after the trigger hour in Taipei time", () => {
    // 09:00Z = 17:00 Taipei
    expect(isDigestDue(new Date("2026-10-15T09:00:00Z"))).toBe(true);
  });

  it("respects a custom trigger hour", () => {
    expect(isDigestDue(new Date("2026-10-15T08:00:00Z"), 16)).toBe(true);
  });
});

describe("digestTargetDateIso", () => {
  it("targets the Taipei calendar day after now", () => {
    // 2026-10-15 17:00 Taipei -> target 2026-10-16
    expect(digestTargetDateIso(new Date("2026-10-15T09:00:00Z"))).toBe("2026-10-16");
  });

  it("crosses a month boundary correctly", () => {
    // 2026-10-31 20:00 Taipei -> target 2026-11-01
    expect(digestTargetDateIso(new Date("2026-10-31T12:00:00Z"))).toBe("2026-11-01");
  });
});
