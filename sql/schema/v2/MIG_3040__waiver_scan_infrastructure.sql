-- MIG_3040: Waiver Scan Infrastructure
-- Date: 2026-04-02
--
-- Creates:
--   - ops.waiver_scans (lifecycle tracking for scanned waiver PDFs)
--   - ALTER ops.cat_medications (lot_number, certificate_number, manufacturer, dosage_amount, waiver_scan_id)
--   - ALTER ops.cat_vitals (pulse_bpm, respiratory_rate, spo2_pct, mucous_membrane, capillary_refill_time, monitoring_phase, waiver_scan_id)
--   - ALTER ops.appointments (surgery_start_time, surgery_end_time, payment_method, ok_for_surgery, ok_for_release, waiver_consent_signed, waiver_scan_id)
--
-- Part of Waiver Ingest & Enrichment Pipeline (FFS-1110 epic)

\echo ''
\echo '=============================================='
\echo '  MIG_3040: Waiver Scan Infrastructure'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. WAIVER SCANS TABLE
-- ============================================================================

\echo '1. Creating ops.waiver_scans table...'

CREATE TABLE IF NOT EXISTS ops.waiver_scans (
    waiver_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_upload_id UUID REFERENCES ops.file_uploads(upload_id),

    -- Filename-parsed fields
    parsed_last_name TEXT,
    parsed_description TEXT,
    parsed_last4_chip TEXT,
    parsed_date DATE,

    -- Match results
    matched_appointment_id UUID REFERENCES ops.appointments(appointment_id),
    matched_cat_id UUID,
    match_method TEXT,        -- 'chip_date', 'name_date', 'manual'
    match_confidence NUMERIC(3,2),  -- 0.00 to 1.00

    -- OCR
    ocr_status TEXT NOT NULL DEFAULT 'pending',  -- pending/extracting/extracted/failed
    ocr_extracted_data JSONB,
    ocr_error TEXT,

    -- Review
    review_status TEXT NOT NULL DEFAULT 'pending',  -- pending/approved/corrected/rejected/skipped
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_corrections JSONB,

    -- Enrichment
    enrichment_status TEXT NOT NULL DEFAULT 'pending',  -- pending/applied/partial/skipped
    enrichment_results JSONB,
    enriched_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waiver_scans_file_upload ON ops.waiver_scans(file_upload_id);
CREATE INDEX IF NOT EXISTS idx_waiver_scans_appointment ON ops.waiver_scans(matched_appointment_id);
CREATE INDEX IF NOT EXISTS idx_waiver_scans_cat ON ops.waiver_scans(matched_cat_id);
CREATE INDEX IF NOT EXISTS idx_waiver_scans_ocr_status ON ops.waiver_scans(ocr_status);
CREATE INDEX IF NOT EXISTS idx_waiver_scans_review_status ON ops.waiver_scans(review_status);
CREATE INDEX IF NOT EXISTS idx_waiver_scans_parsed_chip ON ops.waiver_scans(parsed_last4_chip);
CREATE INDEX IF NOT EXISTS idx_waiver_scans_parsed_date ON ops.waiver_scans(parsed_date);

COMMENT ON TABLE ops.waiver_scans IS 'Tracks lifecycle of scanned clinic waiver PDFs: parse → match → OCR → review → enrich';

\echo '   Created ops.waiver_scans'

-- ============================================================================
-- 2. ALTER ops.cat_medications — add waiver enrichment columns
-- ============================================================================

\echo ''
\echo '2. Adding waiver columns to ops.cat_medications...'

DO $$ BEGIN
    -- Vaccine lot number (e.g., "L123456")
    ALTER TABLE ops.cat_medications ADD COLUMN lot_number TEXT;
    RAISE NOTICE 'Added lot_number to cat_medications';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'lot_number already exists on cat_medications';
END $$;

DO $$ BEGIN
    -- Rabies certificate number
    ALTER TABLE ops.cat_medications ADD COLUMN certificate_number TEXT;
    RAISE NOTICE 'Added certificate_number to cat_medications';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'certificate_number already exists on cat_medications';
END $$;

DO $$ BEGIN
    -- Vaccine manufacturer
    ALTER TABLE ops.cat_medications ADD COLUMN manufacturer TEXT;
    RAISE NOTICE 'Added manufacturer to cat_medications';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'manufacturer already exists on cat_medications';
END $$;

DO $$ BEGIN
    -- Precise dosage amount (e.g., "0.3 ml", "15 mg")
    ALTER TABLE ops.cat_medications ADD COLUMN dosage_amount TEXT;
    RAISE NOTICE 'Added dosage_amount to cat_medications';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'dosage_amount already exists on cat_medications';
END $$;

DO $$ BEGIN
    -- Link back to waiver that enriched this record
    ALTER TABLE ops.cat_medications ADD COLUMN waiver_scan_id UUID REFERENCES ops.waiver_scans(waiver_id);
    RAISE NOTICE 'Added waiver_scan_id to cat_medications';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'waiver_scan_id already exists on cat_medications';
END $$;

\echo '   Done'

-- ============================================================================
-- 3. ALTER ops.cat_vitals — add post-op monitoring columns
-- ============================================================================

\echo ''
\echo '3. Adding post-op monitoring columns to ops.cat_vitals...'

DO $$ BEGIN
    ALTER TABLE ops.cat_vitals ADD COLUMN pulse_bpm INT;
    RAISE NOTICE 'Added pulse_bpm to cat_vitals';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'pulse_bpm already exists on cat_vitals';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.cat_vitals ADD COLUMN respiratory_rate INT;
    RAISE NOTICE 'Added respiratory_rate to cat_vitals';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'respiratory_rate already exists on cat_vitals';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.cat_vitals ADD COLUMN spo2_pct NUMERIC(4,1);
    RAISE NOTICE 'Added spo2_pct to cat_vitals';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'spo2_pct already exists on cat_vitals';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.cat_vitals ADD COLUMN mucous_membrane TEXT;
    RAISE NOTICE 'Added mucous_membrane to cat_vitals';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'mucous_membrane already exists on cat_vitals';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.cat_vitals ADD COLUMN capillary_refill_time TEXT;
    RAISE NOTICE 'Added capillary_refill_time to cat_vitals';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'capillary_refill_time already exists on cat_vitals';
END $$;

DO $$ BEGIN
    -- Which monitoring timepoint: pre_op, recovery_1, recovery_2, recovery_3, discharge
    ALTER TABLE ops.cat_vitals ADD COLUMN monitoring_phase TEXT;
    RAISE NOTICE 'Added monitoring_phase to cat_vitals';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'monitoring_phase already exists on cat_vitals';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.cat_vitals ADD COLUMN waiver_scan_id UUID REFERENCES ops.waiver_scans(waiver_id);
    RAISE NOTICE 'Added waiver_scan_id to cat_vitals';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'waiver_scan_id already exists on cat_vitals';
END $$;

\echo '   Done'

-- ============================================================================
-- 4. ALTER ops.appointments — add surgery timing and waiver columns
-- ============================================================================

\echo ''
\echo '4. Adding surgery/waiver columns to ops.appointments...'

DO $$ BEGIN
    ALTER TABLE ops.appointments ADD COLUMN surgery_start_time TIME;
    RAISE NOTICE 'Added surgery_start_time to appointments';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'surgery_start_time already exists on appointments';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.appointments ADD COLUMN surgery_end_time TIME;
    RAISE NOTICE 'Added surgery_end_time to appointments';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'surgery_end_time already exists on appointments';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.appointments ADD COLUMN payment_method TEXT;
    RAISE NOTICE 'Added payment_method to appointments';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'payment_method already exists on appointments';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.appointments ADD COLUMN ok_for_surgery BOOLEAN;
    RAISE NOTICE 'Added ok_for_surgery to appointments';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'ok_for_surgery already exists on appointments';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.appointments ADD COLUMN ok_for_release BOOLEAN;
    RAISE NOTICE 'Added ok_for_release to appointments';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'ok_for_release already exists on appointments';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.appointments ADD COLUMN waiver_consent_signed BOOLEAN;
    RAISE NOTICE 'Added waiver_consent_signed to appointments';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'waiver_consent_signed already exists on appointments';
END $$;

DO $$ BEGIN
    ALTER TABLE ops.appointments ADD COLUMN waiver_scan_id UUID REFERENCES ops.waiver_scans(waiver_id);
    RAISE NOTICE 'Added waiver_scan_id to appointments';
EXCEPTION WHEN duplicate_column THEN
    RAISE NOTICE 'waiver_scan_id already exists on appointments';
END $$;

\echo '   Done'

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'waiver_scans columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'waiver_scans'
ORDER BY ordinal_position;

\echo ''
\echo 'New cat_medications columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'cat_medications'
  AND column_name IN ('lot_number', 'certificate_number', 'manufacturer', 'dosage_amount', 'waiver_scan_id');

\echo ''
\echo 'New cat_vitals columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'cat_vitals'
  AND column_name IN ('pulse_bpm', 'respiratory_rate', 'spo2_pct', 'mucous_membrane', 'capillary_refill_time', 'monitoring_phase', 'waiver_scan_id');

\echo ''
\echo 'New appointments columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'appointments'
  AND column_name IN ('surgery_start_time', 'surgery_end_time', 'payment_method', 'ok_for_surgery', 'ok_for_release', 'waiver_consent_signed', 'waiver_scan_id');

\echo ''
\echo '=============================================='
\echo '  MIG_3040 Complete!'
\echo '=============================================='
\echo ''
