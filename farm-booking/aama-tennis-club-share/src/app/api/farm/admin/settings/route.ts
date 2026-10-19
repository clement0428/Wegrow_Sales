import { z } from "zod";
import { requireAdmin, requireStaff } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";
import { getUnclaimedEscalationMinutes, setUnclaimedEscalationMinutes } from "@/lib/farm/settings";

// 讀取不含敏感資料（只是一個分鐘數），接待／餐飲角色也看得到「現在有沒有開自動
// 升級」這件事本身；真正能改的只有admin（canViewSettings規則，SettingsView本來
// 就是admin專屬頁面）。
export async function GET() {
  await requireStaff();
  const db = await getDb();
  const unclaimedEscalationMinutes = await getUnclaimedEscalationMinutes(db);
  return Response.json({ unclaimedEscalationMinutes });
}

const bodySchema = z.object({ unclaimedEscalationMinutes: z.number().int().min(1).max(1440).nullable() });

export async function PUT(request: Request) {
  const member = await requireAdmin();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "請求格式錯誤" }, { status: 400 });
  const db = await getDb();
  await setUnclaimedEscalationMinutes(db, parsed.data.unclaimedEscalationMinutes, member.id);
  return Response.json({ ok: true, unclaimedEscalationMinutes: parsed.data.unclaimedEscalationMinutes });
}
