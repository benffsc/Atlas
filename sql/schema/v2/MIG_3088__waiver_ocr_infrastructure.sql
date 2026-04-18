-- MIG_3088: Waiver OCR Infrastructure — Ground Truth Pipeline
--
-- Part of FFS-1287 (CDS V2: Waiver OCR Ground Truth Pipeline)
--
-- Problem: 626 SharePoint waiver PDFs have microchip (from filename) but zero
-- clinic numbers extracted. The clinic number IS on the physical form but was
-- never OCR'd. This is the missing link for deterministic CDS matching.
--
-- Solution:
--   1. Add 'waiver_ocr' to clinic_day_number_source enum
--   2. Add denormalized OCR columns on waiver_scans (queryable + indexed)
--   3. Update set_clinic_day_number() with priority-aware logic
--
-- Depends on: MIG_3040 (waiver_scans table), MIG_3052 (set_clinic_day_number)
--
-- Created: 2026-04-18

\echo ''
\echo '=============================================='
\echo '  MIG_3088: Waiver OCR Infrastructure'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Add 'waiver_ocr' to clinic_day_number_source enum
-- ============================================================================

\echo '1. Adding waiver_ocr to clinic_day_number_source enum...'

-- ALTER TYPE ... ADD VALUE cannot run inside a transaction in Postgres < 16.
-- We commit the current txn, add the value, then re-open.
COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'ops.clinic_day_number_source'::regtype
      AND enumlabel = 'waiver_ocr'
  ) THEN
    ALTER TYPE ops.clinic_day_number_source ADD VALUE 'waiver_ocr' AFTER 'manual';
    RAISE NOTICE '   Added waiver_ocr to ops.clinic_day_number_source';
  ELSE
    RAISE NOTICE '   waiver_ocr already exists in ops.clinic_day_number_source';
  END IF;
END;
$$;

BEGIN;

-- ============================================================================
-- 2. Denormalized OCR columns on waiver_scans
-- ============================================================================

\echo ''
\echo '2. Adding OCR columns to ops.waiver_scans...'

ALTER TABLE ops.waiver_scans
  ADD COLUMN IF NOT EXISTS ocr_clinic_number INTEGER,
  ADD COLUMN IF NOT EXISTS ocr_microchip TEXT,
  ADD COLUMN IF NOT EXISTS ocr_microchip_last4 TEXT,
  ADD COLUMN IF NOT EXISTS ocr_cat_name TEXT,
  ADD COLUMN IF NOT EXISTS ocr_owner_last_name TEXT,
  ADD COLUMN IF NOT EXISTS ocr_sex TEXT,
  ADD COLUMN IF NOT EXISTS ocr_weight_lbs NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS ocr_date TEXT,
  ADD COLUMN IF NOT EXISTS ocr_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_model TEXT;

COMMENT ON COLUMN ops.waiver_scans.ocr_clinic_number IS 'Clinic day number extracted via OCR (big handwritten/stamped number, top-right of waiver)';
COMMENT ON COLUMN ops.waiver_scans.ocr_microchip IS 'Full microchip number extracted via OCR (PetLink sticker or handwritten)';
COMMENT ON COLUMN ops.waiver_scans.ocr_microchip_last4 IS 'Last 4 digits of OCR microchip (for cross-check with filename)';
COMMENT ON COLUMN ops.waiver_scans.ocr_model IS 'AI model used for OCR extraction (e.g. claude-haiku-4-5-20251001)';

-- ============================================================================
-- 3. Indexes for matching
-- ============================================================================

\echo ''
\echo '3. Creating OCR indexes...'

CREATE INDEX IF NOT EXISTS idx_waiver_scans_ocr_chip
  ON ops.waiver_scans(ocr_microchip)
  WHERE ocr_microchip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_scans_ocr_cdn
  ON ops.waiver_scans(ocr_clinic_number)
  WHERE ocr_clinic_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_scans_ocr_status
  ON ops.waiver_scans(ocr_status)
  WHERE ocr_status = 'pending';

-- ============================================================================
-- 4. Update set_clinic_day_number with source priority
-- ============================================================================
-- Priority: manual(100) > waiver_ocr(80) > master_list(60) > cds_propagation(40) > clinichq_ingest(30) > legacy_v1(10)
-- waiver_ocr CAN overwrite master_list (higher signal quality)
-- waiver_ocr CANNOT overwrite manual (sacred)

\echo ''
\echo '4. Updating ops.set_clinic_day_number with priority logic...'

CREATE OR REPLACE FUNCTION ops.cdn_source_priority(
  p_source ops.clinic_day_number_source
) RETURNS INTEGER AS $$
BEGIN
  RETURN CASE p_source
    WHEN 'manual'           THEN 100
    WHEN 'waiver_ocr'       THEN 80
    WHEN 'master_list'      THEN 60
    WHEN 'cds_propagation'  THEN 40
    WHEN 'clinichq_ingest'  THEN 30
    WHEN 'legacy_v1'        THEN 10
    ELSE 0
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION ops.cdn_source_priority IS 'Returns numeric priority for clinic_day_number_source values. Higher = more authoritative.';

