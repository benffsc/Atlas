-- MIG_620: Multi-Source Data Transparency for Cats
--
-- Problem: When cats have data from multiple sources (ClinicHQ, ShelterLuv),
-- staff can't see which source reported what. This reduces trust in the data.
--
-- Solution: Track field-level provenance so staff can see:
--   "Breed: DSH Black (ClinicHQ)"
--   "Also: DSH White (ShelterLuv)"
--
-- This increases transparency and trust without losing any data.

\echo ''
\echo '========================================================'
\echo 'MIG_620: Multi-Source Data Transparency for Cats'
\echo '========================================================'
\echo ''

-- ============================================================
-- PART 1: Create cat_field_sources table
-- ============================================================

\echo 'Creating cat_field_sources table...'

CREATE TABLE IF NOT EXISTS trapper.cat_field_sources (
  field_source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which cat and field
  cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id) ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK (field_name IN (
    'name', 'breed', 'sex', 'primary_color', 'secondary_color',
    'altered_status', 'coat_pattern', 'estimated_age', 'ownership_type'
  )),

  -- The value from this source
  field_value TEXT,  -- NULL means source had no value for this field

  -- Provenance
  source_system TEXT NOT NULL,  -- 'clinichq', 'shelterluv', 'petlink', etc.
  source_record_id TEXT,  -- Original ID in source system

  -- Temporal tracking
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- When we received this value
  source_updated_at TIMESTAMPTZ,  -- When source says it was updated (if available)

  -- Resolution tracking
  is_current BOOLEAN DEFAULT FALSE,  -- Is this the value we're using in sot_cats?
  confidence NUMERIC(3,2),  -- Snapshot of source confidence at observation

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (cat_id, field_name, source_system)
);

COMMENT ON TABLE trapper.cat_field_sources IS
'Tracks field-level values from each source system for data transparency.
Shows all values across sources, with is_current marking the "winning" value.
Enables staff to see: "Breed: DSH Black (ClinicHQ), Also: DSH White (ShelterLuv)"';

COMMENT ON COLUMN trapper.cat_field_sources.is_current IS
'TRUE if this source''s value is currently displayed in sot_cats.
Only one source per field should have is_current=TRUE.';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_cat_field_sources_cat_id
  ON trapper.cat_field_sources(cat_id);

CREATE INDEX IF NOT EXISTS idx_cat_field_sources_is_current
  ON trapper.cat_field_sources(cat_id, field_name) WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_cat_field_sources_conflicts
  ON trapper.cat_field_sources(cat_id, field_name)
  WHERE field_value IS NOT NULL;

-- ============================================================
-- PART 2: Create conflict detection view
-- ============================================================

\echo 'Creating v_cat_field_conflicts view...'

CREATE OR REPLACE VIEW trapper.v_cat_field_conflicts AS
SELECT
  cfs.cat_id,
  cfs.field_name,
  c.display_name AS cat_name,
  c.microchip,
  jsonb_agg(
    jsonb_build_object(
      'source', cfs.source_system,
      'value', cfs.field_value,
      'observed_at', cfs.observed_at,
      'is_current', cfs.is_current,
      'confidence', cfs.confidence
    ) ORDER BY cfs.is_current DESC, cfs.confidence DESC NULLS LAST, cfs.observed_at DESC
  ) AS all_values,
  COUNT(DISTINCT cfs.field_value) AS distinct_value_count,
  -- Conflict exists if >1 distinct non-null value
  COUNT(DISTINCT cfs.field_value) > 1 AS has_conflict
FROM trapper.cat_field_sources cfs
JOIN trapper.sot_cats c ON c.cat_id = cfs.cat_id
WHERE cfs.field_value IS NOT NULL
GROUP BY cfs.cat_id, cfs.field_name, c.display_name, c.microchip
HAVING COUNT(DISTINCT cfs.field_value) > 1;

