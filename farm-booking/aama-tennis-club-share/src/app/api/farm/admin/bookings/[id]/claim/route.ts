import { z } from "zod";
import { canClaimBooking, requireStaff } from "@/lib/auth/current-member";
import { claimBooking } from "@/lib/farm/claim";
import { getDb } from "@/lib/db/client";

const bodySchema = z.object({ visitVersion: z.number().int().optional() });

// 「我接單」：同一時間只能有一位現場負責人（規格第4.2節）。實際的atomic claim邏輯
// 共用給這支authenticated端點與麻豆群webhook的postback（見claim.ts）。
//
// visitVersion是可選的：目前管理後台還沒有任何畫面顯示/傳送這個值（還沒有admin
// UI的接單按鈕），所以完全省略這個欄位時行為不變（不檢查版本）。一旦前端加上顯示
// 版本的接單按鈕，傳了這個值就會被強制比對，跟webhook那一側的檢查邏輯一致——不是
// 等UI做完才補後端，後端先準備好。
//
// 但「省略」跟「傳了卻格式錯誤」必須分開處理：原本safeParse失敗一律回退成
// undefined，會讓一個畫錯的版本號（字串、小數、負數）被錯誤當成「沒傳」而跳過
// 檢查——這正好是版本檢查原本要防的事。body裡確實帶著visitVersion這個key但解析
// 失敗，必須直接400，不能靜默放行。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await requireStaff();
  if (!canClaimBooking(member)) return Response.json({ error: "此角色無法接單" }, { status: 403 });
  const { id } = await params;
  const rawBody = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    if (rawBody && typeof rawBody === "object" && "visitVersion" in rawBody) {
      return Response.json({ error: "visitVersion 格式錯誤，必須是整數" }, { status: 400 });
    }
    // Body itself was malformed JSON, or an object with no visitVersion key
    // at all — legitimate omission, not a bad version value.
  }
  const visitVersion = parsed.success ? parsed.data.visitVersion : undefined;

  const db = await getDb();
  const result = await claimBooking(db, id, member.id, "staff", visitVersion);

  if (!result.ok) {
    if (result.reason === "not_found") return Response.json({ error: "找不到這筆預約" }, { status: 404 });
    if (result.reason === "cancelled") return Response.json({ error: "這筆預約已取消，無法接單" }, { status: 409 });
    if (result.reason === "stale_card") return Response.json({ error: "預約版本已變更，請重新整理", currentVisitVersion: result.currentVisitVersion }, { status: 409 });
    return Response.json({ error: "已有人接單", code: "already_claimed", claimedBy: result.claimedByName }, { status: 409 });
  }

  return Response.json({ ok: true, bookingId: id, claimedBy: member.display_name });
}
