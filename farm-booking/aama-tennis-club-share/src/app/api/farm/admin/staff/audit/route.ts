import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";

// 角色變更紀錄——寫進farm_audit_log不代表「有稽核」，沒有人能看到跟沒寫
// 一樣。這支GET讓admin能實際查「誰、何時、把誰的角色從什麼改成什麼」，
// 不是只存在資料庫裡沒人查得到。
export async function GET() {
  await requireAdmin();
  const db = await getDb();
  const result = await db
    .prepare(
      `SELECT a.id, a.entity_id AS member_id, m.display_name AS member_name,
              a.actor_id, actor.display_name AS actor_name,
              a.from_state, a.to_state, a.reason, a.created_at
       FROM farm_audit_log a
       LEFT JOIN members m ON m.id = a.entity_id
       LEFT JOIN members actor ON actor.id = a.actor_id
       WHERE a.entity_type = 'member' AND a.action = 'role_change'
       ORDER BY a.created_at DESC
       LIMIT 200`,
    )
    .all<{
      id: string; member_id: string; member_name: string | null;
      actor_id: string | null; actor_name: string | null;
      from_state: string | null; to_state: string | null; reason: string | null; created_at: string;
    }>();
  return Response.json({ changes: result.results ?? [] });
}
