-- 2026-10-17 D1根因調查發現：farm_notification_outbox從0006建表以來從未有任何
-- 索引（只有PK/retry_key UNIQUE的隱含索引）。reminders跟madou-group兩個job每次
-- tick的due查詢都是 WHERE status='queued' AND channel=? AND next_attempt_at<=?
-- ORDER BY next_attempt_at LIMIT 50——LIMIT不等於只掃描50列，沒有索引支援時
-- SQLite必須整表掃描再排序才套LIMIT。這張表被兩個job每個tick各查一次，長期
-- 累積的歷史資料量越大，每一次「找到期的50筆」就要讀越多列，這是0017 rebuild
-- 之外、讀取量偏高的另一個真實成因,之前一直沒被排查到。
CREATE INDEX IF NOT EXISTS idx_farm_notification_outbox_due
  ON farm_notification_outbox(status, channel, next_attempt_at);
