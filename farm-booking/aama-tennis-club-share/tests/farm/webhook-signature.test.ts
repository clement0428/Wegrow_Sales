import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLineWebhookSignature } from "@/lib/line/webhook-signature";

describe("verifyLineWebhookSignature", () => {
  const secret = "test-channel-secret";
  const body = JSON.stringify({ events: [] });
  const validSignature = createHmac("sha256", secret).update(body, "utf8").digest("base64");

  it("accepts a correctly computed signature", () => {
    expect(verifyLineWebhookSignature(body, validSignature, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyLineWebhookSignature(body + " ", validSignature, secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyLineWebhookSignature(body, null, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    expect(verifyLineWebhookSignature(body, validSignature, "wrong-secret")).toBe(false);
  });
});
