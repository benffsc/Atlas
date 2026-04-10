-- MIG_3072: Evidence pipeline data quality checks
--
-- Adds 5 checks to ops.data_quality_checks for CDS-AI evidence monitoring.
-- These catch silent failures: bad OCR, sequence gaps, orphan photos,
-- unresolved critical audits, unmatched known chips.
--
-- Depends on: MIG_3050 (data_quality_framework), MIG_3070 (evidence_stream_segments),
--             MIG_3071 (evidence_audit_results)
--
-- Linear: FFS-1221
-- Created: 2026-04-09

\echo ''
\echo '=============================================='
\echo '  MIG_3072: Evidence Pipeline DQ Checks'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================
-- Add a new category for evidence checks
-- ============================================================

-- Widen the category constraint to include 'evidence'
ALTER TABLE ops.data_quality_checks
  DROP CONSTRAINT IF EXISTS data_quality_checks_category_check;

ALTER TABLE ops.data_quality_checks
  ADD CONSTRAINT data_quality_checks_category_check
  CHECK (category IN ('structural', 'referential', 'coverage', 'drift', 'freshness', 'evidence'));

\echo 'Added evidence category to data_quality_checks'

-- ============================================================
-- Insert 5 evidence checks
-- ============================================================

INSERT INTO ops.data_quality_checks (
  check_id, name, description, category, severity, sql_definition, expected_max, drilldown_sql
) VALUES

-- 1. Orphan photos: classified as cat_photo but not in any chunk
(
  'evidence_orphan_photos',
  'Orphan cat photos (no chunk)',
  'Classified cat photos with no chunk_id. These are photos between clinic days or at stream boundaries that no waiver claimed. Small numbers are expected.',
  'evidence', 'warning',
  $sql$SELECT COUNT(*)::INT FROM ops.evidence_stream_segments
       WHERE segment_role = 'cat_photo'
         AND chunk_id IS NULL
         AND assignment_status NOT IN ('rejected')$sql$,
  10,
  $sql$SELECT segment_id, clinic_date, sequence_number, original_filename
       FROM ops.evidence_stream_segments s
       LEFT JOIN ops.request_media rm ON rm.media_id = s.source_ref_id AND s.source_kind = 'request_media'
       WHERE s.segment_role = 'cat_photo'
         AND s.chunk_id IS NULL
         AND s.assignment_status NOT IN ('rejected')
       ORDER BY s.clinic_date, s.sequence_number$sql$
),

-- 2. Low confidence classifications
(
  'evidence_low_confidence',
  'Low-confidence classifications (<0.5)',
  'Segments where the classifier had low confidence. May indicate poor photo quality or unusual content.',
  'evidence', 'info',
  $sql$SELECT COUNT(*)::INT FROM ops.evidence_stream_segments
       WHERE segment_role IS NOT NULL
         AND confidence IS NOT NULL
         AND confidence < 0.5$sql$,
  20,
  $sql$SELECT segment_id, clinic_date, segment_role, confidence, sequence_number
       FROM ops.evidence_stream_segments
       WHERE segment_role IS NOT NULL
         AND confidence IS NOT NULL
         AND confidence < 0.5
       ORDER BY confidence ASC$sql$
),

-- 3. Sequence gaps within batches
(
  'evidence_sequence_gaps',
  'Sequence gaps in evidence batches',
  'Batches where max(sequence_number) - min(sequence_number) + 1 != count. Indicates dropped photos during ingest.',
  'evidence', 'warning',
  $sql$SELECT COUNT(*)::INT FROM (
         SELECT ingest_batch_id,
                MAX(sequence_number) - MIN(sequence_number) + 1 AS expected,
                COUNT(*) AS actual
         FROM ops.evidence_stream_segments
         WHERE source_kind = 'request_media'
         GROUP BY ingest_batch_id
         HAVING MAX(sequence_number) - MIN(sequence_number) + 1 != COUNT(*)
       ) gaps$sql$,
  0,
  $sql$SELECT ingest_batch_id, clinic_date,
              MIN(sequence_number) AS min_seq, MAX(sequence_number) AS max_seq,
              COUNT(*) AS actual_count,
              MAX(sequence_number) - MIN(sequence_number) + 1 AS expected_count
       FROM ops.evidence_stream_segments
       WHERE source_kind = 'request_media'
       GROUP BY ingest_batch_id, clinic_date
       HAVING MAX(sequence_number) - MIN(sequence_number) + 1 != COUNT(*)
       ORDER BY clinic_date$sql$
),

