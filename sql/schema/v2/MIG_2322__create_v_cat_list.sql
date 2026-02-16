-- ============================================================================
-- MIG_2322: Create sot.v_cat_list view
-- ============================================================================
-- Issue: The cats API uses sot.v_cat_list which doesn't exist in V2.
-- This view was never migrated from V1 (trapper.v_cat_list).
--
-- This migration creates the view using V2 schema conventions:
--   - sot.cats instead of trapper.sot_cats
--   - ops.appointments instead of trapper.sot_appointments
--   - sot.cat_place instead of cat_place_relationships
--   - sot.person_cat instead of person_cat_relationships
--
-- The view provides:
--   - Basic cat info with display_name
--   - Quality tier (based on data completeness)
--   - Owner count and names
--   - Primary place info
--   - Visit stats (last visit, count)
-- ============================================================================

\echo '=== MIG_2322: Create sot.v_cat_list view ==='

-- ============================================================================
-- Helper View 1: v_cat_quality - Data quality tiers based on completeness
-- ============================================================================

\echo 'Creating sot.v_cat_quality...'

CREATE OR REPLACE VIEW sot.v_cat_quality AS
SELECT
    c.cat_id,
    c.microchip,
    (c.microchip IS NOT NULL) AS has_microchip,
    CASE
        -- Gold: Has microchip and altered status
        WHEN c.microchip IS NOT NULL AND c.altered_status IN ('spayed', 'neutered') THEN 'gold'
        -- Silver: Has microchip OR has altered status
        WHEN c.microchip IS NOT NULL OR c.altered_status IN ('spayed', 'neutered') THEN 'silver'
        -- Bronze: Has name and sex
        WHEN c.name IS NOT NULL AND c.name != '' AND c.sex IS NOT NULL THEN 'bronze'
        -- Unranked: Minimal data
        ELSE 'unranked'
    END AS quality_tier,
    CASE
        WHEN c.microchip IS NOT NULL AND c.altered_status IN ('spayed', 'neutered') THEN 'Complete: microchip + altered'
        WHEN c.microchip IS NOT NULL THEN 'Has microchip, unknown altered'
        WHEN c.altered_status IN ('spayed', 'neutered') THEN 'Altered, no microchip'
        WHEN c.name IS NOT NULL AND c.name != '' AND c.sex IS NOT NULL THEN 'Basic info only'
        ELSE 'Minimal data'
    END AS quality_reason
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND COALESCE(c.data_quality, 'good') NOT IN ('garbage', 'needs_review');

COMMENT ON VIEW sot.v_cat_quality IS
'Quality tiers for cats based on data completeness.
Tiers: gold (microchip+altered) > silver (either) > bronze (basic) > unranked';

-- ============================================================================
-- Helper View 2: v_cat_primary_place - Primary place for each cat
-- ============================================================================

\echo 'Creating sot.v_cat_primary_place...'

CREATE OR REPLACE VIEW sot.v_cat_primary_place AS
SELECT DISTINCT ON (cp.cat_id)
    cp.cat_id,
    cp.place_id,
    COALESCE(p.display_name, p.formatted_address) AS place_name,
    p.place_kind
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE p.merged_into_place_id IS NULL
ORDER BY cp.cat_id,
    -- Priority: home > residence > colony_member > other
    CASE cp.relationship_type
        WHEN 'home' THEN 1
        WHEN 'residence' THEN 2
        WHEN 'colony_member' THEN 3
        ELSE 4
    END,
    cp.created_at DESC;

COMMENT ON VIEW sot.v_cat_primary_place IS
'Primary place for each cat based on relationship type priority.';

-- ============================================================================
-- Main View: v_cat_list - Full cat list for UI
-- ============================================================================

\echo 'Creating sot.v_cat_list...'

CREATE OR REPLACE VIEW sot.v_cat_list AS
SELECT
    c.cat_id,
    COALESCE(c.name, 'Unknown') AS display_name,
    c.sex,
    c.altered_status,
    c.breed,
    cq.microchip,
    COALESCE(cq.quality_tier, 'unranked') AS quality_tier,
    COALESCE(cq.quality_reason, 'Not assessed') AS quality_reason,
    COALESCE(cq.has_microchip, FALSE) AS has_microchip,
    -- Owner count
    COALESCE(
        (SELECT COUNT(DISTINCT pc.person_id)
         FROM sot.person_cat pc
         WHERE pc.cat_id = c.cat_id),
        0
    ) AS owner_count,
    -- Owner names
    (SELECT string_agg(DISTINCT p.display_name, ', ' ORDER BY p.display_name)
     FROM sot.person_cat pc
     JOIN sot.people p ON p.person_id = pc.person_id
     WHERE pc.cat_id = c.cat_id
       AND p.merged_into_person_id IS NULL) AS owner_names,
    -- Primary place
    cpp.place_id AS primary_place_id,
    cpp.place_name AS primary_place_label,
    cpp.place_kind,
    (cpp.place_id IS NOT NULL) AS has_place,
    c.created_at,
    c.updated_at,
    -- Last visit date from appointments
    (SELECT MAX(a.appointment_date)
     FROM ops.appointments a
     WHERE a.cat_id = c.cat_id) AS last_visit_date,
    -- Total visit count
    COALESCE(
        (SELECT COUNT(*)
         FROM ops.appointments a
         WHERE a.cat_id = c.cat_id),
        0
    ) AS visit_count
FROM sot.cats c
LEFT JOIN sot.v_cat_quality cq ON cq.cat_id = c.cat_id
LEFT JOIN sot.v_cat_primary_place cpp ON cpp.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NULL
  AND COALESCE(c.data_quality, 'good') NOT IN ('garbage', 'needs_review');

COMMENT ON VIEW sot.v_cat_list IS
'Cat list view with quality, ownership, place, and visit data for UI display.
Supports sorting by: quality_tier, display_name, last_visit_date, created_at.
Excludes merged cats and garbage data quality.';

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo '=== Verification ==='

DO $$
DECLARE
    v_cat_count INTEGER;
    v_with_place INTEGER;
    v_with_visits INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_cat_count FROM sot.v_cat_list;
    SELECT COUNT(*) INTO v_with_place FROM sot.v_cat_list WHERE has_place = TRUE;
    SELECT COUNT(*) INTO v_with_visits FROM sot.v_cat_list WHERE visit_count > 0;

    RAISE NOTICE 'Total cats in v_cat_list: %', v_cat_count;
    RAISE NOTICE 'Cats with place: %', v_with_place;
    RAISE NOTICE 'Cats with visits: %', v_with_visits;
END;
$$;

\echo ''
\echo 'Sample cats by quality tier:'
SELECT
    quality_tier,
    COUNT(*) as count
FROM sot.v_cat_list
GROUP BY quality_tier
ORDER BY
    CASE quality_tier
        WHEN 'gold' THEN 1
        WHEN 'silver' THEN 2
        WHEN 'bronze' THEN 3
        ELSE 4
    END;

\echo ''
\echo 'MIG_2322 Complete!'
