-- MIG_922: Multi-Source Data Transparency for People
--
-- Problem: When people appear in multiple sources (ClinicHQ, VolunteerHub, ShelterLuv),
-- staff can't see which source reported what. This reduces trust in the data.
--
-- Solution: Track field-level provenance for people (mirroring cat_field_sources from MIG_620).
-- Staff can see: "Name: John Smith (VolunteerHub), Also: Jon Smith (ClinicHQ)"
--
-- Source Authority (per user confirmation):
--   - VolunteerHub: People (volunteers) - roles, groups, hours, status
--   - ClinicHQ: People (clinic clients) - from appointment owner info
--   - ShelterLuv: People (adopters/fosters) - from outcome events
--
-- Related: MIG_620 (cat_field_sources), MIG_875 (source authority map)

\echo ''
\echo '========================================================'
\echo 'MIG_922: Multi-Source Data Transparency for People'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Create person_field_sources table
-- ============================================================

\echo 'Creating person_field_sources table...'

CREATE TABLE IF NOT EXISTS trapper.person_field_sources (
  field_source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which person and field
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id) ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK (field_name IN (
    'display_name', 'first_name', 'last_name', 'address', 'email', 'phone'
  )),

  -- The value from this source
  field_value TEXT,  -- NULL means source had no value for this field

  -- Provenance
  source_system TEXT NOT NULL,  -- 'clinichq', 'volunteerhub', 'shelterluv', 'airtable', etc.
  source_record_id TEXT,  -- Original ID in source system

  -- Temporal tracking
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- When we received this value
  source_updated_at TIMESTAMPTZ,  -- When source says it was updated (if available)

  -- Resolution tracking
  is_current BOOLEAN DEFAULT FALSE,  -- Is this the value we're using in sot_people?
  confidence NUMERIC(3,2),  -- Snapshot of source confidence at observation

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (person_id, field_name, source_system)
);

COMMENT ON TABLE trapper.person_field_sources IS
'Tracks field-level values from each source system for people data transparency.
Shows all values across sources, with is_current marking the "winning" value.
Enables staff to see: "Name: John Smith (VolunteerHub), Also: Jon Smith (ClinicHQ)"
Mirrors cat_field_sources (MIG_620) for consistency.';

COMMENT ON COLUMN trapper.person_field_sources.is_current IS
'TRUE if this source''s value is currently displayed in sot_people.
Only one source per field should have is_current=TRUE.';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_person_field_sources_person_id
  ON trapper.person_field_sources(person_id);

CREATE INDEX IF NOT EXISTS idx_person_field_sources_is_current
  ON trapper.person_field_sources(person_id, field_name) WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_person_field_sources_conflicts
  ON trapper.person_field_sources(person_id, field_name)
  WHERE field_value IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_person_field_sources_source
  ON trapper.person_field_sources(source_system);

-- ============================================================
-- PART 2: Create conflict detection view
-- ============================================================

\echo 'Creating v_person_field_conflicts view...'

CREATE OR REPLACE VIEW trapper.v_person_field_conflicts AS
SELECT
  pfs.person_id,
  pfs.field_name,
  p.display_name AS person_name,
  jsonb_agg(
    jsonb_build_object(
      'source', pfs.source_system,
      'value', pfs.field_value,
      'observed_at', pfs.observed_at,
      'is_current', pfs.is_current,
      'confidence', pfs.confidence
    ) ORDER BY pfs.is_current DESC, pfs.confidence DESC NULLS LAST, pfs.observed_at DESC
  ) AS all_values,
  COUNT(DISTINCT pfs.field_value) AS distinct_value_count,
  -- Conflict exists if >1 distinct non-null value
  COUNT(DISTINCT pfs.field_value) > 1 AS has_conflict
FROM trapper.person_field_sources pfs
JOIN trapper.sot_people p ON p.person_id = pfs.person_id
WHERE pfs.field_value IS NOT NULL
  AND p.merged_into_person_id IS NULL
GROUP BY pfs.person_id, pfs.field_name, p.display_name
HAVING COUNT(DISTINCT pfs.field_value) > 1;

COMMENT ON VIEW trapper.v_person_field_conflicts IS
'Shows people where multiple sources disagree on field values.
Use to identify data quality issues and manual review candidates.';

-- ============================================================
-- PART 3: Create person_survivorship_priority table
-- ============================================================

\echo 'Creating person_survivorship_priority table (if not exists)...'

