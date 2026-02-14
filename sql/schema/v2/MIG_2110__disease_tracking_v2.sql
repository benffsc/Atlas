-- MIG_2110: V2 Disease Tracking System
-- Date: 2026-02-14
--
-- Purpose: Port V1 disease tracking (MIG_814) to V2 architecture
-- Creates ops.disease_types and ops.place_disease_status tables
-- Updates v_map_atlas_pins to display disease badges
--
-- V1 had: trapper.disease_types, trapper.place_disease_status, trapper.v_place_disease_summary
-- V2 has: sot.condition_types (generic conditions) - this migration adds disease-specific tracking

\echo ''
\echo '=============================================='
\echo '  MIG_2110: V2 Disease Tracking System'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. OPS.DISEASE_TYPES (Registry of trackable diseases)
-- ============================================================================

\echo '1. Creating ops.disease_types...'

CREATE TABLE IF NOT EXISTS ops.disease_types (
    disease_key TEXT PRIMARY KEY,
    display_label TEXT NOT NULL,
    short_code TEXT NOT NULL UNIQUE,  -- 1-letter code for map badges
    badge_color TEXT NOT NULL,        -- Hex color for badge display
    severity_order INT NOT NULL DEFAULT 50,
    decay_window_months INT NOT NULL DEFAULT 36,
    is_contagious BOOLEAN DEFAULT TRUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ops.disease_types IS
'V2 OPS: Registry of trackable feline diseases.
short_code is a 1-letter code for map badge display.
decay_window_months controls how long a positive result keeps a place flagged.';

-- Seed disease types (same as V1 MIG_814)
INSERT INTO ops.disease_types (disease_key, display_label, short_code, badge_color, severity_order, decay_window_months, is_contagious, description)
VALUES
    ('felv', 'FeLV (Feline Leukemia)', 'F', '#dc2626', 10, 36, TRUE,
     'Feline Leukemia Virus. Highly contagious, spreads through saliva, nasal secretions, urine, feces, and milk.'),
    ('fiv', 'FIV (Feline Immunodeficiency)', 'V', '#ea580c', 20, 36, TRUE,
     'Feline Immunodeficiency Virus. Primarily spread through deep bite wounds.'),
    ('ringworm', 'Ringworm (Dermatophytosis)', 'R', '#ca8a04', 30, 12, TRUE,
     'Fungal skin infection. Highly contagious to cats and humans.'),
    ('heartworm', 'Heartworm', 'H', '#7c3aed', 40, 24, FALSE,
     'Dirofilaria immitis. Spread by mosquitoes, not cat-to-cat.'),
    ('panleukopenia', 'Panleukopenia (Feline Distemper)', 'P', '#be185d', 15, 24, TRUE,
     'Feline parvovirus. Extremely contagious and often fatal in kittens.')
ON CONFLICT (disease_key) DO NOTHING;

\echo '   Created ops.disease_types (5 diseases seeded)'

-- ============================================================================
-- 2. OPS.PLACE_DISEASE_STATUS (Per-disease status at each place)
-- ============================================================================

\echo ''
\echo '2. Creating ops.place_disease_status...'

CREATE TABLE IF NOT EXISTS ops.place_disease_status (
    status_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID NOT NULL REFERENCES sot.places(place_id),
    disease_type_key TEXT NOT NULL REFERENCES ops.disease_types(disease_key),

    -- Status with time decay and manual override support
    status TEXT NOT NULL DEFAULT 'suspected'
        CHECK (status IN ('confirmed_active', 'suspected', 'historical', 'perpetual', 'false_flag', 'cleared')),

    -- Where did this come from?
    evidence_source TEXT NOT NULL DEFAULT 'computed'
        CHECK (evidence_source IN ('test_result', 'ai_extraction', 'google_maps', 'manual', 'computed')),

    -- Time tracking
    first_positive_date DATE,
    last_positive_date DATE,
    decay_window_override INT,  -- Override default decay from disease_types

    -- Counts
    positive_cat_count INT DEFAULT 0,
    total_tested_count INT DEFAULT 0,

    -- Manual override fields
    notes TEXT,
    set_by TEXT,
    set_at TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(place_id, disease_type_key)
);

CREATE INDEX IF NOT EXISTS idx_ops_place_disease_status_place
    ON ops.place_disease_status(place_id);
CREATE INDEX IF NOT EXISTS idx_ops_place_disease_status_active
    ON ops.place_disease_status(place_id)
    WHERE status IN ('confirmed_active', 'perpetual', 'suspected');

COMMENT ON TABLE ops.place_disease_status IS
'V2 OPS: Per-disease status at each place with time decay.
Statuses:
  confirmed_active: Test-confirmed positive, within decay window
  suspected: AI-extracted or mentioned, not test-confirmed
  historical: Was positive but beyond decay window
  perpetual: Staff permanently flagged (never decays)
  false_flag: Staff dismissed
  cleared: Staff confirmed resolved/treated
Manual overrides (perpetual, false_flag, cleared) survive recompute.';

\echo '   Created ops.place_disease_status'

-- ============================================================================
-- 3. OPS.V_PLACE_DISEASE_SUMMARY (Aggregated disease badges per place)
-- ============================================================================

\echo ''
\echo '3. Creating ops.v_place_disease_summary...'

CREATE OR REPLACE VIEW ops.v_place_disease_summary AS
SELECT
    p.place_id,
    -- Disease badges as JSONB array for map display
    COALESCE(
        JSONB_AGG(
            JSONB_BUILD_OBJECT(
                'disease_key', pds.disease_type_key,
                'short_code', dt.short_code,
                'color', dt.badge_color,
                'status', pds.status,
                'label', dt.display_label,
                'last_positive', pds.last_positive_date,
                'positive_cats', pds.positive_cat_count,
                'evidence', pds.evidence_source
            ) ORDER BY dt.severity_order
        ) FILTER (WHERE pds.status_id IS NOT NULL),
        '[]'::JSONB
    ) AS disease_badges,
    -- Counts
    COUNT(pds.status_id) FILTER (
        WHERE pds.status IN ('confirmed_active', 'perpetual')
    ) AS active_disease_count,
    COUNT(pds.status_id) FILTER (
        WHERE pds.status = 'suspected'
    ) AS suspected_count,
    -- Boolean for quick filtering
    BOOL_OR(pds.status IN ('confirmed_active', 'perpetual', 'suspected')) AS has_any_disease
FROM sot.places p
LEFT JOIN ops.place_disease_status pds
    ON pds.place_id = p.place_id
    AND pds.status NOT IN ('false_flag', 'cleared')
LEFT JOIN ops.disease_types dt
    ON dt.disease_key = pds.disease_type_key
    AND dt.is_active = TRUE
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id;

COMMENT ON VIEW ops.v_place_disease_summary IS
'V2 OPS: One row per place with aggregated disease status.
disease_badges is a JSONB array of {disease_key, short_code, color, status, label, last_positive, positive_cats}.
Used by v_map_atlas_pins for map badge display.';

\echo '   Created ops.v_place_disease_summary'

-- ============================================================================
-- 4. MIGRATE DATA FROM V1 (if exists)
-- ============================================================================

\echo ''
\echo '4. Migrating data from V1 tables (if any)...'

DO $$
DECLARE
    v_migrated_types INT := 0;
    v_migrated_status INT := 0;
BEGIN
    -- Check if V1 disease_types has data we should migrate
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'disease_types'
    ) THEN
        -- Migrate any disease types not already in ops
        INSERT INTO ops.disease_types (
            disease_key, display_label, short_code, badge_color,
            severity_order, decay_window_months, is_contagious, description, is_active
        )
        SELECT
            disease_key, display_label, short_code,
            COALESCE(color, '#888888'),  -- V1 uses 'color', V2 uses 'badge_color'
            severity_order, decay_window_months, is_contagious, description, is_active
        FROM trapper.disease_types
        WHERE NOT EXISTS (
            SELECT 1 FROM ops.disease_types o WHERE o.disease_key = trapper.disease_types.disease_key
        )
        ON CONFLICT (disease_key) DO NOTHING;

        GET DIAGNOSTICS v_migrated_types = ROW_COUNT;
        IF v_migrated_types > 0 THEN
            RAISE NOTICE 'Migrated % new disease types from V1', v_migrated_types;
        END IF;
    END IF;

    -- Check if V1 place_disease_status has data
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'place_disease_status'
    ) THEN
        -- Migrate place disease statuses
        INSERT INTO ops.place_disease_status (
            status_id, place_id, disease_type_key, status, evidence_source,
            first_positive_date, last_positive_date, decay_window_override,
            positive_cat_count, total_tested_count, notes, set_by, set_at,
            created_at, updated_at
        )
        SELECT
            status_id, place_id, disease_type_key, status, evidence_source,
            first_positive_date, last_positive_date, decay_window_override,
            positive_cat_count, total_tested_count, notes, set_by, set_at,
            created_at, updated_at
        FROM trapper.place_disease_status
        WHERE EXISTS (
            SELECT 1 FROM sot.places p WHERE p.place_id = trapper.place_disease_status.place_id
        )
        AND NOT EXISTS (
            SELECT 1 FROM ops.place_disease_status o
            WHERE o.place_id = trapper.place_disease_status.place_id
              AND o.disease_type_key = trapper.place_disease_status.disease_type_key
        )
        ON CONFLICT (place_id, disease_type_key) DO NOTHING;

        GET DIAGNOSTICS v_migrated_status = ROW_COUNT;
        IF v_migrated_status > 0 THEN
            RAISE NOTICE 'Migrated % place disease statuses from V1', v_migrated_status;
        END IF;
    END IF;

    IF v_migrated_types = 0 AND v_migrated_status = 0 THEN
        RAISE NOTICE 'No V1 disease data found to migrate (tables may not exist or be empty)';
    END IF;
