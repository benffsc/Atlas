-- MIG_2015: V2 Tables in Proper Schemas
--
-- Purpose: Create V2 tables in the correct schema locations:
--   - sot.* for canonical/reference data
--   - ops.* for operational/workflow data
--   - source.* for raw import data
--
-- Also fixes auth tables (move from trapper.* to ops.*)
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2015: V2 Tables in Proper Schemas'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. SOT.CONDITION_TYPES (Reference table for place conditions)
-- ============================================================================

\echo '1. Creating sot.condition_types...'

CREATE TABLE IF NOT EXISTS sot.condition_types (
    condition_type TEXT PRIMARY KEY,
    display_label TEXT NOT NULL,
    description TEXT,
    default_severity TEXT,
    is_ecological_significant BOOLEAN DEFAULT TRUE,
    display_color TEXT,
    display_order INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sot.condition_types VALUES
    ('hoarding', 'Hoarding Situation', 'Large number of cats in poor conditions', 'severe', TRUE, '#9333ea', 1),
    ('breeding_crisis', 'Breeding Crisis', 'Rapid uncontrolled breeding', 'severe', TRUE, '#dc2626', 2),
    ('disease_outbreak', 'Disease Outbreak', 'FeLV/FIV or other disease cluster', 'critical', TRUE, '#ef4444', 3),
    ('feeding_station', 'Feeding Station', 'Regular outdoor feeding attracting cats', 'moderate', TRUE, '#f59e0b', 4),
    ('abandonment', 'Abandonment', 'Cats left behind by previous occupant', 'moderate', TRUE, '#8b5cf6', 5),
    ('neglect', 'Neglect Situation', 'Cats present but not properly cared for', 'moderate', FALSE, '#6b7280', 6),
    ('difficult_client', 'Difficult Client', 'Safety or communication concerns', 'minor', FALSE, '#f97316', 7),
    ('resolved_colony', 'Resolved Colony', 'TNR completed, population managed', 'minor', FALSE, '#10b981', 8),
    ('historical_source', 'Historical Source', 'Known historical breeding/source site', 'moderate', TRUE, '#7c3aed', 9)
ON CONFLICT (condition_type) DO NOTHING;

COMMENT ON TABLE sot.condition_types IS
'V2 SOT: Reference table for place condition types.
Used for ecological context and historical tracking.';

\echo '   Created sot.condition_types'

-- ============================================================================
-- 2. SOT.PLACE_CONDITIONS (Historical place conditions)
-- ============================================================================

\echo ''
\echo '2. Creating sot.place_conditions...'

CREATE TABLE IF NOT EXISTS sot.place_conditions (
    condition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID NOT NULL REFERENCES sot.places(place_id),

    -- What condition
    condition_type TEXT NOT NULL REFERENCES sot.condition_types(condition_type),
    severity TEXT NOT NULL DEFAULT 'moderate' CHECK (severity IN ('minor', 'moderate', 'severe', 'critical')),

    -- Valid time: When was this TRUE in reality?
    valid_from DATE NOT NULL,
    valid_to DATE,  -- NULL = ongoing

    -- Transaction time: When did we LEARN about this?
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    recorded_by TEXT,

    -- Context
    description TEXT,
    peak_cat_count INT,
    intervention_type TEXT CHECK (intervention_type IN ('tnr', 'removal', 'surrender', 'eviction', 'none')),
    outcome TEXT CHECK (outcome IN ('resolved', 'improved', 'ongoing', 'abandoned')),

    -- Ecological significance
    estimated_dispersed_cats INT,
    ecological_impact TEXT CHECK (ecological_impact IN ('minimal', 'local', 'regional', 'significant')),

    -- Provenance
    source_type TEXT NOT NULL DEFAULT 'staff_observation',
    source_system TEXT,
    source_record_id TEXT,
    evidence_notes TEXT,

    -- Soft delete / supersede
    superseded_at TIMESTAMPTZ,
    superseded_by UUID REFERENCES sot.place_conditions(condition_id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sot_place_conditions_place
    ON sot.place_conditions(place_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sot_place_conditions_type
    ON sot.place_conditions(condition_type) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sot_place_conditions_valid
    ON sot.place_conditions(valid_from, valid_to) WHERE superseded_at IS NULL;

COMMENT ON TABLE sot.place_conditions IS
'V2 SOT: Bitemporal history of place conditions (hoarding, disease, etc.).
Supports operational queries and ecological analysis.';

\echo '   Created sot.place_conditions'

-- ============================================================================
-- 3. SOT.COLONY_ESTIMATES (Place ecology data)
-- ============================================================================

\echo ''
\echo '3. Creating sot.colony_estimates...'

CREATE TABLE IF NOT EXISTS sot.colony_estimates (
    estimate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Location
    place_id UUID NOT NULL REFERENCES sot.places(place_id) ON DELETE CASCADE,

    -- The estimate
    total_cats INTEGER,
    adult_count INTEGER,
    kitten_count INTEGER,
    altered_count INTEGER,
    unaltered_count INTEGER,
    friendly_count INTEGER,
    feral_count INTEGER,
    eartip_count_observed INTEGER,  -- Cats observed with ear tips

    -- Source classification
    source_type TEXT NOT NULL CHECK (source_type IN (
        'verified_cats', 'post_clinic_survey', 'trapper_site_visit',
        'manual_observation', 'trapping_request', 'appointment_request', 'intake_form'
    )),
    source_entity_type TEXT,
    source_entity_id UUID,

    -- Who reported and when
    reported_by_person_id UUID REFERENCES sot.people(person_id),
    observation_date DATE,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Reliability indicators
    is_firsthand BOOLEAN DEFAULT TRUE,
    notes TEXT,

    -- Provenance
    source_system TEXT,
    source_record_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL DEFAULT 'system',

    -- Prevent duplicate imports
    UNIQUE (source_system, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_sot_colony_estimates_place
    ON sot.colony_estimates(place_id);
CREATE INDEX IF NOT EXISTS idx_sot_colony_estimates_date
    ON sot.colony_estimates(observation_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_sot_colony_estimates_source
    ON sot.colony_estimates(source_type);

COMMENT ON TABLE sot.colony_estimates IS
'V2 SOT: Colony size estimates from multiple sources.
Tracks cat counts, altered/unaltered, with confidence scoring.';

\echo '   Created sot.colony_estimates'

-- ============================================================================
-- 4. SOT.OBSERVATION_ZONES (Geographic survey zones)
-- ============================================================================

\echo ''
\echo '4. Creating sot.observation_zones...'

CREATE TABLE IF NOT EXISTS sot.observation_zones (
    zone_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Zone identification
    zone_code TEXT UNIQUE NOT NULL,
    zone_name TEXT,
    service_zone TEXT,

    -- Geographic definition
    boundary_geom GEOMETRY(Polygon, 4326),
    centroid GEOGRAPHY(Point, 4326),
    area_sq_km NUMERIC(10,4),

    -- Methodology
    creation_method TEXT NOT NULL CHECK (creation_method IN (
        'grid_based', 'cluster_based', 'manual_definition', 'colony_based', 'feeding_station'
    )),
    creation_parameters JSONB,
    methodology_notes TEXT,

    -- Anchor point
    anchor_place_id UUID REFERENCES sot.places(place_id),
    anchor_selection_reason TEXT,

    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'merged', 'archived')),
    merged_into_zone_id UUID REFERENCES sot.observation_zones(zone_id),

    -- Audit trail
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_sot_obs_zones_status
    ON sot.observation_zones(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sot_obs_zones_boundary
    ON sot.observation_zones USING GIST (boundary_geom);

COMMENT ON TABLE sot.observation_zones IS
'V2 SOT: Observation zones for field survey planning.
Scientific basis: Stratified sampling design (Krebs 1999).';

\echo '   Created sot.observation_zones'

-- ============================================================================
-- 5. SOT.PLACE_OBSERVATION_ZONE (Links places to zones)
-- ============================================================================

\echo ''
\echo '5. Creating sot.place_observation_zone...'

CREATE TABLE IF NOT EXISTS sot.place_observation_zone (
    place_id UUID NOT NULL REFERENCES sot.places(place_id),
    zone_id UUID NOT NULL REFERENCES sot.observation_zones(zone_id),

    assignment_method TEXT NOT NULL CHECK (assignment_method IN (
        'automatic_proximity', 'automatic_clustering', 'manual_assignment', 'feeding_station_anchor'
    )),
    distance_to_anchor_m NUMERIC(10,2),

    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by TEXT,

    PRIMARY KEY (place_id, zone_id)
);

CREATE INDEX IF NOT EXISTS idx_sot_poz_zone ON sot.place_observation_zone(zone_id);

COMMENT ON TABLE sot.place_observation_zone IS
'V2 SOT: Links places to observation zones for survey purposes.
A place can belong to multiple zones.';

\echo '   Created sot.place_observation_zone'

-- ============================================================================
-- 6. OPS.MAP_ANNOTATIONS (Staff map notes)
-- ============================================================================

\echo ''
\echo '6. Creating ops.map_annotations...'

CREATE TABLE IF NOT EXISTS ops.map_annotations (
    annotation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location GEOGRAPHY(Point, 4326) NOT NULL,
    label TEXT NOT NULL CHECK (length(label) > 0 AND length(label) <= 100),
    note TEXT CHECK (note IS NULL OR length(note) <= 2000),
    photo_url TEXT,
    annotation_type TEXT NOT NULL DEFAULT 'general' CHECK (annotation_type IN (
        'general', 'colony_sighting', 'trap_location', 'hazard', 'feeding_site', 'other'
    )),
    created_by TEXT NOT NULL DEFAULT 'staff',
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_map_annotations_location
    ON ops.map_annotations USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_ops_map_annotations_active
    ON ops.map_annotations (is_active) WHERE is_active = TRUE;

COMMENT ON TABLE ops.map_annotations IS
'V2 OPS: Lightweight operational map notes placed by staff.
Used for colony sightings, trap locations, hazards, feeding sites.';

\echo '   Created ops.map_annotations'

-- ============================================================================
-- 7. OPS.STAFF (Move from trapper.staff)
-- ============================================================================

\echo ''
\echo '7. Creating ops.staff...'

-- Check if trapper.staff exists and has data
DO $$
DECLARE
    v_has_trapper_staff BOOLEAN;
    v_staff_count INT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'staff'
    ) INTO v_has_trapper_staff;

    IF v_has_trapper_staff THEN
        SELECT COUNT(*) INTO v_staff_count FROM trapper.staff;
        RAISE NOTICE 'trapper.staff exists with % rows - will migrate', v_staff_count;
    ELSE
        RAISE NOTICE 'trapper.staff does not exist - creating ops.staff fresh';
    END IF;
END $$;

-- Create ops.staff table
CREATE TABLE IF NOT EXISTS ops.staff (
    staff_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    auth_role TEXT NOT NULL DEFAULT 'staff' CHECK (auth_role IN ('admin', 'staff', 'volunteer')),
    person_id UUID REFERENCES sot.people(person_id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    password_change_required BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_staff_email ON ops.staff(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_ops_staff_person ON ops.staff(person_id) WHERE person_id IS NOT NULL;

COMMENT ON TABLE ops.staff IS
'V2 OPS: Staff users for authentication.
Moved from trapper.staff for proper V2 schema organization.';

-- Migrate data from trapper.staff if exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'staff'
    ) THEN
        INSERT INTO ops.staff (
            staff_id, display_name, email, password_hash, auth_role, person_id,
            is_active, login_attempts, locked_until, password_change_required,
            created_at, updated_at
        )
        SELECT
            staff_id, display_name, email, password_hash, auth_role, person_id,
            is_active, login_attempts, locked_until, password_change_required,
            created_at, updated_at
        FROM trapper.staff
        ON CONFLICT (email) DO NOTHING;

        RAISE NOTICE 'Migrated staff from trapper.staff to ops.staff';
    END IF;
END $$;

\echo '   Created ops.staff'

-- ============================================================================
-- 8. OPS.STAFF_SESSIONS (Move from trapper.staff_sessions)
-- ============================================================================

\echo ''
\echo '8. Creating ops.staff_sessions...'

CREATE TABLE IF NOT EXISTS ops.staff_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES ops.staff(staff_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    invalidated_at TIMESTAMPTZ,
    invalidation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_staff_sessions_token
    ON ops.staff_sessions(token_hash) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ops_staff_sessions_staff
    ON ops.staff_sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_ops_staff_sessions_expires
    ON ops.staff_sessions(expires_at) WHERE invalidated_at IS NULL;

COMMENT ON TABLE ops.staff_sessions IS
'V2 OPS: Staff login sessions.
Moved from trapper.staff_sessions for proper V2 schema organization.';

\echo '   Created ops.staff_sessions'

-- ============================================================================
-- 9. SESSION FUNCTIONS (Updated to use ops.*)
-- ============================================================================

\echo ''
\echo '9. Creating session functions in ops.*...'

-- Create session
CREATE OR REPLACE FUNCTION ops.create_staff_session(
    p_staff_id UUID,
    p_token_hash TEXT,
    p_expiry_hours INTEGER DEFAULT 24,
    p_ip_address TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_session_id UUID;
BEGIN
    INSERT INTO ops.staff_sessions (staff_id, token_hash, expires_at, ip_address, user_agent)
    VALUES (p_staff_id, p_token_hash, NOW() + (p_expiry_hours || ' hours')::INTERVAL, p_ip_address, p_user_agent)
    RETURNING session_id INTO v_session_id;

    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql;

-- Validate session
CREATE OR REPLACE FUNCTION ops.validate_staff_session(p_token_hash TEXT)
RETURNS TABLE(
    staff_id UUID,
    display_name TEXT,
    email TEXT,
    auth_role TEXT,
    person_id UUID,
    session_id UUID
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.staff_id,
        s.display_name,
        s.email,
        s.auth_role,
        s.person_id,
        ss.session_id
    FROM ops.staff_sessions ss
    JOIN ops.staff s ON s.staff_id = ss.staff_id
    WHERE ss.token_hash = p_token_hash
      AND ss.expires_at > NOW()
      AND ss.invalidated_at IS NULL
      AND s.is_active = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Invalidate session
CREATE OR REPLACE FUNCTION ops.invalidate_staff_session(
    p_token_hash TEXT,
    p_reason TEXT DEFAULT 'logout'
) RETURNS BOOLEAN AS $$
DECLARE
    v_updated BOOLEAN;
BEGIN
    UPDATE ops.staff_sessions
    SET invalidated_at = NOW(),
        invalidation_reason = p_reason
    WHERE token_hash = p_token_hash
      AND invalidated_at IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql;

\echo '   Created ops session functions'

-- ============================================================================
-- 10. COMPATIBILITY VIEWS (trapper.* → V2)
-- ============================================================================

\echo ''
\echo '10. Creating compatibility views in trapper.*...'

-- trapper.staff → ops.staff
CREATE OR REPLACE VIEW trapper.staff AS
SELECT * FROM ops.staff;

-- trapper.staff_sessions → ops.staff_sessions
CREATE OR REPLACE VIEW trapper.staff_sessions AS
SELECT * FROM ops.staff_sessions;

-- trapper.map_annotations → ops.map_annotations
CREATE OR REPLACE VIEW trapper.map_annotations AS
SELECT * FROM ops.map_annotations;

-- trapper.place_colony_estimates → sot.colony_estimates
CREATE OR REPLACE VIEW trapper.place_colony_estimates AS
SELECT * FROM sot.colony_estimates;

-- trapper.observation_zones → sot.observation_zones
CREATE OR REPLACE VIEW trapper.observation_zones AS
SELECT * FROM sot.observation_zones;

-- trapper.place_observation_zone → sot.place_observation_zone
CREATE OR REPLACE VIEW trapper.place_observation_zone AS
SELECT * FROM sot.place_observation_zone;

-- trapper.place_condition_types → sot.condition_types
CREATE OR REPLACE VIEW trapper.place_condition_types AS
SELECT * FROM sot.condition_types;

-- trapper.place_condition_history → sot.place_conditions
CREATE OR REPLACE VIEW trapper.place_condition_history AS
SELECT * FROM sot.place_conditions;

-- Wrapper functions for backward compatibility
CREATE OR REPLACE FUNCTION trapper.create_staff_session(
    p_staff_id UUID,
    p_token_hash TEXT,
    p_expiry_hours INTEGER DEFAULT 24,
    p_ip_address TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
) RETURNS UUID AS $$
BEGIN
    RETURN ops.create_staff_session(p_staff_id, p_token_hash, p_expiry_hours, p_ip_address, p_user_agent);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.validate_staff_session(p_token_hash TEXT)
RETURNS TABLE(
    staff_id UUID,
    display_name TEXT,
    email TEXT,
    auth_role TEXT,
    person_id UUID,
    session_id UUID
) AS $$
BEGIN
    RETURN QUERY SELECT * FROM ops.validate_staff_session(p_token_hash);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.invalidate_staff_session(
    p_token_hash TEXT,
    p_reason TEXT DEFAULT 'logout'
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN ops.invalidate_staff_session(p_token_hash, p_reason);
END;
$$ LANGUAGE plpgsql;

\echo '   Created compatibility views and functions'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'New V2 tables created:'
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('sot', 'ops')
  AND table_name IN (
      'condition_types', 'place_conditions', 'colony_estimates',
      'observation_zones', 'place_observation_zone', 'map_annotations',
      'staff', 'staff_sessions'
  )
ORDER BY table_schema, table_name;

\echo ''
\echo 'Compatibility views created:'
SELECT schemaname, viewname
FROM pg_views
WHERE schemaname = 'trapper'
  AND viewname IN (
      'staff', 'staff_sessions', 'map_annotations', 'place_colony_estimates',
      'observation_zones', 'place_observation_zone', 'place_condition_types',
      'place_condition_history'
  )
ORDER BY viewname;

\echo ''
\echo '=============================================='
\echo '  MIG_2015 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created V2 tables in proper schemas:'
\echo '  - sot.condition_types (reference data)'
\echo '  - sot.place_conditions (place history)'
\echo '  - sot.colony_estimates (ecology data)'
\echo '  - sot.observation_zones (survey zones)'
\echo '  - sot.place_observation_zone (zone links)'
\echo '  - ops.map_annotations (staff notes)'
\echo '  - ops.staff (auth - moved from trapper)'
\echo '  - ops.staff_sessions (auth - moved from trapper)'
\echo ''
\echo 'Created compatibility views in trapper.*'
\echo 'All session functions work via both ops.* and trapper.*'
\echo ''
