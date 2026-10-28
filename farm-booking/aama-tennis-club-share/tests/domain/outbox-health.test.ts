import { describe, it, expect } from "vitest";
import { isHealthyRun, deriveCredentialState } from "@/lib/outbox/health";

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

describe("deriveCredentialState (D-20261028-01)", () => {
  it("完全沒有執行紀錄 -> unverified", () => {
    expect(deriveCredentialState([])).toBe("unverified");
  });
  it("最近一次是完全沒設定、直接跳過 -> not_configured (sales-sync的固定字串)", () => {
    expect(deriveCredentialState([{ completed_at: "2026-10-28T00:00:00Z", failed_count: 0, error_summary: "not_configured_skipped_entirely" }])).toBe("not_configured");
  });
  it("最近一次是完全沒設定、直接跳過 -> not_configured (reminders的固定字串)", () => {
    expect(deriveCredentialState([{ completed_at: "2026-10-28T00:00:00Z", failed_count: 0, error_summary: "no_credentials_skipped_entirely" }])).toBe("not_configured");
  });
  it("最近一次健康執行 -> healthy", () => {
    expect(deriveCredentialState([{ completed_at: "2026-10-28T00:00:00Z", failed_count: 0, error_summary: null }])).toBe("healthy");
  });
  it("最近一次整批失敗(非not_configured字串) -> failing", () => {
    expect(deriveCredentialState([{ completed_at: "2026-10-28T00:00:00Z", failed_count: 5, error_summary: "credential:401" }])).toBe("failing");
  });
  it("最近一次還沒跑完(completed_at為null，非not_configured字串) -> failing", () => {
    expect(deriveCredentialState([{ completed_at: null, failed_count: 0, error_summary: null }])).toBe("failing");
  });
  it("只看陣列第一筆(最新一筆)，不被更舊的健康紀錄誤導", () => {
    const runs = [
      { completed_at: "2026-10-28T00:15:00Z", failed_count: 5, error_summary: "credential:401" },
      { completed_at: "2026-10-28T00:00:00Z", failed_count: 0, error_summary: null },
    ];
    expect(deriveCredentialState(runs)).toBe("failing");
  });
});
