import { requireStaff } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await requireStaff();
  const { id } = await params;
  const db = await getDb();
  const now = new Date().toISOString();

  // Atomic conditional update, same discipline as every other state
  // transition here — WHERE status='open' means a double-resolve (two staff
  // clicking at once) is a no-op for the loser, not an error.
  const result = await db
    .prepare("UPDATE farm_booking_issues SET status = 'resolved', resolved_at = ?, resolved_by_member_id = ? WHERE id = ? AND status = 'open'")
    .bind(now, member.id, id)
    .run();

  if (!result.meta.changes) {
    return Response.json({ error: "找不到這筆問題回報，或已被結案" }, { status: 409 });
  }
  return Response.json({ ok: true, id });
}
