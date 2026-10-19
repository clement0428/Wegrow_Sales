import { z } from "zod";
import { requireAdmin } from "@/lib/auth/current-member";
import { claimBooking } from "@/lib/farm/claim";
import { getDb } from "@/lib/db/client";

const bodySchema = z.object({ memberId: z.string().min(1) });

// 「指定接待人」：admin在後台直接把一筆未接單的預約指派給某位現場人員，不用等
// 對方自己在麻豆群按「我接單」——未接單清單本來就是為了處理「超時沒人按」的情況
// 才存在，指派動作本身用同一個claimBooking()atomic update，跟自己接單、群組
// 按鈕接單是同一套保證（同一時間只有一人能接到）。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "請求格式錯誤" }, { status: 400 });

  const db = await getDb();
  const target = await db.prepare("SELECT id, display_name, role FROM members WHERE id = ? AND role IN ('admin','reception')").bind(parsed.data.memberId).first<{ id: string; display_name: string; role: string }>();
  if (!target) return Response.json({ error: "指定的人員不存在或角色無法接單" }, { status: 400 });

  const result = await claimBooking(db, id, target.id, "staff");
  if (!result.ok) {
    if (result.reason === "not_found") return Response.json({ error: "找不到這筆預約" }, { status: 404 });
    if (result.reason === "cancelled") return Response.json({ error: "這筆預約已取消，無法指派" }, { status: 409 });
    if (result.reason === "stale_card") return Response.json({ error: "預約版本已變更，請重新整理", currentVisitVersion: result.currentVisitVersion }, { status: 409 });
    return Response.json({ error: "已有人接單", code: "already_claimed", claimedBy: result.claimedByName }, { status: 409 });
  }
  return Response.json({ ok: true, bookingId: id, claimedBy: target.display_name });
}
