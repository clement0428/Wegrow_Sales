import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { processMadouPostbackAction, type MadouPostbackAction } from "@/lib/line/madou-webhook-process";
import { sendLineReplyMessage } from "@/lib/line/messaging";
import { verifyLineWebhookSignature } from "@/lib/line/webhook-signature";

const KNOWN_ACTIONS: ReadonlySet<string> = new Set(["claim", "view_prep", "report_issue"]);

// 麻豆現場群 webhook：這個repo目前唯一的LINE Messaging API webhook接收端
// （既有程式只有送出，見messaging.ts）。驗簽、事件去重、群組/來源白名單、
// 成員身分解析——不信任前端或postback payload本身帶的任何身分宣稱，一律用
// members.line_user_id反查，跟既有LIFF登入走的是同一套member識別，不另建身分系統。
//
// 事件處理分兩段：先寫入farm_line_webhook_events（status='queued'），再執行動作；
// 成功才轉status='processed'。LINE對已回200的事件永不重送，所以動作失敗時絕對
// 不能讓事件就此消失——失敗留在status='queued'讓/api/jobs/madou-group的重試階段
// 之後再試（見madou-webhook-process.ts）。這是本輪審查發現的P0缺口修正：原版
// 本只用這張表做去重、動作失敗仍回200且沒有任何重試路徑。
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

  const db = await getDb();
  const madouGroupId = env.MADOU_GROUP_ID;
  const accessToken = env.LINE_MESSAGING_ACCESS_TOKEN;
  let handled = 0;

  for (const rawEvent of payload.events ?? []) {
    const event = rawEvent as {
      type?: string;
      webhookEventId?: string;
      replyToken?: string;
      source?: { type?: string; groupId?: string; userId?: string };
      postback?: { data?: string };
    };
    const eventId = event.webhookEventId;
    if (!eventId) continue; // can't dedupe an event with no id — drop rather than risk double-processing

    if (event.type !== "postback") continue;
    const source = event.source ?? {};
    if (source.type !== "group" || !madouGroupId || source.groupId !== madouGroupId) continue; // only the Madou group, and only once configured
    if (!source.userId) continue;

    const fields = new URLSearchParams(event.postback?.data ?? "");
    const action = fields.get("action");
    const bookingId = fields.get("bookingId");
    const vRaw = fields.get("v");
    const expectedVisitVersion = vRaw !== null && vRaw !== "" && !Number.isNaN(Number(vRaw)) ? Number(vRaw) : null;
    if (!action || !bookingId || !KNOWN_ACTIONS.has(action)) continue;

    const member = await db.prepare("SELECT id, display_name, role FROM members WHERE line_user_id = ?").bind(source.userId).first<{ id: string; display_name: string; role: string }>();
    if (!member) continue; // unrecognized LINE account — never trust a bare userId as staff

    const nowIso = new Date().toISOString();
    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO farm_line_webhook_events
         (id, processed_at, status, raw_event_json, action, booking_id, actor_member_id, visit_version_param, attempt_count, updated_at)
         VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, 0, ?)`,
      )
      .bind(eventId, nowIso, JSON.stringify(rawEvent), action, bookingId, member.id, expectedVisitVersion, nowIso)
      .run();
    if (!inserted.meta.changes) continue; // already recorded this exact event (duplicate delivery or already-processed)

    let replyText: string | null = null;
    try {
      const result = await processMadouPostbackAction(db, action as MadouPostbackAction, bookingId, expectedVisitVersion, member);
      replyText = result.replyText;
      await db.prepare("UPDATE farm_line_webhook_events SET status = 'processed', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), eventId).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now2 = new Date().toISOString();
      // Leave status='queued' (not 'failed') — the retry worker's SELECT in
      // jobs/madou-group/route.ts picks up 'queued' rows, same vocabulary as
      // farm_notification_outbox so claimRow() can be reused unmodified.
      await db
        .prepare("UPDATE farm_line_webhook_events SET attempt_count = attempt_count + 1, error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?")
        .bind(message, now2, now2, eventId)
        .run();
      console.error("madou webhook event failed, queued for retry", error);
    }

    if (replyText) await replyIfPossible(accessToken, event.replyToken, replyText);
    handled += 1;
  }

  return Response.json({ handled });
}

async function replyIfPossible(accessToken: string | undefined, replyToken: string | undefined, text: string): Promise<void> {
  if (!accessToken || !replyToken) return;
  await sendLineReplyMessage(accessToken, replyToken, [{ type: "text", text }]);
}