END $$;

-- ============================================================================
-- 5. COMPATIBILITY VIEW (for code expecting trapper.v_place_disease_summary)
-- ============================================================================

\echo ''
\echo '5. Creating compatibility view...'

CREATE OR REPLACE VIEW trapper.v_place_disease_summary AS
SELECT * FROM ops.v_place_disease_summary;

COMMENT ON VIEW trapper.v_place_disease_summary IS
'V2 compatibility: Points to ops.v_place_disease_summary';

\echo '   Created trapper.v_place_disease_summary'

-- ============================================================================
-- 6. UPDATE V_MAP_ATLAS_PINS WITH DISEASE BADGES
-- ============================================================================

\echo ''
\echo '6. Updating trapper.v_map_atlas_pins with disease badges...'

DROP VIEW IF EXISTS ops.v_map_atlas_pins CASCADE;
DROP VIEW IF EXISTS trapper.v_map_atlas_pins CASCADE;

CREATE VIEW trapper.v_map_atlas_pins AS
SELECT
    p.place_id as id,
    COALESCE(p.formatted_address, p.display_name) as address,
    p.display_name,
    ST_Y(p.location::geometry) as lat,
    ST_X(p.location::geometry) as lng,
    p.service_zone,

    -- Parent place for clustering
    p.parent_place_id,
    p.place_kind,
    p.unit_identifier,

    -- Cat counts (excluding merged cats)
    COALESCE(cc.cat_count, 0) as cat_count,

    -- People linked
    COALESCE(ppl.people, '[]'::JSONB) as people,
    COALESCE(ppl.person_count, 0) as person_count,

    -- Disease risk (boolean for backward compat)
    COALESCE(p.disease_risk, FALSE)
        OR COALESCE(ds.has_any_disease, FALSE) as disease_risk,
    p.disease_risk_notes,

    -- NEW: Per-disease badges from ops.v_place_disease_summary
    COALESCE(ds.disease_badges, '[]'::JSONB) as disease_badges,
    COALESCE(ds.active_disease_count, 0) as disease_count,

    -- Watch list
    COALESCE(p.watch_list, FALSE) as watch_list,
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
    COALESCE(tnr.total_cats_altered, 0) as total_altered,
    tnr.latest_request_date as last_alteration_at,

    -- Pin style (includes disease badges)
    CASE
        WHEN COALESCE(p.disease_risk, FALSE) OR COALESCE(ds.has_any_disease, FALSE) THEN 'disease'
        WHEN COALESCE(p.watch_list, FALSE) THEN 'watch_list'
        WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
        WHEN COALESCE(req.request_count, 0) > 0
            OR COALESCE(intake.intake_count, 0) > 0 THEN 'active_requests'
        WHEN COALESCE(gme.entry_count, 0) > 0 THEN 'has_history'
        ELSE 'minimal'
    END as pin_style,

    -- Pin tier (active = full teardrop, reference = smaller muted pin)
    CASE
        WHEN COALESCE(p.disease_risk, FALSE) OR COALESCE(ds.has_any_disease, FALSE) THEN 'active'
        WHEN COALESCE(p.watch_list, FALSE) THEN 'active'
        WHEN COALESCE(cc.cat_count, 0) > 0 THEN 'active'
        WHEN COALESCE(req.request_count, 0) > 0
            OR COALESCE(intake.intake_count, 0) > 0 THEN 'active'
        WHEN active_roles.place_id IS NOT NULL THEN 'active'
        ELSE 'reference'
    END as pin_tier,

    -- Metadata
    p.created_at,
    p.last_activity_at,

    -- Requests needing trapper assignment
    COALESCE(req.needs_trapper_count, 0) as needs_trapper_count

