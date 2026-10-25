import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { STAFF_ROLES } from "@/lib/auth/roles";

// 「指定接待人」下拉選單用——只給admin看，名單只回display_name/role，不含
// LINE user id（不是公開資料，沒有必要在這個清單裡傳出去）。
// ?all=1 時改列「所有」成員（含role='member'的一般使用者，不是員工角色），
// 給角色指派管理UI用，看得到誰還沒被指派——預設行為不變，不影響既有
// 指定接待人下拉選單（那裡只該看到已經是admin/reception的人）。
export async function GET(req: Request) {
  await requireAdmin();
  const db = await getDb();
  const all = new URL(req.url).searchParams.get("all") === "1";
  const sql = all
    ? "SELECT id, display_name, role FROM members ORDER BY display_name"
    : "SELECT id, display_name, role FROM members WHERE role IN ('admin','reception') ORDER BY display_name";
  const result = await db.prepare(sql).all<{ id: string; display_name: string; role: string }>();
  return Response.json({ staff: (result.results ?? []).map((r) => ({ id: r.id, displayName: r.display_name, role: r.role })) });
}

// 角色指派——之前整個repo完全沒有任何POST可以改role，Clement自己的admin
// 升級是直接對production D1下UPDATE，完全沒有留下紀錄。這裡補上：
// (1) 唯一能改角色的程式路徑，一定要admin身分；
// (2) 每次變更都寫進既有farm_audit_log（entity_type='member'，沿用同一張
//     表，不另外開一張角色稽核表——跟Orbit那邊C12「沿用既有不重複建表」
//     同一個原則）。
const ASSIGNABLE_ROLES = [...STAFF_ROLES, "member"] as const;

export async function POST(req: Request) {
  const actor = await requireAdmin();
  const body = (await req.json().catch(() => null)) as { memberId?: string; role?: string; reason?: string } | null;
  if (!body?.memberId || !body?.role) {
    return Response.json({ error: "memberId與role必填" }, { status: 400 });
  }
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(body.role)) {
    return Response.json({ error: `role必須是${ASSIGNABLE_ROLES.join("/")}其中之一` }, { status: 400 });
  }
  const db = await getDb();
  const target = await db
    .prepare("SELECT id, display_name, role FROM members WHERE id = ?")
    .bind(body.memberId)
    .first<{ id: string; display_name: string; role: string }>();
  if (!target) return Response.json({ error: "找不到這個成員" }, { status: 404 });
  if (target.role === body.role) {
    return Response.json({ ok: true, unchanged: true, member: target });
  }

  await db.prepare("UPDATE members SET role = ? WHERE id = ?").bind(body.role, body.memberId).run();
  await db
    .prepare(
      `INSERT INTO farm_audit_log (id, entity_type, entity_id, actor_type, actor_id, action, from_state, to_state, reason, created_at)
       VALUES (?, 'member', ?, 'staff', ?, 'role_change', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
    .bind(newId(), body.memberId, actor.id, target.role, body.role, body.reason ?? "")
    .run();

  return Response.json({ ok: true, member: { id: target.id, displayName: target.display_name, role: body.role } });
}
