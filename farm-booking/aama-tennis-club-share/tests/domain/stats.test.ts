import { describe, it, expect } from "vitest";
import { computeAttendance, buildLeaderboard, type AttendanceRow } from "@/lib/domain/stats";

const now = new Date("2026-09-13T12:00:00+08:00");
const past = { event_date: "2026-09-06", end_time: "21:00:00" };
const future = { event_date: "2026-09-20", end_time: "21:00:00" };

describe("computeAttendance", () => {
  it("已結算只算 attended=true", () => {
    const rows: AttendanceRow[] = [
      { member_id: "a", event_status: "settled", reg_status: "confirmed", attended: true, ...past },
      { member_id: "b", event_status: "settled", reg_status: "confirmed", attended: false, ...past },
    ];
    const m = computeAttendance(rows, now);
    expect(m.get("a")).toBe(1);
    expect(m.get("b") ?? 0).toBe(0);
  });
  it("open 且已過期的正取暫計，候補與未來場次不計", () => {
    const rows: AttendanceRow[] = [
      { member_id: "a", event_status: "open", reg_status: "confirmed", attended: null, ...past },
      { member_id: "b", event_status: "open", reg_status: "waitlisted", attended: null, ...past },
      { member_id: "c", event_status: "open", reg_status: "confirmed", attended: null, ...future },
    ];
    const m = computeAttendance(rows, now);
    expect(m.get("a")).toBe(1);
    expect(m.get("b") ?? 0).toBe(0);
    expect(m.get("c") ?? 0).toBe(0);
  });
  it("cancelled 不計", () => {
    const m = computeAttendance([{ member_id: "a", event_status: "cancelled", reg_status: "confirmed", attended: true, ...past }], now);
    expect(m.get("a") ?? 0).toBe(0);
  });
});

describe("buildLeaderboard", () => {
  it("依場數降序，同分依名稱", () => {
    const counts = new Map([["a", 3], ["b", 5], ["c", 3]]);
    const members = [
      { id: "a", display_name: "小明", picture_url: null },
      { id: "b", display_name: "小華", picture_url: null },
      { id: "c", display_name: "小美", picture_url: null },
      { id: "d", display_name: "沒來過", picture_url: null },
    ];
    const lb = buildLeaderboard(counts, members);
    expect(lb.map((x) => x.member.id)).toEqual(["b", "a", "c"]);
    expect(lb[0]).toMatchObject({ rank: 1, count: 5 });
  });
});
