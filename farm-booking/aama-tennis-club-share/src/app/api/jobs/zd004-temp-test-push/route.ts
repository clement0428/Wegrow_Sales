import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { sendLinePushMessage } from "@/lib/line/messaging";

// TEMPORARY diagnostic route for ZD-004 closed-loop verification. Hardcoded
// to Clement's own, already-confirmed member row - no user-controllable
// input, sends exactly one clearly-labeled test message. Remove this file
// (and redeploy) once the result has been read; it is not meant to stay.
const CLEMENT_MEMBER_ID = "2482ae6b-bc8c-4abd-b8cf-d68b4f1d6464";

export async function GET() {
  const accessToken = env.LINE_MESSAGING_ACCESS_TOKEN;
  if (!accessToken) return Response.json({ error: "not_configured" }, { status: 503 });
  const db = await getDb();
  const member = await db
    .prepare("SELECT line_user_id FROM members WHERE id = ?")
    .bind(CLEMENT_MEMBER_ID)
    .first<{ line_user_id: string | null }>();
  if (!member?.line_user_id) return Response.json({ error: "no_line_user_id" }, { status: 404 });
  const result = await sendLinePushMessage(
    accessToken,
    member.line_user_id,
    [{ type: "text", text: "[系統測試 ZD-004] 這是WeGrow農場預約系統的驗收測試通知，確認LINE Messaging API已恢復正常。此訊息只會發送給Clement本人，請忽略即可。" }],
    crypto.randomUUID(),
  );
  return Response.json(result);
}
