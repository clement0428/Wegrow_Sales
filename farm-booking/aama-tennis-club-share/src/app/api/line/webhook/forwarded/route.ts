import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { processSingleLineEvent, type RawLineEvent } from "@/lib/line/webhook-event-processor";
import { getDb } from "@/lib/db/client";

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 耕譯(wegrow-orbit-src)轉發麻豆工作卡postback事件的入口——這個LINE
// channel(@647hlrhw)目前真正登記的webhook URL是耕譯那邊，不是這個repo，見
// /api/line/webhook/route.ts開頭的說明。耕譯收到postback事件後，用獨立的
// service-to-service密鑰（不是重用LINE簽章——簽章是對耕譯收到的原始webhook
// body算的，轉發過來的是重新包裝過的單一event JSON，簽章對不上也不該硬套）
// 呼叫這支API，帶著單一一筆原始LINE event JSON。
//
// 事件去重、claim/lease、回覆恰好一次——跟/api/line/webhook/route.ts共用同一套
// processSingleLineEvent()，不因為走的是轉發路徑就少一層保護。
export async function POST(request: Request) {
  const forwardSecret = process.env.LINE_WEBHOOK_FORWARD_SECRET;
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!forwardSecret || !bearer || !sameSecret(bearer, forwardSecret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { event?: RawLineEvent };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.event) {
    return Response.json({ error: "missing event" }, { status: 400 });
  }

  const db = await getDb();
  const result = await processSingleLineEvent(db, body.event, env.MADOU_GROUP_ID, env.LINE_MESSAGING_ACCESS_TOKEN);
  return Response.json({ handled: result.handled });
}