COMMENT ON VIEW trapper.v_cat_field_conflicts IS
'Shows cats where multiple sources disagree on field values.
Use to identify data quality issues and manual review candidates.';

-- ============================================================
-- PART 3: Create record_cat_field_source() function
-- ============================================================

\echo 'Creating record_cat_field_source() function...'

CREATE OR REPLACE FUNCTION trapper.record_cat_field_source(
  p_cat_id UUID,
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

  -- Get source confidence (use email_confidence as proxy for general source quality)
  SELECT COALESCE(email_confidence, 0.50) INTO v_confidence
  FROM trapper.source_identity_confidence
  WHERE source_system = p_source_system;

  v_confidence := COALESCE(v_confidence, 0.50);

  -- Get survivorship priority for this field (which source should win)
  SELECT priority_order INTO v_priority_sources
  FROM trapper.survivorship_priority
  WHERE entity_type = 'cat' AND field_name = p_field_name;

  -- Default priority if not defined
  IF v_priority_sources IS NULL THEN
    v_priority_sources := ARRAY['clinichq', 'shelterluv', 'petlink', 'airtable', 'web_intake', 'atlas_ui'];
  END IF;

  -- Check what source currently holds this field
  SELECT source_system INTO v_current_source
  FROM trapper.cat_field_sources
  WHERE cat_id = p_cat_id AND field_name = p_field_name AND is_current = TRUE
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
  INSERT INTO trapper.cat_field_sources (
    cat_id, field_name, field_value, source_system, source_record_id,
    observed_at, source_updated_at, is_current, confidence
  ) VALUES (
    p_cat_id, p_field_name, TRIM(p_field_value), p_source_system, p_source_record_id,
    NOW(), p_source_updated_at, v_is_current, v_confidence
  )
  ON CONFLICT (cat_id, field_name, source_system) DO UPDATE SET
    field_value = EXCLUDED.field_value,
    observed_at = EXCLUDED.observed_at,
    source_updated_at = EXCLUDED.source_updated_at,
    confidence = EXCLUDED.confidence,
    updated_at = NOW()
  RETURNING field_source_id INTO v_field_source_id;

  -- If this source should be current, update flags for all sources of this field
  IF v_is_current THEN
    UPDATE trapper.cat_field_sources
    SET is_current = (source_system = p_source_system),
        updated_at = NOW()
    WHERE cat_id = p_cat_id AND field_name = p_field_name;
  END IF;

  RETURN v_field_source_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_cat_field_source IS
'Records a field value from a specific source for a cat.
Uses survivorship_priority to determine which source should be "current".
All values are preserved for transparency regardless of priority.';

-- ============================================================
-- PART 4: Create batch recording function
-- ============================================================

\echo 'Creating record_cat_field_sources_batch() function...'

CREATE OR REPLACE FUNCTION trapper.record_cat_field_sources_batch(
  p_cat_id UUID,
  p_source_system TEXT,
  p_source_record_id TEXT,
  p_name TEXT DEFAULT NULL,
  p_breed TEXT DEFAULT NULL,
  p_sex TEXT DEFAULT NULL,
  p_primary_color TEXT DEFAULT NULL,
  p_secondary_color TEXT DEFAULT NULL,
  p_altered_status TEXT DEFAULT NULL,
  p_coat_pattern TEXT DEFAULT NULL,
  p_ownership_type TEXT DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  v_count INT := 0;
BEGIN
  -- Record each field that has a value
  IF p_name IS NOT NULL THEN
    PERFORM trapper.record_cat_field_source(p_cat_id, 'name', p_name, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_breed IS NOT NULL THEN
    PERFORM trapper.record_cat_field_source(p_cat_id, 'breed', p_breed, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_sex IS NOT NULL THEN
    PERFORM trapper.record_cat_field_source(p_cat_id, 'sex', p_sex, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_primary_color IS NOT NULL THEN
    PERFORM trapper.record_cat_field_source(p_cat_id, 'primary_color', p_primary_color, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_secondary_color IS NOT NULL THEN
    PERFORM trapper.record_cat_field_source(p_cat_id, 'secondary_color', p_secondary_color, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_altered_status IS NOT NULL THEN
    PERFORM trapper.record_cat_field_source(p_cat_id, 'altered_status', p_altered_status, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_coat_pattern IS NOT NULL THEN
    PERFORM trapper.record_cat_field_source(p_cat_id, 'coat_pattern', p_coat_pattern, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  IF p_ownership_type IS NOT NULL THEN
    PERFORM trapper.record_cat_field_source(p_cat_id, 'ownership_type', p_ownership_type, p_source_system, p_source_record_id);
    v_count := v_count + 1;
  END IF;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.record_cat_field_sources_batch IS
'Convenience function to record multiple field values at once from a single source.
Returns count of fields recorded.';

-- ============================================================
-- PART 5: Create cat field sources summary view
-- ============================================================

\echo 'Creating v_cat_field_sources_summary view...'

CREATE OR REPLACE VIEW trapper.v_cat_field_sources_summary AS
SELECT
  c.cat_id,
  c.display_name,
  c.microchip,
  -- Aggregate all field sources into a JSONB object for easy API consumption
  (
    SELECT jsonb_object_agg(
      field_name,
      sources_for_field
    )
    FROM (
      SELECT
        cfs.field_name,
        jsonb_agg(
          jsonb_build_object(
            'value', cfs.field_value,
            'source', cfs.source_system,
            'observed_at', cfs.observed_at,
            'is_current', cfs.is_current,
            'confidence', cfs.confidence
          ) ORDER BY cfs.is_current DESC, cfs.confidence DESC NULLS LAST
        ) AS sources_for_field
      FROM trapper.cat_field_sources cfs
      WHERE cfs.cat_id = c.cat_id
      GROUP BY cfs.field_name
    ) field_data
  ) AS field_sources,
  -- Quick check for any conflicts
  EXISTS (
    SELECT 1
    FROM trapper.v_cat_field_conflicts conf
    WHERE conf.cat_id = c.cat_id
  ) AS has_conflicts,
  -- Count of sources per cat
  (
    SELECT COUNT(DISTINCT source_system)
    FROM trapper.cat_field_sources cfs
    WHERE cfs.cat_id = c.cat_id
  ) AS source_count
FROM trapper.sot_cats c
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW trapper.v_cat_field_sources_summary IS
'Aggregated field sources per cat for API consumption.
field_sources is a JSONB object: { "breed": [{value, source, ...}], "name": [...], ... }';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'Verification:'

SELECT 'cat_field_sources table' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'cat_field_sources')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'record_cat_field_source function' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_cat_field_source')
            THEN 'OK' ELSE 'MISSING' END AS status;

SELECT 'v_cat_field_conflicts view' AS check_item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_cat_field_conflicts')
            THEN 'OK' ELSE 'MISSING' END AS status;

\echo ''
\echo '========================================================'
\echo 'MIG_620 Complete!'
\echo '========================================================'
\echo ''
\echo 'New capabilities:'
\echo '  1. cat_field_sources table tracks per-field provenance'
\echo '  2. record_cat_field_source() stores values with source attribution'
\echo '  3. v_cat_field_conflicts shows cats with conflicting data'
\echo '  4. v_cat_field_sources_summary provides JSONB for API'
\echo ''
\echo 'Usage:'
\echo '  SELECT trapper.record_cat_field_source('
\echo '    cat_id, ''breed'', ''DSH Black'', ''clinichq'''
\echo '  );'
\echo ''
\echo '  -- Batch recording:'
\echo '  SELECT trapper.record_cat_field_sources_batch('
\echo '    cat_id, ''shelterluv'', ''sl_123'','
\echo '    p_name => ''Fluffy'', p_breed => ''DSH'''
\echo '  );'
\echo ''
