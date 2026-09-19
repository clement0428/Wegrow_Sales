-- 2026-09-18 回歸修正：登記收款/退款需要防重複點擊（原本沒有 idempotency
-- key，雙擊送出會產生兩筆記錄）。Partial unique index 允許舊資料 NULL 共存。
ALTER TABLE farm_payment_records ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_farm_payment_records_idem ON farm_payment_records(idempotency_key) WHERE idempotency_key IS NOT NULL;
