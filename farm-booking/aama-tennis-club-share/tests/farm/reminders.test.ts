import { describe, expect, it } from "vitest";
import { reminderAtForVisit, reminderDedupeKey } from "@/lib/farm/reminders";

describe("day-before reminders", () => {
  it("uses the previous Taipei calendar day at 18:00", () => {
    expect(reminderAtForVisit("2026-09-20T14:00:00+08:00").toISOString()).toBe("2026-09-19T10:00:00.000Z");
  });

  it("crosses month and year boundaries", () => {
    expect(reminderAtForVisit("2027-01-01T09:00:00+08:00").toISOString()).toBe("2026-12-31T10:00:00.000Z");
  });

  it("versions the dedupe key after rescheduling", () => {
    expect(reminderDedupeKey("B-1", 2)).toBe("B-1:visit:2:day_before");
  });
});
