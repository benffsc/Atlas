-- MIG_056__places_from_address_observations.sql
-- Create places from address observations without full geocoding
--
-- Problem:
--   38K+ address observations exist but only 120 places (from legacy_import)
--   Full geocoding requires Google API ($5/1000 requests) and is slow
--   Users want to see and link addresses now
--
-- Solution:
--   1. Create index on observations for faster lookup
--   2. Create sot_addresses from unique address text
--   3. Create places linked to those addresses
--   4. Batch link observations to the addresses
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_056__places_from_address_observations.sql

\echo '============================================'
\echo 'MIG_056: Places from Address Observations'
\echo '============================================'

-- Increase statement timeout for this migration
SET statement_timeout = '10min';

-- ============================================
-- PART 1: Create indexes for faster lookups
-- ============================================
\echo ''
\echo 'Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_observations_address_text
ON trapper.observations (UPPER(TRIM(value_text)))
WHERE observation_type = 'address_signal';

CREATE INDEX IF NOT EXISTS idx_sot_addresses_formatted_upper
ON trapper.sot_addresses (UPPER(formatted_address));

-- ============================================
-- PART 2: Create addresses and places in bulk
-- ============================================
\echo ''
\echo 'Creating addresses from unique observation values...'

-- Step 1: Create temporary table with unique addresses
CREATE TEMP TABLE _unique_addresses AS
SELECT DISTINCT ON (UPPER(TRIM(value_text)))
    gen_random_uuid() as address_id,
    TRIM(value_text) as formatted_address,
    source_table
FROM trapper.observations
WHERE observation_type = 'address_signal'
  AND value_text IS NOT NULL
  AND TRIM(value_text) != ''
  AND LENGTH(TRIM(value_text)) >= 10
  AND NOT EXISTS (
      SELECT 1 FROM trapper.sot_addresses sa
      WHERE UPPER(sa.formatted_address) = UPPER(TRIM(value_text))
  )
ORDER BY UPPER(TRIM(value_text)), created_at;

\echo ''
SELECT COUNT(*) as unique_addresses_to_create FROM _unique_addresses;

-- Step 2: Insert into sot_addresses
\echo ''
\echo 'Inserting into sot_addresses...'

INSERT INTO trapper.sot_addresses (
    address_id,
    formatted_address,
    components,
    geocode_status,
    raw_input,
    input_source,
    data_source
)
SELECT
    address_id,
    formatted_address,
    '{}'::jsonb,
    'pending',
    formatted_address,
    source_table,
    'file_upload'::trapper.data_source
FROM _unique_addresses
ON CONFLICT DO NOTHING;

-- Step 3: Insert into places
\echo ''
\echo 'Creating places...'

INSERT INTO trapper.places (
    sot_address_id,
    display_name,
    formatted_address,
    place_kind,
    is_address_backed,
    place_origin,
    data_source
)
SELECT
    ua.address_id,
    ua.formatted_address,
    ua.formatted_address,
    'unknown'::trapper.place_kind,
    true,
    'atlas',
    'file_upload'::trapper.data_source
FROM _unique_addresses ua
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.places p WHERE p.sot_address_id = ua.address_id
);

-- ============================================
-- PART 3: Link observations to addresses (batched)
-- ============================================
\echo ''
\echo 'Linking observations to addresses...'

-- Link in batches to avoid timeout
UPDATE trapper.observations o
SET resolved_address_id = sa.address_id
FROM trapper.sot_addresses sa
WHERE o.observation_type = 'address_signal'
  AND o.resolved_address_id IS NULL
  AND UPPER(TRIM(o.value_text)) = UPPER(sa.formatted_address);

DROP TABLE _unique_addresses;

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Verification:'

SELECT
    (SELECT COUNT(*) FROM trapper.sot_addresses) as total_addresses,
    (SELECT COUNT(*) FROM trapper.places) as total_places,
    (SELECT COUNT(*) FROM trapper.observations WHERE observation_type = 'address_signal' AND resolved_address_id IS NOT NULL) as linked_observations,
    (SELECT COUNT(*) FROM trapper.observations WHERE observation_type = 'address_signal') as total_address_observations;

\echo ''
\echo 'Places by origin:'
SELECT place_origin, COUNT(*)
FROM trapper.places
GROUP BY place_origin
ORDER BY COUNT(*) DESC;

\echo ''
\echo '============================================'
\echo 'MIG_056 Complete'
\echo '============================================'
