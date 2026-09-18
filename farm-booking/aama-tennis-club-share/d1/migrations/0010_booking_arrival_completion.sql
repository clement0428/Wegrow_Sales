-- Admin check-in/complete actions (規格 4 節「到場報到」「已完成」) need a place
-- to record them. Mirrors the existing cancelled_at pattern (point-in-time
-- marker columns layered on top of booking_status, not new booking_status
-- string values) rather than inventing a parallel status enum.
ALTER TABLE farm_bookings ADD COLUMN arrived_at TEXT;
ALTER TABLE farm_bookings ADD COLUMN completed_at TEXT;
