-- MIG_1008: V2 Architecture - Unified Badge System (Place Contexts)
-- Phase 1.5, Part 1: Port place_contexts to V2 with all enhancements
--
-- Creates:
-- 1. atlas.place_context_types - Badge type definitions
-- 2. sot.place_contexts - Badge assignments with temporal validity
-- 3. sot.assign_place_context() - Idempotent badge assignment
-- 4. sot.end_place_context() - Deactivate badges
-- 5. V2 views for badge display
-- 6. Historical data migration from V1
--
-- Key Design Principles:
-- - Badges are DATA-DERIVED, not manual labels
-- - Manual (is_verified=TRUE) overrides AI/inferred
-- - Temporal tracking via valid_from/valid_to
-- - Single unified table, no fragmentation

\echo ''
\echo '=============================================='
\echo '  MIG_1008: V2 Unified Badge System'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. BADGE TYPE DEFINITIONS (atlas.place_context_types)
-- ============================================================================

\echo '1. Creating atlas.place_context_types...'

CREATE TABLE IF NOT EXISTS atlas.place_context_types (
    context_type TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('operational', 'ecological', 'organization', 'classification')),
    display_name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    color TEXT,
    sort_order INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE atlas.place_context_types IS
'Lookup table for V2 place badge types. Controls what badges can be assigned to places.
Categories:
- operational: Staff workflow contexts (foster_home, trapper_base, etc.)
- ecological: Colony and habitat contexts (colony_site, feeding_station)
- organization: Business/partner contexts (clinic, shelter, partner_org)
- classification: Place type classification (residential, multi_unit, etc.)';

-- Seed with all context types from V1 (MIG_464 + MIG_760 + MIG_874)
INSERT INTO atlas.place_context_types (context_type, category, display_name, description, sort_order) VALUES
    -- Ecological contexts
    ('colony_site', 'ecological', 'Colony Site', 'Active or historical colony location with feral/community cats', 10),
    ('feeding_station', 'ecological', 'Feeding Station', 'Regular feeding location for community cats', 15),

    -- Operational contexts
    ('foster_home', 'operational', 'Foster Home', 'Location where cats are fostered temporarily', 20),
    ('adopter_residence', 'operational', 'Adopter Residence', 'Home where adopted cats live', 25),
    ('barn_placement', 'operational', 'Barn Placement', 'Working cat/barn cat placement location', 27),
    ('relocation_destination', 'operational', 'Relocation Destination', 'Destination for relocated cats', 28),
    ('trapper_base', 'operational', 'Trapper Base', 'Trapper''s home or staging location', 30),
    ('volunteer_location', 'operational', 'Volunteer Location', 'Volunteer''s home or base of operations', 35),
    ('trap_pickup', 'operational', 'Trap Pickup/Dropoff', 'Location for trap equipment pickup/dropoff', 40),

    -- Organization contexts
    ('clinic', 'organization', 'Veterinary Clinic', 'Vet clinic or medical facility', 50),
    ('shelter', 'organization', 'Shelter', 'Animal shelter or rescue facility', 55),
    ('partner_org', 'organization', 'Partner Organization', 'Partner organization (Sonoma Humane, etc.)', 60),
    ('organization', 'organization', 'Organization', 'Business, government, or non-profit entity', 65),

    -- Classification contexts (from MIG_760)
    ('business', 'classification', 'Business', 'Commercial business location', 70),
    ('residential', 'classification', 'Residential', 'Residential property', 75),
    ('multi_unit', 'classification', 'Multi-Unit', 'Apartment building or multi-unit complex', 80),
    ('public_space', 'classification', 'Public Space', 'Park, plaza, or public area', 85),
    ('farm_ranch', 'classification', 'Farm/Ranch', 'Agricultural property', 90)
ON CONFLICT (context_type) DO UPDATE SET
    category = EXCLUDED.category,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order;

\echo '   Created atlas.place_context_types with 17 badge types'

-- ============================================================================
-- 2. PLACE CONTEXTS TABLE (sot.place_contexts)
-- ============================================================================

\echo ''
\echo '2. Creating sot.place_contexts...'

