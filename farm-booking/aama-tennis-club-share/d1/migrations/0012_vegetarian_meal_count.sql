-- 2026-09-18 Clement: 選購餐飲時收集「素食份數」，葷食份數 = 餐飲總份數 - 素食份數。
-- Nullable: NULL means "未確認" (booking predates this column, or a legacy
-- import) — must NEVER be silently treated as 0 素食, per Clement's explicit
-- instruction. New bookings created after this migration always write an
-- explicit integer (0 if the customer has no vegetarian diners).
ALTER TABLE farm_bookings ADD COLUMN vegetarian_meal_count INTEGER;
