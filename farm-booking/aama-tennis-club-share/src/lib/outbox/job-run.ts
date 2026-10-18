import "server-only";
import { newId } from "@/lib/db/uuid";

export type JobName = "reminders" | "sales-sync" | "madou-group";
export type JobRun = {
  id: string;
  jobName: JobName;
  triggerSource: "cron" | "manual";
  startedAt: string;
};
export type JobCounts = {
  dueCount: number;
  sent: number;
  failed: number;
  blocked: number;
  // Other durable changes: stale cancellations, digest enqueue, webhook retries.
  // Merely selecting due rows or observing older backlog is NOT activity.
  otherChanges?: number;
  // Explicit evidence that this invocation passed the pre-query config guard.
  configReady?: boolean;
};

export const HOURLY_JOB_RUN_PREFIX = "hourly:v1:";

// A fresh invocation ID remains the lease owner. Starting a job must never
// spend a D1 write or fail before the actual outbox work just to record a log.
export function startJobRun(jobName: JobName, triggerSource: "cron" | "manual"): JobRun {
  return { id: newId(), jobName, triggerSource, startedAt: new Date().toISOString() };
}

function canonicalErrors(value: string | null): string | null {
  if (!value) return null;
  const allowed = /^(no_credentials|no_recipient|not_configured|no_group_id|bad_payload|webhook_retry_failed|webhook_actor_missing|job_execution_failed|(?:credential|permanent|rate_limit|transient):\d{1,3}|\d{1,3})$/;
  // Never persist raw exception text, payloads, credentials or recipient data.
  const codes = [...new Set(value.split(",").map((code) => {
    const normalized = /^(no_credentials|not_configured|no_group_id)_skipped_entirely$/.test(code)
      ? code.replace(/_skipped_entirely$/, "") : code;
    return allowed.test(normalized) ? normalized : "job_execution_failed";
  }))].sort();
  return codes.slice(0, 16).join(",");
}

function reportSummaryWrite(result: D1Result, run: JobRun, summaryId: string): void {
  console.info(JSON.stringify({ event: "farm_job_summary_persisted", job: run.jobName,
    source: run.triggerSource, runId: run.id, summaryId,
    rowsWritten: result.meta?.rows_written ?? null, changedRows: result.meta?.changes ?? null }));
}

type SummaryRow = { completed_at: string; error_summary: string | null };

