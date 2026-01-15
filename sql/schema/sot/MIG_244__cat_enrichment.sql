-- MIG_244: Cat Enrichment System
--
-- Creates a unified entry point for adding/updating cats from ANY data source.
-- All external systems (ClinicHQ, Airtable, Jotform) should use these functions
-- to ensure identity resolution and data enrichment.
--
-- Key principles:
-- 1. MATCH by microchip first (most reliable), then clinic animal ID
-- 2. CREATE new cat only if no match exists
-- 3. ENRICH existing cat with better/newer data
-- 4. LINK to places and owners when possible
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_244__cat_enrichment.sql

\echo ''
\echo 'MIG_244: Cat Enrichment System'
\echo '=============================='
\echo ''

-- ============================================================
-- 1. Cat medical events table (tracks clinic visits, procedures)
-- ============================================================

\echo 'Creating cat_medical_events table...'

CREATE TABLE IF NOT EXISTS trapper.cat_medical_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
  event_type TEXT NOT NULL, -- 'clinic_visit', 'surgery', 'vaccination', 'medication', 'observation'
  event_date TIMESTAMPTZ NOT NULL,
  provider TEXT, -- Clinic name or vet
  description TEXT,
  -- Clinic-specific fields
  appointment_id UUID, -- Link to appointments table if from clinic
  procedure_type TEXT, -- 'spay', 'neuter', 'eartip', 'rabies', etc.
  -- Tracking
  source_system TEXT NOT NULL,
  source_record_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_medical_events_cat ON trapper.cat_medical_events(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_medical_events_date ON trapper.cat_medical_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_cat_medical_events_type ON trapper.cat_medical_events(event_type);

COMMENT ON TABLE trapper.cat_medical_events IS
'Tracks all medical events for a cat - clinic visits, surgeries, vaccinations, etc.
Provides full medical history view.';

-- ============================================================
-- 2. Cat owner relationships table
-- ============================================================

\echo 'Creating cat_owner_relationships table...'

CREATE TABLE IF NOT EXISTS trapper.cat_owner_relationships (
  relationship_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
  relationship_type TEXT NOT NULL DEFAULT 'owner', -- 'owner', 'caretaker', 'feeder', 'fosterer', 'reported_by'
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  source_system TEXT NOT NULL,
  source_record_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cat_id, person_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_cat_owner_relationships_cat ON trapper.cat_owner_relationships(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_owner_relationships_person ON trapper.cat_owner_relationships(person_id);
CREATE INDEX IF NOT EXISTS idx_cat_owner_relationships_current ON trapper.cat_owner_relationships(is_current) WHERE is_current = TRUE;

COMMENT ON TABLE trapper.cat_owner_relationships IS
'Links cats to their owners/caretakers. A cat can have multiple relationships
(owner, feeder, fosterer, etc.) and relationships can change over time.';

-- ============================================================
-- 3. Main cat enrichment function
-- ============================================================

\echo 'Creating enrich_cat function...'

CREATE OR REPLACE FUNCTION trapper.enrich_cat(
  -- Identifiers (provide at least one)
  p_microchip TEXT DEFAULT NULL,
  p_clinic_animal_id TEXT DEFAULT NULL,
  p_airtable_id TEXT DEFAULT NULL,
  -- Cat details
  p_name TEXT DEFAULT NULL,
  p_sex TEXT DEFAULT NULL, -- 'male', 'female', 'unknown'
  p_altered_status TEXT DEFAULT NULL, -- 'altered', 'intact', 'unknown'
  p_breed TEXT DEFAULT NULL,
  p_primary_color TEXT DEFAULT NULL,
  p_secondary_color TEXT DEFAULT NULL,
  p_birth_year INT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  -- Ownership
  p_ownership_type TEXT DEFAULT NULL, -- 'owned', 'community', 'feral', 'stray'
  -- Linking
  p_owner_person_id UUID DEFAULT NULL, -- Link to owner
  p_place_id UUID DEFAULT NULL, -- Link to place
  -- Tracking
  p_source_system TEXT DEFAULT 'unknown',
  p_source_record_id TEXT DEFAULT NULL
)
RETURNS TABLE(
  cat_id UUID,
  is_new BOOLEAN,
  matched_by TEXT
) AS $$
DECLARE
  v_cat_id UUID;
  v_is_new BOOLEAN := FALSE;
  v_matched_by TEXT := NULL;
  v_display_name TEXT;
  v_norm_microchip TEXT;
BEGIN
  -- Normalize microchip
  v_norm_microchip := NULLIF(regexp_replace(upper(trim(p_microchip)), '[^A-Z0-9]', '', 'g'), '');

  -- Build display name
  v_display_name := COALESCE(
    NULLIF(trim(p_name), ''),
    CASE WHEN v_norm_microchip IS NOT NULL THEN 'Cat-' || substring(v_norm_microchip, 1, 8) ELSE NULL END,
    CASE WHEN p_clinic_animal_id IS NOT NULL THEN 'Cat-' || p_clinic_animal_id ELSE NULL END,
    'Unknown Cat'
  );

  -- Try to match by microchip first (most reliable)
  IF v_norm_microchip IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'microchip'
      AND upper(regexp_replace(ci.id_value, '[^A-Z0-9]', '', 'g')) = v_norm_microchip
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      v_matched_by := 'microchip';
    END IF;
  END IF;

  -- Try clinic animal ID if no microchip match
  IF v_cat_id IS NULL AND p_clinic_animal_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'clinichq_animal_id'
      AND ci.id_value = p_clinic_animal_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      v_matched_by := 'clinichq_animal_id';
    END IF;
  END IF;

  -- Try Airtable ID if still no match
  IF v_cat_id IS NULL AND p_airtable_id IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE ci.id_type = 'airtable_id'
      AND ci.id_value = p_airtable_id
      AND c.merged_into_cat_id IS NULL
    LIMIT 1;

    IF v_cat_id IS NOT NULL THEN
      v_matched_by := 'airtable_id';
    END IF;
  END IF;

  -- No match - create new cat
  IF v_cat_id IS NULL THEN
    -- Require at least one identifier
    IF v_norm_microchip IS NULL AND p_clinic_animal_id IS NULL AND p_airtable_id IS NULL THEN
      RAISE EXCEPTION 'Cannot create cat without at least one identifier (microchip, clinic_animal_id, or airtable_id)';
    END IF;

    INSERT INTO trapper.sot_cats (
      display_name,
      sex,
      altered_status,
      breed,
      primary_color,
      secondary_color,
      birth_year,
      notes,
      ownership_type,
      data_source,
      created_at,
      updated_at
    ) VALUES (
      v_display_name,
      COALESCE(p_sex, 'unknown'),
      COALESCE(p_altered_status, 'unknown'),
      p_breed,
      p_primary_color,
      p_secondary_color,
      p_birth_year,
      p_notes,
      COALESCE(p_ownership_type, 'unknown'),
      p_source_system::trapper.data_source,
      NOW(),
      NOW()
    )
    RETURNING sot_cats.cat_id INTO v_cat_id;

    v_is_new := TRUE;
    v_matched_by := 'new';

    -- Add identifiers
    IF v_norm_microchip IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'microchip', v_norm_microchip, p_source_system);
    END IF;

    IF p_clinic_animal_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'clinichq_animal_id', p_clinic_animal_id, p_source_system);
    END IF;

    IF p_airtable_id IS NOT NULL THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'airtable_id', p_airtable_id, p_source_system);
    END IF;
  ELSE
    -- ENRICH existing cat: add missing identifiers and update fields
    IF v_norm_microchip IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = v_cat_id AND id_type = 'microchip'
    ) THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'microchip', v_norm_microchip, p_source_system);
    END IF;

    IF p_clinic_animal_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM trapper.cat_identifiers WHERE cat_id = v_cat_id AND id_type = 'clinichq_animal_id'
    ) THEN
      INSERT INTO trapper.cat_identifiers (cat_id, id_type, id_value, source_system)
      VALUES (v_cat_id, 'clinichq_animal_id', p_clinic_animal_id, p_source_system);
    END IF;

    -- Update cat with better data (fill in missing fields)
    UPDATE trapper.sot_cats c
    SET
      display_name = CASE WHEN c.display_name IS NULL OR c.display_name = 'Unknown Cat' OR c.display_name LIKE 'Cat-%' THEN COALESCE(NULLIF(trim(p_name), ''), c.display_name) ELSE c.display_name END,
      sex = CASE WHEN c.sex IS NULL OR c.sex = 'unknown' THEN COALESCE(p_sex, c.sex) ELSE c.sex END,
      altered_status = CASE WHEN c.altered_status IS NULL OR c.altered_status = 'unknown' THEN COALESCE(p_altered_status, c.altered_status) ELSE c.altered_status END,
      breed = COALESCE(c.breed, p_breed),
      primary_color = COALESCE(c.primary_color, p_primary_color),
      secondary_color = COALESCE(c.secondary_color, p_secondary_color),
      birth_year = COALESCE(c.birth_year, p_birth_year),
      ownership_type = CASE WHEN c.ownership_type IS NULL OR c.ownership_type = 'unknown' THEN COALESCE(p_ownership_type, c.ownership_type) ELSE c.ownership_type END,
      updated_at = NOW()
    WHERE c.cat_id = v_cat_id;
  END IF;

  -- Link to owner if provided
  IF p_owner_person_id IS NOT NULL THEN
    INSERT INTO trapper.cat_owner_relationships (cat_id, person_id, relationship_type, is_current, source_system, source_record_id)
    VALUES (v_cat_id, p_owner_person_id, 'owner', TRUE, p_source_system, p_source_record_id)
    ON CONFLICT (cat_id, person_id, relationship_type) DO UPDATE
    SET is_current = TRUE, updated_at = NOW();
  END IF;

  -- Link to place if provided
  IF p_place_id IS NOT NULL THEN
    INSERT INTO trapper.cat_place_relationships (cat_id, place_id, relationship_type, source_system)
    VALUES (v_cat_id, p_place_id, 'residence', p_source_system)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_cat_id, v_is_new, v_matched_by;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enrich_cat IS
