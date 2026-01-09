-- MIG_084__clinichq_hist_search_indexes.sql
-- Adds trigram indexes for case-insensitive fuzzy search on historical tables
--
-- These indexes support ILIKE '%term%' and similarity() searches on:
--   - animal_name (appts and cats tables)
--   - owner address (owners table)
--
-- Requires pg_trgm extension (should already exist from MIG_078).
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_084__clinichq_hist_search_indexes.sql

-- Ensure pg_trgm exists
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- APPTS: trigram index on animal_name
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'trapper'
          AND tablename = 'clinichq_hist_appts'
          AND indexname = 'idx_clinichq_hist_appts_animal_trgm'
    ) THEN
        CREATE INDEX idx_clinichq_hist_appts_animal_trgm
        ON trapper.clinichq_hist_appts
        USING gin (animal_name gin_trgm_ops);

        RAISE NOTICE 'Created index: idx_clinichq_hist_appts_animal_trgm';
    ELSE
        RAISE NOTICE 'Index idx_clinichq_hist_appts_animal_trgm already exists';
    END IF;
END $$;

-- ============================================
-- CATS: trigram index on animal_name
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'trapper'
          AND tablename = 'clinichq_hist_cats'
          AND indexname = 'idx_clinichq_hist_cats_animal_trgm'
    ) THEN
        CREATE INDEX idx_clinichq_hist_cats_animal_trgm
        ON trapper.clinichq_hist_cats
        USING gin (animal_name gin_trgm_ops);

        RAISE NOTICE 'Created index: idx_clinichq_hist_cats_animal_trgm';
    ELSE
        RAISE NOTICE 'Index idx_clinichq_hist_cats_animal_trgm already exists';
    END IF;
END $$;

-- ============================================
-- OWNERS: trigram index on address for location search
-- ============================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'trapper'
          AND tablename = 'clinichq_hist_owners'
          AND indexname = 'idx_clinichq_hist_owners_address_trgm'
    ) THEN
        CREATE INDEX idx_clinichq_hist_owners_address_trgm
        ON trapper.clinichq_hist_owners
        USING gin (owner_address gin_trgm_ops);

        RAISE NOTICE 'Created index: idx_clinichq_hist_owners_address_trgm';
    ELSE
        RAISE NOTICE 'Index idx_clinichq_hist_owners_address_trgm already exists';
    END IF;
END $$;

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Trigram indexes on historical tables:'

SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'trapper'
  AND tablename LIKE 'clinichq_hist_%'
  AND indexname LIKE '%_trgm'
ORDER BY tablename, indexname;
