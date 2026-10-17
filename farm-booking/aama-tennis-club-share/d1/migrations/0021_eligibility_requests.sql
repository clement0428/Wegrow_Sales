-- 2026-10-17：免費參訪資格改用nonce交換（取代原本直接信任客戶填寫email的設計，
-- 見adoption-eligibility.ts的說明）。這張表是farm-booking端自己的bookkeeping，
-- 記錄「這個nonce是我方哪一次請求發起的、何時過期、是否已經用過」——真正的身分
-- 核對跟一次性消耗邊界在Orbit那端（booking_eligibility_grants），這裡是第二層
-- 防禦，不是信任鏈的唯一環節。
CREATE TABLE farm_eligibility_requests (
  id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  visit_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX idx_farm_eligibility_requests_nonce ON farm_eligibility_requests(nonce);
