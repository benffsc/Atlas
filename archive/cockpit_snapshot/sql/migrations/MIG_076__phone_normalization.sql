-- MIG_076__phone_normalization.sql
-- Creates phone normalization function and adds normalized phone columns
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_076__phone_normalization.sql

-- ============================================
-- CREATE NORMALIZE_PHONE FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION trapper.normalize_phone(raw_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    digits text;
BEGIN
    -- Return NULL for NULL or empty input
    IF raw_phone IS NULL OR TRIM(raw_phone) = '' THEN
        RETURN NULL;
    END IF;

    -- Extract only digits
    digits := regexp_replace(raw_phone, '[^0-9]', '', 'g');

    -- If empty after stripping, return NULL
    IF digits = '' THEN
        RETURN NULL;
    END IF;

    -- Handle US phone numbers
    -- 10 digits: assume US, prepend +1
    IF length(digits) = 10 THEN
        RETURN '+1' || digits;
    -- 11 digits starting with 1: US with country code
    ELSIF length(digits) = 11 AND left(digits, 1) = '1' THEN
        RETURN '+' || digits;
    -- Already has country code (11+ digits)
    ELSIF length(digits) >= 11 THEN
        RETURN '+' || digits;
    -- Short number (local/extension), return as-is with + prefix
    ELSE
        RETURN '+' || digits;
    END IF;
END;
$$;

COMMENT ON FUNCTION trapper.normalize_phone IS
'Normalizes phone numbers to E.164-ish format. Strips non-digits, adds +1 for 10-digit US numbers.';

-- ============================================
-- ADD NORMALIZED COLUMNS TO PEOPLE
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'people'
                   AND column_name = 'phone_normalized') THEN
        ALTER TABLE trapper.people ADD COLUMN phone_normalized text;
        RAISE NOTICE 'Added column: people.phone_normalized';
    END IF;
END $$;

-- Backfill people.phone_normalized
UPDATE trapper.people
SET phone_normalized = trapper.normalize_phone(phone)
WHERE phone IS NOT NULL
  AND phone_normalized IS NULL;

-- Index on normalized phone
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'trapper'
                   AND tablename = 'people'
                   AND indexname = 'idx_people_phone_normalized') THEN
        CREATE INDEX idx_people_phone_normalized ON trapper.people(phone_normalized);
        RAISE NOTICE 'Created index: idx_people_phone_normalized';
    END IF;
END $$;

-- ============================================
-- ADD NORMALIZED COLUMNS TO APPOINTMENT_REQUESTS
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'appointment_requests'
                   AND column_name = 'phone_normalized') THEN
        ALTER TABLE trapper.appointment_requests ADD COLUMN phone_normalized text;
        RAISE NOTICE 'Added column: appointment_requests.phone_normalized';
    END IF;
END $$;

-- Backfill appointment_requests.phone_normalized
UPDATE trapper.appointment_requests
SET phone_normalized = trapper.normalize_phone(phone)
WHERE phone IS NOT NULL
  AND phone_normalized IS NULL;

-- Index
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'trapper'
                   AND tablename = 'appointment_requests'
                   AND indexname = 'idx_appointment_requests_phone_normalized') THEN
        CREATE INDEX idx_appointment_requests_phone_normalized ON trapper.appointment_requests(phone_normalized);
        RAISE NOTICE 'Created index: idx_appointment_requests_phone_normalized';
    END IF;
END $$;

-- ============================================
-- ADD NORMALIZED COLUMNS TO CLINICHQ_UPCOMING_APPOINTMENTS
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'clinichq_upcoming_appointments'
                   AND column_name = 'phone_normalized') THEN
        ALTER TABLE trapper.clinichq_upcoming_appointments ADD COLUMN phone_normalized text;
        RAISE NOTICE 'Added column: clinichq_upcoming_appointments.phone_normalized';
    END IF;
END $$;

-- Backfill (use client_phone or client_cell_phone)
UPDATE trapper.clinichq_upcoming_appointments
SET phone_normalized = trapper.normalize_phone(COALESCE(client_cell_phone, client_phone))
WHERE (client_cell_phone IS NOT NULL OR client_phone IS NOT NULL)
  AND phone_normalized IS NULL;

-- Index
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'trapper'
                   AND tablename = 'clinichq_upcoming_appointments'
                   AND indexname = 'idx_clinichq_upcoming_phone_normalized') THEN
        CREATE INDEX idx_clinichq_upcoming_phone_normalized ON trapper.clinichq_upcoming_appointments(phone_normalized);
        RAISE NOTICE 'Created index: idx_clinichq_upcoming_phone_normalized';
    END IF;
END $$;

-- ============================================
-- VERIFICATION
-- ============================================
SELECT 'people' AS table_name,
       COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL) AS normalized,
       COUNT(*) FILTER (WHERE phone IS NOT NULL) AS has_phone
FROM trapper.people
UNION ALL
SELECT 'appointment_requests',
       COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL),
       COUNT(*) FILTER (WHERE phone IS NOT NULL)
FROM trapper.appointment_requests
UNION ALL
SELECT 'clinichq_upcoming',
       COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL),
       COUNT(*) FILTER (WHERE client_phone IS NOT NULL OR client_cell_phone IS NOT NULL)
FROM trapper.clinichq_upcoming_appointments;

-- Sample normalized phones
SELECT phone, phone_normalized
FROM trapper.people
WHERE phone_normalized IS NOT NULL
LIMIT 5;
