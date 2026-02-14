\echo '=== MIG_464: Place Context Tagging System ==='
\echo 'Transform SoT Places into profiles with relevance tagging (colony, foster, volunteer, adopter)'
\echo ''

-- ============================================================================
-- 1. Create place_context_types lookup table
-- ============================================================================

\echo 'Creating place_context_types table...'

CREATE TABLE IF NOT EXISTS trapper.place_context_types (
    context_type TEXT PRIMARY KEY,
    display_label TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.place_context_types IS
'Lookup table for place context types. Controls what relevance tags can be assigned to places.';

-- Seed with standard context types
INSERT INTO trapper.place_context_types (context_type, display_label, description, sort_order) VALUES
    ('colony_site', 'Colony Site', 'Active or historical colony location with feral/community cats', 10),
    ('foster_home', 'Foster Home', 'Location where cats are fostered temporarily', 20),
    ('adopter_residence', 'Adopter Residence', 'Home where adopted cats live', 30),
    ('volunteer_location', 'Volunteer Location', 'Volunteer''s home or base of operations', 40),
    ('trapper_base', 'Trapper Base', 'Trapper''s home or staging location', 45),
    ('trap_pickup', 'Trap Pickup', 'Location for trap equipment pickup/dropoff', 50),
    ('clinic', 'Veterinary Clinic', 'Vet clinic or medical facility', 60),
    ('shelter', 'Shelter', 'Animal shelter or rescue facility', 70),
    ('partner_org', 'Partner Organization', 'Partner organization (Sonoma Humane, etc.)', 80),
    ('feeding_station', 'Feeding Station', 'Regular feeding location for community cats', 90)
ON CONFLICT (context_type) DO UPDATE SET
    display_label = EXCLUDED.display_label,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order;

\echo 'Seeded place_context_types:'
SELECT context_type, display_label FROM trapper.place_context_types ORDER BY sort_order;

-- ============================================================================
-- 2. Create place_contexts table
-- ============================================================================

\echo ''
\echo 'Creating place_contexts table...'

CREATE TABLE IF NOT EXISTS trapper.place_contexts (
    context_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID NOT NULL REFERENCES trapper.places(place_id) ON DELETE CASCADE,
    context_type TEXT NOT NULL REFERENCES trapper.place_context_types(context_type),

    -- Temporal validity
    valid_from DATE,
    valid_to DATE,  -- NULL = currently active

    -- Evidence/provenance
    evidence_type TEXT,  -- 'request', 'appointment', 'outcome', 'manual', 'inferred'
    evidence_entity_id UUID,  -- ID of request/appointment/etc that established this
    evidence_notes TEXT,

    -- Confidence & tracking
    confidence NUMERIC(3,2) DEFAULT 0.80 CHECK (confidence >= 0 AND confidence <= 1),
    source_system TEXT,
    source_record_id TEXT,
    assigned_by TEXT,  -- User or system that assigned
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    is_verified BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One active context per type per place (can have historical)
    UNIQUE NULLS NOT DISTINCT (place_id, context_type, valid_to)
);

COMMENT ON TABLE trapper.place_contexts IS
'Tags places with contextual relevance (colony, foster, adopter, etc.).
A place can have multiple contexts. valid_to=NULL means currently active.';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_place_contexts_place_id
    ON trapper.place_contexts(place_id);

CREATE INDEX IF NOT EXISTS idx_place_contexts_type
    ON trapper.place_contexts(context_type);

CREATE INDEX IF NOT EXISTS idx_place_contexts_active
    ON trapper.place_contexts(place_id, context_type)
    WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_place_contexts_evidence
    ON trapper.place_contexts(evidence_entity_id)
    WHERE evidence_entity_id IS NOT NULL;

-- ============================================================================
-- 3. Create assign_place_context function (idempotent)
-- ============================================================================

\echo ''
\echo 'Creating assign_place_context function...'

CREATE OR REPLACE FUNCTION trapper.assign_place_context(
    p_place_id UUID,
    p_context_type TEXT,
    p_valid_from DATE DEFAULT NULL,
    p_evidence_type TEXT DEFAULT 'inferred',
    p_evidence_entity_id UUID DEFAULT NULL,
    p_evidence_notes TEXT DEFAULT NULL,
    p_confidence NUMERIC DEFAULT 0.80,
    p_source_system TEXT DEFAULT 'atlas',
    p_source_record_id TEXT DEFAULT NULL,
    p_assigned_by TEXT DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
    v_context_id UUID;
    v_existing_id UUID;
BEGIN
    -- Validate place exists
    IF NOT EXISTS (SELECT 1 FROM trapper.places WHERE place_id = p_place_id) THEN
        RAISE WARNING 'Place % does not exist', p_place_id;
        RETURN NULL;
    END IF;

    -- Validate context type exists
    IF NOT EXISTS (SELECT 1 FROM trapper.place_context_types WHERE context_type = p_context_type AND is_active) THEN
        RAISE WARNING 'Context type % does not exist or is inactive', p_context_type;
        RETURN NULL;
    END IF;

    -- Check for existing active context
    SELECT context_id INTO v_existing_id
    FROM trapper.place_contexts
    WHERE place_id = p_place_id
      AND context_type = p_context_type
      AND valid_to IS NULL;

    IF v_existing_id IS NOT NULL THEN
        -- Already has this context - update confidence if higher
        UPDATE trapper.place_contexts
        SET confidence = GREATEST(confidence, p_confidence),
            updated_at = NOW(),
            -- Add evidence if not already set
            evidence_type = COALESCE(evidence_type, p_evidence_type),
            evidence_entity_id = COALESCE(evidence_entity_id, p_evidence_entity_id)
        WHERE context_id = v_existing_id;

        RETURN v_existing_id;
    END IF;

    -- Create new context
    INSERT INTO trapper.place_contexts (
        place_id,
        context_type,
        valid_from,
        evidence_type,
        evidence_entity_id,
        evidence_notes,
        confidence,
        source_system,
        source_record_id,
        assigned_by
    ) VALUES (
        p_place_id,
        p_context_type,
        COALESCE(p_valid_from, CURRENT_DATE),
        p_evidence_type,
        p_evidence_entity_id,
        p_evidence_notes,
        p_confidence,
        p_source_system,
        p_source_record_id,
        p_assigned_by
    )
    RETURNING context_id INTO v_context_id;

    RETURN v_context_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.assign_place_context IS
'Idempotently assigns a context tag to a place. If already exists, updates confidence if higher.';

-- ============================================================================
-- 4. Create end_place_context function
-- ============================================================================

\echo 'Creating end_place_context function...'

CREATE OR REPLACE FUNCTION trapper.end_place_context(
    p_place_id UUID,
    p_context_type TEXT,
    p_end_date DATE DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE trapper.place_contexts
    SET valid_to = COALESCE(p_end_date, CURRENT_DATE),
        updated_at = NOW()
    WHERE place_id = p_place_id
      AND context_type = p_context_type
      AND valid_to IS NULL;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.end_place_context IS
'Ends an active context by setting valid_to date. Returns TRUE if a context was ended.';

-- ============================================================================
-- 5. Create views for place contexts
-- ============================================================================

\echo ''
\echo 'Creating place context views...'

-- Active contexts view
CREATE OR REPLACE VIEW trapper.v_place_active_contexts AS
SELECT
    pc.context_id,
    pc.place_id,
    p.formatted_address,
    p.display_name AS place_name,
    pc.context_type,
    pct.display_label AS context_label,
    pc.valid_from,
    pc.evidence_type,
    pc.confidence,
    pc.is_verified,
    pc.assigned_at,
    pc.source_system
FROM trapper.place_contexts pc
JOIN trapper.places p ON p.place_id = pc.place_id
JOIN trapper.place_context_types pct ON pct.context_type = pc.context_type
WHERE pc.valid_to IS NULL
  AND p.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_active_contexts IS
'All currently active place contexts with labels';

-- Context summary per place
CREATE OR REPLACE VIEW trapper.v_place_context_summary AS
SELECT
    p.place_id,
    p.formatted_address,
    p.display_name,
    p.location,
    ARRAY_AGG(DISTINCT pc.context_type ORDER BY pc.context_type) FILTER (WHERE pc.valid_to IS NULL) AS active_contexts,
    ARRAY_AGG(DISTINCT pct.display_label ORDER BY pct.display_label) FILTER (WHERE pc.valid_to IS NULL) AS context_labels,
    COUNT(DISTINCT pc.context_id) FILTER (WHERE pc.valid_to IS NULL) AS active_context_count,
    COUNT(DISTINCT pc.context_id) AS total_context_count,
    MAX(pc.confidence) FILTER (WHERE pc.valid_to IS NULL) AS max_confidence,
    MIN(pc.valid_from) AS first_context_date
FROM trapper.places p
LEFT JOIN trapper.place_contexts pc ON pc.place_id = p.place_id
LEFT JOIN trapper.place_context_types pct ON pct.context_type = pc.context_type
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.formatted_address, p.display_name, p.location;

COMMENT ON VIEW trapper.v_place_context_summary IS
'Aggregated context information per place';

-- ============================================================================
-- 6. Create trigger to auto-assign colony_site context on request creation
-- ============================================================================

\echo ''
\echo 'Creating auto-assign trigger for colony_site context...'

CREATE OR REPLACE FUNCTION trapper.trg_assign_colony_context_on_request()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-assign colony_site context when request has a place
    IF NEW.place_id IS NOT NULL THEN
        PERFORM trapper.assign_place_context(
            p_place_id := NEW.place_id,
            p_context_type := 'colony_site',
            p_valid_from := COALESCE(NEW.source_created_at::date, NEW.created_at::date),
            p_evidence_type := 'request',
            p_evidence_entity_id := NEW.request_id,
            p_confidence := 0.85,
            p_source_system := COALESCE(NEW.source_system, 'web_intake'),
            p_source_record_id := NEW.source_record_id,
            p_assigned_by := 'auto_request_trigger'
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_colony_context_on_request ON trapper.sot_requests;
CREATE TRIGGER trg_assign_colony_context_on_request
    AFTER INSERT ON trapper.sot_requests
    FOR EACH ROW
    EXECUTE FUNCTION trapper.trg_assign_colony_context_on_request();

-- ============================================================================
-- 7. Create infer_place_contexts_from_data function for backfill
-- ============================================================================

\echo ''
\echo 'Creating backfill function...'

CREATE OR REPLACE FUNCTION trapper.infer_place_contexts_from_data()
RETURNS TABLE (
    context_type TEXT,
    places_tagged INT
) AS $$
DECLARE
    v_colony_count INT := 0;
    v_clinic_count INT := 0;
    v_trapper_count INT := 0;
    v_volunteer_count INT := 0;
BEGIN
    -- 1. Tag colony_site from requests
    WITH requests_with_places AS (
        SELECT DISTINCT
            r.place_id,
            r.request_id,
            COALESCE(r.source_created_at::date, r.created_at::date) AS context_date,
            r.source_system,
            r.source_record_id
        FROM trapper.sot_requests r
        WHERE r.place_id IS NOT NULL
    )
    INSERT INTO trapper.place_contexts (
        place_id, context_type, valid_from, evidence_type, evidence_entity_id,
        confidence, source_system, source_record_id, assigned_by
    )
    SELECT
        rwp.place_id,
        'colony_site',
        rwp.context_date,
        'request',
        rwp.request_id,
        0.85,
        rwp.source_system,
        rwp.source_record_id,
        'backfill_infer'
    FROM requests_with_places rwp
    ON CONFLICT (place_id, context_type, valid_to) DO NOTHING;
    GET DIAGNOSTICS v_colony_count = ROW_COUNT;

    -- 2. Tag clinic from appointments (places where procedures happen)
    WITH clinic_places AS (
        SELECT DISTINCT
            a.place_id,
            MIN(a.appointment_date) AS first_visit
        FROM trapper.sot_appointments a
        WHERE a.place_id IS NOT NULL
          AND (a.is_spay OR a.is_neuter)
        GROUP BY a.place_id
        HAVING COUNT(*) >= 5  -- At least 5 procedures = likely a clinic
    )
    INSERT INTO trapper.place_contexts (
        place_id, context_type, valid_from, evidence_type, confidence, assigned_by
    )
    SELECT
        cp.place_id,
        'clinic',
        cp.first_visit,
        'inferred',
        0.70,
        'backfill_infer'
    FROM clinic_places cp
    ON CONFLICT (place_id, context_type, valid_to) DO NOTHING;
    GET DIAGNOSTICS v_clinic_count = ROW_COUNT;

    -- 3. Tag trapper_base from person_roles + person_place_relationships
    WITH trapper_places AS (
        SELECT DISTINCT
            ppr.place_id,
            pr.assigned_at::date AS context_date
        FROM trapper.person_roles pr
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = pr.person_id
        WHERE pr.role_type IN ('ffsc_trapper', 'head_trapper', 'coordinator', 'community_trapper')
          AND pr.is_active = TRUE
          AND ppr.relationship_type = 'home'
    )
    INSERT INTO trapper.place_contexts (
        place_id, context_type, valid_from, evidence_type, confidence, assigned_by
    )
    SELECT
        tp.place_id,
        'trapper_base',
        tp.context_date,
        'inferred',
        0.75,
        'backfill_infer'
    FROM trapper_places tp
    ON CONFLICT (place_id, context_type, valid_to) DO NOTHING;
    GET DIAGNOSTICS v_trapper_count = ROW_COUNT;

    -- 4. Tag volunteer_location from person_roles
    WITH volunteer_places AS (
        SELECT DISTINCT
            ppr.place_id,
            pr.assigned_at::date AS context_date
        FROM trapper.person_roles pr
        JOIN trapper.person_place_relationships ppr ON ppr.person_id = pr.person_id
        WHERE pr.role_type IN ('volunteer', 'feeder')
          AND pr.is_active = TRUE
          AND ppr.relationship_type = 'home'
    )
    INSERT INTO trapper.place_contexts (
        place_id, context_type, valid_from, evidence_type, confidence, assigned_by
    )
    SELECT
        vp.place_id,
        'volunteer_location',
        vp.context_date,
        'inferred',
        0.75,
        'backfill_infer'
    FROM volunteer_places vp
    ON CONFLICT (place_id, context_type, valid_to) DO NOTHING;
    GET DIAGNOSTICS v_volunteer_count = ROW_COUNT;

    -- Return results
    RETURN QUERY VALUES
        ('colony_site'::TEXT, v_colony_count),
        ('clinic'::TEXT, v_clinic_count),
        ('trapper_base'::TEXT, v_trapper_count),
        ('volunteer_location'::TEXT, v_volunteer_count);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.infer_place_contexts_from_data IS
'Backfills place contexts from existing requests, appointments, and roles.';

-- ============================================================================
-- 8. Run initial backfill
-- ============================================================================

\echo ''
\echo 'Running initial backfill of place contexts...'

SELECT * FROM trapper.infer_place_contexts_from_data();

-- ============================================================================
-- 9. Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Place contexts by type:'
SELECT
    context_type,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE valid_to IS NULL) AS active_count
FROM trapper.place_contexts
GROUP BY context_type
ORDER BY count DESC;

\echo ''
\echo 'Places with contexts:'
SELECT
    COUNT(DISTINCT place_id) AS places_with_contexts,
    (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL) AS total_places
FROM trapper.place_contexts;

\echo ''
\echo '=== MIG_464 Complete ==='
\echo 'Created:'
\echo '  - place_context_types table with 10 context types'
\echo '  - place_contexts table for tagging places'
\echo '  - assign_place_context() function (idempotent)'
\echo '  - end_place_context() function'
\echo '  - v_place_active_contexts view'
\echo '  - v_place_context_summary view'
\echo '  - Auto-trigger for colony_site on new requests'
\echo '  - infer_place_contexts_from_data() backfill function'
\echo ''
