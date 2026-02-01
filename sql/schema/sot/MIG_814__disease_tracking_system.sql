\echo '=== MIG_814: Disease Tracking System ==='
\echo 'DIS_001: Per-disease tracking at place level with time decay, manual overrides,'
\echo 'and map integration. Derived from cat_test_results + AI extraction + manual flags.'
\echo ''

-- ============================================================================
-- 1. Disease Type Registry (extensible lookup table)
-- ============================================================================

\echo 'Creating disease_types registry...'

CREATE TABLE IF NOT EXISTS trapper.disease_types (
  disease_key TEXT PRIMARY KEY,
  display_label TEXT NOT NULL,
  short_code TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  severity_order INT NOT NULL DEFAULT 50,
  decay_window_months INT NOT NULL DEFAULT 36,
  is_contagious BOOLEAN DEFAULT TRUE,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.disease_types IS
'Extensible registry of trackable feline diseases. Staff can add new types via admin UI.
short_code is a 1-letter code for map badge display. decay_window_months controls how long
a positive result keeps a place flagged before transitioning to historical status.';

INSERT INTO trapper.disease_types (disease_key, display_label, short_code, color, severity_order, decay_window_months, is_contagious, description)
VALUES
  ('felv', 'FeLV (Feline Leukemia)', 'F', '#dc2626', 10, 36, TRUE,
   'Feline Leukemia Virus. Highly contagious, spreads through saliva, nasal secretions, urine, feces, and milk. Detected via SNAP combo test.'),
  ('fiv', 'FIV (Feline Immunodeficiency)', 'V', '#ea580c', 20, 36, TRUE,
   'Feline Immunodeficiency Virus. Primarily spread through deep bite wounds. Detected via SNAP combo test.'),
  ('ringworm', 'Ringworm (Dermatophytosis)', 'R', '#ca8a04', 30, 12, TRUE,
   'Fungal skin infection. Highly contagious to cats and humans. Detected via Wood''s lamp or skin scrape.'),
  ('heartworm', 'Heartworm', 'H', '#7c3aed', 40, 24, FALSE,
   'Dirofilaria immitis. Spread by mosquitoes, not cat-to-cat. Detected via blood test.'),
  ('panleukopenia', 'Panleukopenia (Feline Distemper)', 'P', '#be185d', 15, 24, TRUE,
   'Feline parvovirus. Extremely contagious and often fatal in kittens. Can persist in environment for months.')
ON CONFLICT (disease_key) DO NOTHING;

-- ============================================================================
-- 2. Place Disease Status Table
-- ============================================================================

\echo 'Creating place_disease_status table...'

CREATE TABLE IF NOT EXISTS trapper.place_disease_status (
  status_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES trapper.places(place_id),
  disease_type_key TEXT NOT NULL REFERENCES trapper.disease_types(disease_key),

  status TEXT NOT NULL DEFAULT 'suspected'
    CHECK (status IN ('confirmed_active', 'suspected', 'historical', 'perpetual', 'false_flag', 'cleared')),

  evidence_source TEXT NOT NULL DEFAULT 'computed'
    CHECK (evidence_source IN ('test_result', 'ai_extraction', 'google_maps', 'manual', 'computed')),

  first_positive_date DATE,
  last_positive_date DATE,
  decay_window_override INT,

  positive_cat_count INT DEFAULT 0,
  total_tested_count INT DEFAULT 0,

  notes TEXT,
  set_by TEXT,
  set_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(place_id, disease_type_key)
);

CREATE INDEX IF NOT EXISTS idx_place_disease_status_place ON trapper.place_disease_status(place_id);
CREATE INDEX IF NOT EXISTS idx_place_disease_status_active ON trapper.place_disease_status(place_id)
  WHERE status IN ('confirmed_active', 'perpetual', 'suspected');

COMMENT ON TABLE trapper.place_disease_status IS
'Per-disease status at each place. Statuses:
  confirmed_active: Test-confirmed positive, within decay window
  suspected: AI-extracted or mentioned, not test-confirmed
  historical: Was positive but beyond decay window with no recent positives
  perpetual: Staff permanently flagged (never decays)
  false_flag: Staff dismissed (AI/mention was wrong)
  cleared: Staff confirmed resolved/treated
Manual statuses (perpetual, false_flag, cleared) survive recompute.';

-- ============================================================================
-- 3. Test Type → Disease Key Mapping
-- ============================================================================

\echo 'Creating test_type_disease_mapping...'

CREATE TABLE IF NOT EXISTS trapper.test_type_disease_mapping (
  test_type TEXT NOT NULL,
  result_pattern TEXT NOT NULL,
  disease_key TEXT NOT NULL REFERENCES trapper.disease_types(disease_key),
  PRIMARY KEY (test_type, result_pattern, disease_key)
);

COMMENT ON TABLE trapper.test_type_disease_mapping IS
'Maps cat_test_results.test_type + result/result_detail patterns to disease_types.
result_pattern is matched against test result enum value OR result_detail text.
Used by compute_place_disease_status() to derive place disease from cat tests.';

INSERT INTO trapper.test_type_disease_mapping (test_type, result_pattern, disease_key)
VALUES
  -- FeLV/FIV combo test: parse result_detail for specific virus
  ('felv_fiv', 'FeLV+', 'felv'),
  ('felv_fiv', 'FIV+', 'fiv'),
  -- Combo test generic positive (when result_detail doesn't specify which)
  -- Map to felv as the more dangerous default
  ('felv_fiv', 'positive', 'felv'),
  -- Ringworm tests
  ('ringworm_woods_lamp', 'positive', 'ringworm'),
  ('skin_scrape', 'positive', 'ringworm'),
  -- Heartworm
  ('heartworm', 'positive', 'heartworm')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. Compute Place Disease Status Function
-- ============================================================================

\echo 'Creating compute_place_disease_status() function...'

CREATE OR REPLACE FUNCTION trapper.compute_place_disease_status(
  p_place_id UUID DEFAULT NULL
)
RETURNS TABLE (
  out_place_id UUID,
  diseases_updated INT
) AS $$
DECLARE
  v_total_places INT := 0;
  v_total_updates INT := 0;
  v_place_updates INT;
  v_rec RECORD;
BEGIN
  -- For each place (or specific place), aggregate cat test results
  FOR v_rec IN
    WITH target_places AS (
      SELECT DISTINCT cpr.place_id
      FROM trapper.cat_place_relationships cpr
      JOIN trapper.places pl ON pl.place_id = cpr.place_id
      WHERE pl.merged_into_place_id IS NULL
        AND (p_place_id IS NULL OR cpr.place_id = p_place_id)
    ),
    -- Get all positive test results mapped to disease keys
    place_disease_data AS (
      SELECT
        tp.place_id,
        m.disease_key,
        COUNT(DISTINCT ctr.cat_id) FILTER (WHERE ctr.result = 'positive') AS positive_cats,
        COUNT(DISTINCT ctr.cat_id) AS total_tested,
        MIN(ctr.test_date) FILTER (WHERE ctr.result = 'positive') AS first_positive,
        MAX(ctr.test_date) FILTER (WHERE ctr.result = 'positive') AS last_positive
      FROM target_places tp
      JOIN trapper.cat_place_relationships cpr ON cpr.place_id = tp.place_id
      JOIN trapper.cat_test_results ctr ON ctr.cat_id = cpr.cat_id
      JOIN trapper.test_type_disease_mapping m ON m.test_type = ctr.test_type
        AND (
          -- Match on result_detail text (e.g., "FeLV+/FIV-" contains "FeLV+")
          (ctr.result_detail IS NOT NULL AND ctr.result_detail LIKE '%' || m.result_pattern || '%')
          -- OR match on result enum value (e.g., result='positive' matches pattern 'positive')
          OR (ctr.result::TEXT = m.result_pattern AND ctr.result_detail IS NULL)
        )
      WHERE ctr.result = 'positive'
      GROUP BY tp.place_id, m.disease_key
    )
    SELECT
      pdd.place_id,
      pdd.disease_key,
      pdd.positive_cats,
      pdd.total_tested,
      pdd.first_positive,
      pdd.last_positive,
      dt.decay_window_months,
      -- Check if existing manual override should be preserved
      COALESCE(existing.status, 'none') AS existing_status,
      existing.decay_window_override
    FROM place_disease_data pdd
    JOIN trapper.disease_types dt ON dt.disease_key = pdd.disease_key
    LEFT JOIN trapper.place_disease_status existing
      ON existing.place_id = pdd.place_id
      AND existing.disease_type_key = pdd.disease_key
    WHERE pdd.positive_cats > 0
  LOOP
    -- Skip manual overrides (staff decisions preserved)
    IF v_rec.existing_status IN ('perpetual', 'false_flag', 'cleared') THEN
      CONTINUE;
    END IF;

    v_place_updates := 0;

    -- Determine status based on decay window
    DECLARE
      v_effective_decay INT := COALESCE(v_rec.decay_window_override, v_rec.decay_window_months);
      v_status TEXT;
    BEGIN
      IF v_rec.last_positive >= (CURRENT_DATE - (v_effective_decay || ' months')::INTERVAL)::DATE THEN
        v_status := 'confirmed_active';
      ELSE
        v_status := 'historical';
      END IF;

      INSERT INTO trapper.place_disease_status (
        place_id, disease_type_key, status, evidence_source,
        first_positive_date, last_positive_date,
        positive_cat_count, total_tested_count,
        set_by, set_at, updated_at
      ) VALUES (
        v_rec.place_id, v_rec.disease_key, v_status, 'test_result',
        v_rec.first_positive, v_rec.last_positive,
        v_rec.positive_cats, v_rec.total_tested,
        'system', NOW(), NOW()
      )
      ON CONFLICT (place_id, disease_type_key) DO UPDATE SET
        status = CASE
          -- Only update status if not manually set
          WHEN place_disease_status.status NOT IN ('perpetual', 'false_flag', 'cleared')
          THEN EXCLUDED.status
          ELSE place_disease_status.status
        END,
        evidence_source = CASE
          WHEN place_disease_status.status NOT IN ('perpetual', 'false_flag', 'cleared')
          THEN 'test_result'
          ELSE place_disease_status.evidence_source
        END,
        first_positive_date = LEAST(place_disease_status.first_positive_date, EXCLUDED.first_positive_date),
        last_positive_date = GREATEST(place_disease_status.last_positive_date, EXCLUDED.last_positive_date),
        positive_cat_count = EXCLUDED.positive_cat_count,
        total_tested_count = EXCLUDED.total_tested_count,
        updated_at = NOW();

      GET DIAGNOSTICS v_place_updates = ROW_COUNT;
    END;

    v_total_updates := v_total_updates + v_place_updates;
    v_total_places := v_total_places + 1;
  END LOOP;

  -- Sync places.disease_risk boolean for backward compatibility
  UPDATE trapper.places p
  SET disease_risk = EXISTS (
    SELECT 1 FROM trapper.place_disease_status pds
    WHERE pds.place_id = p.place_id
      AND pds.status IN ('confirmed_active', 'perpetual')
  )
  WHERE p.merged_into_place_id IS NULL
    AND (p_place_id IS NULL OR p.place_id = p_place_id);

  out_place_id := p_place_id;
  diseases_updated := v_total_updates;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.compute_place_disease_status IS
'Computes place_disease_status from cat_test_results via cat_place_relationships.
Respects manual overrides (perpetual, false_flag, cleared). Applies time decay.
Pass NULL for all places or a specific place_id. Also syncs places.disease_risk boolean.';

-- ============================================================================
-- 5. Manual Override Function
-- ============================================================================

\echo 'Creating set_place_disease_override() function...'

CREATE OR REPLACE FUNCTION trapper.set_place_disease_override(
  p_place_id UUID,
  p_disease_key TEXT,
  p_status TEXT,
  p_notes TEXT DEFAULT NULL,
  p_set_by TEXT DEFAULT 'staff'
)
RETURNS UUID AS $$
DECLARE
  v_status_id UUID;
  v_old_status TEXT;
  v_old_notes TEXT;
BEGIN
  -- Validate status
  IF p_status NOT IN ('confirmed_active', 'suspected', 'historical', 'perpetual', 'false_flag', 'cleared') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be one of: confirmed_active, suspected, historical, perpetual, false_flag, cleared', p_status;
  END IF;

  -- Validate disease key
  IF NOT EXISTS (SELECT 1 FROM trapper.disease_types WHERE disease_key = p_disease_key AND is_active) THEN
    RAISE EXCEPTION 'Unknown or inactive disease type: %', p_disease_key;
  END IF;

  -- Get old values for audit
  SELECT status, notes INTO v_old_status, v_old_notes
  FROM trapper.place_disease_status
  WHERE place_id = p_place_id AND disease_type_key = p_disease_key;

  -- Upsert
  INSERT INTO trapper.place_disease_status (
    place_id, disease_type_key, status, evidence_source,
    notes, set_by, set_at, updated_at
  ) VALUES (
    p_place_id, p_disease_key, p_status, 'manual',
    p_notes, p_set_by, NOW(), NOW()
  )
  ON CONFLICT (place_id, disease_type_key) DO UPDATE SET
    status = p_status,
    evidence_source = 'manual',
    notes = p_notes,
    set_by = p_set_by,
    set_at = NOW(),
    updated_at = NOW()
  RETURNING status_id INTO v_status_id;

  -- Log to entity_edits
  INSERT INTO trapper.entity_edits (
    entity_type, entity_id, edit_type, field_name,
    old_value, new_value, reason, edited_by, edit_source
  ) VALUES (
    'place', p_place_id, 'field_update', 'disease_status_' || p_disease_key,
    CASE WHEN v_old_status IS NOT NULL
      THEN jsonb_build_object('status', v_old_status, 'notes', v_old_notes)
      ELSE NULL
    END,
    jsonb_build_object('status', p_status, 'notes', p_notes),
    p_notes,
    p_set_by,
    'web_ui'
  );

  -- Sync backward compat
  UPDATE trapper.places
  SET disease_risk = EXISTS (
    SELECT 1 FROM trapper.place_disease_status pds
    WHERE pds.place_id = p_place_id
      AND pds.status IN ('confirmed_active', 'perpetual')
  )
  WHERE place_id = p_place_id;

  RETURN v_status_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.set_place_disease_override IS
'Manual override of place disease status. Logs to entity_edits for audit trail.
Syncs places.disease_risk boolean for backward compatibility.';

-- ============================================================================
-- 6. Place Disease Summary View
-- ============================================================================

\echo 'Creating v_place_disease_summary view...'

CREATE OR REPLACE VIEW trapper.v_place_disease_summary AS
SELECT
  p.place_id,
  COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'disease_key', pds.disease_type_key,
        'short_code', dt.short_code,
        'color', dt.color,
        'status', pds.status,
        'label', dt.display_label,
        'last_positive', pds.last_positive_date,
        'positive_cats', pds.positive_cat_count,
        'evidence', pds.evidence_source
      ) ORDER BY dt.severity_order
    ) FILTER (WHERE pds.status_id IS NOT NULL),
    '[]'::JSONB
  ) AS disease_badges,
  COUNT(pds.status_id) FILTER (
    WHERE pds.status IN ('confirmed_active', 'perpetual')
  ) AS active_disease_count,
  COUNT(pds.status_id) FILTER (
    WHERE pds.status = 'suspected'
  ) AS suspected_count,
  BOOL_OR(pds.status IN ('confirmed_active', 'perpetual', 'suspected')) AS has_any_disease