CREATE OR REPLACE FUNCTION ops.set_clinic_day_number(
  p_appointment_id UUID,
  p_value          INTEGER,
  p_source         ops.clinic_day_number_source,
  p_changed_by     UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_current INTEGER;
  v_current_source ops.clinic_day_number_source;
  v_manually_overridden BOOLEAN;
BEGIN
  SELECT
    clinic_day_number,
    clinic_day_number_source,
    ops.is_field_manually_set(manually_overridden_fields, 'clinic_day_number')
  INTO v_current, v_current_source, v_manually_overridden
  FROM ops.appointments
  WHERE appointment_id = p_appointment_id
    AND merged_into_appointment_id IS NULL;

  IF NOT FOUND THEN
    RAISE WARNING 'set_clinic_day_number: appointment % not found (or merged)', p_appointment_id;
    RETURN FALSE;
  END IF;

  -- Manual protection: if the field is flagged as manually overridden and
  -- this write is not itself a 'manual' source, refuse silently.
  IF v_manually_overridden AND p_source != 'manual' THEN
    RAISE NOTICE 'set_clinic_day_number: refusing % → % for appointment % (source=%, field is manually overridden)',
      v_current, p_value, p_appointment_id, p_source;
    RETURN FALSE;
  END IF;

  -- No-op if unchanged
  IF v_current IS NOT DISTINCT FROM p_value
     AND v_current_source IS NOT DISTINCT FROM p_source
  THEN
    RETURN TRUE;
  END IF;

  -- Priority check: refuse if current source has higher priority
  -- (unless current value is NULL)
  IF v_current IS NOT NULL
     AND v_current_source IS NOT NULL
     AND ops.cdn_source_priority(v_current_source) > ops.cdn_source_priority(p_source)
  THEN
    RAISE NOTICE 'set_clinic_day_number: refusing % → % for appointment % (current source % priority % > new source % priority %)',
      v_current, p_value, p_appointment_id,
      v_current_source, ops.cdn_source_priority(v_current_source),
      p_source, ops.cdn_source_priority(p_source);
    RETURN FALSE;
  END IF;

  -- Collision check: refuse if another appointment on the same date
  -- already claims this CDN with equal or higher priority
  IF EXISTS (
    SELECT 1 FROM ops.appointments other
    WHERE other.appointment_date = (
      SELECT appointment_date FROM ops.appointments WHERE appointment_id = p_appointment_id
    )
    AND other.appointment_id != p_appointment_id
    AND other.merged_into_appointment_id IS NULL
    AND other.clinic_day_number = p_value
    AND ops.cdn_source_priority(other.clinic_day_number_source) >= ops.cdn_source_priority(p_source)
  ) THEN
    RAISE NOTICE 'set_clinic_day_number: CDN % already claimed on same date by another appointment (equal or higher priority)',
      p_value;
    RETURN FALSE;
  END IF;

  -- Audit trail
  INSERT INTO ops.entity_edits (
    entity_type, entity_id, field_name,
    old_value, new_value, changed_by, change_source
  ) VALUES (
    'appointment', p_appointment_id, 'clinic_day_number',
    v_current::TEXT, p_value::TEXT, p_changed_by, p_source::TEXT
  );

  -- Apply
  UPDATE ops.appointments
  SET clinic_day_number = p_value,
      clinic_day_number_source = p_source,
      updated_at = NOW()
  WHERE appointment_id = p_appointment_id;

  -- If manual, mark as manually overridden
  IF p_source = 'manual' THEN
    UPDATE ops.appointments
    SET manually_overridden_fields = array_append(
      COALESCE(manually_overridden_fields, ARRAY[]::TEXT[]),
      'clinic_day_number'
    )
    WHERE appointment_id = p_appointment_id
      AND NOT ops.is_field_manually_set(manually_overridden_fields, 'clinic_day_number');
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. Verification
-- ============================================================================

\echo ''
\echo '5. Verification...'

DO $$
DECLARE
  v_enum_exists BOOLEAN;
  v_col_count INT;
BEGIN
  -- Check enum value
  SELECT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'ops.clinic_day_number_source'::regtype
      AND enumlabel = 'waiver_ocr'
  ) INTO v_enum_exists;
  ASSERT v_enum_exists, 'waiver_ocr enum value not found';

  -- Check columns
  SELECT COUNT(*) INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'ops'
    AND table_name = 'waiver_scans'
    AND column_name IN (
      'ocr_clinic_number', 'ocr_microchip', 'ocr_microchip_last4',
      'ocr_cat_name', 'ocr_owner_last_name', 'ocr_sex',
      'ocr_weight_lbs', 'ocr_date', 'ocr_processed_at', 'ocr_model'
    );
  ASSERT v_col_count = 10, format('Expected 10 OCR columns, found %s', v_col_count);

  RAISE NOTICE '   ✓ All verifications passed';
END;
$$;

COMMIT;

\echo ''
\echo '✓ MIG_3088 complete'
\echo ''