// Reuses the existing table/indexes. No migration, replay, cleanup or new
// per-minute counter is needed. Counters are sums of actual outcomes; due is
// the peak observed backlog, not the sum of rows selected by overlapping jobs.
export async function completeJobRun(
  db: D1Database,
  run: JobRun,
  counts: JobCounts,
  oldestPendingSeconds: number | null,
  errorSummary: string | null,
): Promise<void> {
  const completedAt = new Date().toISOString();
  const hour = `${run.startedAt.slice(0, 13)}:00:00.000Z`;
  const summaryId = `${HOURLY_JOB_RUN_PREFIX}${run.jobName}:${run.triggerSource}:${hour}`;
  const error = canonicalErrors(errorSummary);
  const hasActivity = counts.sent + counts.failed + counts.blocked + (counts.otherChanges ?? 0) > 0;
  // Emit per-invocation counts to Workers logs rather than a D1 UPDATE for
  // every idle tick (subject to platform log retention/sampling). No personal
  // data or raw error text is logged.
  console.info(JSON.stringify({ event: "farm_job_completed", job: run.jobName, source: run.triggerSource,
    runId: run.id, summaryId, completedAt, ...counts, errorCodes: error }));

  try {
    if (!hasActivity) {
      if (error) {
        // New failures must survive an insert/update race with a successful
        // empty tick. Persist the newest distinct error atomically; repeated
        // occurrences are emitted to Workers logs without a D1 counter.
        await db.prepare(`INSERT INTO farm_job_runs
          (id, job_name, trigger_source, started_at, completed_at, due_count, oldest_pending_seconds, error_summary)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
            due_count = MAX(farm_job_runs.due_count, excluded.due_count),
            completed_at = excluded.completed_at,
            oldest_pending_seconds = excluded.oldest_pending_seconds,
            error_summary = excluded.error_summary
          WHERE excluded.completed_at >= farm_job_runs.completed_at AND farm_job_runs.error_summary IS NOT excluded.error_summary`)
          .bind(summaryId, run.jobName, run.triggerSource, hour, completedAt, counts.dueCount, oldestPendingSeconds, error).run().then((result) => reportSummaryWrite(result, run, summaryId));
        return;
      }
      const existing = await db.prepare("SELECT completed_at, error_summary FROM farm_job_runs WHERE id = ?")
        .bind(summaryId).first<SummaryRow>();
      if (existing) {
        // Passing the explicit config guard proves absence was fixed, but an
        // empty poll never proves that an existing token is accepted by LINE.
        const recoverable = existing.error_summary === "job_execution_failed" ||
          (counts.configReady && existing.error_summary?.split(",").every((code) =>
            ["no_credentials", "not_configured", "no_group_id", "job_execution_failed"].includes(code)));
        if (recoverable && run.startedAt >= existing.completed_at) {
          // Compare-and-set: a late empty invocation cannot erase newer work.
          await db.prepare(`UPDATE farm_job_runs SET completed_at = ?, error_summary = NULL, oldest_pending_seconds = ?
            WHERE id = ? AND completed_at = ? AND error_summary IS ? AND completed_at <= ?`)
            .bind(completedAt, oldestPendingSeconds, summaryId, existing.completed_at, existing.error_summary, completedAt).run().then((result) => reportSummaryWrite(result, run, summaryId));
        }
        return;
      }
      // A competing active invocation may have inserted after our read. On
      // conflict do nothing, never overwrite its counters/error/heartbeat.
      await db.prepare(`INSERT INTO farm_job_runs
        (id, job_name, trigger_source, started_at, completed_at, due_count, sent_count, failed_count, blocked_count, oldest_pending_seconds, error_summary)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .bind(summaryId, run.jobName, run.triggerSource, hour, completedAt, counts.dueCount, oldestPendingSeconds, error).run().then((result) => reportSummaryWrite(result, run, summaryId));
      return;
    }

    // SQLite evaluates this update atomically, so concurrent runs do not lose
    // counters. Snapshot timestamps never move backwards; an invocation that
    // began before a failure cannot clear that failure by completing late.
    await db.prepare(`INSERT INTO farm_job_runs
      (id, job_name, trigger_source, started_at, completed_at, due_count, sent_count, failed_count, blocked_count, oldest_pending_seconds, error_summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        due_count = MAX(farm_job_runs.due_count, excluded.due_count),
        sent_count = farm_job_runs.sent_count + excluded.sent_count,
        failed_count = farm_job_runs.failed_count + excluded.failed_count,
        blocked_count = farm_job_runs.blocked_count + excluded.blocked_count,
        oldest_pending_seconds = CASE WHEN excluded.completed_at >= farm_job_runs.completed_at THEN excluded.oldest_pending_seconds ELSE farm_job_runs.oldest_pending_seconds END,
        error_summary = CASE WHEN excluded.completed_at >= farm_job_runs.completed_at AND (excluded.error_summary IS NOT NULL OR
          (? >= farm_job_runs.completed_at AND (excluded.sent_count > 0 OR
            (COALESCE(farm_job_runs.error_summary, '') NOT LIKE '%credential:%' AND
             COALESCE(farm_job_runs.error_summary, '') NOT LIKE '%401%' AND
             (? = 1 OR (COALESCE(farm_job_runs.error_summary, '') NOT LIKE '%no_credentials%' AND
                        COALESCE(farm_job_runs.error_summary, '') NOT LIKE '%not_configured%' AND
                        COALESCE(farm_job_runs.error_summary, '') NOT LIKE '%no_group_id%')))))) THEN excluded.error_summary ELSE farm_job_runs.error_summary END,
        completed_at = MAX(farm_job_runs.completed_at, excluded.completed_at)`)
      .bind(summaryId, run.jobName, run.triggerSource, hour, completedAt, counts.dueCount, counts.sent, counts.failed, counts.blocked, oldestPendingSeconds, error, run.startedAt, Number(counts.configReady ?? false)).run().then((result) => reportSummaryWrite(result, run, summaryId));
  } catch {
    // Logging must not turn a completed external send/state change into a 500
    // that encourages replay. Business/claim errors still propagate normally.
    console.error(JSON.stringify({ event: "farm_job_summary_write_failed", job: run.jobName,
      source: run.triggerSource, runId: run.id, summaryId, code: "summary_persistence_failed" }));
  }
}

export async function failJobRun(
  db: D1Database, run: JobRun,
  counts: JobCounts = { dueCount: 0, sent: 0, failed: 0, blocked: 0 },
  errorCodes: string | null = null,
): Promise<void> {
  await completeJobRun(db, run, counts, null, [errorCodes, "job_execution_failed"].filter(Boolean).join(","));
}
