-- MIG_466: Backfill Person Identifiers and Fix is_processed Flags
--
-- Fixes critical data quality issues:
-- 1. 15,129 people have primary_email/primary_phone but no person_identifiers records
-- 2. ~100k staged_records are marked is_processed=false despite being processed
--
-- Root cause: People created through legacy code paths that didn't create person_identifiers
-- Impact: Identity matching fails for these people, causing duplicate creation
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_466__backfill_person_identifiers.sql

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_466: Backfill Person Identifiers and Fix Staged Records Flags   ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''

-- ============================================================================
-- PART 1: Pre-flight counts
-- ============================================================================

\echo 'Pre-flight counts...'
\echo ''

SELECT 'People without email identifiers' as metric, COUNT(*) as count
FROM trapper.sot_people p
WHERE p.primary_email IS NOT NULL
  AND TRIM(p.primary_email) != ''
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
  );

SELECT 'People without phone identifiers' as metric, COUNT(*) as count
FROM trapper.sot_people p
WHERE p.primary_phone IS NOT NULL
  AND LENGTH(trapper.norm_phone_us(p.primary_phone)) >= 10
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'phone'
  )
  AND NOT EXISTS (
      SELECT 1 FROM trapper.identity_phone_blacklist bl
      WHERE bl.phone_norm = trapper.norm_phone_us(p.primary_phone)
  );

SELECT 'Unprocessed staged records' as metric,
       source_system, source_table, COUNT(*) as count
FROM trapper.staged_records
WHERE NOT is_processed
GROUP BY source_system, source_table
ORDER BY count DESC
LIMIT 10;

-- ============================================================================
-- PART 2: Backfill Email Identifiers
-- ============================================================================

\echo ''
\echo 'Backfilling email identifiers...'

INSERT INTO trapper.person_identifiers (
    person_id, id_type, id_value_raw, id_value_norm, source_system, created_at
)
SELECT
    p.person_id,
    'email',
    p.primary_email,
    LOWER(TRIM(p.primary_email)),
    COALESCE(p.data_source::TEXT, 'backfill'),
    NOW()
FROM trapper.sot_people p
WHERE p.primary_email IS NOT NULL
  AND TRIM(p.primary_email) != ''
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
  )
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

SELECT 'Email identifiers created' as action, COUNT(*) as count
FROM trapper.person_identifiers
WHERE source_system IN ('clinichq', 'shelterluv', 'backfill')
  AND id_type = 'email'
  AND created_at > NOW() - INTERVAL '1 minute';

-- ============================================================================
-- PART 3: Backfill Phone Identifiers
-- ============================================================================

\echo ''
\echo 'Backfilling phone identifiers...'

INSERT INTO trapper.person_identifiers (
    person_id, id_type, id_value_raw, id_value_norm, source_system, created_at
)
SELECT
    p.person_id,
    'phone',
    p.primary_phone,
    trapper.norm_phone_us(p.primary_phone),
    COALESCE(p.data_source::TEXT, 'backfill'),
    NOW()
FROM trapper.sot_people p
WHERE p.primary_phone IS NOT NULL
  AND TRIM(p.primary_phone) != ''
  AND LENGTH(trapper.norm_phone_us(p.primary_phone)) >= 10
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'phone'
  )
  AND NOT EXISTS (
      SELECT 1 FROM trapper.identity_phone_blacklist bl
      WHERE bl.phone_norm = trapper.norm_phone_us(p.primary_phone)
  )
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

SELECT 'Phone identifiers created' as action, COUNT(*) as count
FROM trapper.person_identifiers
WHERE source_system IN ('clinichq', 'shelterluv', 'backfill')
  AND id_type = 'phone'
  AND created_at > NOW() - INTERVAL '1 minute';

-- ============================================================================
-- PART 4: Fix is_processed Flags for ClinicHQ
-- ============================================================================

\echo ''
\echo 'Fixing is_processed flags for ClinicHQ appointment_info...'

UPDATE trapper.staged_records sr
SET is_processed = true, processed_at = NOW()
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'appointment_info'
  AND sr.is_processed = false
  AND EXISTS (
      SELECT 1 FROM trapper.sot_appointments a
      WHERE a.source_record_id = sr.source_row_id
        AND a.source_system = 'clinichq'
  );

SELECT 'ClinicHQ appointment_info marked processed' as action, COUNT(*) as count
FROM trapper.staged_records
WHERE source_system = 'clinichq'
  AND source_table = 'appointment_info'
  AND is_processed = true
  AND processed_at > NOW() - INTERVAL '1 minute';