-- Check if survivorship_priority supports 'person' entity_type
DO $$
BEGIN
  -- Add person entries to survivorship_priority if table exists
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'survivorship_priority') THEN
    INSERT INTO trapper.survivorship_priority (entity_type, field_name, priority_order, notes)
    VALUES
      ('person', 'display_name', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
       'VolunteerHub is authority for volunteer names; ClinicHQ for clinic clients'),
      ('person', 'first_name', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
       'VolunteerHub is authority for volunteer names'),
      ('person', 'last_name', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
       'VolunteerHub is authority for volunteer names'),
      ('person', 'address', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'web_intake', 'airtable', 'atlas_ui'],
       'VolunteerHub volunteers have accurate addresses; ClinicHQ for clients'),
      ('person', 'email', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
       'VolunteerHub emails are verified; ClinicHQ has clinic client emails'),
      ('person', 'phone', ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'],
       'VolunteerHub phones are verified')
    ON CONFLICT (entity_type, field_name) DO UPDATE SET
      priority_order = EXCLUDED.priority_order,
      notes = EXCLUDED.notes;
    RAISE NOTICE 'Added person survivorship priorities';
  ELSE
    RAISE NOTICE 'survivorship_priority table does not exist, skipping';
  END IF;
END $$;

-- ============================================================
-- PART 4: Create record_person_field_source() function
-- ============================================================

\echo 'Creating record_person_field_source() function...'

