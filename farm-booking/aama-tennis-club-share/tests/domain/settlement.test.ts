import { describe, it, expect } from "vitest";
import { computeSettlement } from "@/lib/domain/settlement";

describe("computeSettlement", () => {
  it("整除", () => {
    expect(computeSettlement({ finalTotal: 2500, attendedMemberIds: ["a", "b", "c", "d", "e"] }))
      .toEqual({ perPerson: 500, expectedIncome: 2500, diff: 0 });
  });
  it("不整除時無條件進位，diff 為多收", () => {
    expect(computeSettlement({ finalTotal: 1000, attendedMemberIds: ["a", "b", "c"] }))
      .toEqual({ perPerson: 334, expectedIncome: 1002, diff: 2 });
  });
  it("到場 0 人丟錯", () => {
    expect(() => computeSettlement({ finalTotal: 100, attendedMemberIds: [] })).toThrow("到場人數不可為 0");
  });
  it("總額為負或非整數丟錯", () => {
    expect(() => computeSettlement({ finalTotal: -1, attendedMemberIds: ["a"] })).toThrow();
    expect(() => computeSettlement({ finalTotal: 10.5, attendedMemberIds: ["a"] })).toThrow();
  });
  it("重新結算把某人從 attended 拿掉後，per-person 依新的到場人數重算", () => {
    const first = computeSettlement({ finalTotal: 1200, attendedMemberIds: ["a", "b", "c", "d"] });
    expect(first).toEqual({ perPerson: 300, expectedIncome: 1200, diff: 0 });
    const resettled = computeSettlement({ finalTotal: 1200, attendedMemberIds: ["a", "b", "c"] });
    expect(resettled).toEqual({ perPerson: 400, expectedIncome: 1200, diff: 0 });
  });
});