FROM trapper.places p
LEFT JOIN trapper.place_disease_status pds
  ON pds.place_id = p.place_id
  AND pds.status NOT IN ('false_flag', 'cleared')
LEFT JOIN trapper.disease_types dt
  ON dt.disease_key = pds.disease_type_key
  AND dt.is_active = TRUE
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id;

COMMENT ON VIEW trapper.v_place_disease_summary IS
'One row per place with aggregated disease status. disease_badges is a JSONB array
of {disease_key, short_code, color, status, label, last_positive, positive_cats}.
Excludes false_flag and cleared statuses. Used by v_map_atlas_pins for map display.';

-- ============================================================================
-- 7. Update v_map_atlas_pins with disease badges
-- ============================================================================

\echo 'Recreating v_map_atlas_pins with disease badge support...'

DROP VIEW IF EXISTS trapper.v_map_atlas_pins;

CREATE VIEW trapper.v_map_atlas_pins AS
SELECT
  p.place_id as id,
  p.formatted_address as address,
  COALESCE(org.org_display_name, p.display_name) as display_name,
  ST_Y(p.location::geometry) as lat,
  ST_X(p.location::geometry) as lng,
  p.service_zone,

  -- Parent place for clustering
  p.parent_place_id,
  p.place_kind,
  p.unit_identifier,

  -- Cat counts
  COALESCE(cc.cat_count, 0) as cat_count,

  -- People linked
  COALESCE(ppl.people, '[]'::JSONB) as people,
  COALESCE(ppl.person_count, 0) as person_count,

  -- Disease risk (backward compat boolean)
  (COALESCE(p.disease_risk, FALSE)
   OR COALESCE(gme.has_disease_risk, FALSE)
   OR COALESCE(ds.has_any_disease, FALSE)) as disease_risk,
  p.disease_risk_notes,

  -- NEW: Per-disease badges
  COALESCE(ds.disease_badges, '[]'::JSONB) as disease_badges,
  COALESCE(ds.active_disease_count, 0) as disease_count,

  -- Watch list
  (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) as watch_list,
  p.watch_list_reason,

  -- Google Maps history
  COALESCE(gme.entry_count, 0) as google_entry_count,
  COALESCE(gme.ai_summaries, '[]'::JSONB) as google_summaries,

  -- Request counts
  COALESCE(req.request_count, 0) as request_count,
  COALESCE(req.active_request_count, 0) as active_request_count,

  -- Intake submission counts
  COALESCE(intake.intake_count, 0) as intake_count,

  -- TNR stats
  COALESCE(tnr.total_altered, 0) as total_altered,
  tnr.last_alteration_at,

  -- Pin style (disease now includes per-disease tracking)
  CASE
    WHEN (COALESCE(p.disease_risk, FALSE)
          OR COALESCE(gme.has_disease_risk, FALSE)
          OR COALESCE(ds.has_any_disease, FALSE)) THEN 'disease'
    WHEN (COALESCE(p.watch_list, FALSE) OR COALESCE(gme.has_watch_list, FALSE)) THEN 'watch_list'
    WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
    WHEN COALESCE(req.request_count, 0) > 0
      OR COALESCE(intake.intake_count, 0) > 0 THEN 'active_requests'
    WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
    ELSE 'minimal'
  END as pin_style,

  -- Metadata
  p.created_at,
  p.last_activity_at

