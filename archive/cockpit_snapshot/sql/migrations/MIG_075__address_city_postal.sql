-- MIG_075__address_city_postal.sql
-- Adds city and postal_code columns to addresses table with backfill from components JSONB
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_075__address_city_postal.sql

-- ============================================
-- ADD COLUMNS (if not exist)
-- ============================================
DO $$
BEGIN
    -- Add city column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'addresses'
                   AND column_name = 'city') THEN
        ALTER TABLE trapper.addresses ADD COLUMN city text;
        RAISE NOTICE 'Added column: addresses.city';
    ELSE
        RAISE NOTICE 'Column addresses.city already exists';
    END IF;

    -- Add postal_code column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'addresses'
                   AND column_name = 'postal_code') THEN
        ALTER TABLE trapper.addresses ADD COLUMN postal_code text;
        RAISE NOTICE 'Added column: addresses.postal_code';
    ELSE
        RAISE NOTICE 'Column addresses.postal_code already exists';
    END IF;
END $$;

-- ============================================
-- BACKFILL FROM COMPONENTS JSONB
-- ============================================
-- Extract city from 'locality' type
UPDATE trapper.addresses
SET city = (
    SELECT elem->>'long_name'
    FROM jsonb_array_elements(components) AS elem
    WHERE elem->'types' ? 'locality'
    LIMIT 1
)
WHERE components IS NOT NULL
  AND city IS NULL;

-- Extract postal_code from 'postal_code' type
UPDATE trapper.addresses
SET postal_code = (
    SELECT elem->>'long_name'
    FROM jsonb_array_elements(components) AS elem
    WHERE elem->'types' ? 'postal_code'
    LIMIT 1
)
WHERE components IS NOT NULL
  AND postal_code IS NULL;

-- ============================================
-- CREATE INDEXES
-- ============================================
DO $$
BEGIN
    -- Index on city
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'trapper'
                   AND tablename = 'addresses'
                   AND indexname = 'idx_addresses_city') THEN
        CREATE INDEX idx_addresses_city ON trapper.addresses(city);
        RAISE NOTICE 'Created index: idx_addresses_city';
    END IF;

    -- Index on postal_code
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'trapper'
                   AND tablename = 'addresses'
                   AND indexname = 'idx_addresses_postal_code') THEN
        CREATE INDEX idx_addresses_postal_code ON trapper.addresses(postal_code);
        RAISE NOTICE 'Created index: idx_addresses_postal_code';
    END IF;
END $$;

-- ============================================
-- VERIFICATION
-- ============================================
SELECT
    'city coverage' AS metric,
    COUNT(*) FILTER (WHERE city IS NOT NULL) AS filled,
    COUNT(*) AS total,
    ROUND(100.0 * COUNT(*) FILTER (WHERE city IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct
FROM trapper.addresses
UNION ALL
SELECT
    'postal_code coverage',
    COUNT(*) FILTER (WHERE postal_code IS NOT NULL),
    COUNT(*),
    ROUND(100.0 * COUNT(*) FILTER (WHERE postal_code IS NOT NULL) / NULLIF(COUNT(*), 0), 1)
FROM trapper.addresses;

-- Sample of extracted values
SELECT city, postal_code, formatted_address
FROM trapper.addresses
WHERE city IS NOT NULL
LIMIT 5;