'Universal function to add or update a cat from any data source.
Handles identity matching by microchip/clinic_id, enrichment, and linking.
Use this from ALL sync scripts that process cat data.';

-- ============================================================
-- 4. Function to add medical event
-- ============================================================

\echo 'Creating add_cat_medical_event function...'

CREATE OR REPLACE FUNCTION trapper.add_cat_medical_event(
  p_cat_id UUID,
  p_event_type TEXT,
  p_event_date TIMESTAMPTZ,
  p_description TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_procedure_type TEXT DEFAULT NULL,
  p_appointment_id UUID DEFAULT NULL,
  p_source_system TEXT DEFAULT 'unknown',
  p_source_record_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- Don't create duplicate events
  IF p_source_record_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM trapper.cat_medical_events
    WHERE cat_id = p_cat_id
      AND source_system = p_source_system
      AND source_record_id = p_source_record_id
  ) THEN
    SELECT event_id INTO v_event_id
    FROM trapper.cat_medical_events
    WHERE cat_id = p_cat_id
      AND source_system = p_source_system
      AND source_record_id = p_source_record_id;
    RETURN v_event_id;
  END IF;

  INSERT INTO trapper.cat_medical_events (
    cat_id,
    event_type,
    event_date,
    description,
    provider,
    procedure_type,
    appointment_id,
    source_system,
    source_record_id,
    metadata
  ) VALUES (
    p_cat_id,
    p_event_type,
    p_event_date,
    p_description,
    p_provider,
    p_procedure_type,
    p_appointment_id,
    p_source_system,
    p_source_record_id,
    p_metadata
  )
  RETURNING event_id INTO v_event_id;

  -- If this is an alteration event, update cat's altered_status
  IF p_procedure_type IN ('spay', 'neuter', 'altered') THEN
    UPDATE trapper.sot_cats
    SET altered_status = 'altered', altered_by_clinic = TRUE, updated_at = NOW()
    WHERE cat_id = p_cat_id;
  END IF;

  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.add_cat_medical_event IS
