-- MIG_240: Unified Person Enrichment System
--
-- Creates a single entry point for adding/updating people from ANY data source.
-- All external systems (VolunteerHub, Clinic, Jotform, Airtable) should use
-- these functions to ensure identity resolution and data enrichment.
--
-- Key principles:
-- 1. MATCH by email first (most reliable), then phone
-- 2. CREATE new person only if no match exists
-- 3. ENRICH existing person with better/newer data
-- 4. TRACK all interactions and role changes
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_240__unified_person_enrichment.sql

\echo ''
\echo 'MIG_240: Unified Person Enrichment System'
\echo '=========================================='
\echo ''

-- ============================================================
-- 1. Person interaction history table
-- ============================================================

\echo 'Creating person_interactions table...'

CREATE TABLE IF NOT EXISTS trapper.person_interactions (
  interaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
  interaction_type TEXT NOT NULL, -- 'intake_submission', 'clinic_visit', 'volunteer_shift', 'trapping_help', etc.
  interaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_system TEXT NOT NULL, -- 'web_intake', 'clinichq', 'volunteerhub', 'airtable'
  source_record_id TEXT, -- ID in the source system
  summary TEXT, -- Brief description
  metadata JSONB, -- Additional details
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_person_interactions_person ON trapper.person_interactions(person_id);
CREATE INDEX IF NOT EXISTS idx_person_interactions_type ON trapper.person_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_person_interactions_date ON trapper.person_interactions(interaction_date DESC);

COMMENT ON TABLE trapper.person_interactions IS
'Tracks all interactions a person has had with FFSC across all systems.
Enables "show me everything about this person" queries.';

-- ============================================================
-- 2. Person role history table
-- ============================================================

\echo 'Creating person_role_history table...'

CREATE TABLE IF NOT EXISTS trapper.person_role_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),
  role_type TEXT NOT NULL, -- 'volunteer', 'foster', 'trapper', 'staff', 'requester'
  status TEXT NOT NULL, -- 'active', 'inactive', 'pending', 'removed'
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  source_system TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_person_role_history_person ON trapper.person_role_history(person_id);
CREATE INDEX IF NOT EXISTS idx_person_role_history_role ON trapper.person_role_history(role_type, status);

COMMENT ON TABLE trapper.person_role_history IS
'Tracks role changes over time. A person can be a requester, then volunteer, then foster parent - all tracked.';

-- ============================================================
-- 3. Main enrichment function
-- ============================================================

\echo 'Creating enrich_person function...'

CREATE OR REPLACE FUNCTION trapper.enrich_person(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_display_name TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT 'unknown',
  p_source_record_id TEXT DEFAULT NULL,
  p_interaction_type TEXT DEFAULT NULL,
  p_interaction_summary TEXT DEFAULT NULL,
  p_roles TEXT[] DEFAULT NULL, -- Array of roles to add: ['volunteer', 'foster']
  p_metadata JSONB DEFAULT NULL
)
RETURNS TABLE(
  person_id UUID,
  is_new BOOLEAN,
  matched_by TEXT
) AS $$
DECLARE
  v_person_id UUID;
  v_is_new BOOLEAN := FALSE;
  v_matched_by TEXT := NULL;
  v_norm_email TEXT;
  v_norm_phone TEXT;
  v_display_name TEXT;
  v_role TEXT;
