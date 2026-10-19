import { env } from "@/lib/env";
import { processLineEvents } from "@/lib/line/webhook-event-processor";
import { verifyLineWebhookSignature } from "@/lib/line/webhook-signature";

// 麻豆現場群 webhook：這個repo自己的LINE Messaging API webhook接收端，驗證
// 真正的LINE簽章。2026-10-18確認：這個LINE channel(@647hlrhw)目前登記的webhook
// URL其實是耕譯那邊(wegrow-orbit-src的/api/line/kengyi/webhook)，不是這支路由
// ——耕譯從不處理postback事件，會把麻豆工作卡的postback轉發到
// /api/line/webhook/forwarded（服務對服務密鑰驗證，不是LINE簽章）。這支路由
// 保留著：驗簽、事件去重、群組/來源白名單、成員身分解析的邏輯跟forwarded那支
// 共用同一個processLineEvents()，哪天真的改登記回這裡也不用重寫。
export async function POST(request: Request) {
  const channelSecret = env.LINE_MESSAGING_CHANNEL_SECRET;
  const rawBody = await request.text();
  if (!channelSecret || !verifyLineWebhookSignature(rawBody, request.headers.get("x-line-signature"), channelSecret)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: { events?: unknown[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const handled = await processLineEvents((payload.events ?? []) as never[], env.MADOU_GROUP_ID, env.LINE_MESSAGING_ACCESS_TOKEN);
  return Response.json({ handled });
}
