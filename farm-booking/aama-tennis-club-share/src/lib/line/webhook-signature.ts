import { createHmac, timingSafeEqual } from "node:crypto";

// LINE Messaging API webhook signature: base64(HMAC-SHA256(channelSecret, rawBody)),
// compared to the x-line-signature header. Must run against the RAW body bytes
// before any JSON.parse — reformatting first would change the byte sequence and
// make every signature mismatch.
export function verifyLineWebhookSignature(rawBody: string, signatureHeader: string | null, channelSecret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
