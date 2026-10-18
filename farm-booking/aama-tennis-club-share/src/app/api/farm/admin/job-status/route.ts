import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";
import { statusFor } from "@/lib/outbox/job-status";

export async function GET() {
  // 員工查詢畫面：管理員專用（沿用現有管理監測入口，不另開新畫面框架）。
  await requireAdmin();
  const db = await getDb();
  const [reminders, salesSync] = await Promise.all([
    statusFor(db, "reminders", "farm_notification_outbox"),
    statusFor(db, "sales-sync", "farm_sales_sync_outbox"),
  ]);
  return Response.json({ reminders, salesSync });
}
