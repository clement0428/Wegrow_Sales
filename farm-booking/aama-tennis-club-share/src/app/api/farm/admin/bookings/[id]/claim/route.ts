import { canClaimBooking, requireStaff } from "@/lib/auth/current-member";
import { claimBooking } from "@/lib/farm/claim";
import { getDb } from "@/lib/db/client";

// 「我接單」：同一時間只能有一位現場負責人（規格第4.2節）。實際的atomic claim邏輯
// 共用給這支authenticated端點與麻豆群webhook的postback（見claim.ts）。
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await requireStaff();
  if (!canClaimBooking(member)) return Response.json({ error: "此角色無法接單" }, { status: 403 });
  const { id } = await params;

  const db = await getDb();
  const result = await claimBooking(db, id, member.id, "staff");

  if (!result.ok) {
    if (result.reason === "not_found") return Response.json({ error: "找不到這筆預約" }, { status: 404 });
    if (result.reason === "cancelled") return Response.json({ error: "這筆預約已取消，無法接單" }, { status: 409 });
    return Response.json({ error: "已有人接單", code: "already_claimed", claimedBy: result.claimedByName }, { status: 409 });
  }

  return Response.json({ ok: true, bookingId: id, claimedBy: member.display_name });
}
