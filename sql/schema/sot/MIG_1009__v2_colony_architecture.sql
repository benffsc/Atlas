-- MIG_1009: V2 Architecture - Colony Tables
-- Phase 1.5, Part 2: Staff-curated colony management for Beacon analytics
--
-- Core Principle: Colonies Are Staff-Curated Aggregations
-- - NOT automated - staff must explicitly create colonies
-- - Composed of selected cats at selected places
-- - Foundation for Beacon population analytics
-- - Distinguishable from pet/owned cat groupings
--
-- Creates:
-- 1. sot.colonies - Colony definitions (staff-created)
-- 2. sot.colony_places - Colony-place relationships (multi-place support)
-- 3. sot.colony_cats - Colony-cat memberships (explicit, not inferred)
-- 4. beacon.colony_estimates - Population tracking for Beacon analytics
-- 5. ALTER sot.cats to add barn/foster ownership types

\echo ''
\echo '=============================================='
\echo '  MIG_1009: V2 Colony Architecture'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. EXTEND OWNERSHIP_TYPE TO INCLUDE BARN AND FOSTER
-- ============================================================================

\echo '1. Extending sot.cats ownership_type...'

-- Drop existing constraint
ALTER TABLE sot.cats
DROP CONSTRAINT IF EXISTS cats_ownership_type_check;

-- Add new constraint with barn and foster
ALTER TABLE sot.cats
ADD CONSTRAINT cats_ownership_type_check
CHECK (ownership_type IN ('stray', 'owned', 'community', 'feral', 'barn', 'foster', 'unknown'));

COMMENT ON COLUMN sot.cats.ownership_type IS
'Cat ownership classification:
- stray: Stray cat, no known owner
- owned: Pet cat with owner
- community: Community cat, fed by caretaker(s)
- feral: Feral/unsocialized cat
- barn: Barn/working cat placement
- foster: Currently in foster care
- unknown: Classification not determined';

\echo '   Extended ownership_type: added barn, foster'

-- ============================================================================
-- 2. COLONIES TABLE (sot.colonies)
-- ============================================================================

\echo ''
\echo '2. Creating sot.colonies...'