CREATE OR REPLACE FUNCTION trapper.record_person_field_source(
  p_person_id UUID,
  p_field_name TEXT,
  p_field_value TEXT,
  p_source_system TEXT,
  p_source_record_id TEXT DEFAULT NULL,
  p_source_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_field_source_id UUID;
  v_confidence NUMERIC;
  v_is_current BOOLEAN := FALSE;
  v_current_source TEXT;
  v_priority_sources TEXT[];
BEGIN
  -- Skip if no value provided
  IF p_field_value IS NULL OR TRIM(p_field_value) = '' THEN
    RETURN NULL;
  END IF;

  -- Get source confidence
  SELECT COALESCE(email_confidence, 0.50) INTO v_confidence
  FROM trapper.source_identity_confidence
  WHERE source_system = p_source_system;

  v_confidence := COALESCE(v_confidence, 0.50);

  -- Get survivorship priority for this field (which source should win)
  SELECT priority_order INTO v_priority_sources
  FROM trapper.survivorship_priority
  WHERE entity_type = 'person' AND field_name = p_field_name;

  -- Default priority if not defined
  IF v_priority_sources IS NULL THEN
    v_priority_sources := ARRAY['volunteerhub', 'clinichq', 'shelterluv', 'airtable', 'web_intake', 'atlas_ui'];
  END IF;

  -- Check what source currently holds this field
  SELECT source_system INTO v_current_source
  FROM trapper.person_field_sources
  WHERE person_id = p_person_id AND field_name = p_field_name AND is_current = TRUE
  LIMIT 1;

  -- Determine if this source should become current
  IF v_current_source IS NULL THEN
    -- No current source, this one wins
    v_is_current := TRUE;
  ELSE
    -- Compare priority: lower index = higher priority
    v_is_current := (
      array_position(v_priority_sources, p_source_system) IS NOT NULL AND
      (
        array_position(v_priority_sources, v_current_source) IS NULL OR
        array_position(v_priority_sources, p_source_system) < array_position(v_priority_sources, v_current_source)
      )
    );
  END IF;

  -- Upsert the field source record
  INSERT INTO trapper.person_field_sources (
    person_id, field_name, field_value, source_system, source_record_id,
    observed_at, source_updated_at, is_current, confidence
  ) VALUES (
    p_person_id, p_field_name, TRIM(p_field_value), p_source_system, p_source_record_id,
    NOW(), p_source_updated_at, v_is_current, v_confidence
  )
  ON CONFLICT (person_id, field_name, source_system) DO UPDATE SET
    field_value = EXCLUDED.field_value,
    observed_at = EXCLUDED.observed_at,
    source_updated_at = EXCLUDED.source_updated_at,
    confidence = EXCLUDED.confidence,
    updated_at = NOW()
  RETURNING field_source_id INTO v_field_source_id;

  -- If this source should be current, update flags for all sources of this field
  IF v_is_current THEN
    UPDATE trapper.person_field_sources
    SET is_current = (source_system = p_source_system),
        updated_at = NOW()
    WHERE person_id = p_person_id AND field_name = p_field_name;
  END IF;

  RETURN v_field_source_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_person_field_source IS
'Records a field value from a specific source for a person.
Uses survivorship_priority to determine which source should be "current".
All values are preserved for transparency regardless of priority.
Mirrors record_cat_field_source() for consistency.';

-- ============================================================
-- PART 5: Create batch recording function
-- ============================================================

\echo 'Creating record_person_field_sources_batch() function...'

CREATE OR REPLACE FUNCTION trapper.record_person_field_sources_batch(
  p_person_id UUID,
  p_source_system TEXT,
  p_source_record_id TEXT,
  p_display_name TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  v_count INT := 0;
BEGIN
  -- Record each field that has a value
  IF p_display_name IS NOT NULL THEN
    PERFORM trapper.record_person_field_source(p_person_id, 'display_name', p_display_name, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_first_name IS NOT NULL THEN
    PERFORM trapper.record_person_field_source(p_person_id, 'first_name', p_first_name, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_last_name IS NOT NULL THEN
    PERFORM trapper.record_person_field_source(p_person_id, 'last_name', p_last_name, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_address IS NOT NULL THEN
    PERFORM trapper.record_person_field_source(p_person_id, 'address', p_address, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_email IS NOT NULL THEN
    PERFORM trapper.record_person_field_source(p_person_id, 'email', p_email, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_phone IS NOT NULL THEN
    PERFORM trapper.record_person_field_source(p_person_id, 'phone', p_phone, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_person_field_sources_batch IS
'Convenience function to record multiple field values at once from a single source.
Returns count of fields recorded. Used by processor functions.';

-- ============================================================
-- PART 6: Create person field sources summary view
-- ============================================================

\echo 'Creating v_person_field_sources_summary view...'

CREATE OR REPLACE VIEW trapper.v_person_field_sources_summary AS
SELECT
  p.person_id,
  p.display_name,
  -- Aggregate all field sources into a JSONB object for easy API consumption
  (
    SELECT jsonb_object_agg(
      field_name,
      sources_for_field
    )
    FROM (
      SELECT
        pfs.field_name,
        jsonb_agg(
          jsonb_build_object(
            'value', pfs.field_value,
            'source', pfs.source_system,
            'observed_at', pfs.observed_at,
            'is_current', pfs.is_current,
            'confidence', pfs.confidence
          ) ORDER BY pfs.is_current DESC, pfs.confidence DESC NULLS LAST
        ) AS sources_for_field
      FROM trapper.person_field_sources pfs
      WHERE pfs.person_id = p.person_id
      GROUP BY pfs.field_name
    ) field_data
  ) AS field_sources,
  -- Quick check for any conflicts
  EXISTS (
    SELECT 1
    FROM trapper.v_person_field_conflicts conf
    WHERE conf.person_id = p.person_id
  ) AS has_conflicts,
  -- Count of sources per person
  (
    SELECT COUNT(DISTINCT source_system)
    FROM trapper.person_field_sources pfs
    WHERE pfs.person_id = p.person_id
  ) AS source_count
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_field_sources_summary IS
'Aggregated field sources per person for API consumption.
field_sources is a JSONB object: { "display_name": [{value, source, ...}], "email": [...], ... }';

-- ============================================================
-- PART 7: Create unified conflicts view (cats + people)
-- ============================================================

\echo 'Creating v_all_field_conflicts view...'

CREATE OR REPLACE VIEW trapper.v_all_field_conflicts AS
SELECT
  'cat' AS entity_type,
  cat_id AS entity_id,
  cat_name AS entity_name,
  field_name,
  all_values,
  distinct_value_count,
  has_conflict
FROM trapper.v_cat_field_conflicts

UNION ALL

SELECT
  'person' AS entity_type,
  person_id AS entity_id,
  person_name AS entity_name,
  field_name,
  all_values,
  distinct_value_count,
  has_conflict
FROM trapper.v_person_field_conflicts;

COMMENT ON VIEW trapper.v_all_field_conflicts IS
'Combined view of all field conflicts across cats and people.
Used by the admin conflict dashboard to show all data quality issues.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'person_field_sources table' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'person_field_sources')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'record_person_field_source function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_person_field_source')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'v_person_field_conflicts view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_person_field_conflicts')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'v_all_field_conflicts view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_all_field_conflicts')
            THEN 'OK' ELSE 'MISSING' END AS status;

\echo ''
\echo '========================================================'
\echo 'MIG_922 Complete!'
\echo '========================================================'
\echo ''
\echo 'New capabilities:'
\echo '  1. person_field_sources table tracks per-field provenance for people'
\echo '  2. record_person_field_source() stores values with source attribution'
\echo '  3. v_person_field_conflicts shows people with conflicting data'
\echo '  4. v_person_field_sources_summary provides JSONB for API'
\echo '  5. v_all_field_conflicts unifies cat + person conflicts'
\echo ''
\echo 'Source Authority (VolunteerHub > ClinicHQ > ShelterLuv > Airtable):'
\echo '  - VolunteerHub wins for volunteers (names, emails, phones, addresses)'
\echo '  - ClinicHQ wins for clinic clients'
\echo '  - ShelterLuv wins for adopters/fosters'
\echo ''
\echo 'Usage:'
\echo '  SELECT trapper.record_person_field_source('
\echo '    person_id, ''display_name'', ''John Smith'', ''volunteerhub'''
\echo '  );'
\echo ''
\echo '  -- Batch recording:'
\echo '  SELECT trapper.record_person_field_sources_batch('
\echo '    person_id, ''clinichq'', ''owner_123'','
\echo '    p_display_name => ''Jon Smith'', p_email => ''john@example.com'''
\echo '  );'
\echo ''