CREATE TABLE IF NOT EXISTS sot.place_contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID NOT NULL REFERENCES sot.places(place_id) ON DELETE CASCADE,
    context_type TEXT NOT NULL REFERENCES atlas.place_context_types(context_type),

    -- Temporal validity
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to TIMESTAMPTZ,  -- NULL = currently active

    -- Confidence & verification
    confidence NUMERIC(3,2) DEFAULT 0.80 CHECK (confidence >= 0 AND confidence <= 1),
    is_verified BOOLEAN DEFAULT FALSE,  -- TRUE = staff-assigned, protected from AI override
    evidence_type TEXT DEFAULT 'inferred'
        CHECK (evidence_type IN ('manual', 'request', 'appointment', 'outcome', 'inferred', 'system_derived')),

    -- Linked evidence (optional FKs)
    source_request_id UUID,
    source_appointment_id UUID,
    source_outcome_id UUID,
    evidence_notes TEXT,

    -- Organization details (for clinic, shelter, partner_org, organization)
    organization_name TEXT,
    known_org_id UUID,  -- FK to known_organizations if migrated

    -- Provenance
    source_system TEXT,
    source_record_id TEXT,
    assigned_by TEXT,  -- User or system that assigned

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- V1 migration tracking
    v1_context_id UUID,  -- Original context_id from V1 for audit
    migrated_at TIMESTAMPTZ,

    -- One active context per type per place
    UNIQUE NULLS NOT DISTINCT (place_id, context_type, valid_to)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sot_place_contexts_place
    ON sot.place_contexts(place_id);

CREATE INDEX IF NOT EXISTS idx_sot_place_contexts_type
    ON sot.place_contexts(context_type);

CREATE INDEX IF NOT EXISTS idx_sot_place_contexts_active
    ON sot.place_contexts(place_id, context_type)
    WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_sot_place_contexts_verified
    ON sot.place_contexts(place_id)
    WHERE is_verified = TRUE AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_sot_place_contexts_evidence
    ON sot.place_contexts(source_request_id)
    WHERE source_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sot_place_contexts_v1
    ON sot.place_contexts(v1_context_id)
    WHERE v1_context_id IS NOT NULL;

COMMENT ON TABLE sot.place_contexts IS
'V2 SOT: Place badges/contexts with temporal validity and data-derived assignment.
Badges are DATA-DERIVED from appointments, outcomes, requests, and roles.
Manual (is_verified=TRUE) overrides AI/inferred assignments.
One active context per type per place (valid_to IS NULL = active).';

\echo '   Created sot.place_contexts table with indexes'

-- ============================================================================
-- 3. ASSIGN PLACE CONTEXT FUNCTION (sot.assign_place_context)
-- ============================================================================

\echo ''
\echo '3. Creating sot.assign_place_context() function...'

