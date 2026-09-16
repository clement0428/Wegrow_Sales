ALTER TABLE members ADD COLUMN theme_preference TEXT NOT NULL DEFAULT 'system' CHECK (theme_preference IN ('system','clay','hard','grass'));
ALTER TABLE members ADD COLUMN bank_code TEXT;
ALTER TABLE members ADD COLUMN bank_name TEXT;
ALTER TABLE members ADD COLUMN bank_account TEXT;
