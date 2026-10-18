# Hourly job logging

## Scope and behavior

The reminders, sales-sync and madou-group consumers keep their existing polling cadence, atomic claim/lease, outbound idempotency keys, retry/backoff and operational outbox writes. Booking, payment/audit and sensor data paths are unchanged.

`startJobRun` now creates a fresh invocation UUID in memory. Each job/source/UTC start-hour has one `hourly:v1:` row in the existing `farm_job_runs` table:

- The first empty completion inserts a completed snapshot. Later empty ticks read that primary key and do not write. Growing backlog age or losing a claim is not activity.
- Real outcomes atomically add sent/failed/blocked counts and retain the maximum observed due count. Cancellation/supersession, digest enqueue and webhook claims also cause a snapshot update; their detailed outcomes remain in operational records and invocation logs.
- A newly observed execution error is persisted once per changed error state. Repeated identical idle errors are emitted to Workers logs without repeated D1 writes. A subsequent successful poll can clear an unexpected execution failure. Missing-config absence errors can clear once a later invocation explicitly passes its config guard, even when no rows are due. An actual credential rejection such as 401 still requires a successful send to establish recovery within that hour.
- Counters already completed before a later exception are preserved. Summary persistence failure emits a bounded error code without converting successful business work into an HTTP failure. Original business/claim failures still propagate.
- Counters use atomic SQL updates. Late empty completions cannot overwrite active work. Snapshot times cannot regress, and an invocation that began before a failure cannot clear it by finishing later.
- Summary error codes are allowlisted; no raw exception, recipient, booking payload, token or message text is added to these logs.

Upstream Madou reconciliation still runs after digest queuing and before the delivery-credentials guard. Its `recovered` field counts candidates/attempts, not actual inserts. Candidate-bearing checks emit bounded `farm_job_reconciliation_checked` diagnostics; these counts do not trigger summary writes or inflate `otherChanges`. Reconciliation queue-write totals are not represented in hourly counters; durable outbox records and D1 usage remain the evidence for those writes. Reconciliation exceptions still propagate and create a safe failure summary.

There is no schema migration, historical rewrite, retention DELETE, cron configuration change, or new per-minute persistent counter.

## Admin health semantics

The UI distinguishes hourly summaries from legacy single-run records. Summary due count is a peak, not a sum of repeated scans. Success/failure/blocked counts are actual notification/sync outcomes, not number of job invocations.

Cron freshness uses completed cron evidence independently of manual records. The stale threshold is **75 minutes** (hourly persistence plus 15-minute allowance); backlog age remains **10 minutes**. Unexpected execution errors are visible even if the invocation produced a recent completion record. This is not five-minute failure detection. Use native Workers metrics/alerts separately if faster detection is required.

The newest cron lookup uses the existing `(job_name, started_at)` index, then searches only the newest hour to reconcile overlapping legacy and summary rows. It does not aggregate the entire history on every refresh.

## Write budget: model, not measured production usage

This patch is based on upstream `8cb3ede4a6fbe4106f9b1b4d8b7b0826922cd98f`, including its session-bound eligibility, idempotent retry, persisted booking draft and state-aware outbox recovery fixes. It preserves the missing-configuration guards from `4d69464`, past-visit reminder cancellation, pending Madou work cards, and the due index added by `13cd07d`. The new upstream guards prevent outbox-row attempts when configuration is absent, but upstream still inserts and completes a job log on every invocation, so hourly logging remains complementary.

A separate report says the deployed cron cadence was changed to every 15 minutes; this has not been independently verified from Cloudflare. This patch does not change any cadence. Use the appropriate scenario after checking the live schedule.

Historical one-minute model, for two otherwise idle jobs:

- Previous: 2 × 1,440 × (one INSERT + one UPDATE) = 5,760 table-row mutations/day. Including one TEXT-primary-key index and one explicit index on each INSERT gives an estimated **11,520 D1 rows written/day**.
- New: 2 × 24 = **48 inserted summary rows/day**. With the same assumed three-write INSERT factor, estimated **144 D1 rows written/day**, about **98.75% less** for this idle logging baseline.
Reported 15-minute model, for two otherwise idle jobs:

- Previous: 2 × 96 = **192 invocations/day**, each with the same estimated four-write INSERT-plus-UPDATE factor: **768 D1 rows written/day**.
- New: 2 × 24 = **48 inserted summaries/day**, estimated **144 D1 rows written/day**, or **81.25% less** for this logging baseline. The 98.75% figure applies only to the historical one-minute model.
- A third scheduled job adds 24 summary rows / estimated 72 D1 writes per idle day. Manual calls use a separate source bucket. Real processing, changed errors/recovery, overlapping insert races, business writes and other databases add usage.

SQLite tests independently verify both 2,880 one-minute idle invocations and 192 fifteen-minute idle invocations create 48 rows with no repeated empty updates. SQLite mutation counts do not measure D1 billing/index accounting. Neither this model nor a public availability response identifies the actual cause of the account's quota incident.

## Verification and deployment

Run from this subproject:

1. `npm ci`
2. `npm test`
3. `npx tsc --noEmit --incremental false` after `next build` / type generation
4. Focused ESLint for changed files; report pre-existing full-repository lint failures separately.
5. `BUILD_TARGET_ENV=production npx opennextjs-cloudflare build`

With an existing authorized production Cloudflare session, deploy via the existing `npm run deploy` path. It builds and deploys the Worker and runs the existing LIFF postdeploy check. **Do not run `migrate:prod`, replay migration 0017, or delete history for this change.** This patch adds no migration and needs none of those operations. Existing upstream migrations, including 0019/0020/0021 if still pending, are a separate deployment prerequisite/incident and are not applied by this patch. Do not treat GitHub Pages or test-only CI as a Worker deployment receipt.

After deployment, record the Cloudflare Worker deployment/version ID and exact source commit. Observe natural cron traffic, without manually posting jobs:

- Workers event `farm_job_completed` identifies each invocation and its bounded counts/error codes. Occurrence counting depends on the platform's available logging, sampling and retention.
- `farm_job_summary_persisted` includes D1-provided `rowsWritten` (`meta.rows_written`) and `changedRows`; `null` means unavailable, not zero. Sum these for logging-specific actual writes. This is not total database/account usage.
- `farm_job_summary_write_failed` identifies persistence failures, including when quota blocks writes; it does not mean the original operation succeeded.
- In an error-free idle hour, each cron job should insert one summary and then emit no further summary-persisted events until the next hour. Repeated missing-config or other identical error ticks instead use a guarded UPSERT for race safety and may emit summary-persisted events with `changedRows: 0`; those events do not establish extra actual writes. Check D1-provided `rowsWritten`, rather than event count alone. Confirm hour rollover and independent manual/cron health.
- Read D1 database/account usage and query insights to compare total actual writes and identify other contributors. A safe public smoke check is `GET /api/farm/availability?people=1`; it proves read-path availability only.

Existing quota exhaustion is not repaired by deploying this code. Do not infer that booking/status writes work because availability reads return 200. If external delivery succeeded but its existing success-marker write failed at the quota boundary, reconcile using the existing stable idempotency IDs rather than blindly replaying jobs.