CREATE TABLE IF NOT EXISTS sot.colonies (
    colony_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Display
    name TEXT NOT NULL,
    description TEXT,

    -- Classification
    colony_status TEXT NOT NULL DEFAULT 'active'
        CHECK (colony_status IN ('active', 'monitored', 'declining', 'resolved', 'unknown')),
    colony_type TEXT DEFAULT 'feral_colony'
        CHECK (colony_type IN ('feral_colony', 'managed_colony', 'feeding_station', 'barn_colony')),

    -- Estimates (staff-maintained, NOT auto-calculated)
    estimated_population INTEGER,
    estimated_altered INTEGER,
    last_count_date DATE,
    count_method TEXT CHECK (count_method IN ('visual', 'trap_count', 'camera', 'caretaker_report', 'manual')),

    -- Staff assignment
    created_by_staff_id UUID,
    primary_caretaker_id UUID REFERENCES sot.people(person_id),

    -- Flags
    is_verified BOOLEAN DEFAULT FALSE,
    needs_attention BOOLEAN DEFAULT FALSE,
    attention_reason TEXT,
    watch_list BOOLEAN DEFAULT FALSE,
    watch_list_reason TEXT,

    -- Geographic
    service_zone TEXT,

    -- Merge tracking
    merged_into_colony_id UUID REFERENCES sot.colonies(colony_id),

    -- Provenance
    source_system TEXT DEFAULT 'atlas_ui',
    source_record_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sot_colonies_status ON sot.colonies(colony_status) WHERE colony_status = 'active';
CREATE INDEX IF NOT EXISTS idx_sot_colonies_caretaker ON sot.colonies(primary_caretaker_id) WHERE primary_caretaker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sot_colonies_attention ON sot.colonies(needs_attention) WHERE needs_attention = TRUE;
CREATE INDEX IF NOT EXISTS idx_sot_colonies_merged ON sot.colonies(merged_into_colony_id) WHERE merged_into_colony_id IS NOT NULL;

COMMENT ON TABLE sot.colonies IS
'V2 SOT: Staff-curated colony definitions.
CRITICAL: Colonies are NOT auto-created. Staff must explicitly create them.
Each colony:
- Has a name and description
- Has status tracking (active, monitored, declining, resolved)
- Links to places via colony_places (multi-place supported)
- Links to cats via colony_cats (explicit membership)
- Has staff-maintained population estimates';

\echo '   Created sot.colonies table'

-- ============================================================================
-- 3. COLONY-PLACE RELATIONSHIPS (sot.colony_places)
-- ============================================================================

\echo ''
\echo '3. Creating sot.colony_places...'

CREATE TABLE IF NOT EXISTS sot.colony_places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colony_id UUID NOT NULL REFERENCES sot.colonies(colony_id) ON DELETE CASCADE,
    place_id UUID NOT NULL REFERENCES sot.places(place_id),

    -- Role of this place in the colony
    place_role TEXT DEFAULT 'core_site'
        CHECK (place_role IN ('core_site', 'feeding_station', 'shelter_location', 'territory_boundary')),

    -- Flags
    is_primary BOOLEAN DEFAULT FALSE,  -- Primary location for display
    is_active BOOLEAN DEFAULT TRUE,

    -- Timestamps
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by_staff_id UUID,
    deactivated_at TIMESTAMPTZ,

    UNIQUE (colony_id, place_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sot_colony_places_colony ON sot.colony_places(colony_id);
CREATE INDEX IF NOT EXISTS idx_sot_colony_places_place ON sot.colony_places(place_id);
CREATE INDEX IF NOT EXISTS idx_sot_colony_places_active ON sot.colony_places(colony_id) WHERE is_active = TRUE;

COMMENT ON TABLE sot.colony_places IS
'V2 SOT: Links colonies to places.
Supports multi-place colonies (e.g., a colony spanning multiple properties).
Place roles:
- core_site: Main colony location
- feeding_station: Regular feeding spot
- shelter_location: Shelter/hiding area
- territory_boundary: Edge of colony territory';

\echo '   Created sot.colony_places table'

-- ============================================================================
-- 4. COLONY-CAT MEMBERSHIPS (sot.colony_cats)
-- ============================================================================

\echo ''
\echo '4. Creating sot.colony_cats...'

CREATE TABLE IF NOT EXISTS sot.colony_cats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colony_id UUID NOT NULL REFERENCES sot.colonies(colony_id) ON DELETE CASCADE,
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),

    -- Membership details
    membership_status TEXT DEFAULT 'active'
        CHECK (membership_status IN ('active', 'relocated', 'deceased', 'adopted', 'unknown')),
    joined_date DATE,
    left_date DATE,
    left_reason TEXT,

    -- Evidence
    evidence_type TEXT DEFAULT 'staff_assigned'
        CHECK (evidence_type IN ('staff_assigned', 'appointment_based', 'sighting', 'inferred')),
    confidence NUMERIC(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by_staff_id UUID,

    UNIQUE (colony_id, cat_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sot_colony_cats_colony ON sot.colony_cats(colony_id);
CREATE INDEX IF NOT EXISTS idx_sot_colony_cats_cat ON sot.colony_cats(cat_id);
CREATE INDEX IF NOT EXISTS idx_sot_colony_cats_active ON sot.colony_cats(colony_id, membership_status) WHERE membership_status = 'active';

COMMENT ON TABLE sot.colony_cats IS
'V2 SOT: Explicit colony-cat memberships.
CRITICAL: Memberships are NOT inferred. Staff assigns cats to colonies.
Membership status tracks what happened to the cat:
- active: Currently part of colony
- relocated: Moved to different location
- deceased: Died (mortality tracking)
- adopted: Adopted out of colony
- unknown: Status unknown';

\echo '   Created sot.colony_cats table'

-- ============================================================================
-- 5. BEACON COLONY ESTIMATES (beacon.colony_estimates)
-- ============================================================================

\echo ''
\echo '5. Creating beacon.colony_estimates...'

CREATE TABLE IF NOT EXISTS beacon.colony_estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    colony_id UUID NOT NULL REFERENCES sot.colonies(colony_id) ON DELETE CASCADE,

    -- Estimate data
    estimate_date DATE NOT NULL,
    total_estimated INTEGER,
    altered_count INTEGER,
    unaltered_count INTEGER,
    kittens_count INTEGER,
    adults_count INTEGER,
    seniors_count INTEGER,

    -- Alteration rate (calculated)
    alteration_rate NUMERIC(5,4) GENERATED ALWAYS AS (
        CASE WHEN total_estimated > 0 THEN altered_count::NUMERIC / total_estimated ELSE NULL END
    ) STORED,

    -- Methodology
    estimation_method TEXT CHECK (estimation_method IN (
        'chapman', 'visual', 'caretaker_report', 'trap_session', 'camera_survey', 'manual'
    )),
    confidence_level TEXT CHECK (confidence_level IN ('high', 'medium', 'low')),
    notes TEXT,

    -- Population trend (compared to previous estimate)
    population_trend TEXT CHECK (population_trend IN ('growing', 'stable', 'declining', 'unknown')),

    -- Provenance
    recorded_by_staff_id UUID,
    source_system TEXT DEFAULT 'atlas_ui',
    source_record_id TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (colony_id, estimate_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_beacon_colony_estimates_colony ON beacon.colony_estimates(colony_id);
CREATE INDEX IF NOT EXISTS idx_beacon_colony_estimates_date ON beacon.colony_estimates(estimate_date DESC);
CREATE INDEX IF NOT EXISTS idx_beacon_colony_estimates_trend ON beacon.colony_estimates(population_trend) WHERE population_trend IS NOT NULL;

COMMENT ON TABLE beacon.colony_estimates IS
'Beacon Layer: Population estimates for colonies over time.
Used for:
- Chapman mark-recapture calculations
- Alteration rate tracking (altered / total)
- Population trend analysis
- Beacon map visualizations

Estimation methods:
- chapman: Mark-recapture statistical method
- visual: Visual count by observer
- caretaker_report: Reported by colony caretaker
- trap_session: Count during TNR trap session
- camera_survey: Trail camera population count
- manual: Manual staff entry';

\echo '   Created beacon.colony_estimates table'

-- ============================================================================
-- 6. HELPER VIEWS
-- ============================================================================

\echo ''
\echo '6. Creating colony views...'

-- Colony summary view
CREATE OR REPLACE VIEW sot.v_colony_summary AS
SELECT
    c.colony_id,
    c.name,
    c.description,
    c.colony_status,
    c.colony_type,
    c.estimated_population,
    c.estimated_altered,
    c.last_count_date,
    c.needs_attention,
    c.service_zone,

    -- Caretaker info
    p.display_name AS caretaker_name,
    p.primary_email AS caretaker_email,

    -- Places
    (SELECT COUNT(*) FROM sot.colony_places cp WHERE cp.colony_id = c.colony_id AND cp.is_active) AS place_count,
    (SELECT array_agg(pl.formatted_address)
     FROM sot.colony_places cp
     JOIN sot.places pl ON pl.place_id = cp.place_id
     WHERE cp.colony_id = c.colony_id AND cp.is_active AND cp.is_primary) AS primary_addresses,

    -- Cats
    (SELECT COUNT(*) FROM sot.colony_cats cc WHERE cc.colony_id = c.colony_id AND cc.membership_status = 'active') AS active_cat_count,
    (SELECT COUNT(*) FROM sot.colony_cats cc
     JOIN sot.cats cat ON cat.cat_id = cc.cat_id
     WHERE cc.colony_id = c.colony_id AND cc.membership_status = 'active'
       AND cat.is_altered = TRUE) AS altered_cat_count,

    -- Latest estimate
    (SELECT total_estimated FROM beacon.colony_estimates ce
     WHERE ce.colony_id = c.colony_id ORDER BY estimate_date DESC LIMIT 1) AS latest_estimate,
    (SELECT alteration_rate FROM beacon.colony_estimates ce
     WHERE ce.colony_id = c.colony_id ORDER BY estimate_date DESC LIMIT 1) AS latest_alteration_rate,

    c.created_at,
    c.updated_at
FROM sot.colonies c
LEFT JOIN sot.people p ON p.person_id = c.primary_caretaker_id
WHERE c.merged_into_colony_id IS NULL;

COMMENT ON VIEW sot.v_colony_summary IS
'Aggregated colony information for list views and colony management UI';

-- Colony with cats view
CREATE OR REPLACE VIEW sot.v_colony_cats_detail AS
SELECT
    cc.id,
    cc.colony_id,
    c.name AS colony_name,
    cc.cat_id,
    cat.name AS cat_name,
    cat.microchip,
    cat.sex,
    cat.is_altered,
    cat.primary_color,
    cat.ownership_type,
    cc.membership_status,
    cc.joined_date,
    cc.left_date,
    cc.left_reason,
    cc.evidence_type,
    cc.confidence
FROM sot.colony_cats cc
JOIN sot.colonies c ON c.colony_id = cc.colony_id
JOIN sot.cats cat ON cat.cat_id = cc.cat_id
WHERE c.merged_into_colony_id IS NULL
  AND cat.merged_into_cat_id IS NULL;

COMMENT ON VIEW sot.v_colony_cats_detail IS
'Colony cats with full cat details for colony management';

-- Beacon colony map view
CREATE OR REPLACE VIEW beacon.v_colony_map_pins AS
SELECT
    c.colony_id,
    c.name AS colony_name,
    c.colony_status,
    c.colony_type,
    c.estimated_population,
    c.estimated_altered,
    c.needs_attention,

    -- Primary place location
    pl.place_id,
    pl.formatted_address,
    pl.location,
    ST_X(pl.location::geometry) AS longitude,
    ST_Y(pl.location::geometry) AS latitude,

    -- Stats
    (SELECT COUNT(*) FROM sot.colony_cats cc
     WHERE cc.colony_id = c.colony_id AND cc.membership_status = 'active') AS verified_cat_count,

    -- Latest estimate
    (SELECT alteration_rate FROM beacon.colony_estimates ce
     WHERE ce.colony_id = c.colony_id ORDER BY estimate_date DESC LIMIT 1) AS alteration_rate,
    (SELECT population_trend FROM beacon.colony_estimates ce
     WHERE ce.colony_id = c.colony_id ORDER BY estimate_date DESC LIMIT 1) AS population_trend,

    c.service_zone
FROM sot.colonies c
JOIN sot.colony_places cp ON cp.colony_id = c.colony_id AND cp.is_primary = TRUE AND cp.is_active = TRUE
JOIN sot.places pl ON pl.place_id = cp.place_id
WHERE c.merged_into_colony_id IS NULL
  AND c.colony_status != 'resolved'
  AND pl.location IS NOT NULL;

COMMENT ON VIEW beacon.v_colony_map_pins IS
'Colony pins for Beacon map visualization with population and alteration stats';

\echo '   Created views: v_colony_summary, v_colony_cats_detail, v_colony_map_pins'

-- ============================================================================
-- 7. HELPER FUNCTIONS
-- ============================================================================

\echo ''
\echo '7. Creating helper functions...'

-- Create colony
CREATE OR REPLACE FUNCTION sot.create_colony(
    p_name TEXT,
    p_description TEXT DEFAULT NULL,
    p_colony_type TEXT DEFAULT 'feral_colony',
    p_primary_caretaker_id UUID DEFAULT NULL,
    p_created_by_staff_id UUID DEFAULT NULL,
    p_service_zone TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_colony_id UUID;
BEGIN
    INSERT INTO sot.colonies (
        name,
        description,
        colony_type,
        primary_caretaker_id,
        created_by_staff_id,
        service_zone,
        source_system
    ) VALUES (
        p_name,
        p_description,
        p_colony_type,
        p_primary_caretaker_id,
        p_created_by_staff_id,
        p_service_zone,
        'atlas_ui'
    )
    RETURNING colony_id INTO v_colony_id;

    RETURN v_colony_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.create_colony IS
'Creates a new colony. Returns colony_id. Use add_place_to_colony() and add_cat_to_colony() to populate.';

-- Add place to colony
CREATE OR REPLACE FUNCTION sot.add_place_to_colony(
    p_colony_id UUID,
    p_place_id UUID,
    p_place_role TEXT DEFAULT 'core_site',
    p_is_primary BOOLEAN DEFAULT FALSE,
    p_added_by_staff_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    -- If this is primary, unset other primaries first
    IF p_is_primary THEN
        UPDATE sot.colony_places
        SET is_primary = FALSE, deactivated_at = NOW()
        WHERE colony_id = p_colony_id AND is_primary = TRUE;
    END IF;

    INSERT INTO sot.colony_places (
        colony_id,
        place_id,
        place_role,
        is_primary,
        added_by_staff_id
    ) VALUES (
        p_colony_id,
        p_place_id,
        p_place_role,
        p_is_primary,
        p_added_by_staff_id
    )
    ON CONFLICT (colony_id, place_id) DO UPDATE SET
        place_role = EXCLUDED.place_role,
        is_primary = EXCLUDED.is_primary,
        is_active = TRUE,
        deactivated_at = NULL
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.add_place_to_colony IS
'Adds a place to a colony. If is_primary=TRUE, unsets previous primary.';

-- Add cat to colony
CREATE OR REPLACE FUNCTION sot.add_cat_to_colony(
    p_colony_id UUID,
    p_cat_id UUID,
    p_evidence_type TEXT DEFAULT 'staff_assigned',
    p_joined_date DATE DEFAULT NULL,
    p_assigned_by_staff_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO sot.colony_cats (
        colony_id,
        cat_id,
        evidence_type,
        joined_date,
        assigned_by_staff_id
    ) VALUES (
        p_colony_id,
        p_cat_id,
        p_evidence_type,
        COALESCE(p_joined_date, CURRENT_DATE),
        p_assigned_by_staff_id
    )
    ON CONFLICT (colony_id, cat_id) DO UPDATE SET
        membership_status = 'active',
        evidence_type = EXCLUDED.evidence_type,
        updated_at = NOW(),
        left_date = NULL,
        left_reason = NULL
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.add_cat_to_colony IS
'Adds a cat to a colony. If already exists, reactivates membership.';

-- Remove cat from colony
CREATE OR REPLACE FUNCTION sot.remove_cat_from_colony(
    p_colony_id UUID,
    p_cat_id UUID,
    p_reason TEXT DEFAULT 'relocated',
    p_left_date DATE DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE sot.colony_cats
    SET membership_status = p_reason,
        left_date = COALESCE(p_left_date, CURRENT_DATE),
        left_reason = p_reason,
        updated_at = NOW()
    WHERE colony_id = p_colony_id
      AND cat_id = p_cat_id
      AND membership_status = 'active';

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.remove_cat_from_colony IS
'Removes a cat from a colony by setting membership_status. Use reason: relocated, deceased, adopted, unknown.';

-- Record colony estimate
CREATE OR REPLACE FUNCTION beacon.record_colony_estimate(
    p_colony_id UUID,
    p_estimate_date DATE,
    p_total_estimated INTEGER,
    p_altered_count INTEGER DEFAULT NULL,
    p_unaltered_count INTEGER DEFAULT NULL,
    p_kittens_count INTEGER DEFAULT NULL,
    p_estimation_method TEXT DEFAULT 'visual',
    p_confidence_level TEXT DEFAULT 'medium',
    p_notes TEXT DEFAULT NULL,
    p_recorded_by_staff_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
    v_previous_total INTEGER;
    v_trend TEXT;
BEGIN
    -- Determine trend from previous estimate
    SELECT total_estimated INTO v_previous_total
    FROM beacon.colony_estimates
    WHERE colony_id = p_colony_id
      AND estimate_date < p_estimate_date
    ORDER BY estimate_date DESC
    LIMIT 1;

    IF v_previous_total IS NOT NULL AND p_total_estimated IS NOT NULL THEN
        IF p_total_estimated > v_previous_total * 1.1 THEN
            v_trend := 'growing';
        ELSIF p_total_estimated < v_previous_total * 0.9 THEN
            v_trend := 'declining';
        ELSE
            v_trend := 'stable';
        END IF;
    ELSE
        v_trend := 'unknown';
    END IF;

    INSERT INTO beacon.colony_estimates (
        colony_id,
        estimate_date,
        total_estimated,
        altered_count,
        unaltered_count,
        kittens_count,
        estimation_method,
        confidence_level,
        population_trend,
        notes,
        recorded_by_staff_id
    ) VALUES (
        p_colony_id,
        p_estimate_date,
        p_total_estimated,
        p_altered_count,
        p_unaltered_count,
        p_kittens_count,
        p_estimation_method,
        p_confidence_level,
        v_trend,
        p_notes,
        p_recorded_by_staff_id
    )
    ON CONFLICT (colony_id, estimate_date) DO UPDATE SET
        total_estimated = EXCLUDED.total_estimated,
        altered_count = EXCLUDED.altered_count,
        unaltered_count = EXCLUDED.unaltered_count,
        kittens_count = EXCLUDED.kittens_count,
        estimation_method = EXCLUDED.estimation_method,
        confidence_level = EXCLUDED.confidence_level,
        population_trend = v_trend,
        notes = EXCLUDED.notes
    RETURNING id INTO v_id;

    -- Update colony's cached estimates
    UPDATE sot.colonies
    SET estimated_population = p_total_estimated,
        estimated_altered = p_altered_count,
        last_count_date = p_estimate_date,
        count_method = p_estimation_method,
        updated_at = NOW()
    WHERE colony_id = p_colony_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION beacon.record_colony_estimate IS
'Records a population estimate for a colony. Calculates trend from previous estimate.
Also updates the colony''s cached estimate fields for quick access.';

\echo '   Created functions: create_colony, add_place_to_colony, add_cat_to_colony, remove_cat_from_colony, record_colony_estimate'

-- ============================================================================
-- 8. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Tables created:'
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name IN ('colonies', 'colony_places', 'colony_cats', 'colony_estimates')
  AND table_schema IN ('sot', 'beacon')
ORDER BY table_schema, table_name;

\echo ''
\echo 'Ownership type constraint updated:'
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'cats_ownership_type_check';

\echo ''
\echo '=============================================='
\echo '  MIG_1009 Complete'
\echo '=============================================='
\echo 'Created:'
\echo '  - Extended sot.cats ownership_type with barn, foster'
\echo '  - sot.colonies (staff-curated colony definitions)'
\echo '  - sot.colony_places (multi-place support)'
\echo '  - sot.colony_cats (explicit memberships)'
\echo '  - beacon.colony_estimates (population tracking)'
\echo '  - sot.v_colony_summary view'
\echo '  - sot.v_colony_cats_detail view'
\echo '  - beacon.v_colony_map_pins view'
\echo '  - Helper functions for colony management'
\echo ''
\echo 'Key Principle: Colonies are STAFF-CURATED'
\echo '  - NOT automated or inferred'
\echo '  - Staff must explicitly create colonies'
\echo '  - Staff assigns cats to colonies'
\echo '  - Staff records population estimates'
\echo ''