'Adds a medical event to a cat''s history. Prevents duplicates by source_record_id.
Automatically updates cat''s altered_status if procedure is spay/neuter.';

-- ============================================================
-- 5. View: Cat with full profile
-- ============================================================

\echo 'Creating v_cat_profile view...'

CREATE OR REPLACE VIEW trapper.v_cat_profile AS
SELECT
  c.cat_id,
  c.atlas_id,
  c.display_name,
  c.sex,
  c.altered_status,
  c.breed,
  c.primary_color,
  c.secondary_color,
  c.birth_year,
  c.ownership_type,
  c.data_source,
  c.created_at,
  -- Identifiers
  (SELECT id_value FROM trapper.cat_identifiers WHERE cat_id = c.cat_id AND id_type = 'microchip' LIMIT 1) AS microchip,
  (SELECT id_value FROM trapper.cat_identifiers WHERE cat_id = c.cat_id AND id_type = 'clinichq_animal_id' LIMIT 1) AS clinic_animal_id,
  -- Owners
  (
    SELECT jsonb_agg(jsonb_build_object(
      'person_id', cor.person_id,
      'relationship_type', cor.relationship_type,
      'name', p.display_name
    ))
    FROM trapper.cat_owner_relationships cor
    JOIN trapper.sot_people p ON p.person_id = cor.person_id
    WHERE cor.cat_id = c.cat_id AND cor.is_current = TRUE
  ) AS current_owners,
  -- Places
  (
    SELECT jsonb_agg(jsonb_build_object(
      'place_id', cpr.place_id,
      'relationship_type', cpr.relationship_type,
      'address', pl.formatted_address
    ))
    FROM trapper.cat_place_relationships cpr
    JOIN trapper.places pl ON pl.place_id = cpr.place_id
    WHERE cpr.cat_id = c.cat_id
  ) AS places,
  -- Medical summary
  (SELECT COUNT(*) FROM trapper.cat_medical_events WHERE cat_id = c.cat_id) AS medical_event_count,
  (SELECT MAX(event_date) FROM trapper.cat_medical_events WHERE cat_id = c.cat_id) AS last_medical_event,
  (SELECT event_date FROM trapper.cat_medical_events WHERE cat_id = c.cat_id AND procedure_type IN ('spay', 'neuter') ORDER BY event_date LIMIT 1) AS altered_date
