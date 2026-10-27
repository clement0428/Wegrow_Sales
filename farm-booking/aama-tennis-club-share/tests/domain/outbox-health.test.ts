import { describe, it, expect } from "vitest";
import { isHealthyRun } from "@/lib/outbox/health";

describe("isHealthyRun (ZD-003)", () => {
  it("空queue的成功tick(due=0, failed=0)算健康", () => {
    expect(isHealthyRun({ completed_at: "2026-10-27T00:00:32.000Z", failed_count: 0 })).toBe(true);
  });
  it("有待處理且全部送達成功(failed=0)算健康", () => {
    expect(isHealthyRun({ completed_at: "2026-10-27T00:00:45.000Z", failed_count: 0 })).toBe(true);
  });
  it("結構性401整批失敗(failed>0)不算健康，即使completed_at有值", () => {
    expect(isHealthyRun({ completed_at: "2026-10-26T14:05:34.000Z", failed_count: 3 })).toBe(false);
  });
  it("還沒跑完(completed_at為null)不算健康", () => {
    expect(isHealthyRun({ completed_at: null, failed_count: 0 })).toBe(false);
  });
});
