ALTER TABLE farm_bookings ADD COLUMN lookup_code TEXT;
ALTER TABLE farm_bookings ADD COLUMN plant_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE farm_bookings ADD COLUMN meal_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE farm_bookings ADD COLUMN customer_note TEXT NOT NULL DEFAULT '';
ALTER TABLE farm_bookings ADD COLUMN cancelled_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_bookings_lookup_code ON farm_bookings(lookup_code);
CREATE INDEX IF NOT EXISTS idx_farm_slots_public ON farm_slots(status, starts_at);

INSERT OR IGNORE INTO farm_capacity_policies (
  id, farm_id, version, max_groups, limit_one_group, limit_two_groups,
  limit_three_groups, effective_at
) VALUES ('wegrow-policy-v1', 'wegrow-madou', 1, 3, 50, 30, 15, '2026-09-16T00:00:00+08:00');

INSERT OR IGNORE INTO farm_experiences (
  id, farm_id, name, description, duration_minutes, rain_policy, active
) VALUES (
  'wegrow-greenhouse-visit', 'wegrow-madou', '科技溫室農場參訪',
  '溫室導覽、現場解說與農法分享', 90,
  '遇天候或農場作業調整時，由農場另行聯繫', 1
);

INSERT OR IGNORE INTO farm_ticket_types (
  id, farm_id, name, age_rule, price_twd, occupies_capacity,
  active_from, active_until, version
) VALUES (
  'wegrow-ticket-reference-v1', 'wegrow-madou', '參訪門票（待核定參考）',
  '成人、兒童與幼兒年齡規則待核定', 300, 1,
  '2026-09-16T00:00:00+08:00', NULL, 1
);

INSERT OR IGNORE INTO farm_slots (
  id, farm_id, experience_id, capacity_policy_id, starts_at, ends_at,
  booking_cutoff_at, buffer_minutes, status, version
) VALUES
  ('wegrow-20260919-am', 'wegrow-madou', 'wegrow-greenhouse-visit', 'wegrow-policy-v1', '2026-09-19T09:30:00+08:00', '2026-09-19T11:00:00+08:00', '2026-09-18T18:00:00+08:00', 30, 'open', 1),
  ('wegrow-20260919-pm', 'wegrow-madou', 'wegrow-greenhouse-visit', 'wegrow-policy-v1', '2026-09-19T14:00:00+08:00', '2026-09-19T15:30:00+08:00', '2026-09-18T18:00:00+08:00', 30, 'open', 1),
  ('wegrow-20260920-am', 'wegrow-madou', 'wegrow-greenhouse-visit', 'wegrow-policy-v1', '2026-09-20T09:30:00+08:00', '2026-09-20T11:00:00+08:00', '2026-09-19T18:00:00+08:00', 30, 'open', 1),
  ('wegrow-20260926-am', 'wegrow-madou', 'wegrow-greenhouse-visit', 'wegrow-policy-v1', '2026-09-26T10:00:00+08:00', '2026-09-26T11:30:00+08:00', '2026-09-25T18:00:00+08:00', 30, 'open', 1);
