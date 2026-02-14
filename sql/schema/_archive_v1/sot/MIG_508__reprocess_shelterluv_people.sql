-- MIG_508: Reprocess ShelterLuv People and Backfill Identifiers
--
-- Problem:
--   After MIG_506 created the processor and MIG_507 merged existing duplicates,
--   we need to:
--   1. Reprocess any unprocessed shelterluv/people staged records
--   2. Backfill person_identifiers for existing ShelterLuv people
--   3. Ensure future ingests go through proper pipeline
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_508__reprocess_shelterluv_people.sql

\echo ''
\echo '=============================================='
\echo 'MIG_508: Reprocess ShelterLuv People'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Pre-processing diagnostics
-- ============================================================

\echo '1. Pre-processing diagnostics...'
\echo ''

-- Show current state
SELECT 'ShelterLuv people' as entity,
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE merged_into_person_id IS NULL) as active,
       COUNT(*) FILTER (WHERE merged_into_person_id IS NOT NULL) as merged
FROM trapper.sot_people
WHERE data_source::TEXT = 'shelterluv';

SELECT 'Staged records' as entity,
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE is_processed) as processed,
       COUNT(*) FILTER (WHERE NOT is_processed) as unprocessed
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'people';

-- Identifier coverage before
\echo ''
\echo 'Identifier coverage BEFORE backfill:'
SELECT
  p.data_source::TEXT,
  COUNT(*) as total_people,
  COUNT(CASE WHEN EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id
  ) THEN 1 END) as with_identifiers,
  ROUND(100.0 * COUNT(CASE WHEN EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id
  ) THEN 1 END) / NULLIF(COUNT(*), 0), 1) as pct_with_identifiers
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.data_source::TEXT = 'shelterluv'
GROUP BY p.data_source;

-- ============================================================
-- 2. Backfill email identifiers
-- ============================================================

\echo ''
\echo '2. Backfilling email identifiers...'

INSERT INTO trapper.person_identifiers (
  person_id,
  id_type,
  id_value_norm,
  id_value_raw,
  source_system,
  confidence,
  created_at
)
SELECT
  p.person_id,
  'email',
  LOWER(TRIM(p.primary_email)),
  p.primary_email,
  'shelterluv',
  0.8,  -- Standard confidence for backfill
  NOW()
FROM trapper.sot_people p
WHERE p.data_source::TEXT = 'shelterluv'
  AND p.primary_email IS NOT NULL
  AND TRIM(p.primary_email) != ''
  AND p.primary_email LIKE '%@%'  -- Basic email validation
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = p.person_id
      AND pi.id_type = 'email'
  )
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

SELECT 'Email identifiers backfilled' as action, COUNT(*) as count
FROM trapper.person_identifiers
WHERE source_system = 'shelterluv'
  AND id_type = 'email'
  AND created_at > NOW() - INTERVAL '1 minute';

-- ============================================================
-- 3. Backfill phone identifiers
-- ============================================================

\echo ''
\echo '3. Backfilling phone identifiers...'

INSERT INTO trapper.person_identifiers (
  person_id,
  id_type,
  id_value_norm,
  id_value_raw,
  source_system,
  confidence,
  created_at
)
SELECT
  p.person_id,
  'phone',
  trapper.norm_phone_us(p.primary_phone),
  p.primary_phone,
  'shelterluv',
  0.8,  -- Standard confidence for backfill
  NOW()
FROM trapper.sot_people p
WHERE p.data_source::TEXT = 'shelterluv'
  AND p.primary_phone IS NOT NULL
  AND TRIM(p.primary_phone) != ''
  AND LENGTH(trapper.norm_phone_us(p.primary_phone)) = 10  -- Valid US phone
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi
    WHERE pi.person_id = p.person_id
      AND pi.id_type = 'phone'
  )
  -- Skip blacklisted phones
  AND NOT EXISTS (
    SELECT 1 FROM trapper.identity_phone_blacklist bl
    WHERE bl.phone_norm = trapper.norm_phone_us(p.primary_phone)
  )
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

SELECT 'Phone identifiers backfilled' as action, COUNT(*) as count
FROM trapper.person_identifiers
WHERE source_system = 'shelterluv'
  AND id_type = 'phone'
  AND created_at > NOW() - INTERVAL '1 minute';

-- ============================================================
-- 4. Process unprocessed staged records
-- ============================================================

\echo ''
\echo '4. Processing unprocessed staged records...'

-- Process in batches until done
DO $$
DECLARE
  v_result JSONB;
  v_remaining INT;
  v_batch_count INT := 0;
  v_total_processed INT := 0;