FROM trapper.places p

-- Cat counts
LEFT JOIN (
  SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
  FROM trapper.cat_place_relationships
  GROUP BY place_id
) cc ON cc.place_id = p.place_id

-- People with role info (from MIG_811)
LEFT JOIN (
  SELECT
    ppr.place_id,
    COUNT(DISTINCT per.person_id) as person_count,
    JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
      'name', per.display_name,
      'roles', COALESCE((
        SELECT ARRAY_AGG(DISTINCT pr.role)
        FROM trapper.person_roles pr
        WHERE pr.person_id = per.person_id
          AND pr.role_status = 'active'
      ), ARRAY[]::TEXT[]),
      'is_staff', COALESCE(per.is_system_account, FALSE)
    )) FILTER (WHERE per.display_name IS NOT NULL) as people
  FROM trapper.person_place_relationships ppr
  JOIN trapper.sot_people per ON per.person_id = ppr.person_id
  WHERE per.merged_into_person_id IS NULL
    AND NOT trapper.is_organization_name(per.display_name)
    AND (
      COALESCE(per.is_system_account, FALSE) = FALSE
      OR ppr.source_system = 'volunteerhub'
    )
  GROUP BY ppr.place_id
) ppl ON ppl.place_id = p.place_id

-- Organization display name fallback
LEFT JOIN (
  SELECT DISTINCT ON (place_id) place_id, org_display_name
  FROM trapper.organization_place_mappings
  WHERE auto_link_enabled = TRUE AND org_display_name IS NOT NULL
  ORDER BY place_id, created_at DESC
) org ON org.place_id = p.place_id

