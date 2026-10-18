import "server-only";
import { HOURLY_JOB_RUN_PREFIX } from "@/lib/outbox/job-run";

// 告警門檻可調整——這裡先給合理預設值，之後要做成設定畫面再抽出來。
const HEARTBEAT_MISSED_MINUTES = 75; // 每小時持久化快照，加 15 分鐘緩衝；不是每分鐘的心跳。
const BACKLOG_TOO_OLD_SECONDS = 600; // 最舊待處理事件等待超過10分鐘

type JobName = "reminders" | "sales-sync";
type RunRow = {
  id: string; trigger_source: string; started_at: string; completed_at: string | null;
  due_count: number; sent_count: number; failed_count: number; blocked_count: number;
  oldest_pending_seconds: number | null; error_summary: string | null;
};

export async function statusFor(db: D1Database, jobName: JobName, outboxTable: "farm_notification_outbox" | "farm_sales_sync_outbox") {
  const runs = await db
    .prepare("SELECT id, trigger_source, started_at, completed_at, due_count, sent_count, failed_count, blocked_count, oldest_pending_seconds, error_summary FROM farm_job_runs WHERE job_name = ? ORDER BY started_at DESC LIMIT 10")
    .bind(jobName)
    .all<RunRow>();
  const recentRuns = runs.results ?? [];
  const lastRun = recentRuns[0] ?? null;
  // Separate query: manual calls (even >10) must never mask a missing cron.
  const newestCron = await db.prepare("SELECT started_at, completed_at, error_summary FROM farm_job_runs WHERE job_name = ? AND trigger_source = 'cron' AND completed_at IS NOT NULL ORDER BY started_at DESC LIMIT 1")
    .bind(jobName).first<{ started_at: string; completed_at: string; error_summary: string | null }>();
  // The existing (job_name, started_at) index bounds this second query to the
  // newest hour. It covers legacy rows overlapping the first summary without
  // aggregating/sorting the entire retained history on every admin refresh.
  const lastCron = newestCron ? await db.prepare("SELECT completed_at, error_summary FROM farm_job_runs WHERE job_name = ? AND trigger_source = 'cron' AND started_at >= ? AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1")
    .bind(jobName, `${newestCron.started_at.slice(0, 13)}:00:00.000Z`).first<{ completed_at: string; error_summary: string | null }>() : null;

  const deadLetter = await db.prepare(`SELECT COUNT(*) AS n FROM ${outboxTable} WHERE status = 'failed'`).first<{ n: number }>();
  const oldestQueued = await db.prepare(`SELECT MIN(datetime(next_attempt_at)) AS oldest FROM ${outboxTable} WHERE status = 'queued'`).first<{ oldest: string | null }>();
  const oldestPendingSeconds = oldestQueued?.oldest ? Math.max(0, Math.floor((Date.now() - new Date(oldestQueued.oldest).getTime()) / 1000)) : null;

  const minutesSinceLastRun = lastCron?.completed_at ? (Date.now() - new Date(lastCron.completed_at).getTime()) / 60_000 : null;
  const heartbeatMissed = minutesSinceLastRun === null || minutesSinceLastRun > HEARTBEAT_MISSED_MINUTES;
  const backlogTooOld = (oldestPendingSeconds ?? 0) > BACKLOG_TOO_OLD_SECONDS;
  const errors = [lastCron?.error_summary, ...recentRuns.map((r) => r.error_summary)];
  const hasCredentialErrors = errors.some((error) => error?.includes("credential") || error?.includes("401") || error?.includes("not_configured") || error?.includes("no_group_id"));
  const deadLetterCount = deadLetter?.n ?? 0;

  return {
    jobName,
    lastCronObservedAt: lastCron?.completed_at ?? null,
    loggingMode: "hourly_summary",
    lastRunAt: lastRun?.started_at ?? null,
    lastRunTriggerSource: lastRun?.trigger_source ?? null,
    lastRunCompletedAt: lastRun?.completed_at ?? null,
    oldestPendingSeconds,
    deadLetterCount,
    recentRuns: recentRuns.map((r) => ({
      id: r.id, recordKind: r.id.startsWith(HOURLY_JOB_RUN_PREFIX) ? "hourly_summary" : "legacy_run", triggerSource: r.trigger_source, startedAt: r.started_at, completedAt: r.completed_at,
      dueCount: r.due_count, sentCount: r.sent_count, failedCount: r.failed_count, blockedCount: r.blocked_count,
      oldestPendingSeconds: r.oldest_pending_seconds, errorSummary: r.error_summary,
    })),
    alerts: {
      heartbeatMissed,
      backlogTooOld,
      hasCredentialErrors,
      hasExecutionErrors: errors.some((error) => error?.includes("job_execution_failed") || error?.includes("webhook_retry_failed") || error?.includes("webhook_actor_missing")),
      hasDeadLetters: deadLetterCount > 0,
      thresholds: { heartbeatMissedMinutes: HEARTBEAT_MISSED_MINUTES, backlogTooOldSeconds: BACKLOG_TOO_OLD_SECONDS },
    },
  };
}
