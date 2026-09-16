import { timingSafeEqual } from "node:crypto";

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.JOB_SECRET;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !sameSecret(actual, expected)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ mode: "not_configured", processed: 0, message: "提醒 outbox schema 已建立；LINE Messaging API 憑證與 D1 正式環境尚未設定。" });
}
