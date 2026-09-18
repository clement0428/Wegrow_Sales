-- 2026-09-18 Clement：先做人工收款登記，線上金流另行選定。
-- 應收＝farm_bookings.amount_twd（既有快照，不改動）；已收／退款從這張表加總
-- 得出；未收＝應收－已收＋退款。一張訂單可以有多筆記錄（分期、部分退款）。
CREATE TABLE farm_payment_records (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES farm_bookings(id),
  record_type TEXT NOT NULL CHECK (record_type IN ('payment','refund')),
  amount_twd INTEGER NOT NULL CHECK (amount_twd > 0),
  method TEXT NOT NULL,
  reference_note TEXT NOT NULL DEFAULT '',
  recorded_by_member_id TEXT NOT NULL REFERENCES members(id),
  recorded_by_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_farm_payment_records_booking ON farm_payment_records(booking_id);
