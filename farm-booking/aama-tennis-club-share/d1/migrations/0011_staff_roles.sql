-- 2026-09-18 Clement: 落實管理員／接待員／餐飲備料三種角色（Section 4）。
-- Same CHECK-constraint-rebuild pattern as 0003_theme_rename.sql — D1/SQLite
-- can't ALTER a CHECK constraint in place. members has 3 rows in production,
-- all role='member', zero 'admin' rows, so this is a low-risk rebuild.
PRAGMA foreign_keys = OFF;

CREATE TABLE members_new (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin','reception','kitchen')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  theme_preference TEXT NOT NULL DEFAULT 'aama' CHECK (theme_preference IN ('aama','hard','clay','grass')),
  bank_code TEXT,
  bank_name TEXT,
  bank_account TEXT,
  bank_holder TEXT
);

INSERT INTO members_new
SELECT id, line_user_id, display_name, picture_url, role, created_at, last_login_at,
       theme_preference, bank_code, bank_name, bank_account, bank_holder
FROM members;

DROP TABLE members;
ALTER TABLE members_new RENAME TO members;

PRAGMA foreign_keys = ON;