-- Disease summary (NEW in MIG_814)
LEFT JOIN trapper.v_place_disease_summary ds ON ds.place_id = p.place_id

-- Google Maps entries
LEFT JOIN (
  SELECT
    COALESCE(place_id, linked_place_id) as place_id,
    COUNT(*) as entry_count,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'summary', COALESCE(ai_summary, SUBSTRING(original_content FROM 1 FOR 200)),
        'meaning', ai_meaning,
        'date', parsed_date::text
      )
      ORDER BY imported_at DESC
    ) FILTER (WHERE ai_summary IS NOT NULL OR original_content IS NOT NULL) as ai_summaries,
    BOOL_OR(ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony')) as has_disease_risk,
    BOOL_OR(ai_meaning = 'watch_list') as has_watch_list
  FROM trapper.google_map_entries
  WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL
  GROUP BY COALESCE(place_id, linked_place_id)
) gme ON gme.place_id = p.place_id

-- Request counts
LEFT JOIN (
  SELECT
    place_id,
    COUNT(*) as request_count,
    COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')) as active_request_count
  FROM trapper.sot_requests
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) req ON req.place_id = p.place_id

-- Intake submissions
LEFT JOIN (
  SELECT
    place_id,
    COUNT(DISTINCT submission_id) as intake_count
  FROM trapper.web_intake_submissions
  WHERE place_id IS NOT NULL
  GROUP BY place_id
) intake ON intake.place_id = p.place_id

