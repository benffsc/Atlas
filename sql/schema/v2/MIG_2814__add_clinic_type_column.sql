-- MIG_2814: Add clinic_type column to ops.clinic_days
-- Fixes FFS-124: Routes currently hardcode 'regular' AS clinic_type because the column doesn't exist
--
-- clinic_type values: regular, tame_only, mass_trapping, emergency, mobile

ALTER TABLE ops.clinic_days
  ADD COLUMN IF NOT EXISTS clinic_type TEXT NOT NULL DEFAULT 'regular';

COMMENT ON COLUMN ops.clinic_days.clinic_type IS 'Type of clinic day: regular, tame_only, mass_trapping, emergency, mobile';

-- Backfill: all existing clinic days are regular (the default handles this)
