\echo '=== MIG_324: Data Engine Full Backfill ==='
\echo 'Processes all existing staged records through Data Engine for audit trail'
\echo ''

-- ============================================================================
-- PROBLEM
-- ============================================================================
-- 99.99% of records (47,000+) bypassed the Data Engine because they were
-- ingested before the Data Engine was integrated. This means:
-- - No audit trail of identity decisions
-- - No household detection
-- - No soft blacklist population
-- - No review queue items for uncertain matches
--
-- SOLUTION
-- Process all unprocessed staged records through data_engine_process_batch()
-- in controlled batches, then run household detection and soft blacklist.
-- ============================================================================

-- Step 1: Count unprocessed records by source
\echo 'Step 1: Counting unprocessed staged records...'

SELECT
    source_system,
    source_table,
    COUNT(*) as unprocessed_count
FROM trapper.staged_records sr
LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.staged_record_id
WHERE d.decision_id IS NULL
  AND (
      sr.payload->>'Owner Email' IS NOT NULL OR
      sr.payload->>'Owner Phone' IS NOT NULL OR
      sr.payload->>'email' IS NOT NULL OR
      sr.payload->>'phone' IS NOT NULL OR
      sr.payload->>'Email' IS NOT NULL OR
      sr.payload->>'Phone' IS NOT NULL
  )
GROUP BY source_system, source_table
ORDER BY unprocessed_count DESC;

-- Step 2: Create backfill orchestration function
\echo ''
\echo 'Step 2: Creating backfill orchestration function...'

CREATE OR REPLACE FUNCTION trapper.data_engine_full_backfill(
    p_batch_size INT DEFAULT 500,
    p_max_batches INT DEFAULT 200,
    p_source_system TEXT DEFAULT NULL
)
RETURNS TABLE (
    source_system TEXT,
    total_processed INT,
    auto_matched INT,
    new_entities INT,
    reviews_created INT,
    household_members INT,
    rejected INT,
    errors INT,
    batches_run INT,
    duration_seconds NUMERIC
) AS $$
DECLARE
    v_batch_result JSONB;
    v_batch_count INT := 0;
    v_total_processed INT := 0;
    v_auto_matched INT := 0;
    v_new_entities INT := 0;
    v_reviews_created INT := 0;
    v_household_members INT := 0;
    v_rejected INT := 0;
    v_errors INT := 0;
    v_source TEXT;
    v_sources TEXT[];
    v_start_time TIMESTAMPTZ;