\echo 'Fixing is_processed flags for ClinicHQ cat_info...'

UPDATE trapper.staged_records sr
SET is_processed = true, processed_at = NOW()
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'cat_info'
  AND sr.is_processed = false
  AND EXISTS (
      SELECT 1 FROM trapper.cat_identifiers ci
      WHERE ci.id_value = sr.payload->>'Microchip Number'
        AND ci.id_type = 'microchip'
  );

SELECT 'ClinicHQ cat_info marked processed' as action, COUNT(*) as count
FROM trapper.staged_records
WHERE source_system = 'clinichq'
  AND source_table = 'cat_info'
  AND is_processed = true
  AND processed_at > NOW() - INTERVAL '1 minute';

\echo 'Fixing is_processed flags for ClinicHQ owner_info...'

UPDATE trapper.staged_records sr
SET is_processed = true, processed_at = NOW()
WHERE sr.source_system = 'clinichq'
  AND sr.source_table = 'owner_info'
  AND sr.is_processed = false
  AND EXISTS (
      SELECT 1 FROM trapper.sot_appointments a
      WHERE a.source_record_id = sr.source_row_id
        AND a.source_system = 'clinichq'
  );

SELECT 'ClinicHQ owner_info marked processed' as action, COUNT(*) as count
FROM trapper.staged_records
WHERE source_system = 'clinichq'
  AND source_table = 'owner_info'
  AND is_processed = true
  AND processed_at > NOW() - INTERVAL '1 minute';

-- ============================================================================
-- PART 5: Fix is_processed Flags for PetLink
-- ============================================================================

\echo ''
\echo 'Fixing is_processed flags for PetLink pets...'

UPDATE trapper.staged_records sr
SET is_processed = true, processed_at = NOW()
WHERE sr.source_system = 'petlink'
  AND sr.source_table = 'pets'
  AND sr.is_processed = false
  AND EXISTS (
      SELECT 1 FROM trapper.cat_identifiers ci
      WHERE ci.id_value = sr.payload->>'Microchip'
        AND ci.id_type = 'microchip'
  );

SELECT 'PetLink pets marked processed' as action, COUNT(*) as count
FROM trapper.staged_records
WHERE source_system = 'petlink'
  AND source_table = 'pets'
  AND is_processed = true
  AND processed_at > NOW() - INTERVAL '1 minute';

\echo 'Fixing is_processed flags for PetLink owners...'

UPDATE trapper.staged_records sr
SET is_processed = true, processed_at = NOW()
WHERE sr.source_system = 'petlink'
  AND sr.source_table = 'owners'
  AND sr.is_processed = false
  AND EXISTS (
      SELECT 1 FROM trapper.sot_people p
      JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
      WHERE pi.id_value_norm = LOWER(TRIM(sr.payload->>'Email'))
        AND pi.id_type = 'email'
  );

SELECT 'PetLink owners marked processed' as action, COUNT(*) as count
FROM trapper.staged_records
WHERE source_system = 'petlink'
  AND source_table = 'owners'
  AND is_processed = true
  AND processed_at > NOW() - INTERVAL '1 minute';

-- ============================================================================
-- PART 6: Post-flight verification
-- ============================================================================

\echo ''
\echo 'Post-flight verification...'
\echo ''

SELECT 'People without email identifiers (should be ~0)' as metric, COUNT(*) as count
FROM trapper.sot_people p
WHERE p.primary_email IS NOT NULL
  AND TRIM(p.primary_email) != ''
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
  );

SELECT 'People without phone identifiers (should be ~770)' as metric, COUNT(*) as count
FROM trapper.sot_people p
WHERE p.primary_phone IS NOT NULL
  AND LENGTH(trapper.norm_phone_us(p.primary_phone)) >= 10
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id AND pi.id_type = 'phone'
  )
  AND NOT EXISTS (
      SELECT 1 FROM trapper.identity_phone_blacklist bl
      WHERE bl.phone_norm = trapper.norm_phone_us(p.primary_phone)
  );

\echo ''
\echo 'Staged records processing status by source:'
SELECT
  source_system,
  source_table,
  COUNT(*) FILTER (WHERE is_processed) as processed,
  COUNT(*) FILTER (WHERE NOT is_processed) as unprocessed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_processed) / NULLIF(COUNT(*), 0), 1) as pct_processed
FROM trapper.staged_records
GROUP BY source_system, source_table
ORDER BY source_system, source_table;

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_466 COMPLETE - Person identifiers backfilled, flags fixed       ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''