CREATE OR REPLACE FUNCTION sot.assign_place_context(
    p_place_id UUID,
    p_context_type TEXT,
    p_valid_from TIMESTAMPTZ DEFAULT NULL,
    p_evidence_type TEXT DEFAULT 'inferred',
    p_source_request_id UUID DEFAULT NULL,
    p_source_appointment_id UUID DEFAULT NULL,
    p_source_outcome_id UUID DEFAULT NULL,
    p_evidence_notes TEXT DEFAULT NULL,
    p_confidence NUMERIC DEFAULT 0.80,
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_source_record_id TEXT DEFAULT NULL,
    p_assigned_by TEXT DEFAULT 'system',
    p_organization_name TEXT DEFAULT NULL,
    p_known_org_id UUID DEFAULT NULL,
    p_is_verified BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
    v_context_id UUID;
    v_existing_id UUID;
    v_existing_verified BOOLEAN;
BEGIN
    -- Validate place exists in V2
    IF NOT EXISTS (SELECT 1 FROM sot.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL) THEN
        RAISE WARNING 'Place % does not exist or is merged', p_place_id;
        RETURN NULL;
    END IF;

    -- Validate context type exists and is active
    IF NOT EXISTS (SELECT 1 FROM atlas.place_context_types WHERE context_type = p_context_type AND is_active) THEN
        RAISE WARNING 'Context type % does not exist or is inactive', p_context_type;
        RETURN NULL;
    END IF;

    -- Check for existing active context
    SELECT id, is_verified INTO v_existing_id, v_existing_verified
    FROM sot.place_contexts
    WHERE place_id = p_place_id
      AND context_type = p_context_type
      AND valid_to IS NULL;

    IF v_existing_id IS NOT NULL THEN
        -- CRITICAL: Manual > AI rule
        -- Don't let inferred/system override staff-verified contexts
        IF v_existing_verified = TRUE AND p_evidence_type = 'inferred' THEN
            RAISE NOTICE 'Skipping: verified context % on place % cannot be overridden by inferred evidence',
                p_context_type, p_place_id;
            RETURN v_existing_id;
        END IF;

        -- Update existing: increase confidence if higher, add evidence if not set
        UPDATE sot.place_contexts
        SET confidence = GREATEST(confidence, p_confidence),
            updated_at = NOW(),
            evidence_type = COALESCE(evidence_type, p_evidence_type),
            source_request_id = COALESCE(source_request_id, p_source_request_id),
            source_appointment_id = COALESCE(source_appointment_id, p_source_appointment_id),
            source_outcome_id = COALESCE(source_outcome_id, p_source_outcome_id),
            organization_name = COALESCE(p_organization_name, organization_name),
            known_org_id = COALESCE(p_known_org_id, known_org_id),
            -- Allow upgrading to verified
            is_verified = is_verified OR p_is_verified
        WHERE id = v_existing_id;

        RETURN v_existing_id;
    END IF;

    -- Create new context
    INSERT INTO sot.place_contexts (
        place_id,
        context_type,
        valid_from,
        evidence_type,
        source_request_id,
        source_appointment_id,
        source_outcome_id,
        evidence_notes,
        confidence,
        source_system,
        source_record_id,
        assigned_by,
        organization_name,
        known_org_id,
        is_verified
    ) VALUES (
        p_place_id,
        p_context_type,
        COALESCE(p_valid_from, NOW()),
        p_evidence_type,
        p_source_request_id,
        p_source_appointment_id,
        p_source_outcome_id,
        p_evidence_notes,
        p_confidence,
        p_source_system,
        p_source_record_id,
        p_assigned_by,
        p_organization_name,
        p_known_org_id,
        p_is_verified
    )
    RETURNING id INTO v_context_id;

    RETURN v_context_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.assign_place_context IS
'Idempotently assigns a badge/context to a place.
Key behavior:
- If already exists, updates confidence if higher
- CRITICAL: Manual (is_verified=TRUE) cannot be overridden by inferred
- Supports linking to request, appointment, or outcome as evidence
- Supports organization details for org-type contexts';

-- ============================================================================
-- 4. END PLACE CONTEXT FUNCTION (sot.end_place_context)
-- ============================================================================

\echo '4. Creating sot.end_place_context() function...'

CREATE OR REPLACE FUNCTION sot.end_place_context(
    p_place_id UUID,
    p_context_type TEXT,
    p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE sot.place_contexts
    SET valid_to = COALESCE(p_end_date, NOW()),
        updated_at = NOW()
    WHERE place_id = p_place_id
      AND context_type = p_context_type
      AND valid_to IS NULL;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.end_place_context IS
'Ends an active context by setting valid_to date. Returns TRUE if a context was ended.
Does not delete - preserves history for audit trail.';

-- ============================================================================
-- 5. VIEWS FOR BADGE DISPLAY
-- ============================================================================

\echo ''
\echo '5. Creating badge views...'

-- Active contexts view
CREATE OR REPLACE VIEW sot.v_place_active_contexts AS
SELECT
    pc.id AS context_id,
    pc.place_id,
    p.formatted_address,
    p.display_name AS place_name,
    pc.context_type,
    pct.display_name AS context_label,
    pct.category,
    pc.valid_from,
    pc.confidence,
    pc.is_verified,
    pc.evidence_type,
    pc.organization_name,
    pc.source_system,
    pc.created_at,
    pc.assigned_by
FROM sot.place_contexts pc
JOIN sot.places p ON p.place_id = pc.place_id
JOIN atlas.place_context_types pct ON pct.context_type = pc.context_type
WHERE pc.valid_to IS NULL
  AND p.merged_into_place_id IS NULL;

COMMENT ON VIEW sot.v_place_active_contexts IS
'All currently active place badges with display labels and confidence';

-- Context summary per place
CREATE OR REPLACE VIEW sot.v_place_context_summary AS
SELECT
    p.place_id,
    p.formatted_address,
    p.display_name,
    p.location,
    p.place_kind,
    ARRAY_AGG(DISTINCT pc.context_type ORDER BY pc.context_type)
        FILTER (WHERE pc.valid_to IS NULL) AS active_contexts,
    ARRAY_AGG(DISTINCT pct.display_name ORDER BY pct.display_name)
        FILTER (WHERE pc.valid_to IS NULL) AS context_labels,
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.valid_to IS NULL) AS active_context_count,
    COUNT(DISTINCT pc.id) AS total_context_count,
    MAX(pc.confidence) FILTER (WHERE pc.valid_to IS NULL) AS max_confidence,
    MIN(pc.valid_from) AS first_context_date,
    BOOL_OR(pc.is_verified) FILTER (WHERE pc.valid_to IS NULL) AS has_verified_context
FROM sot.places p
LEFT JOIN sot.place_contexts pc ON pc.place_id = p.place_id
LEFT JOIN atlas.place_context_types pct ON pct.context_type = pc.context_type
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.formatted_address, p.display_name, p.location, p.place_kind;

COMMENT ON VIEW sot.v_place_context_summary IS
'Aggregated badge information per place for map display and search';

-- Contexts by category for filtering
CREATE OR REPLACE VIEW sot.v_place_contexts_by_category AS
SELECT
    pc.place_id,
    pct.category,
    ARRAY_AGG(DISTINCT pc.context_type ORDER BY pc.context_type) AS contexts,
    COUNT(*) AS context_count,
    MAX(pc.confidence) AS max_confidence,
    BOOL_OR(pc.is_verified) AS any_verified
FROM sot.place_contexts pc
JOIN atlas.place_context_types pct ON pct.context_type = pc.context_type
WHERE pc.valid_to IS NULL
GROUP BY pc.place_id, pct.category;

COMMENT ON VIEW sot.v_place_contexts_by_category IS
'Place contexts grouped by category (operational, ecological, organization, classification)';

\echo '   Created views: v_place_active_contexts, v_place_context_summary, v_place_contexts_by_category'

-- ============================================================================
-- 6. MIGRATE DATA FROM V1
-- ============================================================================

\echo ''
\echo '6. Migrating place contexts from V1...'

-- Create mapping from V1 place_id to V2 place_id
-- V1 places.place_id should match V2 sot.places.place_id after MIG_1005

INSERT INTO sot.place_contexts (
    place_id,
    context_type,
    valid_from,
    valid_to,
    confidence,
    is_verified,
    evidence_type,
    evidence_notes,
    organization_name,
    source_system,
    source_record_id,
    assigned_by,
    created_at,
    v1_context_id,
    migrated_at
)
SELECT
    pc.place_id,
    pc.context_type,
    COALESCE(pc.valid_from::TIMESTAMPTZ, pc.created_at),
    pc.valid_to::TIMESTAMPTZ,
    COALESCE(pc.confidence, 0.80),
    COALESCE(pc.is_verified, FALSE),
    COALESCE(pc.evidence_type, 'inferred'),
    pc.evidence_notes,
    pc.organization_name,
    COALESCE(pc.source_system, 'v1_migration'),
    pc.source_record_id,
    COALESCE(pc.assigned_by, 'v1_migration'),
    COALESCE(pc.created_at, NOW()),
    pc.context_id AS v1_context_id,
    NOW() AS migrated_at
FROM trapper.place_contexts pc
WHERE EXISTS (
    SELECT 1 FROM sot.places sp
    WHERE sp.place_id = pc.place_id
      AND sp.merged_into_place_id IS NULL
)
ON CONFLICT (place_id, context_type, valid_to) DO UPDATE SET
    confidence = GREATEST(sot.place_contexts.confidence, EXCLUDED.confidence),
    updated_at = NOW(),
    -- Don't overwrite verified with non-verified
    is_verified = sot.place_contexts.is_verified OR EXCLUDED.is_verified;

\echo '   Migrated place_contexts from V1'

-- ============================================================================
-- 7. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Badge types:'
SELECT category, COUNT(*) AS types
FROM atlas.place_context_types
GROUP BY category
ORDER BY category;

\echo ''
\echo 'Place contexts migrated:'
SELECT
    context_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE valid_to IS NULL) AS active,
    COUNT(*) FILTER (WHERE is_verified) AS verified
