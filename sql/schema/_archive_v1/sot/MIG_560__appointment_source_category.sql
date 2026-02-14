-- MIG_560: Add appointment_source_category to sot_appointments
--
-- Categorizes appointments by their source/program:
-- - regular: Normal public appointments
-- - foster_program: From "Forgotten Felines Foster" account
-- - county_scas: From SCAS county contract (A439019 pattern)
-- - lmfm: Love Me Fix Me waiver program (ALL CAPS names or $LMFM marker)
-- - other_internal: Other internal FFSC accounts
--
-- This enables queries like "How many fosters did we fix this year?"

\echo ''
\echo '========================================================'
\echo 'MIG_560: Add appointment_source_category Column'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Add Column to sot_appointments
-- ============================================================

\echo 'Adding appointment_source_category column...'

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS appointment_source_category TEXT;

-- Add check constraint (separate so we can add to existing column)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_appointment_source_category'
  ) THEN
    ALTER TABLE trapper.sot_appointments
    ADD CONSTRAINT chk_appointment_source_category
    CHECK (appointment_source_category IN (
      'regular',
      'foster_program',
      'county_scas',
      'lmfm',
      'other_internal'
    ));
  END IF;
END $$;

COMMENT ON COLUMN trapper.sot_appointments.appointment_source_category IS
'Categorizes appointments by source/program:
- regular: Normal public appointments
- foster_program: From "Forgotten Felines Foster" account or ownership_type = Foster
- county_scas: From SCAS county contract (A439019 pattern owner)
- lmfm: Love Me Fix Me waiver program (ALL CAPS owner name or $LMFM in notes)
- other_internal: Other internal FFSC accounts

Used for reporting: "How many fosters/county cats did we fix?"';

-- ============================================================
-- PART 2: Create Index for Filtering
-- ============================================================

\echo 'Creating index on appointment_source_category...'

CREATE INDEX IF NOT EXISTS idx_appointments_source_category
ON trapper.sot_appointments(appointment_source_category)
WHERE appointment_source_category IS NOT NULL;

-- Composite index for date + category queries
CREATE INDEX IF NOT EXISTS idx_appointments_date_category
ON trapper.sot_appointments(appointment_date, appointment_source_category)
WHERE appointment_source_category IS NOT NULL;

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification - Column added:'

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'sot_appointments'
  AND column_name = 'appointment_source_category';

\echo ''
\echo '========================================================'
\echo 'MIG_560 Complete!'
\echo '========================================================'
\echo ''
\echo 'Next: Apply MIG_561 to create classify_appointment_source() function'
\echo ''