BEGIN
  -- Normalize inputs
  v_norm_email := NULLIF(lower(trim(p_email)), '');
  v_norm_phone := trapper.norm_phone_us(p_phone);

  -- Build display name
  v_display_name := COALESCE(
    NULLIF(p_display_name, ''),
    NULLIF(trim(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, '')), ''),
    v_norm_email,
    v_norm_phone,
    'Unknown'
  );

  -- Check phone blacklist
  IF v_norm_phone IS NOT NULL AND EXISTS (
    SELECT 1 FROM trapper.identity_phone_blacklist WHERE phone_norm = v_norm_phone
  ) THEN
    v_norm_phone := NULL;
  END IF;

  -- Try to match by email first
  IF v_norm_email IS NOT NULL THEN
    SELECT pi.person_id INTO v_person_id
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id
    WHERE pi.id_type = 'email'
      AND pi.id_value_norm = v_norm_email
      AND p.merged_into_person_id IS NULL
    LIMIT 1;

    IF v_person_id IS NOT NULL THEN
      v_matched_by := 'email';
    END IF;
  END IF;

  -- Try phone if no email match
  IF v_person_id IS NULL AND v_norm_phone IS NOT NULL THEN
    SELECT pi.person_id INTO v_person_id
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id
    WHERE pi.id_type = 'phone'
      AND pi.id_value_norm = v_norm_phone
      AND p.merged_into_person_id IS NULL
    LIMIT 1;

    IF v_person_id IS NOT NULL THEN
      v_matched_by := 'phone';
    END IF;
  END IF;

  -- No match - create new person
  IF v_person_id IS NULL THEN
    INSERT INTO trapper.sot_people (display_name, data_source, created_at, updated_at)
    VALUES (v_display_name, p_source_system::trapper.data_source, NOW(), NOW())
    RETURNING sot_people.person_id INTO v_person_id;

    v_is_new := TRUE;
    v_matched_by := 'new';

    -- Add email identifier
    IF v_norm_email IS NOT NULL THEN
      INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system)
      VALUES (v_person_id, 'email', p_email, v_norm_email, p_source_system)
      ON CONFLICT (id_type, id_value_norm) DO NOTHING;
    END IF;

    -- Add phone identifier
    IF v_norm_phone IS NOT NULL THEN
      INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system)
      VALUES (v_person_id, 'phone', p_phone, v_norm_phone, p_source_system)
      ON CONFLICT (id_type, id_value_norm) DO NOTHING;
    END IF;
  ELSE
    -- ENRICH existing person: add missing identifiers
    IF v_norm_email IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers
      WHERE person_id = v_person_id AND id_type = 'email' AND id_value_norm = v_norm_email
    ) THEN
      INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system)
      VALUES (v_person_id, 'email', p_email, v_norm_email, p_source_system)
      ON CONFLICT (id_type, id_value_norm) DO NOTHING;
    END IF;

    IF v_norm_phone IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers
      WHERE person_id = v_person_id AND id_type = 'phone' AND id_value_norm = v_norm_phone
    ) THEN
      INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, source_system)
      VALUES (v_person_id, 'phone', p_phone, v_norm_phone, p_source_system)
      ON CONFLICT (id_type, id_value_norm) DO NOTHING;
    END IF;

    -- Update display name if current one is poor quality
    UPDATE trapper.sot_people
    SET display_name = v_display_name, updated_at = NOW()
    WHERE person_id = v_person_id
      AND (display_name IS NULL OR display_name = 'Unknown' OR display_name ~ '^\d+$');
  END IF;

  -- Log interaction if provided
  IF p_interaction_type IS NOT NULL THEN
    INSERT INTO trapper.person_interactions (
      person_id, interaction_type, interaction_date, source_system, source_record_id, summary, metadata
    ) VALUES (
      v_person_id, p_interaction_type, NOW(), p_source_system, p_source_record_id, p_interaction_summary, p_metadata
    );
  END IF;

  -- Add/update roles if provided
  IF p_roles IS NOT NULL THEN
    FOREACH v_role IN ARRAY p_roles LOOP
      -- Check if role already exists and is active
      IF NOT EXISTS (
        SELECT 1 FROM trapper.person_role_history
        WHERE person_id = v_person_id AND role_type = v_role AND status = 'active' AND ended_at IS NULL
      ) THEN
        -- End any previous instance of this role
        UPDATE trapper.person_role_history
        SET ended_at = NOW(), status = 'replaced'
        WHERE person_id = v_person_id AND role_type = v_role AND ended_at IS NULL;

        -- Add new role
        INSERT INTO trapper.person_role_history (person_id, role_type, status, source_system)
        VALUES (v_person_id, v_role, 'active', p_source_system);
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT v_person_id, v_is_new, v_matched_by;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.enrich_person IS
'Universal function to add or update a person from any data source.
Handles identity matching, enrichment, interaction logging, and role tracking.
Use this from ALL sync scripts and intake handlers.';

-- ============================================================
-- 4. Helper: Remove role from person
-- ============================================================

\echo 'Creating remove_person_role function...'

