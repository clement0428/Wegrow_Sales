import "server-only";
import { getDb } from "@/lib/db/client";
import { buildQueueMadouWebhookResultStatement } from "@/lib/line/madou-group-queue";
import { processMadouPostbackAction, type MadouPostbackAction } from "@/lib/line/madou-webhook-process";
import { fetchGroupMemberDisplayName, sendLineReplyMessage } from "@/lib/line/messaging";
import { claimRow } from "@/lib/outbox/claim";

// 2026-10-19 Clement決定：「麻豆AI草莓現場群」所有成員都能操作該群的工作卡，
// 不要求先註冊/綁定/被管理員設成staff——真正的授權邊界是上面已經做完的
// 驗證（LINE簽章verify_signature過＋source.groupId比對正式MADOU_GROUP_ID＋
// source.userId存在），不是members.role。這裡找不到既有member時自動建立一筆
// role='member'（CHECK約束裡最低權限、不在STAFF_ROLES裡）的紀錄——同一個
// line_user_id如果之後真的用LIFF登入網站，也只會沿用這個最低權限角色，不會
// 因為在麻豆群操作過工作卡就被動升級成網站staff/admin，滿足「不要把所有人
// 升成全站管理員」的要求。displayName盡量用LINE真實群組成員資料，抓不到就用
// 一個不含敏感資訊的佔位字串，不影響授權或功能。
async function resolveGroupActorMember(
  db: D1Database, lineUserId: string, groupId: string, accessToken: string | undefined,
): Promise<{ id: string; display_name: string; role: string }> {
  const existing = await db.prepare("SELECT id, display_name, role FROM members WHERE line_user_id = ?").bind(lineUserId).first<{ id: string; display_name: string; role: string }>();
  if (existing) return existing;

  const displayName = accessToken ? await fetchGroupMemberDisplayName(accessToken, groupId, lineUserId) : null;
  const fallbackName = `麻豆群成員-${lineUserId.slice(-6)}`;
  await db
    .prepare(
      `INSERT INTO members (id, line_user_id, display_name, role)
       VALUES (?, ?, ?, 'member')
       ON CONFLICT(line_user_id) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), lineUserId, displayName ?? fallbackName)
    .run();

  // 用剛才的INSERT ON CONFLICT DO NOTHING後再查一次，而不是直接信任剛產生的id——
  // 如果同一個全新line_user_id有兩個併發事件同時到這裡，有一個的INSERT會被
  // DO NOTHING吃掉，但它手上的id是自己生的、不是真正寫進DB的那一筆，一定要
  // 重新查詢才能拿到唯一真正存在的member row。
  const resolved = await db.prepare("SELECT id, display_name, role FROM members WHERE line_user_id = ?").bind(lineUserId).first<{ id: string; display_name: string; role: string }>();
  if (!resolved) throw new Error("failed to resolve or create member for verified group actor");
  return resolved;
}

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

  const member = await resolveGroupActorMember(db, source.userId, source.groupId, accessToken);

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
