-- MIG_2018: Add secondary_color column to sot.cats
--
-- ClinicHQ exports have "Primary Color" and "Secondary Color" as separate fields.
-- V1 had both columns; V2 needs secondary_color added.
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2018: Add secondary_color to sot.cats'
\echo '=============================================='
\echo ''

-- Add secondary_color column if it doesn't exist
ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS secondary_color TEXT;

-- Also ensure primary_color exists (some V2 setups only have 'color')
ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS primary_color TEXT;

-- If color exists but primary_color is empty, copy color to primary_color
UPDATE sot.cats
SET primary_color = color
WHERE primary_color IS NULL AND color IS NOT NULL;

-- Add comment
COMMENT ON COLUMN sot.cats.primary_color IS 'Primary coat color from ClinicHQ';
COMMENT ON COLUMN sot.cats.secondary_color IS 'Secondary coat color from ClinicHQ';

\echo 'Added secondary_color and primary_color columns to sot.cats'
\echo ''
