PRAGMA foreign_keys = OFF;

CREATE TABLE members_new (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  theme_preference TEXT NOT NULL DEFAULT 'aama' CHECK (theme_preference IN ('aama','hard','clay','grass')),
  bank_code TEXT,
  bank_name TEXT,
  bank_account TEXT
);

INSERT INTO members_new
SELECT
  id, line_user_id, display_name, picture_url, role, created_at, last_login_at,
  CASE WHEN theme_preference = 'system' THEN 'aama' ELSE theme_preference END,
  bank_code, bank_name, bank_account
FROM members;

DROP TABLE members;
ALTER TABLE members_new RENAME TO members;

PRAGMA foreign_keys = ON;
