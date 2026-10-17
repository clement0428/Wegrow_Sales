-- 2026-10-17（補）：審查指出「回報問題」只寫audit log，沒有建立負責人或待辦，
-- 後台看不到。audit_log是給全部動作的一般稽核軌跡，不是待辦清單——新增一張
-- 專門的問題回報表，狀態可追蹤open/resolved，後台可查詢、可結案。
CREATE TABLE farm_booking_issues (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES farm_bookings(id),
  reported_by_member_id TEXT REFERENCES members(id),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by_member_id TEXT REFERENCES members(id)
);

CREATE INDEX idx_farm_booking_issues_open ON farm_booking_issues(status, created_at);
