\echo === MIG_455: Clinic Day Logs ===
\echo Ground truth capture for clinic days (master list equivalent)

-- Clinic day header (one per clinic day)
CREATE TABLE IF NOT EXISTS trapper.clinic_days (
  clinic_day_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_date DATE NOT NULL UNIQUE,
  total_cats INT DEFAULT 0,
  total_females INT DEFAULT 0,
  total_males INT DEFAULT 0,
  total_unknown_sex INT DEFAULT 0,
  total_no_shows INT DEFAULT 0,
  total_cancelled INT DEFAULT 0,
  notes TEXT,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES trapper.staff(staff_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual entries per trapper/site combo
CREATE TABLE IF NOT EXISTS trapper.clinic_day_entries (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_day_id UUID NOT NULL REFERENCES trapper.clinic_days(clinic_day_id) ON DELETE CASCADE,

  -- Who/Where
  trapper_person_id UUID REFERENCES trapper.sot_people(person_id),
  place_id UUID REFERENCES trapper.places(place_id),
  request_id UUID REFERENCES trapper.sot_requests(request_id),

  -- What we know about source (raw from master list)
  source_description TEXT,  -- "Jean Worthey - Trp Crystal" from master list

  -- Counts
  cat_count INT NOT NULL DEFAULT 0,
  female_count INT DEFAULT 0,
  male_count INT DEFAULT 0,
  unknown_sex_count INT DEFAULT 0,

  -- Status
  status TEXT DEFAULT 'completed' CHECK (status IN (
    'completed',     -- Cats received and processed
    'no_show',       -- Client didn't show up
    'cancelled',     -- Cancelled before clinic
    'partial',       -- Some cats, issues with others
    'pending'        -- Expected but not yet arrived
  )),

  -- Optional details
  notes TEXT,

  -- Metadata
  entered_by UUID REFERENCES trapper.staff(staff_id),
  source_system TEXT DEFAULT 'web_app',
  source_record_id TEXT,  -- For SharePoint sync tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clinic_day_date ON trapper.clinic_days(clinic_date);
CREATE INDEX IF NOT EXISTS idx_clinic_entry_day ON trapper.clinic_day_entries(clinic_day_id);
CREATE INDEX IF NOT EXISTS idx_clinic_entry_trapper ON trapper.clinic_day_entries(trapper_person_id);
CREATE INDEX IF NOT EXISTS idx_clinic_entry_place ON trapper.clinic_day_entries(place_id);
CREATE INDEX IF NOT EXISTS idx_clinic_entry_request ON trapper.clinic_day_entries(request_id);
CREATE INDEX IF NOT EXISTS idx_clinic_entry_status ON trapper.clinic_day_entries(status);

-- View: Compare clinic day logs vs ClinicHQ appointments
CREATE OR REPLACE VIEW trapper.v_clinic_day_comparison AS
SELECT
  cd.clinic_day_id,
  cd.clinic_date,
  cd.total_cats as logged_total,
  cd.total_females as logged_females,
  cd.total_males as logged_males,
  cd.total_no_shows as logged_no_shows,
  cd.total_cancelled as logged_cancelled,
  cd.finalized_at IS NOT NULL as is_finalized,
  COUNT(DISTINCT a.appointment_id) as clinichq_appointments,
  COUNT(DISTINCT a.cat_id) as clinichq_cats,
  COUNT(DISTINCT a.cat_id) FILTER (WHERE c.sex = 'female') as clinichq_females,
  COUNT(DISTINCT a.cat_id) FILTER (WHERE c.sex = 'male') as clinichq_males,
  cd.total_cats - COUNT(DISTINCT a.cat_id) as variance,
  CASE
    WHEN cd.total_cats = COUNT(DISTINCT a.cat_id) THEN 'match'
    WHEN cd.total_cats > COUNT(DISTINCT a.cat_id) THEN 'logged_more'
    ELSE 'clinichq_more'
  END as variance_direction
FROM trapper.clinic_days cd
LEFT JOIN trapper.sot_appointments a ON a.appointment_date = cd.clinic_date
LEFT JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
GROUP BY cd.clinic_day_id, cd.clinic_date, cd.total_cats, cd.total_females, cd.total_males, cd.total_no_shows, cd.total_cancelled, cd.finalized_at;

-- View: Clinic day entries with resolved names
CREATE OR REPLACE VIEW trapper.v_clinic_day_entries AS
SELECT
  e.entry_id,
  e.clinic_day_id,
  cd.clinic_date,
  e.trapper_person_id,
  t.display_name as trapper_name,
  e.place_id,
  p.label as place_label,
  p.short_address as place_address,
  e.request_id,
  r.short_address as request_address,
  e.source_description,
  e.cat_count,
  e.female_count,
  e.male_count,
  e.unknown_sex_count,
  e.status,
  e.notes,
  e.entered_by,
  s.display_name as entered_by_name,
  e.created_at
FROM trapper.clinic_day_entries e
JOIN trapper.clinic_days cd ON cd.clinic_day_id = e.clinic_day_id
LEFT JOIN trapper.sot_people t ON t.person_id = e.trapper_person_id
LEFT JOIN trapper.places p ON p.place_id = e.place_id
LEFT JOIN trapper.sot_requests r ON r.request_id = e.request_id
LEFT JOIN trapper.staff s ON s.staff_id = e.entered_by;

-- Trigger: Update clinic_days totals when entries change
CREATE OR REPLACE FUNCTION trapper.update_clinic_day_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_clinic_day_id UUID;
BEGIN
  -- Get the affected clinic_day_id
  v_clinic_day_id := COALESCE(NEW.clinic_day_id, OLD.clinic_day_id);

  -- Update totals
  UPDATE trapper.clinic_days
  SET
    total_cats = COALESCE((
      SELECT SUM(cat_count) FROM trapper.clinic_day_entries
      WHERE clinic_day_id = v_clinic_day_id
      AND status = 'completed'
    ), 0),
    total_females = COALESCE((
      SELECT SUM(female_count) FROM trapper.clinic_day_entries
      WHERE clinic_day_id = v_clinic_day_id
      AND status = 'completed'
    ), 0),
    total_males = COALESCE((
      SELECT SUM(male_count) FROM trapper.clinic_day_entries
      WHERE clinic_day_id = v_clinic_day_id
      AND status = 'completed'
    ), 0),
    total_unknown_sex = COALESCE((
      SELECT SUM(unknown_sex_count) FROM trapper.clinic_day_entries
      WHERE clinic_day_id = v_clinic_day_id
      AND status = 'completed'
    ), 0),
    total_no_shows = COALESCE((
      SELECT COUNT(*) FROM trapper.clinic_day_entries
      WHERE clinic_day_id = v_clinic_day_id
      AND status = 'no_show'
    ), 0),
    total_cancelled = COALESCE((
      SELECT COUNT(*) FROM trapper.clinic_day_entries
      WHERE clinic_day_id = v_clinic_day_id
      AND status = 'cancelled'
    ), 0),
    updated_at = NOW()
  WHERE clinic_day_id = v_clinic_day_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_clinic_entry_totals ON trapper.clinic_day_entries;

-- Create trigger
CREATE TRIGGER trg_clinic_entry_totals
  AFTER INSERT OR UPDATE OR DELETE ON trapper.clinic_day_entries
  FOR EACH ROW EXECUTE FUNCTION trapper.update_clinic_day_totals();

-- Comments
COMMENT ON TABLE trapper.clinic_days IS 'Clinic day header - one record per clinic date with aggregated totals';
COMMENT ON TABLE trapper.clinic_day_entries IS 'Individual entries per trapper/site for a clinic day';
COMMENT ON COLUMN trapper.clinic_day_entries.source_description IS 'Raw text from master list like "Jean Worthey - Trp Crystal"';
COMMENT ON COLUMN trapper.clinic_day_entries.status IS 'Entry status: completed, no_show, cancelled, partial, pending';
COMMENT ON VIEW trapper.v_clinic_day_comparison IS 'Compare clinic day logs vs ClinicHQ appointments';

\echo MIG_455 complete: clinic_days and clinic_day_entries tables created with comparison view
