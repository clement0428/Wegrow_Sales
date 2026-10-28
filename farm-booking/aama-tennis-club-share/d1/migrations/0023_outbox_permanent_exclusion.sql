-- 2026-10-28 D-20261028-02：永久排除的測試/驗證事件(例如2026-10-18人工標記
-- 的WG-261018測試預約)目前只能靠last_error文字判斷，跟真正需要人工處理的
-- 死信全部混在status='failed'裡——管理頁「全部重試」一鍵重試時沒辦法區分，
-- 有復活已排除事件的風險。farm_sales_sync_outbox.status有
-- CHECK(status IN ('queued','sent','failed'))限制(見0014_sales_sync_outbox.sql)，
-- 不能直接新增'excluded'這個狀態值；改用布林欄位結構化標記，純additive，
-- 不影響既有status語意，兩張outbox表為求一致都加上同一個欄位。
ALTER TABLE farm_sales_sync_outbox ADD COLUMN permanently_excluded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE farm_notification_outbox ADD COLUMN permanently_excluded INTEGER NOT NULL DEFAULT 0;
