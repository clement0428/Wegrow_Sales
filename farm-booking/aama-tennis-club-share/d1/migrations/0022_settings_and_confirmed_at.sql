-- 2026-10-19：未接單升級門檻需要「後台可調，沒設定時不自動升級」——用一張通用
-- key/value設定表，而不是為這一個值另開一整組遷移／環境變數，之後其他「待正式
-- 核定」設定（SettingsView既有清單那些）要變成真正可編輯時，同一張表直接加新key。
CREATE TABLE IF NOT EXISTS farm_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 「未接單等待多久」要以confirmBooking()真正把booking_status改成confirmed的
-- 那一刻為起點，不是created_at——付費預約從requested到confirmed之間的等待不算
-- 「現場未接單」的等待時間，兩者是不同的等待對象。
ALTER TABLE farm_bookings ADD COLUMN confirmed_at TEXT;