BEGIN
  LOOP
    -- Check remaining
    SELECT COUNT(*) INTO v_remaining
    FROM trapper.staged_records
    WHERE source_system = 'shelterluv'
      AND source_table = 'people'
      AND is_processed = false;

    EXIT WHEN v_remaining = 0 OR v_batch_count >= 20;  -- Max 20 batches (10k records)

    -- Process batch
    v_result := trapper.process_shelterluv_people_batch(500);
    v_batch_count := v_batch_count + 1;
    v_total_processed := v_total_processed + COALESCE((v_result->>'processed')::int, 0);

    RAISE NOTICE 'Batch %: processed=%, success=%, errors=%, remaining=%',
      v_batch_count,
      v_result->>'processed',
      v_result->>'success',
      v_result->>'errors',
      v_remaining - COALESCE((v_result->>'processed')::int, 0);

    -- Small pause between batches
    PERFORM pg_sleep(0.1);
  END LOOP;

  RAISE NOTICE 'Total processed across % batches: %', v_batch_count, v_total_processed;
END $$;

-- ============================================================
-- 5. Mark remaining unprocessed as complete (no email/phone/name)
-- ============================================================

\echo ''
\echo '5. Marking empty records as processed...'

UPDATE trapper.staged_records sr
SET is_processed = true,
    processed_at = NOW()
WHERE sr.source_system = 'shelterluv'
  AND sr.source_table = 'people'
  AND sr.is_processed = false
  AND (sr.payload->>'Primary Email' IS NULL OR TRIM(sr.payload->>'Primary Email') = '')
  AND (sr.payload->>'Primary Phone' IS NULL OR TRIM(sr.payload->>'Primary Phone') = '')
  AND (sr.payload->>'Name' IS NULL OR TRIM(sr.payload->>'Name') = '');

SELECT 'Empty records marked as processed' as action, COUNT(*) as count
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'people'
  AND is_processed = true
  AND processed_at > NOW() - INTERVAL '1 minute';

-- ============================================================
-- 6. Post-processing verification
-- ============================================================

\echo ''
\echo '6. Post-processing verification...'
\echo ''

-- Identifier coverage after
\echo 'Identifier coverage AFTER backfill:'
SELECT
  p.data_source::TEXT,
  COUNT(*) as total_people,
  COUNT(CASE WHEN EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id
  ) THEN 1 END) as with_identifiers,
  ROUND(100.0 * COUNT(CASE WHEN EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = p.person_id
  ) THEN 1 END) / NULLIF(COUNT(*), 0), 1) as pct_with_identifiers
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.data_source::TEXT = 'shelterluv'
GROUP BY p.data_source;

-- Staged records status
\echo ''
\echo 'Staged records final status:'
SELECT
  CASE WHEN is_processed THEN 'processed' ELSE 'unprocessed' END as status,
  COUNT(*) as count
FROM trapper.staged_records
WHERE source_system = 'shelterluv'
  AND source_table = 'people'
GROUP BY 1
ORDER BY 1;

-- Check data engine processor status (if table exists)
\echo ''
\echo 'Data Engine processor status:'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'data_engine_processors'
  ) THEN
    RAISE NOTICE 'data_engine_processors exists - checking status';
  ELSE
    RAISE NOTICE 'data_engine_processors table does not exist';
  END IF;
END $$;

-- ============================================================
-- 7. Summary
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'MIG_508 Complete!'
\echo '=============================================='
\echo ''
\echo 'Completed:'
\echo '  - Backfilled email identifiers for ShelterLuv people'
\echo '  - Backfilled phone identifiers for ShelterLuv people'
\echo '  - Processed unprocessed staged records through new processor'
\echo '  - Marked empty records as processed'
\echo ''
\echo 'Future ShelterLuv people imports will go through'
\echo 'process_shelterluv_person() for proper deduplication.'
\echo ''

-- Final stats
SELECT
  'Final Stats' as report,
  (SELECT COUNT(*) FROM trapper.sot_people WHERE data_source::TEXT = 'shelterluv' AND merged_into_person_id IS NULL) as active_people,
  (SELECT COUNT(*) FROM trapper.sot_people WHERE data_source::TEXT = 'shelterluv' AND merged_into_person_id IS NOT NULL) as merged_people,
  (SELECT COUNT(*) FROM trapper.person_identifiers WHERE source_system = 'shelterluv') as identifiers,
  (SELECT COUNT(*) FROM trapper.staged_records WHERE source_system = 'shelterluv' AND source_table = 'people' AND is_processed) as processed_records,
  (SELECT COUNT(*) FROM trapper.staged_records WHERE source_system = 'shelterluv' AND source_table = 'people' AND NOT is_processed) as unprocessed_records;

-- Record migration
SELECT trapper.record_migration(508, 'MIG_508__reprocess_shelterluv_people');
