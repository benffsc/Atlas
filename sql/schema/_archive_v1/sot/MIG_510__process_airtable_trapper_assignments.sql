\echo '=== MIG_510: Process Airtable Trapper Assignments ==='
\echo 'Links trappers to requests based on Airtable "Trappers Assigned" field'
\echo ''

-- ============================================================================
-- PROBLEM:
-- Airtable trapping_requests have "Trappers Assigned" field with array of
-- trapper record IDs like ["recoFhe736pyRLN22", "recEXhK4O5gAE61Q7"]
-- But request_trapper_assignments table is nearly empty (only 2 of 279 requests)
--
-- SOLUTION:
-- 1. Create mapping table from Airtable trapper record IDs to person_ids
-- 2. Process "Trappers Assigned" from staged_records into request_trapper_assignments
-- ============================================================================

-- ============================================================================
-- PART 1: Create/refresh trapper mapping by email
-- ============================================================================

\echo '1. Creating trapper mapping from Airtable record IDs to person_ids...'

-- Create temp table mapping airtable trapper record IDs to person_ids via email
CREATE TEMP TABLE tmp_trapper_mapping AS
SELECT DISTINCT ON (sr.source_row_id)
    sr.source_row_id as airtable_record_id,
    LOWER(TRIM(sr.payload->>'Email')) as email_norm,
    pi.person_id
FROM trapper.staged_records sr
JOIN trapper.person_identifiers pi
    ON pi.id_type = 'email'
    AND pi.id_value_norm = LOWER(TRIM(sr.payload->>'Email'))
JOIN trapper.sot_people sp
    ON sp.person_id = pi.person_id
    AND sp.merged_into_person_id IS NULL
WHERE sr.source_system = 'airtable'
  AND sr.source_table = 'trappers'
  AND sr.source_row_id IS NOT NULL
  AND sr.source_row_id != ''
  AND sr.payload->>'Email' IS NOT NULL
  AND TRIM(sr.payload->>'Email') != '';

SELECT 'Trappers mapped' as status, COUNT(*) as count FROM tmp_trapper_mapping;

-- ============================================================================
-- PART 2: Process function to parse and link trappers
-- ============================================================================

\echo ''
\echo '2. Creating/updating process function...'

CREATE OR REPLACE FUNCTION trapper.process_airtable_trapper_assignments(
    p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
    v_processed INT := 0;
    v_success INT := 0;
    v_errors INT := 0;
    v_request RECORD;
    v_trapper_id TEXT;
    v_trapper_person_id UUID;
    v_trappers_array JSONB;
    v_is_first BOOLEAN;
BEGIN
    -- Process each request with Trappers Assigned
    FOR v_request IN
        SELECT
            r.request_id,
            r.source_record_id,
            sr.payload->>'Trappers Assigned' as trappers_json
        FROM trapper.sot_requests r
        JOIN trapper.staged_records sr
            ON sr.source_row_id = r.source_record_id
            AND sr.source_system = 'airtable'
            AND sr.source_table = 'trapping_requests'
        WHERE r.source_system IN ('airtable', 'airtable_ffsc')
          AND sr.payload->>'Trappers Assigned' IS NOT NULL
          AND sr.payload->>'Trappers Assigned' != ''
          AND sr.payload->>'Trappers Assigned' != '[]'
          -- Skip if already has assignments
          AND NOT EXISTS (
              SELECT 1 FROM trapper.request_trapper_assignments rta
              WHERE rta.request_id = r.request_id
          )
        LIMIT p_batch_size
    LOOP
        v_processed := v_processed + 1;

        BEGIN
            -- Parse the trappers array
            v_trappers_array := v_request.trappers_json::JSONB;
            v_is_first := TRUE;

            -- Process each trapper in the array
            FOR v_trapper_id IN SELECT jsonb_array_elements_text(v_trappers_array)
            LOOP
                -- Look up person_id from our mapping
                SELECT person_id INTO v_trapper_person_id
                FROM tmp_trapper_mapping
                WHERE airtable_record_id = v_trapper_id;

                IF v_trapper_person_id IS NOT NULL THEN
                    -- Insert assignment
                    INSERT INTO trapper.request_trapper_assignments (
                        request_id,
                        trapper_person_id,
                        is_primary,
                        assigned_at,
                        source_system,
                        source_record_id,
                        assignment_reason
                    ) VALUES (
                        v_request.request_id,
                        v_trapper_person_id,
                        v_is_first,  -- First trapper is primary
                        NOW(),
                        'airtable',
                        v_trapper_id,
                        'Backfill from Airtable Trappers Assigned field'
                    )
                    ON CONFLICT DO NOTHING;

                    v_is_first := FALSE;
                END IF;
            END LOOP;

            v_success := v_success + 1;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE NOTICE 'Error processing request %: %', v_request.request_id, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'processed', v_processed,
        'success', v_success,
        'errors', v_errors
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_airtable_trapper_assignments IS
'Processes Airtable "Trappers Assigned" field into request_trapper_assignments table.';

-- ============================================================================
-- PART 3: Run the processor
-- ============================================================================

\echo ''
\echo '3. Processing trapper assignments...'

DO $$
DECLARE
    v_result JSONB;
    v_remaining INT;
    v_batch INT := 0;
BEGIN
    LOOP
        v_result := trapper.process_airtable_trapper_assignments(100);
        v_batch := v_batch + 1;

        RAISE NOTICE 'Batch %: %', v_batch, v_result;

        EXIT WHEN (v_result->>'processed')::INT = 0 OR v_batch >= 10;
    END LOOP;
END $$;

-- ============================================================================
-- PART 4: Verification
-- ============================================================================

\echo ''
\echo '4. Verification...'

SELECT
    'Requests with trapper assignments' as metric,
    COUNT(DISTINCT request_id) as count
FROM trapper.request_trapper_assignments
UNION ALL
SELECT
    'Total trapper assignments',
    COUNT(*)
FROM trapper.request_trapper_assignments
UNION ALL
SELECT
    'Requests still without assignments',
    COUNT(*)
FROM trapper.sot_requests r
WHERE r.source_system IN ('airtable', 'airtable_ffsc')
  AND NOT EXISTS (
      SELECT 1 FROM trapper.request_trapper_assignments rta
      WHERE rta.request_id = r.request_id
  );

-- Check Claire specifically
\echo ''
\echo 'Claire Simpson trapper assignments:'
SELECT
    r.source_record_id,
    rta.is_primary,
    rta.assigned_at::date
FROM trapper.request_trapper_assignments rta
JOIN trapper.sot_requests r ON r.request_id = rta.request_id
WHERE rta.trapper_person_id = '7a9a8d77-a44f-4459-8286-645979838d00';

-- Clean up temp table
DROP TABLE IF EXISTS tmp_trapper_mapping;

\echo ''
\echo '=== MIG_510 Complete ==='
\echo ''

SELECT trapper.record_migration(510, 'MIG_510__process_airtable_trapper_assignments');
