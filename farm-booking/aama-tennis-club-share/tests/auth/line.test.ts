import { describe, it, expect, vi } from "vitest";
import { verifyLineIdToken } from "@/lib/auth/line";

describe("verifyLineIdToken", () => {
  it("成功回傳 sub/name/picture，並以 form 送 id_token 與 client_id", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toBe("id_token=tok&client_id=123");
      return new Response(JSON.stringify({ sub: "U1", name: "小明", picture: "https://p" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await verifyLineIdToken("tok", "123", fetchFn);
    expect(r).toEqual({ sub: "U1", name: "小明", picture: "https://p" });
  });
  it("LINE 回 400 時丟出 error_description", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: "invalid_request", error_description: "IdToken expired." }), { status: 400 })) as unknown as typeof fetch;
    await expect(verifyLineIdToken("tok", "123", fetchFn)).rejects.toThrow("IdToken expired.");
  });
});
