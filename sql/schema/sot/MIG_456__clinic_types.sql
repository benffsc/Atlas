\echo === MIG_456: Clinic Day Types ===
\echo Adding clinic type support (regular, tame, mass trapping, etc.)

-- Add clinic_type column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'clinic_days' AND column_name = 'clinic_type'
  ) THEN
    ALTER TABLE trapper.clinic_days ADD COLUMN clinic_type TEXT
      DEFAULT 'regular' CHECK (clinic_type IN (
        'regular',       -- Mon/Wed standard clinic
        'tame_only',     -- Thursday tame cat clinic (vet limits)
        'mass_trapping', -- Special mass trapping day for specific sites
        'emergency',     -- Emergency/urgent clinic
        'mobile'         -- Future: mobile clinic
      ));
  END IF;
END $$;

-- Add target_place_id for mass trapping events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'clinic_days' AND column_name = 'target_place_id'
  ) THEN
    ALTER TABLE trapper.clinic_days ADD COLUMN target_place_id UUID
      REFERENCES trapper.places(place_id);
  END IF;
END $$;

-- Add max_capacity for clinic limits
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'clinic_days' AND column_name = 'max_capacity'
  ) THEN
    ALTER TABLE trapper.clinic_days ADD COLUMN max_capacity INT;
  END IF;
END $$;

-- Add vet_name for primary vet on duty
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'trapper' AND table_name = 'clinic_days' AND column_name = 'vet_name'
  ) THEN
    ALTER TABLE trapper.clinic_days ADD COLUMN vet_name TEXT;
  END IF;
END $$;

-- Add index for clinic_type
CREATE INDEX IF NOT EXISTS idx_clinic_day_type ON trapper.clinic_days(clinic_type);

-- View: Clinic schedule with type info
CREATE OR REPLACE VIEW trapper.v_clinic_schedule AS
SELECT
  cd.*,
  CASE cd.clinic_type
    WHEN 'regular' THEN 'Regular Clinic'
    WHEN 'tame_only' THEN 'Tame Cat Clinic'
    WHEN 'mass_trapping' THEN 'Mass Trapping: ' || COALESCE(p.display_name, 'TBD')
    WHEN 'emergency' THEN 'Emergency Clinic'
    WHEN 'mobile' THEN 'Mobile Clinic'
    ELSE 'Clinic'
  END as clinic_type_label,
  EXTRACT(DOW FROM cd.clinic_date) as day_of_week,
  p.display_name as target_place_name,
  p.formatted_address as target_place_address
FROM trapper.clinic_days cd
LEFT JOIN trapper.places p ON p.place_id = cd.target_place_id;

-- Function to get default clinic type based on day of week
CREATE OR REPLACE FUNCTION trapper.get_default_clinic_type(p_date DATE)
RETURNS TEXT AS $$
DECLARE
  v_dow INT;
BEGIN
  v_dow := EXTRACT(DOW FROM p_date);
  RETURN CASE v_dow
    WHEN 1 THEN 'regular'     -- Monday
    WHEN 3 THEN 'regular'     -- Wednesday
    WHEN 4 THEN 'tame_only'   -- Thursday
    ELSE 'regular'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Comments
COMMENT ON COLUMN trapper.clinic_days.clinic_type IS 'Type of clinic: regular (Mon/Wed), tame_only (Thu), mass_trapping, emergency, mobile';
COMMENT ON COLUMN trapper.clinic_days.target_place_id IS 'For mass trapping clinics: the specific site being targeted';
COMMENT ON COLUMN trapper.clinic_days.max_capacity IS 'Optional maximum number of cats for this clinic day';
COMMENT ON COLUMN trapper.clinic_days.vet_name IS 'Primary veterinarian on duty for this clinic day';

\echo MIG_456 complete: clinic_type columns and schedule view created
