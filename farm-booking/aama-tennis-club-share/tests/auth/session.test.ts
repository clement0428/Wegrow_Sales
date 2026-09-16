import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";

describe("session", () => {
  const secret = "test-secret-at-least-32-characters-long!!";
  it("簽發後可驗證取回 member id", async () => {
    const t = await signSession("m-1", secret);
    expect(await verifySession(t, secret)).toBe("m-1");
  });
  it("錯的 secret 回 null", async () => {
    const t = await signSession("m-1", secret);
    expect(await verifySession(t, "another-secret-that-is-also-long-enough")).toBeNull();
  });
  it("亂字串回 null", async () => {
    expect(await verifySession("garbage", secret)).toBeNull();
  });
});
