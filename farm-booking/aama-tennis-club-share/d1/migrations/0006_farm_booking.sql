PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS farm_capacity_policies (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  max_groups INTEGER NOT NULL DEFAULT 3,
  limit_one_group INTEGER NOT NULL DEFAULT 50,
  limit_two_groups INTEGER NOT NULL DEFAULT 30,
  limit_three_groups INTEGER NOT NULL DEFAULT 15,
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(farm_id, version)
);

CREATE TABLE IF NOT EXISTS farm_experiences (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL,
  rain_policy TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_slots (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  experience_id TEXT NOT NULL REFERENCES farm_experiences(id),
  capacity_policy_id TEXT NOT NULL REFERENCES farm_capacity_policies(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  booking_cutoff_at TEXT NOT NULL,
  buffer_minutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL CHECK(status IN ('open','paused','closed','cancelled')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_ticket_types (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  name TEXT NOT NULL,
  age_rule TEXT NOT NULL DEFAULT '',
  price_twd INTEGER NOT NULL CHECK(price_twd >= 0),
  occupies_capacity INTEGER NOT NULL DEFAULT 1,
  active_from TEXT NOT NULL,
  active_until TEXT,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_bookings (
  id TEXT PRIMARY KEY,
  booking_number TEXT NOT NULL UNIQUE,
  slot_id TEXT NOT NULL REFERENCES farm_slots(id),
  customer_member_id TEXT,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  group_name TEXT,
  adult_count INTEGER NOT NULL DEFAULT 0,
  child_count INTEGER NOT NULL DEFAULT 0,
  infant_count INTEGER NOT NULL DEFAULT 0,
  total_people INTEGER NOT NULL CHECK(total_people > 0),
  amount_twd INTEGER NOT NULL CHECK(amount_twd >= 0),
  currency TEXT NOT NULL DEFAULT 'TWD',
  booking_status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  hold_expires_at TEXT,
  ticket_snapshot_json TEXT NOT NULL,
  policy_snapshot_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  visit_version INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_farm_bookings_slot_status ON farm_bookings(slot_id, booking_status, payment_status);

CREATE TABLE IF NOT EXISTS farm_payment_attempts (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES farm_bookings(id),
  method TEXT NOT NULL CHECK(method IN ('line_pay','credit_card')),
  provider TEXT NOT NULL,
  provider_transaction_id TEXT UNIQUE,
  amount_twd INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TWD',
  status TEXT NOT NULL,
  raw_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payment_attempt_id TEXT NOT NULL REFERENCES farm_payment_attempts(id),
  verified INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS farm_notification_outbox (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES farm_bookings(id),
  channel TEXT NOT NULL DEFAULT 'line',
  notification_type TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  content_snapshot_json TEXT NOT NULL,
  retry_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  accepted_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_calendar_sync (
  booking_id TEXT PRIMARY KEY REFERENCES farm_bookings(id),
  provider TEXT NOT NULL,
  external_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  reason TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
