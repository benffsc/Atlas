-- MIG_3071: ops.evidence_audit_results — Waiver cross-reference audit
--
-- Catches staff assignment errors by comparing waiver-extracted data
-- against assigned cat attributes across multiple independent signals.
-- Append-only, date-scoped, resolvable.
--
-- Linear: FFS-1220
-- Created: 2026-04-09

\echo ''
\echo '=============================================='
\echo '  MIG_3071: ops.evidence_audit_results'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================
-- 0. Ensure extracted_data column exists on evidence_stream_segments
--    (was added ad-hoc to prod, not in MIG_3070)
-- ============================================================

ALTER TABLE ops.evidence_stream_segments
  ADD COLUMN IF NOT EXISTS extracted_data JSONB;

COMMENT ON COLUMN ops.evidence_stream_segments.extracted_data IS
'Classifier-extracted structured fields (waiver OCR, barcode data). Set by CDS-AI classify stage.';

-- ============================================================
-- 1. Audit results table
-- ============================================================

CREATE TABLE IF NOT EXISTS ops.evidence_audit_results (
  audit_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_date       DATE NOT NULL,

  -- What was checked
  chunk_id          UUID,
  segment_id        UUID REFERENCES ops.evidence_stream_segments(segment_id),
  check_type        TEXT NOT NULL
    CHECK (check_type IN (
      'chip_mismatch',        -- waiver chip ≠ assigned cat chip (Critical)
      'date_mismatch',        -- waiver date ≠ clinic_date (Warning)
      'source_disagreement',  -- SharePoint vs photo cat_id disagree (Warning)
      'owner_mismatch'        -- owner name <20% similarity (Info)
    )),

  -- Severity for filtering/alerting
  severity          TEXT NOT NULL
    CHECK (severity IN ('critical', 'warning', 'info')),

  -- What we found
  expected_value    TEXT,         -- what the waiver says
  actual_value      TEXT,         -- what the assigned cat has
  details           JSONB,        -- full context for debugging

  -- Resolution
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID,         -- user who resolved
  resolution_note   TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.evidence_audit_results IS
'CDS-AI waiver cross-reference audit results. Catches errors where waiver data '
'disagrees with assigned cat attributes. Append-only per audit run, resolvable '
'by staff. MIG_3071.';

-- ============================================================
-- 2. Indexes
-- ============================================================

-- Primary query: unresolved audits for a date
CREATE INDEX idx_ear_date_unresolved
  ON ops.evidence_audit_results (clinic_date, severity)
  WHERE resolved_at IS NULL;

-- Chunk lookup
CREATE INDEX idx_ear_chunk
  ON ops.evidence_audit_results (chunk_id)
  WHERE chunk_id IS NOT NULL;

-- ============================================================
-- 3. Verify
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'MIG_3071: ops.evidence_audit_results created';

  -- Verify extracted_data column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ops'
      AND table_name = 'evidence_stream_segments'
      AND column_name = 'extracted_data'
  ) THEN
    RAISE NOTICE 'extracted_data column confirmed on evidence_stream_segments';
  ELSE
    RAISE WARNING 'extracted_data column NOT found — this should not happen';
  END IF;
END $$;

COMMIT;

\echo ''
\echo 'MIG_3071 complete.'
\echo 'New table: ops.evidence_audit_results'
\echo 'Added column: ops.evidence_stream_segments.extracted_data (IF NOT EXISTS)'
\echo ''
