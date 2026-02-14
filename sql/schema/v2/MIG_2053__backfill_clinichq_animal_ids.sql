-- MIG_2053: Backfill clinichq_animal_id on Existing Cats
-- Date: 2026-02-13
--
-- Issue: ~32,000 cats from ClinicHQ have microchips but no clinichq_animal_id
-- because MIG_2051 was applied after the initial ingestion.
--
-- Fix: Backfill clinichq_animal_id from source.clinichq_raw by matching on microchip
--
-- The "Number" field in cat_info records (e.g., "21-118") is the ClinicHQ appointment/animal ID.

\echo ''
\echo '=============================================='
\echo '  MIG_2053: Backfill ClinicHQ Animal IDs'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Check before state
-- ============================================================================

\echo '1. Checking current state...'

SELECT 'BEFORE: sot.cats with clinichq_animal_id' as context,
  COUNT(*) FILTER (WHERE clinichq_animal_id IS NOT NULL) as with_id,
  COUNT(*) FILTER (WHERE clinichq_animal_id IS NULL) as without_id,
  COUNT(*) as total
FROM sot.cats WHERE merged_into_cat_id IS NULL AND source_system = 'clinichq';

-- ============================================================================
-- Backfill from source.clinichq_raw (V2 schema)
-- ============================================================================

\echo ''
\echo '2. Backfilling from source.clinichq_raw (cat records)...'

WITH animal_ids AS (
  SELECT DISTINCT ON (payload->>'Microchip Number')
    payload->>'Microchip Number' as microchip,
    payload->>'Number' as animal_id
  FROM source.clinichq_raw
  WHERE record_type = 'cat'
    AND payload->>'Microchip Number' IS NOT NULL
    AND TRIM(payload->>'Microchip Number') != ''
    AND payload->>'Number' IS NOT NULL
    AND TRIM(payload->>'Number') != ''
  ORDER BY payload->>'Microchip Number', created_at DESC
)
UPDATE sot.cats c
SET
  clinichq_animal_id = a.animal_id,
  updated_at = NOW()
FROM animal_ids a
WHERE c.microchip = a.microchip
  AND c.clinichq_animal_id IS NULL
  AND c.merged_into_cat_id IS NULL;

\echo '   Updated sot.cats from source.clinichq_raw'

-- ============================================================================
-- Also backfill from ops.staged_records (legacy staging table)
-- ============================================================================

\echo ''
\echo '3. Backfilling from ops.staged_records (cat_info records)...'

WITH animal_ids AS (
  SELECT DISTINCT ON (payload->>'Microchip Number')
    payload->>'Microchip Number' as microchip,
    payload->>'Number' as animal_id
  FROM ops.staged_records
  WHERE source_system = 'clinichq'
    AND source_table = 'cat_info'
    AND payload->>'Microchip Number' IS NOT NULL
    AND TRIM(payload->>'Microchip Number') != ''
    AND payload->>'Number' IS NOT NULL
    AND TRIM(payload->>'Number') != ''
  ORDER BY payload->>'Microchip Number', created_at DESC
)
UPDATE sot.cats c
SET
  clinichq_animal_id = a.animal_id,
  updated_at = NOW()
FROM animal_ids a
WHERE c.microchip = a.microchip
  AND c.clinichq_animal_id IS NULL
  AND c.merged_into_cat_id IS NULL;

\echo '   Updated sot.cats from ops.staged_records'

-- ============================================================================
-- Also backfill from trapper.staged_records (V1 staging table)
-- ============================================================================

\echo ''
\echo '4. Backfilling from trapper.staged_records (cat_info records)...'

WITH animal_ids AS (
  SELECT DISTINCT ON (payload->>'Microchip Number')
    payload->>'Microchip Number' as microchip,
    payload->>'Number' as animal_id
  FROM trapper.staged_records
  WHERE source_system = 'clinichq'
    AND source_table = 'cat_info'
    AND payload->>'Microchip Number' IS NOT NULL
    AND TRIM(payload->>'Microchip Number') != ''
    AND payload->>'Number' IS NOT NULL
    AND TRIM(payload->>'Number') != ''
  ORDER BY payload->>'Microchip Number', created_at DESC
)
UPDATE sot.cats c
SET
  clinichq_animal_id = a.animal_id,
  updated_at = NOW()
FROM animal_ids a
WHERE c.microchip = a.microchip
  AND c.clinichq_animal_id IS NULL
  AND c.merged_into_cat_id IS NULL;

\echo '   Updated sot.cats from trapper.staged_records'

-- ============================================================================
-- Also update trapper.sot_cats (V1 table)
-- ============================================================================

\echo ''
\echo '5. Backfilling trapper.sot_cats...'

WITH animal_ids AS (
  SELECT DISTINCT ON (payload->>'Microchip Number')
    payload->>'Microchip Number' as microchip,
    payload->>'Number' as animal_id
  FROM trapper.staged_records
  WHERE source_system = 'clinichq'
    AND source_table = 'cat_info'
    AND payload->>'Microchip Number' IS NOT NULL
    AND TRIM(payload->>'Microchip Number') != ''
    AND payload->>'Number' IS NOT NULL
    AND TRIM(payload->>'Number') != ''
  ORDER BY payload->>'Microchip Number', created_at DESC
)
UPDATE trapper.sot_cats c
SET
  clinichq_animal_id = a.animal_id,
  updated_at = NOW()
FROM animal_ids a
JOIN trapper.cat_identifiers ci ON ci.id_type = 'microchip' AND ci.id_value = a.microchip
WHERE ci.cat_id = c.cat_id
  AND (c.clinichq_animal_id IS NULL OR c.clinichq_animal_id = '')
  AND c.merged_into_cat_id IS NULL;

\echo '   Updated trapper.sot_cats'

-- ============================================================================
-- Also create cat_identifiers entries for clinichq_animal_id
-- ============================================================================

\echo ''
\echo '6. Creating cat_identifiers entries for clinichq_animal_id...'

INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system)
SELECT DISTINCT
  c.cat_id,
  'clinichq_animal_id',
  c.clinichq_animal_id,
  1.0,
  'clinichq'
FROM sot.cats c
WHERE c.clinichq_animal_id IS NOT NULL
  AND c.clinichq_animal_id != ''
  AND c.merged_into_cat_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM sot.cat_identifiers ci
    WHERE ci.cat_id = c.cat_id
      AND ci.id_type = 'clinichq_animal_id'
  )
ON CONFLICT DO NOTHING;

\echo '   Created cat_identifiers entries'

-- ============================================================================
-- Check after state
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

SELECT 'AFTER: sot.cats with clinichq_animal_id' as context,
  COUNT(*) FILTER (WHERE clinichq_animal_id IS NOT NULL) as with_id,
  COUNT(*) FILTER (WHERE clinichq_animal_id IS NULL) as without_id,
  COUNT(*) as total
FROM sot.cats WHERE merged_into_cat_id IS NULL AND source_system = 'clinichq';

SELECT 'AFTER: cat_identifiers by type' as context, id_type, COUNT(*) as count
FROM sot.cat_identifiers
GROUP BY id_type
ORDER BY count DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_2053 Complete'
\echo '=============================================='
\echo ''
\echo 'Backfilled clinichq_animal_id from:'
\echo '  - source.clinichq_raw (V2 raw storage)'
\echo '  - ops.staged_records (V2 staging)'
\echo '  - trapper.staged_records (V1 staging)'
\echo ''
\echo 'Also created cat_identifiers entries for all populated IDs.'
\echo ''
