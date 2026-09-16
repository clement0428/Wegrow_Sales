PRAGMA foreign_keys = ON;

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,                    -- YYYY-MM-DD (台北)
  start_time TEXT NOT NULL,                    -- HH:mm
  end_time TEXT NOT NULL,                      -- HH:mm
  venue_id TEXT NOT NULL REFERENCES venues(id),
  capacity INTEGER NOT NULL DEFAULT 8 CHECK (capacity >= 1),
  registration_deadline TEXT NOT NULL,         -- ISO with +08:00 offset
  estimated_total INTEGER CHECK (estimated_total IS NULL OR estimated_total >= 0),
  final_total INTEGER CHECK (final_total IS NULL OR final_total >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','cancelled')),
  organizer_id TEXT NOT NULL REFERENCES members(id),
  settled_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_time > start_time)
);
CREATE INDEX events_date_idx ON events(event_date);
CREATE INDEX events_organizer_idx ON events(organizer_id);

CREATE TABLE registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed','waitlisted')),
  seat_no INTEGER NOT NULL,                    -- 1..N; confirmed if seat_no <= capacity
  attended INTEGER,                            -- 0/1 nullable
  amount_due INTEGER,
  paid_at TEXT,
  paid_amount INTEGER,
  paid_marked_by TEXT REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(event_id, member_id),
  UNIQUE(event_id, seat_no)
);
CREATE INDEX registrations_member_idx ON registrations(member_id);
