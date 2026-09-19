import "server-only";
import { newId } from "@/lib/db/uuid";

// 記錄每次job啟動/完成、成功/失敗數、最舊積壓秒數——供 GET
// /api/farm/admin/job-status 讀取，不再只靠開發終端印log。
export async function startJobRun(db: D1Database, jobName: "reminders" | "sales-sync", triggerSource: "cron" | "manual"): Promise<string> {
  const id = newId();
  await db
    .prepare("INSERT INTO farm_job_runs (id, job_name, trigger_source, started_at) VALUES (?, ?, ?, ?)")
    .bind(id, jobName, triggerSource, new Date().toISOString())
    .run();
  return id;
}

export async function completeJobRun(
  db: D1Database,
  runId: string,
  counts: { dueCount: number; sent: number; failed: number; blocked: number },
  oldestPendingSeconds: number | null,
  errorSummary: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE farm_job_runs
       SET completed_at = ?, due_count = ?, sent_count = ?, failed_count = ?, blocked_count = ?, oldest_pending_seconds = ?, error_summary = ?
       WHERE id = ?`,
    )
    .bind(new Date().toISOString(), counts.dueCount, counts.sent, counts.failed, counts.blocked, oldestPendingSeconds, errorSummary, runId)
    .run();
}
