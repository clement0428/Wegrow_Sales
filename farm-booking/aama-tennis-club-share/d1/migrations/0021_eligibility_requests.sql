-- 2026-10-17：免費參訪資格改用nonce交換（取代原本直接信任客戶填寫email的設計，
-- 見adoption-eligibility.ts的說明）。這張表是farm-booking端自己的bookkeeping，
-- 記錄「這個nonce是我方哪一次請求發起的、何時過期、是否已經用過」——真正的身分
-- 核對跟一次性消耗邊界在Orbit那端（booking_eligibility_grants），這裡是第二層
-- 防禦，不是信任鏈的唯一環節。
--
-- 2026-10-17二次修正（審查指出的兩個正確性問題，這張表還沒套用到任何環境，
-- 直接改原本的CREATE TABLE，不另開一個rebuild migration）：
-- (a) session_token_hash——原設計nonce本身像bearer token，誰拿到URL裡的nonce
--     字串就能在任何瀏覽器兌換，等於能被攔截/重放。改成/eligibility/start同時
--     發一個只存在HttpOnly cookie裡、從不出現在任何URL的session token，這裡存
--     它的雜湊（不存明文，資料庫洩漏也不能直接冒用）；之後兌換時必須連同cookie
--     一起送，雜湊比對不上就拒絕——跟OAuth的state參數同樣的防偽造用途。
--     一般匿名付費預約完全不受影響，這個cookie只在走免費驗證流程時才會被設定，
--     不要求LINE登入。
-- (b) redemption_id——原設計「used_at非NULL就拒絕」在booking建立失敗時（D1
--     寫入失敗、名額剛好滿、網路逾時）會把本機這一層的資格使用狀態卡住，即使
--     Orbit那端已經用同一個redemption_id安全地允許retry，本機還是會先擋下來。
--     改成跟Orbit同樣的邏輯：同一個redemption_id（=farm-booking這裡的
--     idempotencyKey）重試視為同一次請求，不同才是真正重複使用。
CREATE TABLE farm_eligibility_requests (
  id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  visit_date TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  redemption_id TEXT
);

CREATE INDEX idx_farm_eligibility_requests_nonce ON farm_eligibility_requests(nonce);