FROM sot.place_contexts
GROUP BY context_type
ORDER BY total DESC;

\echo ''
\echo 'Migration summary:'
SELECT
    COUNT(DISTINCT place_id) AS places_with_contexts,
    COUNT(*) AS total_contexts,
    COUNT(*) FILTER (WHERE valid_to IS NULL) AS active_contexts,
    COUNT(*) FILTER (WHERE is_verified) AS verified_contexts,
    COUNT(*) FILTER (WHERE migrated_at IS NOT NULL) AS migrated_from_v1
FROM sot.place_contexts;

\echo ''
\echo '=============================================='
\echo '  MIG_1008 Complete'
\echo '=============================================='
\echo 'Created:'
\echo '  - atlas.place_context_types (17 badge types)'
\echo '  - sot.place_contexts (unified badge table)'
\echo '  - sot.assign_place_context() function'
\echo '  - sot.end_place_context() function'
\echo '  - sot.v_place_active_contexts view'
\echo '  - sot.v_place_context_summary view'
\echo '  - sot.v_place_contexts_by_category view'
\echo '  - Migrated V1 place_contexts data'
\echo ''
\echo 'Key Features:'
\echo '  - Badges are DATA-DERIVED, not labels'
\echo '  - Manual (is_verified=TRUE) overrides AI/inferred'
\echo '  - Temporal tracking via valid_from/valid_to'
\echo '  - Single unified table, no fragmentation'
\echo ''
