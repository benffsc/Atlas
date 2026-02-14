-- ============================================================================
-- MIG_760: Classification Engine - Unified Place Classification System
-- ============================================================================
-- Part of Atlas's Classification Engine - the unified system for categorizing
-- and tagging entities with contextual information.
--
-- The Classification Engine connects to:
--   - Data Engine: Identity resolution feeds classification (e.g., recognizing
--     a person as a "foster" triggers adopter_residence context on their address)
--   - AI Extraction Engine: AI-inferred classifications from notes, Google Maps
--     data, and ClinicHQ records flow into place_contexts
--   - Data Collection: Manual classifications from staff during intake override
--     AI-inferred ones (is_verified = TRUE takes precedence)
--
-- Classification Engine Architecture:
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │                        CLASSIFICATION ENGINE                            │
-- ├─────────────────────────────────────────────────────────────────────────┤
-- │  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐           │
-- │  │ Data Engine   │───▶│ place_contexts│◀───│ AI Extraction │           │
-- │  │ (Identity)    │    │ (Unified Tags)│    │ Engine        │           │
-- │  └───────────────┘    └───────┬───────┘    └───────────────┘           │
-- │                               │                                         │
-- │  ┌───────────────┐           │            ┌───────────────┐           │
-- │  │ Staff Input   │───────────┴───────────▶│ known_orgs    │           │
-- │  │ (Manual/UI)   │  is_verified=TRUE      │ (Registry)    │           │
-- │  └───────────────┘                        └───────────────┘           │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- Key Principle: Manual > AI
--   Staff-verified classifications (is_verified=TRUE) CANNOT be overridden
--   by AI-inferred classifications. This ensures ground truth from field
--   observations takes precedence over algorithmic guesses.
--
-- Features:
-- 1. New context types for place classification (organization, residential, etc.)
-- 2. Links contexts to known_organizations registry
-- 3. Protects verified (manual) contexts from AI override
-- 4. Support for multiple coexisting classifications (org + colony_site)
-- ============================================================================

\echo '=== MIG_760: Classification Engine - Unified Place Classification ==='

-- ============================================================================
-- 1. Add New Context Types for Place Classification
-- ============================================================================

\echo 'Adding new place context types...'

INSERT INTO trapper.place_context_types (context_type, display_label, description, sort_order) VALUES
    ('organization', 'Organization', 'Business, government, or non-profit entity', 5),
    ('business', 'Business', 'Commercial business location', 6),
    ('residential', 'Residential', 'Private home or apartment', 7),
    ('multi_unit', 'Multi-Unit Housing', 'Apartment complex, mobile home park, condo', 8),
    ('public_space', 'Public Space', 'Park, parking lot, public area', 9),
    ('farm_ranch', 'Farm/Ranch', 'Agricultural property', 11)
ON CONFLICT (context_type) DO UPDATE SET
    display_label = EXCLUDED.display_label,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order;

\echo 'Place context types after update:'
SELECT context_type, display_label, sort_order FROM trapper.place_context_types ORDER BY sort_order;

-- ============================================================================
-- 2. Extend place_contexts Table with Organization Link
-- ============================================================================

\echo ''
\echo 'Extending place_contexts table with organization columns...'

-- Add organization_name for free-form org name entry
ALTER TABLE trapper.place_contexts
    ADD COLUMN IF NOT EXISTS organization_name TEXT;

-- Add known_org_id for linking to known_organizations registry
ALTER TABLE trapper.place_contexts
    ADD COLUMN IF NOT EXISTS known_org_id UUID REFERENCES trapper.known_organizations(org_id);

COMMENT ON COLUMN trapper.place_contexts.organization_name IS
    'Free-form organization name for organization contexts. Used when org is not in known_organizations registry.';

COMMENT ON COLUMN trapper.place_contexts.known_org_id IS
    'Reference to known_organizations for verified organization contexts. Enables pattern matching and enrichment.';

-- Index for org lookups
CREATE INDEX IF NOT EXISTS idx_place_contexts_known_org
    ON trapper.place_contexts(known_org_id)
    WHERE known_org_id IS NOT NULL;

-- ============================================================================
-- 3. Update assign_place_context Function to Respect Verified Contexts
-- ============================================================================

