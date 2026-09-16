import { describe, it, expect } from "vitest";
import { nextSeatFrom, recomputeStatus, applyCancel, type RegRow } from "@/lib/domain/seats";

describe("nextSeatFrom", () => {
  it("空陣列 → 1", () => {
    expect(nextSeatFrom([])).toBe(1);
  });
  it("連續座位 [1,2,3] → 4", () => {
    expect(nextSeatFrom([1, 2, 3])).toBe(4);
  });
  it("有洞 [2,5] → 6（不填洞）", () => {
    expect(nextSeatFrom([2, 5])).toBe(6);
  });
});

describe("recomputeStatus", () => {
  it("seat_no <= capacity → confirmed，否則 waitlisted", () => {
    const rows: RegRow[] = [
      { member_id: "a", seat_no: 1, status: "waitlisted" },
      { member_id: "b", seat_no: 2, status: "confirmed" },
      { member_id: "c", seat_no: 3, status: "confirmed" },
    ];
    const result = recomputeStatus(rows, 2);
    expect(result.map((r) => r.status)).toEqual(["confirmed", "confirmed", "waitlisted"]);
  });

  it("不改動原陣列（回傳新陣列）", () => {
    const rows: RegRow[] = [{ member_id: "a", seat_no: 1, status: "waitlisted" }];
    const original = JSON.parse(JSON.stringify(rows));
    const result = recomputeStatus(rows, 5);
    expect(rows).toEqual(original);
    expect(result).not.toBe(rows);
  });

  it("seat_no 剛好等於 capacity → confirmed", () => {
    const rows: RegRow[] = [{ member_id: "a", seat_no: 5, status: "waitlisted" }];
    const result = recomputeStatus(rows, 5);
    expect(result[0].status).toBe("confirmed");
  });
});

describe("applyCancel", () => {
  it("移除中段：其他人 seat_no 往前收，狀態依 capacity 重算", () => {
    const rows: RegRow[] = [
      { member_id: "a", seat_no: 1, status: "confirmed" },
      { member_id: "b", seat_no: 2, status: "confirmed" },
      { member_id: "c", seat_no: 3, status: "confirmed" },
      { member_id: "d", seat_no: 4, status: "waitlisted" },
    ];
    const { after, promoted } = applyCancel(rows, "b", 3);
    expect(after).toEqual([
      { member_id: "a", seat_no: 1, status: "confirmed" },
      { member_id: "c", seat_no: 2, status: "confirmed" },
      { member_id: "d", seat_no: 3, status: "confirmed" },
    ]);
    expect(promoted).toBe("d");
  });

  it("移除首位（confirmed）→ 候補第一位遞補為 confirmed，promoted 回傳該 member_id", () => {
    const rows: RegRow[] = [
      { member_id: "a", seat_no: 1, status: "confirmed" },
      { member_id: "b", seat_no: 2, status: "confirmed" },
      { member_id: "c", seat_no: 3, status: "waitlisted" },
    ];
    const { after, promoted } = applyCancel(rows, "a", 2);
    expect(after).toEqual([
      { member_id: "b", seat_no: 1, status: "confirmed" },
      { member_id: "c", seat_no: 2, status: "confirmed" },
    ]);
    expect(promoted).toBe("c");
  });

  it("移除的人不在 rows → 丟 Error(\"找不到該成員\")", () => {
    const rows: RegRow[] = [{ member_id: "a", seat_no: 1, status: "confirmed" }];
    expect(() => applyCancel(rows, "z", 5)).toThrow("找不到該成員");
  });

  it("從全滿正取 5 中移除一位（capacity 5、5 人正取、0 候補）→ promoted 為 null，剩 4 人皆 confirmed，seat_no 為 1..4", () => {
    const rows: RegRow[] = [
      { member_id: "a", seat_no: 1, status: "confirmed" },
      { member_id: "b", seat_no: 2, status: "confirmed" },
      { member_id: "c", seat_no: 3, status: "confirmed" },
      { member_id: "d", seat_no: 4, status: "confirmed" },
      { member_id: "e", seat_no: 5, status: "confirmed" },
    ];
    const { after, promoted } = applyCancel(rows, "c", 5);
    expect(promoted).toBeNull();
    expect(after.every((r) => r.status === "confirmed")).toBe(true);
    expect(after.map((r) => r.seat_no)).toEqual([1, 2, 3, 4]);
    expect(after.map((r) => r.member_id)).toEqual(["a", "b", "d", "e"]);
  });

  it("空陣列 applyCancel → 丟錯（找不到）", () => {
    expect(() => applyCancel([], "a", 5)).toThrow("找不到該成員");
  });

  it("不改動原陣列（回傳新陣列）", () => {
    const rows: RegRow[] = [
      { member_id: "a", seat_no: 1, status: "confirmed" },
      { member_id: "b", seat_no: 2, status: "waitlisted" },
    ];
    const original = JSON.parse(JSON.stringify(rows));
    applyCancel(rows, "a", 1);
    expect(rows).toEqual(original);
  });
});
