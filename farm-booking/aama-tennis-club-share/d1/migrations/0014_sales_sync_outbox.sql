-- 2026-09-18：Sales 同步的獨立 outbox（規格第5節 Outbox：event_id、booking_id、
-- event_type、payload_version、attempts、status、next_retry）。farm_bookings
-- 是訂單唯一主檔；Sales 只保存 booking_id 關聯與事件投影，重複事件不重建
-- 客戶或訂單——這張表本身就是「重複事件」判斷的依據（retry_key 唯一）。
CREATE TABLE farm_sales_sync_outbox (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES farm_bookings(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('booking_created','booking_confirmed','booking_cancelled')),
  payload_version INTEGER NOT NULL DEFAULT 1,
  retry_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_farm_sales_sync_outbox_due ON farm_sales_sync_outbox(status, next_attempt_at);
