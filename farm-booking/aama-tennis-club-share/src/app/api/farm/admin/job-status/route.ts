import { requireAdmin } from "@/lib/auth/current-member";
import { getDb } from "@/lib/db/client";

// 告警門檻可調整——這裡先給合理預設值，之後要做成設定畫面再抽出來。
const HEARTBEAT_MISSED_MINUTES = 5; // 排程間隔預期更短，超過這個沒有任何一次啟動就算漏跳
const BACKLOG_TOO_OLD_SECONDS = 600; // 最舊待處理事件等待超過10分鐘

type JobName = "reminders" | "sales-sync";
type RunRow = {
  id: string; trigger_source: string; started_at: string; completed_at: string | null;
  due_count: number; sent_count: number; failed_count: number; blocked_count: number;
  oldest_pending_seconds: number | null; error_summary: string | null;
};

async function statusFor(db: D1Database, jobName: JobName, outboxTable: "farm_notification_outbox" | "farm_sales_sync_outbox") {
  const runs = await db
    .prepare("SELECT id, trigger_source, started_at, completed_at, due_count, sent_count, failed_count, blocked_count, oldest_pending_seconds, error_summary FROM farm_job_runs WHERE job_name = ? ORDER BY started_at DESC LIMIT 10")
    .bind(jobName)
    .all<RunRow>();
  const recentRuns = runs.results ?? [];
  const lastRun = recentRuns[0] ?? null;

  const deadLetter = await db.prepare(`SELECT COUNT(*) AS n FROM ${outboxTable} WHERE status = 'failed'`).first<{ n: number }>();
  const oldestQueued = await db.prepare(`SELECT MIN(datetime(next_attempt_at)) AS oldest FROM ${outboxTable} WHERE status = 'queued'`).first<{ oldest: string | null }>();
  const oldestPendingSeconds = oldestQueued?.oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldestQueued.oldest).getTime()) / 1000)) : null;

  const minutesSinceLastRun = lastRun ? (Date.now() - new Date(lastRun.started_at).getTime()) / 60_000 : null;
  const heartbeatMissed = minutesSinceLastRun === null || minutesSinceLastRun > HEARTBEAT_MISSED_MINUTES;
  const backlogTooOld = (oldestPendingSeconds ?? 0) > BACKLOG_TOO_OLD_SECONDS;
  const hasCredentialErrors = recentRuns.some((r) => r.error_summary?.includes("credential") || r.error_summary?.includes("401"));
  const deadLetterCount = deadLetter?.n ?? 0;

  return {
    jobName,
    lastRunAt: lastRun?.started_at ?? null,
    lastRunTriggerSource: lastRun?.trigger_source ?? null,
    lastRunCompletedAt: lastRun?.completed_at ?? null,
    oldestPendingSeconds,
    deadLetterCount,
    recentRuns: recentRuns.map((r) => ({
      id: r.id, triggerSource: r.trigger_source, startedAt: r.started_at, completedAt: r.completed_at,
      dueCount: r.due_count, sentCount: r.sent_count, failedCount: r.failed_count, blockedCount: r.blocked_count,
      oldestPendingSeconds: r.oldest_pending_seconds, errorSummary: r.error_summary,
    })),
    alerts: {
      heartbeatMissed,
      backlogTooOld,
      hasCredentialErrors,
      hasDeadLetters: deadLetterCount > 0,
      thresholds: { heartbeatMissedMinutes: HEARTBEAT_MISSED_MINUTES, backlogTooOldSeconds: BACKLOG_TOO_OLD_SECONDS },
    },
  };
}

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
