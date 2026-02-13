-- MIG_2027: Supplemental VH/SL Components
-- Adds missing tables and functions for cron compatibility

-- ============================================================================
-- 1. Create ops.ingest_runs table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.ingest_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL,
  source_table TEXT,
  run_type TEXT,  -- 'full', 'incremental'
  status TEXT NOT NULL DEFAULT 'running',
  records_fetched INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_errored INTEGER DEFAULT 0,
  duration_ms INTEGER,
  metadata JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_source
  ON ops.ingest_runs(source_system, started_at DESC);

-- ============================================================================
-- 2. Create sot.assign_place_context function (if needed)
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.assign_place_context(
  p_place_id UUID,
  p_context_type TEXT,
  p_evidence_notes TEXT DEFAULT NULL,
  p_confidence NUMERIC DEFAULT 0.8,
  p_source_system TEXT DEFAULT NULL,
  p_source_record_id TEXT DEFAULT NULL,
  p_assigned_by TEXT DEFAULT 'system'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_context_id UUID;
BEGIN
  -- Check if context type is valid
  IF NOT EXISTS (
    SELECT 1 FROM sot.place_context_types WHERE context_type = p_context_type
  ) THEN
    -- Create the context type if it doesn't exist
    INSERT INTO sot.place_context_types (context_type, description)
    VALUES (p_context_type, 'Auto-created context type')
    ON CONFLICT (context_type) DO NOTHING;
  END IF;

  -- Insert or update place context
  INSERT INTO sot.place_contexts (
    place_id, context_type, evidence_notes, confidence,
    source_system, source_record_id, assigned_by
  ) VALUES (
    p_place_id, p_context_type, p_evidence_notes, p_confidence,
    p_source_system, p_source_record_id, p_assigned_by
  )
  ON CONFLICT (place_id, context_type) DO UPDATE SET
    evidence_notes = COALESCE(EXCLUDED.evidence_notes, sot.place_contexts.evidence_notes),
    confidence = GREATEST(EXCLUDED.confidence, sot.place_contexts.confidence),
    updated_at = NOW()
  RETURNING context_id INTO v_context_id;

  RETURN v_context_id;
END;
$$;

-- ============================================================================
-- 3. Create place_contexts and place_context_types tables if needed
-- ============================================================================
CREATE TABLE IF NOT EXISTS sot.place_context_types (
  context_type TEXT PRIMARY KEY,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed common context types
INSERT INTO sot.place_context_types (context_type, description)
VALUES
  ('colony', 'Known cat colony location'),
  ('foster_home', 'Foster parent residence'),
  ('volunteer_location', 'Volunteer home address'),
  ('feeding_station', 'Community feeding station'),
  ('trapping_site', 'TNR trapping location'),
  ('clinic', 'Veterinary clinic'),
  ('shelter', 'Animal shelter'),
  ('rescue', 'Animal rescue organization')
ON CONFLICT (context_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS sot.place_contexts (
  context_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id UUID NOT NULL REFERENCES sot.places(place_id),
  context_type TEXT NOT NULL REFERENCES sot.place_context_types(context_type),
  evidence_notes TEXT,
  confidence NUMERIC(3,2) DEFAULT 0.8,
  source_system TEXT,
  source_record_id TEXT,
  assigned_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_place_contexts_unique
  ON sot.place_contexts(place_id, context_type);

-- ============================================================================
-- 4. Create sot.link_vh_volunteer_to_place function
-- ============================================================================
CREATE OR REPLACE FUNCTION sot.link_vh_volunteer_to_place(p_volunteerhub_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_vol RECORD;
  v_address TEXT;
  v_place_id UUID;
  v_has_foster_role BOOLEAN;
BEGIN
  -- Get the volunteer record
  SELECT vv.volunteerhub_id, vv.matched_person_id, vv.display_name,
         vv.address, vv.full_address
  INTO v_vol
  FROM source.volunteerhub_volunteers vv
  WHERE vv.volunteerhub_id = p_volunteerhub_id;

  IF v_vol IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'volunteerhub_id', p_volunteerhub_id);
  END IF;

  IF v_vol.matched_person_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_matched', 'volunteerhub_id', p_volunteerhub_id);
  END IF;

  -- Check if already has a person_place relationship
  IF EXISTS (
    SELECT 1 FROM sot.person_place
    WHERE person_id = v_vol.matched_person_id
  ) THEN
    -- Check for foster_home tagging
    SELECT EXISTS (
      SELECT 1 FROM sot.person_roles pr
      WHERE pr.person_id = v_vol.matched_person_id
        AND pr.role = 'foster' AND pr.role_status = 'active'
    ) INTO v_has_foster_role;

    IF v_has_foster_role THEN
      -- Tag all residential places as foster_home
      FOR v_place_id IN
        SELECT ppr.place_id
        FROM sot.person_place ppr
        WHERE ppr.person_id = v_vol.matched_person_id
          AND ppr.role IN ('resident', 'owner')
      LOOP
        PERFORM sot.assign_place_context(
          p_place_id := v_place_id,
          p_context_type := 'foster_home',
          p_evidence_notes := 'Foster parent: ' || v_vol.display_name || ' (approved via VolunteerHub)',
          p_confidence := 0.85,
          p_source_system := 'volunteerhub',
          p_source_record_id := v_vol.volunteerhub_id,
          p_assigned_by := 'link_vh_volunteer_to_place'
        );
      END LOOP;
    END IF;

    RETURN jsonb_build_object('status', 'already_linked', 'person_id', v_vol.matched_person_id,
                              'foster_tagged', v_has_foster_role);
  END IF;

  -- Get the best address
  v_address := COALESCE(NULLIF(TRIM(v_vol.full_address), ''), NULLIF(TRIM(v_vol.address), ''));

  -- Skip empty/garbage addresses
  IF v_address IS NULL
     OR v_address ~ '^\s*,\s*(,\s*)*$'
     OR v_address ~* '^\s*p\.?o\.?\s+box'
     OR LENGTH(TRIM(v_address)) < 8
     OR v_address ~* '^[x]+$'
  THEN
    RETURN jsonb_build_object(
      'status', 'no_usable_address',
      'person_id', v_vol.matched_person_id,
      'address_raw', v_vol.address
    );
  END IF;

  -- Find or create the place
  v_place_id := sot.find_or_create_place_deduped(
    p_formatted_address := v_address,
    p_display_name := NULL,
    p_lat := NULL,
    p_lng := NULL,
    p_source_system := 'volunteerhub'
  );

  IF v_place_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'place_creation_failed',
      'person_id', v_vol.matched_person_id,
      'address', v_address
    );
  END IF;

  -- Create person_place relationship
  INSERT INTO sot.person_place (
    person_id, place_id, role, source_system, source_table,
    source_row_id, valid_from, confidence, note, created_by
  ) VALUES (
    v_vol.matched_person_id,
    v_place_id,
    'resident',
    'volunteerhub',
    'volunteerhub_volunteers',
    v_vol.volunteerhub_id,
    CURRENT_DATE,
    0.75,
    'Auto-linked from VolunteerHub address',
    'link_vh_volunteer_to_place'
  )
  ON CONFLICT DO NOTHING;

  -- Tag as volunteer_location
  PERFORM sot.assign_place_context(
    p_place_id := v_place_id,
    p_context_type := 'volunteer_location',
    p_evidence_notes := 'VolunteerHub address for ' || v_vol.display_name,
    p_source_system := 'volunteerhub',
    p_source_record_id := v_vol.volunteerhub_id
  );

  -- Check for foster role
  SELECT EXISTS (
    SELECT 1 FROM sot.person_roles pr
    WHERE pr.person_id = v_vol.matched_person_id
      AND pr.role = 'foster' AND pr.role_status = 'active'
  ) INTO v_has_foster_role;

  IF v_has_foster_role THEN
    PERFORM sot.assign_place_context(
      p_place_id := v_place_id,
      p_context_type := 'foster_home',
      p_evidence_notes := 'Foster parent: ' || v_vol.display_name || ' (approved via VolunteerHub)',
      p_confidence := 0.85,
      p_source_system := 'volunteerhub',
      p_source_record_id := v_vol.volunteerhub_id,
      p_assigned_by := 'link_vh_volunteer_to_place'
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'linked',
    'person_id', v_vol.matched_person_id,
    'place_id', v_place_id,
    'address', v_address,
    'display_name', v_vol.display_name,
    'foster_tagged', v_has_foster_role
  );
END;
$$;

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT ALL ON ops.ingest_runs TO postgres;
GRANT ALL ON sot.place_context_types TO postgres;
GRANT ALL ON sot.place_contexts TO postgres;
GRANT EXECUTE ON FUNCTION sot.assign_place_context(UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO postgres;
GRANT EXECUTE ON FUNCTION sot.link_vh_volunteer_to_place(TEXT) TO postgres;

-- ============================================================================
-- Summary
-- ============================================================================
-- Created tables:
-- - ops.ingest_runs (run logging)
-- - sot.place_context_types (context type definitions)
-- - sot.place_contexts (place tagging)
--
-- Created functions:
-- - sot.assign_place_context()
-- - sot.link_vh_volunteer_to_place()
