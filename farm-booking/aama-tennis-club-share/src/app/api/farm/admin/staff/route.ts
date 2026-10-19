import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";

// 「指定接待人」下拉選單用——只給admin看，名單只回display_name/role，不含
// LINE user id（不是公開資料，沒有必要在這個清單裡傳出去）。
export async function GET() {
  await requireAdmin();
  const db = await getDb();
  const result = await db
    .prepare("SELECT id, display_name, role FROM members WHERE role IN ('admin','reception') ORDER BY display_name")
    .all<{ id: string; display_name: string; role: string }>();
  return Response.json({ staff: (result.results ?? []).map((r) => ({ id: r.id, displayName: r.display_name, role: r.role })) });
}