\echo ''
\echo 'Updating assign_place_context function to protect verified contexts...'

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
    p_assigned_by TEXT DEFAULT 'system',
    p_is_verified BOOLEAN DEFAULT FALSE,
    p_organization_name TEXT DEFAULT NULL,
    p_known_org_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_context_id UUID;
    v_existing_id UUID;
    v_existing_verified BOOLEAN;
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
    SELECT context_id, is_verified
    INTO v_existing_id, v_existing_verified
    FROM trapper.place_contexts
    WHERE place_id = p_place_id
      AND context_type = p_context_type
      AND valid_to IS NULL;

    IF v_existing_id IS NOT NULL THEN
        -- KEY RULE: Don't let AI/inferred override staff-verified contexts
        IF v_existing_verified = TRUE AND p_evidence_type = 'inferred' THEN
            RAISE NOTICE 'Skipping: verified context % on place % cannot be overridden by inferred evidence',
                p_context_type, p_place_id;
            RETURN v_existing_id;
        END IF;

        -- Update existing context - but only upgrade (never downgrade verification)
        UPDATE trapper.place_contexts
        SET confidence = GREATEST(confidence, p_confidence),
            updated_at = NOW(),
            -- Upgrade to verified if new evidence is manual/verified
            is_verified = is_verified OR p_is_verified OR (p_evidence_type = 'manual'),
            -- Add evidence if not already set
            evidence_type = COALESCE(evidence_type, p_evidence_type),
            evidence_entity_id = COALESCE(evidence_entity_id, p_evidence_entity_id),
            evidence_notes = COALESCE(evidence_notes, p_evidence_notes),
            -- Update org fields if provided
            organization_name = COALESCE(p_organization_name, organization_name),
            known_org_id = COALESCE(p_known_org_id, known_org_id)
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
        assigned_by,
        is_verified,
        organization_name,
        known_org_id
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
        p_assigned_by,
        p_is_verified OR (p_evidence_type = 'manual'),
        p_organization_name,
        p_known_org_id
    )
    RETURNING context_id INTO v_context_id;

    RETURN v_context_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.assign_place_context IS
'Idempotently assigns a context tag to a place.
Key behavior:
- If context already exists, updates confidence if higher
- VERIFIED contexts cannot be overridden by inferred/AI evidence
- manual evidence_type automatically sets is_verified = TRUE
- Supports organization linking via organization_name or known_org_id';

-- ============================================================================
-- 4. Create View for Place Classifications with Org Details
-- ============================================================================

\echo ''
\echo 'Creating v_place_classifications view...'

CREATE OR REPLACE VIEW trapper.v_place_classifications AS
SELECT
    pc.context_id,
    pc.place_id,
    p.formatted_address,
    p.display_name AS place_name,
    pc.context_type,
    pct.display_label AS context_label,
    pc.valid_from,
    pc.valid_to,
    pc.evidence_type,
    pc.confidence,
    pc.is_verified,
    pc.assigned_at,
    pc.assigned_by,
    -- Organization details
    pc.organization_name,
    pc.known_org_id,
    ko.canonical_name AS known_org_name,
    ko.org_type AS known_org_type,
    ko.short_name AS known_org_short_name,
    -- Colony link (if place is in a colony)
    cp.colony_id,
    c.colony_name,
    -- Computed flags
    CASE WHEN pc.valid_to IS NULL THEN TRUE ELSE FALSE END AS is_active
FROM trapper.place_contexts pc
JOIN trapper.places p ON p.place_id = pc.place_id
JOIN trapper.place_context_types pct ON pct.context_type = pc.context_type
LEFT JOIN trapper.known_organizations ko ON ko.org_id = pc.known_org_id
LEFT JOIN trapper.colony_places cp ON cp.place_id = pc.place_id
LEFT JOIN trapper.colonies c ON c.colony_id = cp.colony_id
WHERE p.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_classifications IS
'All place classifications with organization and colony details. Shows both active and historical contexts.';

-- ============================================================================
-- 5. Create Helper Function to Set Manual Classification
-- ============================================================================

\echo ''
\echo 'Creating set_place_classification function for UI...'

