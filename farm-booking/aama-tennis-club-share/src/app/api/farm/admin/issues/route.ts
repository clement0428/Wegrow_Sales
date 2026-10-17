import { requireStaff } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";

type IssueRow = {
  id: string; booking_id: string; booking_number: string; note: string; status: string;
  reported_by_name: string | null; created_at: string; resolved_at: string | null; resolved_by_name: string | null;
};

// 審查發現「回報問題」原本只寫audit log，後台完全看不到——這支端點是真正的
// 待辦清單：任何已登入的staff都能看（跟查看預約列表權限一致，不限admin/reception，
// 餐飲/備料角色一樣可能需要知道有哪些待處理問題），預設只回open，帶?all=1才含
// 已結案（供稽核回看）。
export async function GET(request: Request) {
  await requireStaff();
  const url = new URL(request.url);
  const includeResolved = url.searchParams.get("all") === "1";

  const db = await getDb();
  const rows = await db
    .prepare(
      `SELECT i.id, i.booking_id, b.booking_number, i.note, i.status,
              rm.display_name AS reported_by_name, i.created_at, i.resolved_at,
              sm.display_name AS resolved_by_name
       FROM farm_booking_issues i
       JOIN farm_bookings b ON b.id = i.booking_id
       LEFT JOIN members rm ON rm.id = i.reported_by_member_id
       LEFT JOIN members sm ON sm.id = i.resolved_by_member_id
       WHERE (? = 1 OR i.status = 'open')
       ORDER BY i.created_at DESC
       LIMIT 200`,
    )
    .bind(includeResolved ? 1 : 0)
    .all<IssueRow>();

  return Response.json({ issues: rows.results ?? [] });
}
