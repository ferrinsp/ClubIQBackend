-- Add warnings storage and audit columns to uploads
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS warnings JSONB DEFAULT '[]'::jsonb;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS uploaded_by TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