CREATE OR REPLACE FUNCTION trapper.set_place_classification(
    p_place_id UUID,
    p_context_type TEXT,
    p_assigned_by TEXT DEFAULT 'staff',
    p_organization_name TEXT DEFAULT NULL,
    p_known_org_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
BEGIN
    -- Manual classifications are always verified with high confidence
    RETURN trapper.assign_place_context(
        p_place_id := p_place_id,
        p_context_type := p_context_type,
        p_evidence_type := 'manual',
        p_evidence_notes := p_notes,
        p_confidence := 1.0,
        p_source_system := 'atlas_ui',
        p_assigned_by := p_assigned_by,
        p_is_verified := TRUE,
        p_organization_name := p_organization_name,
        p_known_org_id := p_known_org_id
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.set_place_classification IS
'Sets a manual/verified place classification. For use by UI when staff classifies a place.
Always sets is_verified=TRUE and confidence=1.0.';

-- ============================================================================
-- 6. Create Helper Function to Remove Classification
-- ============================================================================

\echo ''
\echo 'Creating remove_place_classification function...'

CREATE OR REPLACE FUNCTION trapper.remove_place_classification(
    p_place_id UUID,
    p_context_type TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    -- End the active context (don't delete, preserve history)
    UPDATE trapper.place_contexts
    SET valid_to = CURRENT_DATE,
        updated_at = NOW()
    WHERE place_id = p_place_id
      AND context_type = p_context_type
      AND valid_to IS NULL;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.remove_place_classification IS
'Ends an active place classification by setting valid_to. Preserves history.';

-- ============================================================================
-- 7. Create Query Function for Place Classifications
-- ============================================================================

\echo ''
\echo 'Creating get_place_classifications function...'

CREATE OR REPLACE FUNCTION trapper.get_place_classifications(p_place_id UUID)
RETURNS TABLE (
    context_type TEXT,
    context_label TEXT,
    is_verified BOOLEAN,
    organization_name TEXT,
    known_org_id UUID,
    known_org_name TEXT,
    colony_id UUID,
    colony_name TEXT,
    valid_from DATE,
    assigned_by TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pc.context_type,
        pct.display_label,
        pc.is_verified,
        pc.organization_name,
        pc.known_org_id,
        ko.canonical_name,
        cp.colony_id,
        c.colony_name,
        pc.valid_from,
        pc.assigned_by
    FROM trapper.place_contexts pc
    JOIN trapper.place_context_types pct ON pct.context_type = pc.context_type
    LEFT JOIN trapper.known_organizations ko ON ko.org_id = pc.known_org_id
    LEFT JOIN trapper.colony_places cp ON cp.place_id = pc.place_id
    LEFT JOIN trapper.colonies c ON c.colony_id = cp.colony_id
    WHERE pc.place_id = p_place_id
      AND pc.valid_to IS NULL
    ORDER BY pct.sort_order;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.get_place_classifications IS
'Returns all active classifications for a place, including org and colony details.';

-- ============================================================================
-- 8. Update v_place_active_contexts to Include Org Details
-- ============================================================================

\echo ''
\echo 'Updating v_place_active_contexts view...'

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
    pc.assigned_by,
    pc.source_system,
    -- Organization details (new)
    pc.organization_name,
    pc.known_org_id,
    ko.canonical_name AS known_org_name
FROM trapper.place_contexts pc
JOIN trapper.places p ON p.place_id = pc.place_id
JOIN trapper.place_context_types pct ON pct.context_type = pc.context_type
LEFT JOIN trapper.known_organizations ko ON ko.org_id = pc.known_org_id
WHERE pc.valid_to IS NULL
  AND p.merged_into_place_id IS NULL;

COMMENT ON VIEW trapper.v_place_active_contexts IS
'All currently active place contexts with labels and organization details.';

-- ============================================================================
-- 9. Create Index for Quick Classification Queries
-- ============================================================================

\echo ''
\echo 'Creating classification query indexes...'

-- Index for finding places by context type
CREATE INDEX IF NOT EXISTS idx_place_contexts_active_type
    ON trapper.place_contexts(context_type, place_id)
    WHERE valid_to IS NULL;

-- Index for verified contexts
CREATE INDEX IF NOT EXISTS idx_place_contexts_verified
    ON trapper.place_contexts(place_id)
    WHERE is_verified = TRUE AND valid_to IS NULL;

-- ============================================================================
-- 10. Verification
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Place context types available:'
SELECT context_type, display_label, sort_order
FROM trapper.place_context_types
WHERE is_active = TRUE
ORDER BY sort_order;

\echo ''
\echo 'Sample: Testing set_place_classification function...'
DO $$
DECLARE
    v_test_place_id UUID;
    v_context_id UUID;
BEGIN
    -- Find a test place
    SELECT place_id INTO v_test_place_id
    FROM trapper.places
    WHERE merged_into_place_id IS NULL
    LIMIT 1;

    IF v_test_place_id IS NOT NULL THEN
        -- Test setting a classification
        v_context_id := trapper.set_place_classification(
            p_place_id := v_test_place_id,
            p_context_type := 'residential',
            p_assigned_by := 'mig_760_test'
        );

        IF v_context_id IS NOT NULL THEN
            RAISE NOTICE 'Test passed: Created residential classification for place %', v_test_place_id;

            -- Remove test classification
            PERFORM trapper.remove_place_classification(v_test_place_id, 'residential');
            RAISE NOTICE 'Test cleanup: Removed test classification';
        END IF;
    END IF;
END $$;

\echo ''
\echo '=== MIG_760 Complete ==='
\echo 'Created:'
\echo '  - New context types: organization, business, residential, multi_unit, public_space, farm_ranch'
\echo '  - Extended place_contexts with organization_name and known_org_id columns'
\echo '  - Updated assign_place_context() to protect verified contexts from AI override'
\echo '  - set_place_classification() function for UI/manual classification'
\echo '  - remove_place_classification() function'
\echo '  - get_place_classifications() function'
\echo '  - v_place_classifications view with org and colony details'
\echo '  - Updated v_place_active_contexts with org details'
\echo ''
\echo 'Key Behavior:'
\echo '  - Verified contexts (is_verified=TRUE) CANNOT be overridden by inferred evidence'
\echo '  - Manual evidence_type automatically sets is_verified=TRUE'
\echo '  - Multiple classifications can coexist (org + colony_site + residential)'
\echo ''
