import { z } from "zod";
import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";

const bodySchema = z.object({ jobName: z.enum(["reminders", "sales-sync"]) });

// 人工重試入口（dead-letter 的救援口）：把該job所有永久失敗的列重置回
// queued、attempt_count歸零、next_attempt_at設為現在，下一次job執行會重新嘗試。
// 只限管理員，且是明確、需要人為按下去的動作，不是自動行為。
//
// 2026-10-28 D-20261028-02：永久排除的測試事件現在用migration 0023新增的
// permanently_excluded布林欄位結構化標記(status本身有CHECK，不能新增狀態值)，
// 這裡額外排除，不需要靠last_error文字比對，不會把已排除事件誤判成可重試。
export async function POST(request: Request) {
  const member = await requireAdmin();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "請求格式錯誤" }, { status: 400 });
  const { jobName } = parsed.data;
  const table = jobName === "reminders" ? "farm_notification_outbox" : "farm_sales_sync_outbox";

  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db
    .prepare(`UPDATE ${table} SET status = 'queued', attempt_count = 0, next_attempt_at = ?, leased_until = NULL, last_error = last_error || ' [manually retried by ' || ? || ']' WHERE status = 'failed' AND permanently_excluded = 0`)
    .bind(now, member.display_name)
    .run();

  return Response.json({ ok: true, requeued: result.meta.changes });
}
