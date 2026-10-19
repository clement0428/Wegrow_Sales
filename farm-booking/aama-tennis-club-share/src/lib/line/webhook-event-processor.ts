import "server-only";
import { getDb } from "@/lib/db/client";
import { buildQueueMadouWebhookResultStatement } from "@/lib/line/madou-group-queue";
import { processMadouPostbackAction, type MadouPostbackAction } from "@/lib/line/madou-webhook-process";
import { sendLineReplyMessage } from "@/lib/line/messaging";
import { claimRow } from "@/lib/outbox/claim";

export const KNOWN_ACTIONS: ReadonlySet<string> = new Set(["claim", "view_prep", "report_issue"]);

export type RawLineEvent = {
  type?: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: { type?: string; groupId?: string; userId?: string };
  postback?: { data?: string };
};

// 單一事件的處理邏輯——原本只內嵌在/api/line/webhook/route.ts的迴圈裡，2026-10-18
// 抽出來給兩個入口共用：
// 1. 真正收到LINE簽章驗證過的原始webhook（這個repo自己的/api/line/webhook，
//    目前LINE channel沒有登記這個URL，但保留著不拆，萬一哪天改登記）。
// 2. 耕譯那邊(wegrow-orbit-src)轉發過來的postback事件
//    （/api/line/webhook/forwarded，見該route.ts）——目前真正的LINE webhook
//    URL登記在耕譯，耕譯自己從不處理postback事件，轉發到這裡才是這個repo
//    實際收到麻豆工作卡按鈕事件的真正路徑。
//
// 不管從哪個入口進來，事件去重（farm_line_webhook_events，INSERT OR IGNORE）、
// claim/lease競態保護、回覆恰好一次、失敗留給retry worker補——同一套保證全部
// 適用，不因為來源是「原始LINE webhook」還是「耕譯轉發」而有差別待遇。
export async function processSingleLineEvent(
  db: D1Database, rawEvent: RawLineEvent, madouGroupId: string | undefined, accessToken: string | undefined,
): Promise<{ handled: boolean }> {
  const eventId = rawEvent.webhookEventId;
  if (!eventId) return { handled: false }; // can't dedupe an event with no id — drop rather than risk double-processing

  if (rawEvent.type !== "postback") return { handled: false };
  const source = rawEvent.source ?? {};
  if (source.type !== "group" || !madouGroupId || source.groupId !== madouGroupId) return { handled: false };
  if (!source.userId) return { handled: false };

  const fields = new URLSearchParams(rawEvent.postback?.data ?? "");
  const action = fields.get("action");
  const bookingId = fields.get("bookingId");
  const vRaw = fields.get("v");
  const expectedVisitVersion = vRaw !== null && /^\d+$/.test(vRaw) ? Number(vRaw) : null;
  if (!action || !bookingId || !KNOWN_ACTIONS.has(action)) return { handled: false };

  const member = await db.prepare("SELECT id, display_name, role FROM members WHERE line_user_id = ?").bind(source.userId).first<{ id: string; display_name: string; role: string }>();
  if (!member) return { handled: false }; // unrecognized LINE account — never trust a bare userId as staff

  const nowIso = new Date().toISOString();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO farm_line_webhook_events
       (id, processed_at, status, raw_event_json, action, booking_id, actor_member_id, visit_version_param, attempt_count, updated_at)
       VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, 0, ?)`,
    )
    .bind(eventId, nowIso, JSON.stringify(rawEvent), action, bookingId, member.id, expectedVisitVersion, nowIso)
    .run();
  if (!inserted.meta.changes) return { handled: false }; // already recorded this exact event (duplicate delivery or already-processed)

  const claimed = await claimRow(db, "farm_line_webhook_events", eventId, `webhook-sync-${eventId}`);
  if (!claimed) return { handled: false }; // lost the race to a concurrent retry-worker tick — it owns this event now

  let replyText: string | null = null;
  try {
    const result = await processMadouPostbackAction(db, action as MadouPostbackAction, bookingId, expectedVisitVersion, member, eventId);
    replyText = result.replyText;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now2 = new Date().toISOString();
    await db
      .prepare("UPDATE farm_line_webhook_events SET attempt_count = attempt_count + 1, error = ?, next_attempt_at = ?, leased_until = NULL, updated_at = ? WHERE id = ?")
      .bind(message, now2, now2, eventId)
      .run();
    console.error("madou webhook event failed, queued for retry", error);
    return { handled: true };
  }

  const replied = accessToken && rawEvent.replyToken
    ? await sendLineReplyMessage(accessToken, rawEvent.replyToken, [{ type: "text", text: replyText }])
    : { ok: false as const, status: 0, error: "no_access_token_or_reply_token" };
  const markProcessed = db
    .prepare("UPDATE farm_line_webhook_events SET status = 'processed', leased_until = NULL, updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), eventId);
  const statements = replied.ok ? [markProcessed] : [markProcessed, buildQueueMadouWebhookResultStatement(db, eventId, replyText)];
  await db.batch(statements);
  return { handled: true };
}

export async function processLineEvents(rawEvents: RawLineEvent[], madouGroupId: string | undefined, accessToken: string | undefined): Promise<number> {
  const db = await getDb();
  let handled = 0;
  for (const rawEvent of rawEvents) {
    const result = await processSingleLineEvent(db, rawEvent, madouGroupId, accessToken);
    if (result.handled) handled += 1;
  }
  return handled;
}
