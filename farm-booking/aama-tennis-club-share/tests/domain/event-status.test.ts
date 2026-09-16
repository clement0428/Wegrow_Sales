import { describe, it, expect } from "vitest";
import { deriveEventStatus, eventEndAt, isPast } from "@/lib/domain/event-status";
import { taipeiISO, defaultDeadline, taipeiDateString } from "@/lib/time";

describe("time", () => {
  it("taipeiISO 組合 +08:00", () => {
    expect(taipeiISO("2026-09-20", "19:00")).toBe("2026-09-20T19:00:00+08:00");
  });
  it("defaultDeadline 為前一天同時刻", () => {
    expect(defaultDeadline("2026-09-20", "19:00")).toBe("2026-09-19T19:00:00+08:00");
  });
  it("taipeiDateString 以台北日期為準", () => {
    // UTC 2026-09-19 17:30 = 台北 09-20 01:30
    expect(taipeiDateString(new Date("2026-09-19T17:30:00Z"))).toBe("2026-09-20");
  });
});

describe("deriveEventStatus", () => {
  const dl = "2026-09-19T19:00:00+08:00";
  it("open 且未到截止 → 接龍中", () => {
    expect(deriveEventStatus({ status: "open", registration_deadline: dl }, new Date("2026-09-19T10:00:00+08:00"))).toBe("接龍中");
  });
  it("open 且已過截止 → 已截止", () => {
    expect(deriveEventStatus({ status: "open", registration_deadline: dl }, new Date("2026-09-19T19:00:00+08:00"))).toBe("已截止");
  });
  it("settled 沒付款 → 結算中；全付 → 結算完成；cancelled → 已取消", () => {
    expect(deriveEventStatus({ status: "settled", registration_deadline: dl, attended_count: 5, paid_count: 3 }, new Date())).toBe("結算中");
    expect(deriveEventStatus({ status: "settled", registration_deadline: dl, attended_count: 5, paid_count: 5 }, new Date())).toBe("結算完成");
    expect(deriveEventStatus({ status: "cancelled", registration_deadline: dl }, new Date())).toBe("已取消");
  });
  it("eventEndAt / isPast", () => {
    const e = { event_date: "2026-09-20", end_time: "21:00:00" };
    expect(eventEndAt(e).toISOString()).toBe("2026-09-20T13:00:00.000Z");
    expect(isPast(e, new Date("2026-09-20T13:00:01Z"))).toBe(true);
    expect(isPast(e, new Date("2026-09-20T12:59:59Z"))).toBe(false);
  });
});
