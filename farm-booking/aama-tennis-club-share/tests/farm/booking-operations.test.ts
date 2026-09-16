import { describe, expect, it } from "vitest";
import { AtomicBookingLedger } from "@/lib/farm/booking-operations";
import { buildFarmCalendar } from "@/lib/farm/calendar";

describe("farm booking operation simulation", () => {
  it("enforces 50 / 30 / 15 total capacity when a group is added", async () => {
    const oneGroup = new AtomicBookingLedger();
    expect(await oneGroup.reserve("one-50", 50)).toMatchObject({ accepted: true });
    expect(await oneGroup.reserve("one-51", 1)).toMatchObject({ accepted: false, reason: "capacity_exceeded" });

    const twoGroups = new AtomicBookingLedger();
    expect(await twoGroups.reserve("two-20", 20)).toMatchObject({ accepted: true });
    expect(await twoGroups.reserve("two-10", 10)).toMatchObject({ accepted: true });
    expect(await twoGroups.reserve("two-over", 1)).toMatchObject({ accepted: false });

    const threeGroups = new AtomicBookingLedger();
    await threeGroups.reserve("three-a", 5);
    await threeGroups.reserve("three-b", 5);
    expect(await threeGroups.reserve("three-c", 5)).toMatchObject({ accepted: true });
    expect(await threeGroups.reserve("three-over", 1)).toMatchObject({ accepted: false });
  });

  it("serializes concurrent reservations so only one competing group wins", async () => {
    const ledger = new AtomicBookingLedger();
    await ledger.reserve("base", 20);
    const results = await Promise.all([
      ledger.reserve("race-a", 10),
      ledger.reserve("race-b", 10),
    ]);
    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(ledger.activeBookings().reduce((sum, booking) => sum + booking.people, 0)).toBe(30);
  });

  it("releases capacity after cancellation and creates a new versioned Sales event", async () => {
    const ledger = new AtomicBookingLedger();
    await ledger.reserve("cancel-me", 30, "2026-09-16T01:00:00.000Z");
    await ledger.confirm("cancel-me", "2026-09-16T01:01:00.000Z");
    expect(await ledger.reserve("blocked", 1)).toMatchObject({ accepted: false });
    expect(await ledger.cancel("cancel-me", "2026-09-16T01:02:00.000Z")).toBe(true);
    expect(await ledger.reserve("replacement", 50)).toMatchObject({ accepted: true });
    expect(ledger.getSalesEvents().map((event) => event.eventId)).toEqual([
      "cancel-me:1:booking.held",
      "cancel-me:1:booking.confirmed",
      "cancel-me:2:booking.cancelled",
      "replacement:1:booking.held",
    ]);
  });

  it("schedules one versioned day-before reminder only for confirmed bookings", async () => {
    const ledger = new AtomicBookingLedger();
    await ledger.reserve("B-18", 18);
    expect(ledger.reminderFor("B-18", "2026-09-20T14:00:00+08:00")).toBeNull();
    await ledger.confirm("B-18");
    expect(ledger.reminderFor("B-18", "2026-09-20T14:00:00+08:00")).toEqual({
      scheduledAt: "2026-09-19T10:00:00.000Z",
      retryKey: "B-18:visit:1:day_before",
    });
  });

  it("builds a readable Taiwan calendar event", () => {
    const calendar = buildFarmCalendar({
      bookingId: "B-ICS",
      startsAt: "2026-09-19T09:30:00",
      endsAt: "2026-09-19T11:00:00",
      summary: "WeGrow 科技農場參訪",
      location: "台南麻豆 WeGrow 科技農場",
      description: "請穿方便行走的鞋子。",
    }, new Date("2026-09-16T00:00:00.000Z"));
    expect(calendar).toContain("DTSTART;TZID=Asia/Taipei:20260919T093000");
    expect(calendar).toContain("SUMMARY:WeGrow 科技農場參訪");
    expect(calendar).not.toContain("�");
  });
});
