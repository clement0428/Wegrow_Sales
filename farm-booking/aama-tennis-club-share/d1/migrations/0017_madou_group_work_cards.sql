-- 2026-10-16：麻豆現場群工作卡。沿用既有 farm_notification_outbox（channel='line_group'，
-- recipient_id 存常數 'madou_group'，不是 members.id——群組不是一個會員）與既有
-- claim/lease worker 機制，不建第二套通知主檔。
--
-- 認領（「我接單」）直接加在 farm_bookings 上，不另建一張關聯表：同一時間一筆預約
-- 只會有一位現場負責人，跟 arrived_at/completed_at 用同一種「狀態點時間戳記疊加在
-- booking_status 之上」風格一致（見 0010_booking_arrival_completion.sql 的既有慣例）。
ALTER TABLE farm_bookings ADD COLUMN claimed_by_member_id TEXT REFERENCES members(id);
ALTER TABLE farm_bookings ADD COLUMN claimed_at TEXT;
-- claimed_by_member_id IS NULL 就是「目前沒人認領」——改期／取消時會被清回 NULL
-- （規格第4.2節「改期後不默認原接待人有空」），不保留在這兩欄內。claim_released_at
-- 只記錄「最近一次失效的時間點」供稽核／除錯用，不是判斷目前是否已認領的依據。
ALTER TABLE farm_bookings ADD COLUMN claim_released_at TEXT;

CREATE INDEX IF NOT EXISTS idx_farm_bookings_unclaimed
  ON farm_bookings(claimed_by_member_id, cancelled_at);

-- Webhook事件去重（LINE postback：我接單/查看準備/回報問題）。claim本身的並行安全
-- 已經靠claimed_by_member_id IS NULL的atomic UPDATE...WHERE保證，這張表主要是避免
-- 「回報問題」在webhook重送時重複寫入稽核紀錄。
CREATE TABLE farm_line_webhook_events (
  id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 麻豆每日彙整（規格第4.2節「明日摘要」）不屬於單一預約——它橫跨當天所有預約，
-- 跟既有 booking_id NOT NULL REFERENCES 的outbox設計假設（「每筆通知對應一筆預約」）
-- 不符。沿用同一張 outbox 表（不建第二套通知主檔），放寬 booking_id 為可為NULL，
-- 其餘欄位與既有資料原樣保留。D1/SQLite不能原地ALTER掉NOT NULL，沿用rebuild模式。
PRAGMA foreign_keys = OFF;

CREATE TABLE farm_notification_outbox_new (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES farm_bookings(id),
  channel TEXT NOT NULL DEFAULT 'line',
  notification_type TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  content_snapshot_json TEXT NOT NULL,
  retry_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  accepted_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  leased_until TEXT,
  leased_by TEXT
);

INSERT INTO farm_notification_outbox_new
SELECT id, booking_id, channel, notification_type, recipient_id, content_snapshot_json, retry_key,
       status, attempt_count, scheduled_at, next_attempt_at, accepted_at, last_error, created_at,
       leased_until, leased_by
FROM farm_notification_outbox;

DROP TABLE farm_notification_outbox;
ALTER TABLE farm_notification_outbox_new RENAME TO farm_notification_outbox;

PRAGMA foreign_keys = ON;

-- farm_job_runs.job_name 的 CHECK 常數需要擴充；D1/SQLite 不能原地 ALTER CHECK，
-- 沿用 0003/0011 的 rebuild 模式。
PRAGMA foreign_keys = OFF;

CREATE TABLE farm_job_runs_new (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL CHECK (job_name IN ('reminders','sales-sync','madou-group')),
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

INSERT INTO farm_job_runs_new
SELECT id, job_name, trigger_source, started_at, completed_at, due_count, sent_count, failed_count, blocked_count, oldest_pending_seconds, error_summary
FROM farm_job_runs;

DROP TABLE farm_job_runs;
ALTER TABLE farm_job_runs_new RENAME TO farm_job_runs;
CREATE INDEX idx_farm_job_runs_job_started ON farm_job_runs(job_name, started_at);

PRAGMA foreign_keys = ON;