BEGIN
    v_start_time := clock_timestamp();

    -- Determine which sources to process
    IF p_source_system IS NOT NULL THEN
        v_sources := ARRAY[p_source_system];
    ELSE
        SELECT ARRAY_AGG(DISTINCT sr.source_system) INTO v_sources
        FROM trapper.staged_records sr
        LEFT JOIN trapper.data_engine_match_decisions d ON d.staged_record_id = sr.staged_record_id
        WHERE d.decision_id IS NULL
          AND (
              sr.payload->>'Owner Email' IS NOT NULL OR
              sr.payload->>'Owner Phone' IS NOT NULL OR
              sr.payload->>'email' IS NOT NULL OR
              sr.payload->>'phone' IS NOT NULL
          );
    END IF;

    -- Process each source
    FOREACH v_source IN ARRAY v_sources
    LOOP
        v_batch_count := 0;

        LOOP
            -- Run a batch
            SELECT trapper.data_engine_process_batch(v_source, NULL, p_batch_size, NULL)
            INTO v_batch_result;

            -- Accumulate stats
            v_total_processed := v_total_processed + COALESCE((v_batch_result->>'processed')::INT, 0);
            v_auto_matched := v_auto_matched + COALESCE((v_batch_result->>'auto_matched')::INT, 0);
            v_new_entities := v_new_entities + COALESCE((v_batch_result->>'new_entities')::INT, 0);
            v_reviews_created := v_reviews_created + COALESCE((v_batch_result->>'reviews_created')::INT, 0);
            v_household_members := v_household_members + COALESCE((v_batch_result->>'household_members')::INT, 0);
            v_rejected := v_rejected + COALESCE((v_batch_result->>'rejected')::INT, 0);
            v_errors := v_errors + COALESCE((v_batch_result->>'errors')::INT, 0);

            v_batch_count := v_batch_count + 1;

            -- Exit conditions
            EXIT WHEN COALESCE((v_batch_result->>'processed')::INT, 0) < p_batch_size;
            EXIT WHEN v_batch_count >= p_max_batches;
        END LOOP;

        RAISE NOTICE 'Processed % records from % in % batches', v_total_processed, v_source, v_batch_count;
    END LOOP;

    RETURN QUERY SELECT
        COALESCE(p_source_system, 'all')::TEXT,
        v_total_processed,
        v_auto_matched,
        v_new_entities,
        v_reviews_created,
        v_household_members,
        v_rejected,
        v_errors,
        v_batch_count,
        ROUND(EXTRACT(EPOCH FROM clock_timestamp() - v_start_time)::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_full_backfill IS
'Processes all unprocessed staged records through the Data Engine in batches.
Creates full audit trail of identity decisions.';

\echo 'Created data_engine_full_backfill function'

-- Step 3: Process ClinicHQ records (largest source - ~47K records)
\echo ''
\echo 'Step 3: Processing ClinicHQ records (this may take several minutes)...'

SELECT * FROM trapper.data_engine_full_backfill(500, 200, 'clinichq');

-- Step 4: Process Airtable records
\echo ''
\echo 'Step 4: Processing Airtable records...'

SELECT * FROM trapper.data_engine_full_backfill(500, 100, 'airtable');

-- Step 5: Process web_intake records
\echo ''
\echo 'Step 5: Processing web_intake records...'

SELECT * FROM trapper.data_engine_full_backfill(500, 50, 'web_intake');

-- Step 6: Build households from shared addresses
\echo ''
\echo 'Step 6: Building households from existing data...'

SELECT * FROM trapper.data_engine_build_households();

-- Step 7: Populate soft blacklist
\echo ''
\echo 'Step 7: Populating soft blacklist...'

SELECT * FROM trapper.data_engine_populate_soft_blacklist();

-- Step 8: Run entity linking to create cat-place relationships
\echo ''
\echo 'Step 8: Running entity linking for cat-place relationships...'

SELECT * FROM trapper.run_all_entity_linking();

-- Step 9: Log the backfill operation
\echo ''
\echo 'Step 9: Logging backfill operation...'

INSERT INTO trapper.data_changes (
    operation, record_type, record_count, notes, changed_by
)
SELECT
    'data_engine_backfill',
    'staged_records',
    COUNT(*),
    'MIG_324: Full Data Engine backfill completed',
    'migration'
FROM trapper.data_engine_match_decisions
WHERE processed_at > NOW() - INTERVAL '1 hour';

-- Step 10: Summary statistics
\echo ''
\echo '=== Backfill Summary ==='

SELECT
    'Total decisions' as metric,
    COUNT(*)::TEXT as value
FROM trapper.data_engine_match_decisions

UNION ALL

SELECT
    'Auto-matched',
    COUNT(*)::TEXT
FROM trapper.data_engine_match_decisions
WHERE decision_type = 'auto_match'

UNION ALL

SELECT
    'New entities created',
    COUNT(*)::TEXT
FROM trapper.data_engine_match_decisions
WHERE decision_type = 'new_entity'

UNION ALL

SELECT
    'Pending reviews',
    COUNT(*)::TEXT
FROM trapper.data_engine_match_decisions
WHERE review_status = 'pending'

UNION ALL

SELECT
    'Household members',
    COUNT(*)::TEXT
FROM trapper.data_engine_match_decisions
WHERE decision_type = 'household_member'

UNION ALL

SELECT
    'Rejected (internal/invalid)',
    COUNT(*)::TEXT
FROM trapper.data_engine_match_decisions
WHERE decision_type = 'rejected';

\echo ''
\echo 'Household coverage:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) as total_people,
    (SELECT COUNT(DISTINCT hm.person_id) FROM trapper.household_members hm WHERE hm.valid_to IS NULL) as people_in_households,
    ROUND(100.0 *
        (SELECT COUNT(DISTINCT hm.person_id) FROM trapper.household_members hm WHERE hm.valid_to IS NULL) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL), 0), 1
    ) as household_coverage_pct;

\echo ''
\echo 'Cat-place coverage:'
SELECT
    (SELECT COUNT(*) FROM trapper.sot_cats WHERE merged_into_cat_id IS NULL) as total_cats,
    (SELECT COUNT(DISTINCT cpr.cat_id)
     FROM trapper.cat_place_relationships cpr
     JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
     WHERE c.merged_into_cat_id IS NULL) as cats_with_places,
    ROUND(100.0 *
        (SELECT COUNT(DISTINCT cpr.cat_id)
         FROM trapper.cat_place_relationships cpr
         JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
         WHERE c.merged_into_cat_id IS NULL) /
        NULLIF((SELECT COUNT(*) FROM trapper.sot_cats WHERE merged_into_cat_id IS NULL), 0), 1
    ) as cat_place_coverage_pct;

\echo ''
\echo '=== MIG_324 Complete ==='
\echo 'Full Data Engine backfill completed:'
\echo '  - All staged records processed with audit trail'
\echo '  - Households created from shared addresses'
\echo '  - Soft blacklist populated'
\echo '  - Entity linking refreshed'
\echo ''
\echo 'Next steps:'
\echo '  - Review pending matches: SELECT * FROM trapper.data_engine_match_decisions WHERE review_status = ''pending'';'
\echo '  - Check Data Engine health: SELECT * FROM trapper.v_data_engine_health;'
\echo ''
