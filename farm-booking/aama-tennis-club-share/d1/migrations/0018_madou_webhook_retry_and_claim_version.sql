-- 2026-10-16（補）：修正獨立程式審查發現的兩個P0缺口。
--
-- P0-1：webhook先寫去重紀錄、動作失敗後仍回200且沒有內部重試——LINE不會重送已
-- 回200的事件，失敗就永久漏處理。改法：沿用0017已建立的farm_line_webhook_events
-- 表，加上「可重試佇列」欄位（status/attempt/lease/next_attempt_at），跟
-- farm_notification_outbox既有queued->sent/failed的claim/lease風格一致，不另建
-- 第二套佇列機制。webhook本身仍即時處理一次（低延遲），失敗則留在status='queued'
-- 讓/api/jobs/madou-group的新增階段之後重試；成功才轉status='processed'。
ALTER TABLE farm_line_webhook_events ADD COLUMN status TEXT NOT NULL DEFAULT 'processed';
ALTER TABLE farm_line_webhook_events ADD COLUMN raw_event_json TEXT;
ALTER TABLE farm_line_webhook_events ADD COLUMN action TEXT;
ALTER TABLE farm_line_webhook_events ADD COLUMN booking_id TEXT;
ALTER TABLE farm_line_webhook_events ADD COLUMN actor_member_id TEXT;
ALTER TABLE farm_line_webhook_events ADD COLUMN visit_version_param INTEGER;
ALTER TABLE farm_line_webhook_events ADD COLUMN error TEXT;
ALTER TABLE farm_line_webhook_events ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE farm_line_webhook_events ADD COLUMN next_attempt_at TEXT;
ALTER TABLE farm_line_webhook_events ADD COLUMN leased_until TEXT;
ALTER TABLE farm_line_webhook_events ADD COLUMN leased_by TEXT;
ALTER TABLE farm_line_webhook_events ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_farm_line_webhook_events_retry
  ON farm_line_webhook_events(status, next_attempt_at);

-- P0-2：「我接單」postback只帶bookingId，沒有預約版本——改期後舊工作卡的接單
-- 按鈕仍然有效，會錯誤認領到改期後的新時段。加visit_version到claim的atomic
-- UPDATE...WHERE條件；同時每張工作卡發出時把產生當下的visit_version存進
-- content_snapshot_json（應用層，非schema變動），讓按鈕postback能帶上版本號。
-- 這裡不需要新增欄位：farm_bookings.visit_version（0014既有）已經是比對基準。