-- 4. Unresolved critical audit results
(
  'evidence_unresolved_audits',
  'Unresolved critical audit results',
  'Critical waiver audit findings (chip mismatches) that have not been resolved by staff. These indicate definitive errors.',
  'evidence', 'critical',
  $sql$SELECT COUNT(*)::INT FROM ops.evidence_audit_results
       WHERE severity = 'critical'
         AND resolved_at IS NULL$sql$,
  0,
  $sql$SELECT audit_id, clinic_date, check_type, expected_value, actual_value, details
       FROM ops.evidence_audit_results
       WHERE severity = 'critical'
         AND resolved_at IS NULL
       ORDER BY clinic_date DESC$sql$
),

-- 5. Unmatched segments with known chips
(
  'evidence_unmatched_known_chips',
  'Unmatched waivers with known microchips',
  'Waiver photos where OCR extracted a microchip that exists in sot.cat_identifiers, but the chunk has no match. This means the matching pipeline missed a definitive link.',
  'evidence', 'warning',
  $sql$SELECT COUNT(*)::INT FROM ops.evidence_stream_segments s
       WHERE s.segment_role = 'waiver_photo'
         AND s.matched_cat_id IS NULL
         AND s.extracted_data IS NOT NULL
         AND (
           EXISTS (
             SELECT 1 FROM sot.cat_identifiers ci
             WHERE ci.id_type = 'microchip'
               AND ci.id_value = s.extracted_data->>'microchip_number'
               AND s.extracted_data->>'microchip_number' IS NOT NULL
           )
           OR EXISTS (
             SELECT 1 FROM sot.cat_identifiers ci
             WHERE ci.id_type = 'microchip'
               AND RIGHT(ci.id_value, 4) = s.extracted_data->>'microchip_last4'
               AND s.extracted_data->>'microchip_last4' IS NOT NULL
           )
         )$sql$,
  0,
  $sql$SELECT s.segment_id, s.clinic_date, s.sequence_number,
              s.extracted_data->>'microchip_number' AS waiver_chip,
              s.extracted_data->>'microchip_last4' AS waiver_chip_last4,
              s.extracted_data->>'owner_last_name' AS waiver_owner
       FROM ops.evidence_stream_segments s
       WHERE s.segment_role = 'waiver_photo'
         AND s.matched_cat_id IS NULL
         AND s.extracted_data IS NOT NULL
         AND (
           EXISTS (
             SELECT 1 FROM sot.cat_identifiers ci
             WHERE ci.id_type = 'microchip'
               AND ci.id_value = s.extracted_data->>'microchip_number'
               AND s.extracted_data->>'microchip_number' IS NOT NULL
           )
           OR EXISTS (
             SELECT 1 FROM sot.cat_identifiers ci
             WHERE ci.id_type = 'microchip'
               AND RIGHT(ci.id_value, 4) = s.extracted_data->>'microchip_last4'
               AND s.extracted_data->>'microchip_last4' IS NOT NULL
           )
         )
       ORDER BY s.clinic_date$sql$
)

ON CONFLICT (check_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  severity = EXCLUDED.severity,
  sql_definition = EXCLUDED.sql_definition,
  expected_max = EXCLUDED.expected_max,
  drilldown_sql = EXCLUDED.drilldown_sql,
  updated_at = NOW();

-- ============================================================
-- Verify
-- ============================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM ops.data_quality_checks
  WHERE category = 'evidence';

  RAISE NOTICE 'Evidence DQ checks registered: %', v_count;
END $$;

COMMIT;

\echo ''
\echo 'MIG_3072 complete.'
\echo 'Added 5 evidence DQ checks to ops.data_quality_checks:'
\echo '  - evidence_orphan_photos (warning)'
\echo '  - evidence_low_confidence (info)'
\echo '  - evidence_sequence_gaps (warning)'
\echo '  - evidence_unresolved_audits (critical)'
\echo '  - evidence_unmatched_known_chips (warning)'
\echo ''
