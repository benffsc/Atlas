-- MIG_2950: Port appointment_source_category to V2 (FFS-585)
--
-- V1 MIG_560/561 added appointment classification by source program.
-- Used by 8+ health check API routes and program stats reporting.
-- Ported from trapper.sot_appointments → ops.appointments.

BEGIN;

-- ── Column ───────────────────────────────────────────────────────────

ALTER TABLE ops.appointments
ADD COLUMN IF NOT EXISTS appointment_source_category TEXT;

-- Check constraint (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_appointment_source_category'
  ) THEN
    ALTER TABLE ops.appointments
    ADD CONSTRAINT chk_appointment_source_category
    CHECK (appointment_source_category IN (
      'regular', 'foster_program', 'county_scas', 'lmfm', 'other_internal'
    ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_source_category
ON ops.appointments(appointment_source_category)
WHERE appointment_source_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_date_category
ON ops.appointments(appointment_date, appointment_source_category)
WHERE appointment_source_category IS NOT NULL;

COMMENT ON COLUMN ops.appointments.appointment_source_category IS
'Source program: regular, foster_program, county_scas, lmfm, other_internal';

-- ── Classification helpers ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION ops.is_lmfm_appointment(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT,
  p_appointment_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  IF p_appointment_notes IS NOT NULL AND p_appointment_notes ILIKE '%$LMFM%' THEN
    RETURN TRUE;
  END IF;
  IF UPPER(TRIM(p_owner_first_name)) = 'LMFM' THEN
    RETURN TRUE;
  END IF;
  v_full_name := TRIM(COALESCE(p_owner_first_name, '') || ' ' || COALESCE(p_owner_last_name, ''));
  IF LENGTH(v_full_name) >= 3
     AND v_full_name ~ '^[A-Z ]+$'
     AND v_full_name LIKE '% %'
     AND LENGTH(TRIM(p_owner_first_name)) > 1
     AND LENGTH(TRIM(p_owner_last_name)) > 1
  THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION ops.is_scas_appointment(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF UPPER(TRIM(p_owner_last_name)) = 'SCAS'
     AND TRIM(p_owner_first_name) ~ '^A[0-9]+$'
  THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION ops.is_foster_program_appointment(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT,
  p_ownership_type TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  IF LOWER(TRIM(COALESCE(p_ownership_type, ''))) = 'foster' THEN
    RETURN TRUE;
  END IF;
  v_full_name := LOWER(TRIM(COALESCE(p_owner_first_name, '') || ' ' || COALESCE(p_owner_last_name, '')));
  IF v_full_name LIKE '%forgotten felines foster%'
     OR v_full_name LIKE '%ff foster%'
     OR v_full_name LIKE '%ffsc foster%'
     OR v_full_name = 'foster program'
     OR v_full_name = 'foster'
  THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION ops.classify_appointment_source(
  p_owner_first_name TEXT,
  p_owner_last_name TEXT,
  p_ownership_type TEXT DEFAULT NULL,
  p_appointment_notes TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF ops.is_scas_appointment(p_owner_first_name, p_owner_last_name) THEN
    RETURN 'county_scas';
  END IF;
  IF ops.is_lmfm_appointment(p_owner_first_name, p_owner_last_name, p_appointment_notes) THEN
    RETURN 'lmfm';
  END IF;
  IF ops.is_foster_program_appointment(p_owner_first_name, p_owner_last_name, p_ownership_type) THEN
    RETURN 'foster_program';
  END IF;
  -- Skip internal_account_types check (table not ported to V2)
  RETURN 'regular';
END;
$$;

-- ── Backfill ─────────────────────────────────────────────────────────

UPDATE ops.appointments a
SET appointment_source_category = ops.classify_appointment_source(
  a.owner_first_name,
  a.owner_last_name,
  a.ownership_type,
  NULL -- notes not available on appointments table
)
WHERE a.appointment_source_category IS NULL;

COMMIT;