FROM sot.places p

-- Cat counts (excluding merged cats)
LEFT JOIN (
    SELECT cpr.place_id, COUNT(DISTINCT cpr.cat_id) as cat_count
    FROM sot.cat_place cpr
    JOIN sot.cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cpr.place_id
) cc ON cc.place_id = p.place_id

-- People with role info
LEFT JOIN (
    SELECT
        ppr.place_id,
        COUNT(DISTINCT per.person_id) as person_count,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
            'name', per.display_name,
            'roles', COALESCE((
                SELECT ARRAY_AGG(DISTINCT pr.role)
                FROM ops.person_roles pr
                WHERE pr.person_id = per.person_id
                  AND pr.role_status = 'active'
            ), ARRAY[]::TEXT[]),
            'is_staff', FALSE
        )) FILTER (WHERE per.display_name IS NOT NULL) as people
    FROM sot.person_place ppr
    JOIN sot.people per ON per.person_id = ppr.person_id
    WHERE per.merged_into_person_id IS NULL
      AND NOT sot.is_organization_name(per.display_name)
    GROUP BY ppr.place_id
) ppl ON ppl.place_id = p.place_id

-- Disease summary (NOW from ops.v_place_disease_summary)
LEFT JOIN ops.v_place_disease_summary ds ON ds.place_id = p.place_id

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
        ) FILTER (WHERE ai_summary IS NOT NULL OR original_content IS NOT NULL) as ai_summaries
    FROM ops.google_map_entries
    WHERE place_id IS NOT NULL OR linked_place_id IS NOT NULL
    GROUP BY COALESCE(place_id, linked_place_id)
) gme ON gme.place_id = p.place_id

