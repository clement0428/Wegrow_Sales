// LINE Messaging API push — real HTTP call, isolated from the outbox
// consumer so it's independently testable without a network mock framework
// (buildPushRequest is pure; sendLinePushMessage does the actual fetch).
export type LineTextMessage = { type: "text"; text: string };

// Buttons template — the Madou group work card uses this for 我接單／查看準備／
// 回報問題 (postback actions carry structured data, not free text the member
// would have to type correctly). `to` being a groupId instead of a userId is the
// only difference from a 1:1 push — same endpoint, same request shape.
export type LineButtonsTemplateMessage = {
  type: "template";
  altText: string;
  template: {
    type: "buttons";
    text: string;
    actions: Array<{ type: "postback"; label: string; data: string }>;
  };
};

export type LineMessage = LineTextMessage | LineButtonsTemplateMessage;

// retryKey maps to LINE's own X-Line-Retry-Key header (see LINE Messaging
// API docs — retry a push with the same key within its dedupe window and
// LINE will not deliver it twice, even if our own local write of "sent"
// failed right after their API actually accepted it). Pass the outbox row's
// own id — stable per row, unique per message.
export function buildPushRequest(accessToken: string, to: string, messages: LineMessage[], retryKey: string) {
  return {
    url: "https://api.line.me/v2/bot/message/push",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Line-Retry-Key": retryKey,
      },
      body: JSON.stringify({ to, messages }),
    } satisfies RequestInit,
  };
}

export type SendResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function sendLinePushMessage(accessToken: string, to: string, messages: LineMessage[], retryKey: string): Promise<SendResult> {
  const { url, init } = buildPushRequest(accessToken, to, messages, retryKey);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "network_error" };
  }
  if (response.ok) return { ok: true };
  const body = await response.text().catch(() => "");
  return { ok: false, status: response.status, error: body.slice(0, 500) };
}

// Reply API — used for webhook-triggered responses (查看準備／回報問題 acks).
// replyToken is single-use and short-lived; unlike push it costs no message quota
// and needs no retry-key (LINE itself rejects a reused/expired token outright, so
// there's nothing meaningful to retry).
export async function sendLineReplyMessage(accessToken: string, replyToken: string, messages: LineMessage[]): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ replyToken, messages }),
    });
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "network_error" };
  }
  if (response.ok) return { ok: true };
  const body = await response.text().catch(() => "");
  return { ok: false, status: response.status, error: body.slice(0, 500) };
}

// 2026-10-19新增：麻豆群成員首次操作工作卡時，用LINE自己的「取得群組成員資料」
// API抓真實displayName——只是UX用途（讓接單紀錄顯示真名而非一串userId），抓
// 失敗完全不影響授權判斷（授權看的是已驗證的groupId+userId，不是這個名字），
// 呼叫端失敗時自行決定fallback顯示字串。
export async function fetchGroupMemberDisplayName(accessToken: string, groupId: string, userId: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { displayName?: string };
    return body.displayName?.trim() || null;
  } catch {
    return null;
  }
}

export { nextAttemptDelayMinutes, MAX_SEND_ATTEMPTS } from "@/lib/outbox/backoff";