FROM trapper.sot_cats c
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW trapper.v_cat_profile IS
'Complete cat profile with identifiers, owners, places, and medical summary.
Use for cat detail pages and search results.';

-- ============================================================
-- 6. Search function
-- ============================================================

\echo 'Creating search_cats function...'

CREATE OR REPLACE FUNCTION trapper.search_cats(
  p_query TEXT,
  p_limit INT DEFAULT 25
)
RETURNS TABLE(
  cat_id UUID,
  display_name TEXT,
  microchip TEXT,
  sex TEXT,
  altered_status TEXT,
  primary_color TEXT,
  owner_name TEXT,
  match_type TEXT
) AS $$
DECLARE
  v_norm_query TEXT;
BEGIN
  v_norm_query := lower(trim(p_query));

  RETURN QUERY
  WITH matches AS (
    -- Match by name
    SELECT c.cat_id, 'name' as match_type, 1 as priority
    FROM trapper.sot_cats c
    WHERE c.merged_into_cat_id IS NULL
      AND lower(c.display_name) LIKE '%' || v_norm_query || '%'

    UNION ALL

    -- Match by microchip
    SELECT ci.cat_id, 'microchip' as match_type, 2 as priority
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE c.merged_into_cat_id IS NULL
      AND ci.id_type = 'microchip'
      AND lower(ci.id_value) LIKE '%' || v_norm_query || '%'

    UNION ALL

    -- Match by clinic animal ID
    SELECT ci.cat_id, 'clinic_id' as match_type, 3 as priority
    FROM trapper.cat_identifiers ci
    JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
    WHERE c.merged_into_cat_id IS NULL
      AND ci.id_type = 'clinichq_animal_id'
      AND ci.id_value LIKE '%' || p_query || '%'
  )
  SELECT DISTINCT ON (c.cat_id)
    c.cat_id,
    c.display_name,
    (SELECT id_value FROM trapper.cat_identifiers WHERE cat_id = c.cat_id AND id_type = 'microchip' LIMIT 1),
    c.sex,
    c.altered_status,
    c.primary_color,
    (SELECT p.display_name FROM trapper.cat_owner_relationships cor JOIN trapper.sot_people p ON p.person_id = cor.person_id WHERE cor.cat_id = c.cat_id AND cor.is_current = TRUE LIMIT 1),
    m.match_type
  FROM matches m
  JOIN trapper.sot_cats c ON c.cat_id = m.cat_id
  ORDER BY c.cat_id, m.priority
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.search_cats IS
'Search for cats by name, microchip, or clinic animal ID. Returns profile summary with match type.';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_244 Complete!'
\echo ''
\echo 'New tables:'
\echo '  - cat_medical_events: Medical history for cats'
\echo '  - cat_owner_relationships: Links cats to owners/caretakers'
\echo ''
\echo 'New functions:'
\echo '  - enrich_cat(): Add/update cat from any source'
\echo '  - add_cat_medical_event(): Add medical event to cat history'
\echo '  - search_cats(): Find cats by name/microchip/clinic_id'
\echo ''
\echo 'New views:'
\echo '  - v_cat_profile: Complete cat profile'
\echo ''
\echo 'Usage example:'
\echo '  SELECT * FROM trapper.enrich_cat('
\echo '    p_microchip := ''985112012345678'','
\echo '    p_name := ''Whiskers'','
\echo '    p_sex := ''male'','
\echo '    p_altered_status := ''altered'','
\echo '    p_owner_person_id := ''abc-123...''::UUID,'
\echo '    p_source_system := ''clinichq'''
\echo '  );'
\echo ''
