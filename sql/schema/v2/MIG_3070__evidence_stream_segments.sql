-- MIG_3070: ops.evidence_stream_segments — CDS-AI foundation
--
-- Unified evidence pool for CDS-AI. Every ordered piece of evidence from
-- every source (phone photos, SharePoint waivers, future feeds) becomes a
-- row with a stable sequence_number. The reconciler walks the stream,
-- classifies segments, chunks by waiver boundaries, and writes back
-- matched cat_id with provenance.
--
-- Linear: FFS-1197
-- Created: 2026-04-09

\echo ''
\echo '=============================================='
\echo '  MIG_3070: ops.evidence_stream_segments'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================
-- 1. Core table
-- ============================================================

CREATE TABLE IF NOT EXISTS ops.evidence_stream_segments (
  segment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_batch_id   UUID NOT NULL,
  clinic_date       DATE NOT NULL,

  -- Polymorphic FK: source_kind tells us which table source_ref_id points to
  source_kind       TEXT NOT NULL
    CHECK (source_kind IN ('request_media', 'waiver_scan')),
  source_ref_id     UUID NOT NULL,

  -- Immutable capture order within one ingest batch
  sequence_number   INT NOT NULL,

  -- Set by the classifier (FFS-1089). NULL on ingest.
  segment_role      TEXT
    CHECK (segment_role IS NULL OR segment_role IN (
      'cat_photo', 'waiver_photo', 'microchip_barcode', 'discard', 'unknown'
    )),

  -- Set by the chunker (FFS-1089). All segments in one cat-chunk share this.
  chunk_id          UUID,

  -- Pipeline status
  assignment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (assignment_status IN (
      'pending', 'classified', 'chunked', 'assigned', 'ambiguous', 'rejected'
    )),

  -- Set by the matcher (FFS-1090)
  confidence        NUMERIC,
  matched_cat_id    UUID REFERENCES sot.cats(cat_id),
  matched_via       TEXT,
  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each source row appears in the evidence pool exactly once
  UNIQUE (source_kind, source_ref_id),

  -- Sequence numbers are contiguous and unique within a batch
  UNIQUE (ingest_batch_id, sequence_number)
);

COMMENT ON TABLE ops.evidence_stream_segments IS
'CDS-AI evidence pool. Each row is one ordered piece of evidence from any source. '
'The reconciler walks segments by (ingest_batch_id, sequence_number) to classify, '
'chunk by waiver boundaries, and assign cat_id with provenance. MIG_3070.';

-- ============================================================
-- 2. Indexes
-- ============================================================

-- Primary query path: "give me all pending segments for a date"
CREATE INDEX idx_ess_clinic_date_status
  ON ops.evidence_stream_segments (clinic_date, assignment_status);

-- Chunk lookups: "give me all segments in this chunk"
CREATE INDEX idx_ess_chunk
  ON ops.evidence_stream_segments (chunk_id)
  WHERE chunk_id IS NOT NULL;

-- Batch sequence walk: "give me all segments in order for this batch"
CREATE INDEX idx_ess_batch_seq
  ON ops.evidence_stream_segments (ingest_batch_id, sequence_number);

-- Cat lookups: "what evidence do we have for this cat?"
CREATE INDEX idx_ess_cat
  ON ops.evidence_stream_segments (matched_cat_id)
  WHERE matched_cat_id IS NOT NULL;

-- ============================================================
-- 3. Helper functions
-- ============================================================

-- Claim the next sequence slot in a batch (used by ingest scripts)
CREATE OR REPLACE FUNCTION ops.next_evidence_segment_sequence(p_batch_id UUID)
RETURNS INT AS $$
  SELECT COALESCE(MAX(sequence_number), 0) + 1
  FROM ops.evidence_stream_segments
  WHERE ingest_batch_id = p_batch_id;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION ops.next_evidence_segment_sequence(UUID) IS
'Returns the next available sequence_number for a given ingest batch. Used by '
'ingest scripts to claim slots in order. MIG_3070.';


-- Write-back: assign a cat_id to every segment in a chunk, with provenance
CREATE OR REPLACE FUNCTION ops.assign_evidence_chunk_cat(
  p_chunk_id     UUID,
  p_cat_id       UUID,
  p_matched_via  TEXT,
  p_confidence   NUMERIC
) RETURNS INT AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE ops.evidence_stream_segments
  SET
    matched_cat_id    = p_cat_id,
    matched_via       = p_matched_via,
    confidence        = p_confidence,
    assignment_status = CASE
      WHEN p_confidence >= 0.9 THEN 'assigned'
      WHEN p_confidence >= 0.6 THEN 'ambiguous'
      ELSE 'pending'
    END,
    updated_at = NOW()
  WHERE chunk_id = p_chunk_id
    AND (matched_cat_id IS NULL OR matched_via != 'manual');
    -- Never overwrite manual assignments (MIG_3048 provenance)

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.assign_evidence_chunk_cat(UUID, UUID, TEXT, NUMERIC) IS
'Assigns a cat_id to all segments in a chunk. Respects manual overrides — segments '
'with matched_via=''manual'' are never overwritten. Returns the count of updated rows. MIG_3070.';