CREATE OR REPLACE FUNCTION trapper.remove_person_role(
  p_person_id UUID,
  p_role_type TEXT,
  p_source_system TEXT DEFAULT 'manual',
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE trapper.person_role_history
  SET ended_at = NOW(),
      status = 'removed',
      notes = COALESCE(notes || E'\n', '') || 'Removed: ' || COALESCE(p_reason, 'No reason given') || ' (' || p_source_system || ')'
  WHERE person_id = p_person_id
    AND role_type = p_role_type
    AND ended_at IS NULL
    AND status = 'active';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. View: Person with all roles and stats
-- ============================================================

\echo 'Creating v_person_profile view...'

CREATE OR REPLACE VIEW trapper.v_person_profile AS
SELECT
  p.person_id,
  p.display_name,
  p.atlas_id,
  p.created_at,
  p.data_source,
  -- Contact info
  (SELECT id_value_raw FROM trapper.person_identifiers WHERE person_id = p.person_id AND id_type = 'email' LIMIT 1) AS email,
  (SELECT id_value_raw FROM trapper.person_identifiers WHERE person_id = p.person_id AND id_type = 'phone' LIMIT 1) AS phone,
  -- Active roles
  (SELECT array_agg(DISTINCT role_type) FROM trapper.person_role_history WHERE person_id = p.person_id AND status = 'active' AND ended_at IS NULL) AS active_roles,
  -- Interaction counts
  (SELECT COUNT(*) FROM trapper.person_interactions WHERE person_id = p.person_id) AS interaction_count,
  (SELECT MAX(interaction_date) FROM trapper.person_interactions WHERE person_id = p.person_id) AS last_interaction,
  -- Intake submissions
  (SELECT COUNT(*) FROM trapper.web_intake_submissions WHERE matched_person_id = p.person_id) AS intake_submissions,
  -- Is this a known trapper/volunteer?
  EXISTS (SELECT 1 FROM trapper.person_roles WHERE person_id = p.person_id AND role IN ('ffsc_trapper', 'community_trapper')) AS is_trapper,
  EXISTS (SELECT 1 FROM trapper.person_role_history WHERE person_id = p.person_id AND role_type = 'volunteer' AND status = 'active') AS is_volunteer,
  EXISTS (SELECT 1 FROM trapper.person_role_history WHERE person_id = p.person_id AND role_type = 'foster' AND status = 'active') AS is_foster
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_profile IS
'Complete person profile with contact info, roles, and interaction summary.
Use this for person search and profile pages.';

-- ============================================================
-- 6. Search function
-- ============================================================

\echo 'Creating search_people function...'

CREATE OR REPLACE FUNCTION trapper.search_people(
  p_query TEXT,
  p_limit INT DEFAULT 25
)
RETURNS TABLE(
  person_id UUID,
  display_name TEXT,
  email TEXT,
  phone TEXT,
  active_roles TEXT[],
  interaction_count BIGINT,
  last_interaction TIMESTAMPTZ,
  match_type TEXT
) AS $$
DECLARE
  v_norm_query TEXT;
  v_norm_phone TEXT;
BEGIN
  v_norm_query := lower(trim(p_query));
  v_norm_phone := trapper.norm_phone_us(p_query);

  RETURN QUERY
  WITH matches AS (
    -- Match by name
    SELECT p.person_id, 'name' as match_type, 1 as priority
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
      AND lower(p.display_name) LIKE '%' || v_norm_query || '%'

    UNION ALL

    -- Match by email
    SELECT pi.person_id, 'email' as match_type, 2 as priority
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id
    WHERE p.merged_into_person_id IS NULL
      AND pi.id_type = 'email'
      AND pi.id_value_norm LIKE '%' || v_norm_query || '%'

    UNION ALL

    -- Match by phone
    SELECT pi.person_id, 'phone' as match_type, 3 as priority
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id
    WHERE p.merged_into_person_id IS NULL
      AND pi.id_type = 'phone'
      AND (pi.id_value_norm LIKE '%' || v_norm_phone || '%' OR pi.id_value_raw LIKE '%' || p_query || '%')
    WHERE v_norm_phone IS NOT NULL OR p_query ~ '^\d'
  )
  SELECT DISTINCT ON (vp.person_id)
    vp.person_id,
    vp.display_name,
    vp.email,
    vp.phone,
    vp.active_roles,
    vp.interaction_count,
    vp.last_interaction,
    m.match_type
  FROM matches m
  JOIN trapper.v_person_profile vp ON vp.person_id = m.person_id
  ORDER BY vp.person_id, m.priority
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.search_people IS
'Search for people by name, email, or phone. Returns profile summary with match type.';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo 'MIG_240 Complete!'
\echo ''
\echo 'New tables:'
\echo '  - person_interactions: All interactions with FFSC'
\echo '  - person_role_history: Role changes over time'
\echo ''
\echo 'New functions:'
\echo '  - enrich_person(): Add/update person from any source'
\echo '  - remove_person_role(): Deactivate a role'
\echo '  - search_people(): Find people by name/email/phone'
\echo ''
\echo 'New views:'
\echo '  - v_person_profile: Complete person profile'
\echo ''
\echo 'Usage example:'
\echo '  SELECT * FROM trapper.enrich_person('
\echo '    p_email := ''john@example.com'','
\echo '    p_phone := ''707-555-1234'','
\echo '    p_first_name := ''John'','
\echo '    p_last_name := ''Doe'','
\echo '    p_source_system := ''volunteerhub'','
\echo '    p_interaction_type := ''volunteer_shift'','
\echo '    p_roles := ARRAY[''volunteer'', ''foster'']'
\echo '  );'
\echo ''
