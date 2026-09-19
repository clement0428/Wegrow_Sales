// LINE Messaging API push — real HTTP call, isolated from the outbox
// consumer so it's independently testable without a network mock framework
// (buildPushRequest is pure; sendLinePushMessage does the actual fetch).
export type LineTextMessage = { type: "text"; text: string };

// retryKey maps to LINE's own X-Line-Retry-Key header (see LINE Messaging
// API docs — retry a push with the same key within its dedupe window and
// LINE will not deliver it twice, even if our own local write of "sent"
// failed right after their API actually accepted it). Pass the outbox row's
// own id — stable per row, unique per message.
export function buildPushRequest(accessToken: string, to: string, messages: LineTextMessage[], retryKey: string) {
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

export async function sendLinePushMessage(accessToken: string, to: string, messages: LineTextMessage[], retryKey: string): Promise<SendResult> {
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

export { nextAttemptDelayMinutes, MAX_SEND_ATTEMPTS } from "@/lib/outbox/backoff";