-- Request counts
LEFT JOIN (
    SELECT
        place_id,
        COUNT(*) as request_count,
        COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')) as active_request_count,
        COUNT(*) FILTER (
            WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress')
              AND (assignment_status = 'pending' OR assignment_status IS NULL)
        ) as needs_trapper_count
    FROM ops.requests
    WHERE place_id IS NOT NULL
    GROUP BY place_id
) req ON req.place_id = p.place_id

-- Intake submissions
LEFT JOIN (
    SELECT
        place_id,
        COUNT(DISTINCT submission_id) as intake_count
    FROM ops.intake_submissions
    WHERE place_id IS NOT NULL
    GROUP BY place_id
) intake ON intake.place_id = p.place_id

-- Active important roles at this place (for auto-graduation)
LEFT JOIN (
    SELECT DISTINCT ppr.place_id
    FROM sot.person_place ppr
    JOIN ops.person_roles pr ON pr.person_id = ppr.person_id
    WHERE pr.role_status = 'active'
      AND pr.role IN ('volunteer', 'trapper', 'coordinator', 'head_trapper',
                      'ffsc_trapper', 'community_trapper', 'foster')
) active_roles ON active_roles.place_id = p.place_id

-- TNR stats
LEFT JOIN trapper.v_place_alteration_history tnr ON tnr.place_id = p.place_id

WHERE p.merged_into_place_id IS NULL
  AND p.location IS NOT NULL;

COMMENT ON VIEW trapper.v_map_atlas_pins IS
'V2: Map pins view with disease badge support.
Joins ops.v_place_disease_summary for disease_badges JSONB array.
Columns: id, address, display_name, lat, lng, cat_count, disease_badges, disease_count, etc.';

-- Recreate ops alias
CREATE OR REPLACE VIEW ops.v_map_atlas_pins AS
SELECT * FROM trapper.v_map_atlas_pins;

COMMENT ON VIEW ops.v_map_atlas_pins IS 'V2: Alias for trapper.v_map_atlas_pins';

\echo '   Updated trapper.v_map_atlas_pins with disease badge support'
\echo '   Recreated ops.v_map_atlas_pins alias'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Disease tables:'
SELECT 'ops.disease_types' as table_name, COUNT(*) as rows FROM ops.disease_types
UNION ALL
SELECT 'ops.place_disease_status', COUNT(*) FROM ops.place_disease_status;

\echo ''
\echo 'Map view test:'
SELECT COUNT(*) as total_pins,
       COUNT(*) FILTER (WHERE disease_count > 0) as pins_with_disease,
       COUNT(*) FILTER (WHERE pin_style = 'disease') as disease_style_pins
FROM trapper.v_map_atlas_pins;

\echo ''
\echo '=============================================='
\echo '  MIG_2110 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - ops.disease_types (disease registry)'
\echo '  - ops.place_disease_status (per-place disease status)'
\echo '  - ops.v_place_disease_summary (aggregated badges)'
\echo '  - trapper.v_place_disease_summary (compatibility view)'
\echo '  - Updated trapper.v_map_atlas_pins with disease badge join'
\echo ''
\echo 'Note: Disease data populates from:'
\echo '  1. Manual entry via staff UI'
\echo '  2. AI extraction from Google Maps notes'
\echo '  3. Cat test results via compute_place_disease_status()'
\echo ''