-- TNR stats
LEFT JOIN (
  SELECT
    place_id,
    total_cats_altered as total_altered,
    latest_request_date as last_alteration_at
  FROM trapper.v_place_alteration_history
) tnr ON tnr.place_id = p.place_id

WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL;

COMMENT ON VIEW trapper.v_map_atlas_pins IS
'Consolidated Atlas pins for map display. Includes all places with geocoordinates.
MIG_814: Added disease_badges JSONB array and disease_count from v_place_disease_summary.
disease_risk boolean now includes per-disease tracking in addition to manual/Google Maps flags.
People subquery returns JSONB objects with {name, roles[], is_staff} (from MIG_811).';

-- ============================================================================
-- 8. Summary
-- ============================================================================
-- 8. Attribute Definitions for Disease Extraction
-- ============================================================================

\echo 'Adding per-disease attribute definitions for AI extraction...'

-- Add per-disease status attributes for cat entity extraction
INSERT INTO trapper.entity_attribute_definitions
  (attribute_key, entity_type, data_type, description, enum_values, extraction_keywords, priority)
VALUES
  ('felv_status', 'cat', 'enum',
   'FeLV (Feline Leukemia Virus) test result status. CRITICAL: "FeLV neg", "FeLV negative", "FeLV-", "SNAP neg" = negative (not a concern). Only "FeLV+", "FeLV positive", "positive for FeLV" = positive.',
   ARRAY['positive', 'negative', 'inconclusive', 'not_tested'],
   ARRAY['felv', 'feline leukemia', 'snap test', 'snap neg', 'snap pos'],
   5),
  ('fiv_status', 'cat', 'enum',
   'FIV (Feline Immunodeficiency Virus) test result status. CRITICAL: "FIV neg", "FIV negative", "FIV-" = negative (not a concern). Only "FIV+", "FIV positive", "positive for FIV" = positive.',
   ARRAY['positive', 'negative', 'inconclusive', 'not_tested'],
   ARRAY['fiv', 'feline immunodeficiency', 'feline aids', 'snap test'],
   5),
  ('ringworm_status', 'cat', 'enum',
   'Ringworm test/observation status. "Woods lamp negative" or "no ringworm" = negative. "Woods lamp positive", "ringworm confirmed", "dermatophytosis" = positive.',
   ARRAY['positive', 'negative', 'inconclusive', 'not_tested'],
   ARRAY['ringworm', 'dermatophyte', 'dermatophytosis', 'woods lamp', 'fungal'],
   10),
  ('heartworm_status', 'cat', 'enum',
   'Heartworm test result status.',
   ARRAY['positive', 'negative', 'inconclusive', 'not_tested'],
   ARRAY['heartworm', 'dirofilaria'],
   15),
  ('panleukopenia_status', 'cat', 'enum',
   'Panleukopenia (feline distemper) status. Look for parvo, panleuk, distemper references.',
   ARRAY['positive', 'negative', 'inconclusive', 'not_tested'],
   ARRAY['panleukopenia', 'panleuk', 'feline distemper', 'parvo', 'fpv'],
   10)
