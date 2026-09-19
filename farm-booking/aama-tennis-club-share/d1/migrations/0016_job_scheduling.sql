-- 2026-09-19：job 排程支援——claim/lease 避免並發重複處理、過期 lease 自動回收
-- (不永久卡住)；farm_job_runs 記錄每次啟動/完成時間、成功/失敗數、最舊積壓秒數。
ALTER TABLE farm_notification_outbox ADD COLUMN leased_until TEXT;
ALTER TABLE farm_notification_outbox ADD COLUMN leased_by TEXT;
ALTER TABLE farm_sales_sync_outbox ADD COLUMN leased_until TEXT;
ALTER TABLE farm_sales_sync_outbox ADD COLUMN leased_by TEXT;

CREATE TABLE farm_job_runs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL CHECK (job_name IN ('reminders','sales-sync')),
  trigger_source TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('cron','manual')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  due_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  oldest_pending_seconds INTEGER,
  error_summary TEXT
);

CREATE INDEX idx_farm_job_runs_job_started ON farm_job_runs(job_name, started_at);
