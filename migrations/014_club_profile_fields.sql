-- Add profile fields to clubs table
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS primary_contact_email TEXT;