ON CONFLICT (attribute_key) DO UPDATE SET
  description = EXCLUDED.description,
  extraction_keywords = EXCLUDED.extraction_keywords;

-- ============================================================================
-- 9. Post-Extraction Hook: Disease → Place Disease Status
-- ============================================================================

\echo 'Creating process_disease_extraction() hook function...'

CREATE OR REPLACE FUNCTION trapper.process_disease_extraction(
  p_cat_id UUID,
  p_disease_key TEXT,
  p_status TEXT DEFAULT 'positive',
  p_evidence_source TEXT DEFAULT 'ai_extraction'
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_place_record RECORD;
  v_updated INT := 0;
BEGIN
  -- Only process positive results to flag places
  IF p_status != 'positive' THEN
    RETURN 0;
  END IF;

  -- Verify disease_key exists
  IF NOT EXISTS (SELECT 1 FROM trapper.disease_types WHERE disease_key = p_disease_key AND is_active) THEN
    RETURN 0;
  END IF;

  -- Find all places linked to this cat
  FOR v_place_record IN
    SELECT DISTINCT place_id
    FROM trapper.cat_place_relationships
    WHERE cat_id = p_cat_id
  LOOP
    -- Only insert if no existing manual override
    INSERT INTO trapper.place_disease_status (
      place_id, disease_type_key, status, evidence_source,
      first_positive_date, last_positive_date,
      positive_cat_count, notes, set_by, set_at
    )
    VALUES (
      v_place_record.place_id, p_disease_key, 'suspected', p_evidence_source,
      CURRENT_DATE, CURRENT_DATE,
      1, 'Auto-flagged from AI extraction on cat ' || p_cat_id::TEXT,
      'ai_extraction', NOW()
    )
    ON CONFLICT (place_id, disease_type_key)
    DO UPDATE SET
      -- Only update if not a manual override
      last_positive_date = CASE
        WHEN trapper.place_disease_status.status IN ('perpetual', 'false_flag', 'cleared')
        THEN trapper.place_disease_status.last_positive_date
        ELSE GREATEST(trapper.place_disease_status.last_positive_date, CURRENT_DATE)
      END,
      positive_cat_count = CASE
        WHEN trapper.place_disease_status.status IN ('perpetual', 'false_flag', 'cleared')
        THEN trapper.place_disease_status.positive_cat_count
        ELSE trapper.place_disease_status.positive_cat_count + 1
      END,
      updated_at = NOW()
    WHERE trapper.place_disease_status.status NOT IN ('perpetual', 'false_flag', 'cleared');

    IF FOUND THEN v_updated := v_updated + 1; END IF;
  END LOOP;

  -- Sync places.disease_risk
  UPDATE trapper.places p
  SET disease_risk = TRUE, disease_risk_set_at = NOW()
  WHERE p.place_id IN (
    SELECT DISTINCT place_id FROM trapper.cat_place_relationships WHERE cat_id = p_cat_id
  )
  AND NOT COALESCE(p.disease_risk, FALSE);

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION trapper.process_disease_extraction IS
'Post-extraction hook: when AI extracts a positive disease result for a cat,
flag all linked places with suspected disease status. Respects manual overrides.';

-- ============================================================================

\echo ''
\echo '=== MIG_814 Complete ==='
\echo 'Created:'
\echo '  - disease_types: Extensible registry (5 seeded: FeLV, FIV, ringworm, heartworm, panleukopenia)'
\echo '  - place_disease_status: Per-disease status at each place with time decay'
\echo '  - test_type_disease_mapping: Maps cat_test_results → disease_types'
\echo '  - compute_place_disease_status(): Aggregates cat tests → place disease flags'
\echo '  - set_place_disease_override(): Manual override with entity_edits audit'
\echo '  - v_place_disease_summary: One row per place with disease_badges JSONB'
\echo '  - v_map_atlas_pins: Updated with disease_badges + disease_count columns'
\echo ''
\echo 'Status values: confirmed_active, suspected, historical, perpetual, false_flag, cleared'
\echo 'Manual overrides (perpetual, false_flag, cleared) survive recompute.'
\echo 'places.disease_risk boolean synced for backward compatibility.'
\echo ''
