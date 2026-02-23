-- MIG_2461: Recheck Monitoring View
--
-- DATA_GAP_052: Monitors for potential duplicate cats from recheck visits.
-- Detects patterns where staff enters microchip in Animal Name field for returning cats.
--
-- The ingest pipeline now handles this automatically (Step 1b), but this view
-- provides visibility into any cases that might slip through or need manual review.
--
-- Created: 2026-02-22

\echo ''
\echo '=============================================='
\echo '  MIG_2461: Recheck Monitoring View'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CREATE MONITORING VIEW
-- ============================================================================

\echo '1. Creating ops.v_potential_recheck_duplicates...'

CREATE OR REPLACE VIEW ops.v_potential_recheck_duplicates AS
WITH microchip_in_name AS (
    SELECT
        sr.id as staged_id,
        sr.payload->>'Number' as animal_number,
        sr.payload->>'Animal Name' as animal_name,
        sr.payload->>'Date' as appt_date,
        sr.payload->>'Microchip Number' as microchip_field,
        sr.created_at,
        'microchip_in_name' as detection_reason
    FROM ops.staged_records sr
    WHERE sr.source_table = 'cat_info'
      -- Animal Name is exactly 15 digits (microchip pattern)
      AND sr.payload->>'Animal Name' ~ '^[0-9]{15}$'
      -- No microchip in the proper field
      AND (sr.payload->>'Microchip Number' IS NULL OR TRIM(sr.payload->>'Microchip Number') = '')
),
-- Check if already handled
handled AS (
    SELECT DISTINCT ci.id_value as animal_number
    FROM sot.cat_identifiers ci
    WHERE ci.id_type = 'clinichq_animal_id'
),
-- Check if the embedded microchip exists as a cat
existing_cats AS (
    SELECT
        min.animal_number,
        min.animal_name as embedded_microchip,
        c.cat_id,
        c.name as cat_name,
        c.clinichq_animal_id as original_animal_id
    FROM microchip_in_name min
    JOIN sot.cat_identifiers ci ON ci.id_value = min.animal_name AND ci.id_type = 'microchip'
    JOIN sot.cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
)
SELECT
    min.animal_number,
    min.animal_name as embedded_microchip,
    min.appt_date,
    min.detection_reason,
    min.created_at as staged_at,
    ec.cat_id as existing_cat_id,
    ec.cat_name as existing_cat_name,
    ec.original_animal_id as existing_animal_id,
    CASE
        WHEN h.animal_number IS NOT NULL THEN 'handled'
        WHEN ec.cat_id IS NOT NULL THEN 'match_found'
        ELSE 'needs_review'
    END as status
FROM microchip_in_name min
LEFT JOIN handled h ON h.animal_number = min.animal_number
LEFT JOIN existing_cats ec ON ec.animal_number = min.animal_number
-- Only show unhandled cases that have a matching cat
WHERE h.animal_number IS NULL
  AND ec.cat_id IS NOT NULL
ORDER BY min.created_at DESC;

COMMENT ON VIEW ops.v_potential_recheck_duplicates IS
'DATA_GAP_052: Monitors staged records with microchip in Animal Name field (recheck pattern).
Shows cases that need linking to existing cats. Should typically be empty after ingest processing.';

-- ============================================================================
-- 2. CREATE SUMMARY VIEW
-- ============================================================================

\echo '2. Creating ops.v_recheck_duplicate_summary...'

CREATE OR REPLACE VIEW ops.v_recheck_duplicate_summary AS
SELECT
    status,
    COUNT(*) as count,
    MIN(staged_at) as oldest,
    MAX(staged_at) as newest
FROM ops.v_potential_recheck_duplicates
GROUP BY status;

COMMENT ON VIEW ops.v_recheck_duplicate_summary IS
'Summary of potential recheck duplicates by status. needs_review count should be 0.';

-- ============================================================================
-- 3. CREATE ALERT VIEW FOR DATA QUALITY
-- ============================================================================

\echo '3. Creating ops.v_unhandled_recheck_duplicates (alert view)...'

CREATE OR REPLACE VIEW ops.v_unhandled_recheck_duplicates AS
SELECT *
FROM ops.v_potential_recheck_duplicates
WHERE status = 'needs_review';

COMMENT ON VIEW ops.v_unhandled_recheck_duplicates IS
'Alert view: Shows recheck records that need manual intervention. Should be empty.';

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '4. Verification...'

-- Check current state
DO $$
DECLARE
    v_unhandled INT;
BEGIN
    SELECT COUNT(*) INTO v_unhandled
    FROM ops.v_unhandled_recheck_duplicates;

    IF v_unhandled > 0 THEN
        RAISE NOTICE 'Warning: % unhandled recheck duplicates detected', v_unhandled;
    ELSE
        RAISE NOTICE 'No unhandled recheck duplicates';
    END IF;
END $$;

-- Show summary
\echo ''
\echo 'Current recheck duplicate status:'
SELECT * FROM ops.v_recheck_duplicate_summary;

\echo ''
\echo '=============================================='
\echo '  MIG_2461 COMPLETE'
\echo '=============================================='
\echo ''
