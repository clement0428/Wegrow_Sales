import { env } from "@/lib/env";

// Temporary diagnostic — never returns the token itself, only the bot's own
// public profile (basicId/displayName, same info anyone sees adding the bot
// as a LINE friend). Exists to answer "is this the same LINE Messaging
// Channel as wegrow-orbit-src's 耕譯 bot" without guessing from matching
// env-var names. Remove after use.
export async function GET() {
  const token = env.LINE_MESSAGING_ACCESS_TOKEN;
  if (!token) return Response.json({ configured: false });
  let resp: Response;
  try {
    resp = await fetch("https://api.line.me/v2/bot/info", { headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    return Response.json({ configured: true, error: error instanceof Error ? error.message : "network_error" });
  }
  const body = resp.ok ? await resp.json() : { status: resp.status, body: (await resp.text()).slice(0, 300) };
  return Response.json({ configured: true, botInfo: body, allowedGroupId: env.MADOU_GROUP_ID ?? null });
}