-- Convenience: get the full evidence stream for a clinic date, in order
CREATE OR REPLACE FUNCTION ops.get_evidence_stream(p_clinic_date DATE)
RETURNS TABLE (
  segment_id        UUID,
  ingest_batch_id   UUID,
  source_kind       TEXT,
  source_ref_id     UUID,
  sequence_number   INT,
  segment_role      TEXT,
  chunk_id          UUID,
  assignment_status TEXT,
  confidence        NUMERIC,
  matched_cat_id    UUID,
  matched_via       TEXT,
  notes             TEXT
) AS $$
  SELECT
    s.segment_id, s.ingest_batch_id, s.source_kind, s.source_ref_id,
    s.sequence_number, s.segment_role, s.chunk_id, s.assignment_status,
    s.confidence, s.matched_cat_id, s.matched_via, s.notes
  FROM ops.evidence_stream_segments s
  WHERE s.clinic_date = p_clinic_date
  ORDER BY s.ingest_batch_id, s.sequence_number;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION ops.get_evidence_stream(DATE) IS
'Returns all evidence segments for a clinic date, ordered by batch and sequence. MIG_3070.';

-- ============================================================
-- 4. Backfill SharePoint waivers into evidence pool
-- ============================================================

\echo 'Backfilling waiver_scans into evidence_stream_segments...'

-- Each clinic_date gets a synthetic batch_id derived from the date
-- so waivers are grouped per-date in the evidence pool.
-- Using md5-based UUID generation for deterministic batch IDs.
INSERT INTO ops.evidence_stream_segments (
  ingest_batch_id,
  clinic_date,
  source_kind,
  source_ref_id,
  sequence_number,
  segment_role,
  assignment_status,
  matched_cat_id,
  matched_via,
  notes
)
SELECT
  -- Deterministic batch UUID per date: md5 of 'waiver_backfill_' || date
  md5('waiver_backfill_' || w.parsed_date::TEXT)::UUID AS ingest_batch_id,
  w.parsed_date AS clinic_date,
  'waiver_scan' AS source_kind,
  w.waiver_id AS source_ref_id,
  ROW_NUMBER() OVER (PARTITION BY w.parsed_date ORDER BY w.created_at)::INT AS sequence_number,
  'waiver_photo' AS segment_role,
  CASE
    WHEN w.matched_cat_id IS NOT NULL THEN 'assigned'
    ELSE 'pending'
  END AS assignment_status,
  w.matched_cat_id,
  CASE
    WHEN w.matched_cat_id IS NOT NULL THEN 'sharepoint_last4_chip'
    ELSE NULL
  END AS matched_via,
  'Backfilled from ops.waiver_scans by MIG_3070' AS notes
FROM ops.waiver_scans w
WHERE w.parsed_date IS NOT NULL
ON CONFLICT (source_kind, source_ref_id) DO NOTHING;

-- ============================================================
-- 5. Verify
-- ============================================================

DO $$
DECLARE
  v_waiver_count INT;
  v_segment_count INT;
BEGIN
  SELECT COUNT(*) INTO v_waiver_count
  FROM ops.waiver_scans WHERE parsed_date IS NOT NULL;

  SELECT COUNT(*) INTO v_segment_count
  FROM ops.evidence_stream_segments WHERE source_kind = 'waiver_scan';

  RAISE NOTICE 'Waiver scans with parsed_date: %', v_waiver_count;
  RAISE NOTICE 'Evidence segments (waiver_scan): %', v_segment_count;

  IF v_segment_count < v_waiver_count THEN
    RAISE WARNING 'Some waivers were not backfilled (likely duplicate source_ref_id). Expected %, got %',
      v_waiver_count, v_segment_count;
  END IF;
END $$;

COMMIT;

\echo ''
\echo 'MIG_3070 complete.'
\echo ''
\echo 'New table:     ops.evidence_stream_segments'
\echo 'New functions:  ops.next_evidence_segment_sequence(batch_id)'
\echo '                ops.assign_evidence_chunk_cat(chunk_id, cat_id, via, confidence)'
\echo '                ops.get_evidence_stream(clinic_date)'
\echo ''
\echo 'Next: run evidence-ingest-photos.ts to stage Desktop photo folders.'
\echo ''
