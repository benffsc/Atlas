-- MIG_043__cat_quality_tiers.sql
-- Add cat identity quality tiers for deduplication and UI filtering
--
-- Purpose:
--   Classify cats by evidence strength so duplicates like "Timmy" with/without
--   microchip don't look equally real. High-confidence cats surface first.
--
-- Tiers:
--   A: Has microchip (strongest identity anchor)
--   B: Has stable clinic ID (ClinicHQ animal/patient ID)
--   C: Has other identifier (source row ID, etc.)
--   D: Name only (lowest confidence)
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_043__cat_quality_tiers.sql

\echo '============================================'
\echo 'MIG_043: Cat Quality Tiers'
\echo '============================================'

-- ============================================
-- PART 1: Cat quality tier view
-- ============================================
\echo ''
\echo 'Creating v_cat_quality...'

DROP VIEW IF EXISTS trapper.v_cat_quality CASCADE;

CREATE VIEW trapper.v_cat_quality AS
WITH cat_identifiers_summary AS (
    SELECT
        ci.cat_id,
        bool_or(ci.id_type = 'microchip') AS has_microchip,
        bool_or(ci.id_type IN ('clinichq_animal_id', 'clinichq_patient_id')) AS has_clinic_id,
        bool_or(ci.id_type NOT IN ('microchip', 'clinichq_animal_id', 'clinichq_patient_id')) AS has_other_id,
        -- Get microchip value for identity key
        MAX(CASE WHEN ci.id_type = 'microchip' THEN ci.id_value END) AS microchip,
        -- Get clinic ID for fallback identity key
        MAX(CASE WHEN ci.id_type = 'clinichq_animal_id' THEN ci.id_value END) AS clinic_animal_id,
        MAX(CASE WHEN ci.id_type = 'clinichq_patient_id' THEN ci.id_value END) AS clinic_patient_id
    FROM trapper.cat_identifiers ci
    GROUP BY ci.cat_id
)
SELECT
    c.cat_id,
    c.display_name,
    -- Identity key: best available stable identifier
    COALESCE(
        cis.microchip,
        cis.clinic_animal_id,
        cis.clinic_patient_id,
        c.cat_id::TEXT  -- fallback to UUID
    ) AS identity_key,
    -- Quality tier
    CASE
        WHEN cis.has_microchip THEN 'A'
        WHEN cis.has_clinic_id THEN 'B'
        WHEN cis.has_other_id THEN 'C'
        ELSE 'D'
    END AS quality_tier,
    -- Human-readable reason
    CASE
        WHEN cis.has_microchip THEN 'microchip'
        WHEN cis.has_clinic_id THEN 'clinic_id'
        WHEN cis.has_other_id THEN 'other_id'
        ELSE 'name_only'
    END AS quality_reason,
    -- Boolean flags for easy filtering
    COALESCE(cis.has_microchip, FALSE) AS has_microchip,
    COALESCE(cis.has_clinic_id, FALSE) AS has_clinic_id,
    cis.microchip
FROM trapper.sot_cats c
LEFT JOIN cat_identifiers_summary cis ON cis.cat_id = c.cat_id;

COMMENT ON VIEW trapper.v_cat_quality IS
'Cat identity quality classification.
Tier A: microchip (highest confidence)
Tier B: clinic ID (ClinicHQ animal/patient ID)
Tier C: other identifier
Tier D: name only (lowest confidence)';

-- ============================================
-- PART 2: Update v_cat_list to include quality info
-- ============================================
\echo ''
\echo 'Updating v_cat_list with quality tier...'

DROP VIEW IF EXISTS trapper.v_cat_list CASCADE;

CREATE VIEW trapper.v_cat_list AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status,
    c.breed,
    c.primary_color AS color,
    cq.microchip,
    cq.quality_tier,
    cq.quality_reason,
    cq.has_microchip,
    -- Owner info
    (
        SELECT COUNT(DISTINCT trapper.canonical_person_id(pcr.person_id))
        FROM trapper.person_cat_relationships pcr
        WHERE pcr.cat_id = c.cat_id
    ) AS owner_count,
    (
        SELECT string_agg(DISTINCT p.display_name, ', ' ORDER BY p.display_name)
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_people p ON p.person_id = trapper.canonical_person_id(pcr.person_id)
        WHERE pcr.cat_id = c.cat_id
    ) AS owner_names,
    -- Place info
    cpp.place_id AS primary_place_id,
    cpp.place_name AS primary_place_label,
    pl.place_kind,
    cpp.place_id IS NOT NULL AS has_place,
    c.created_at,
    c.updated_at
FROM trapper.sot_cats c
LEFT JOIN trapper.v_cat_quality cq ON cq.cat_id = c.cat_id
LEFT JOIN trapper.v_cat_primary_place cpp ON cpp.cat_id = c.cat_id
LEFT JOIN trapper.places pl ON pl.place_id = cpp.place_id;

COMMENT ON VIEW trapper.v_cat_list IS
'Cat list view with quality tier and relationships for UI display.
Includes microchip, quality_tier (A/B/C/D), owner info, and primary place.';

-- ============================================
-- PART 3: Potential duplicates view
-- ============================================
\echo ''
\echo 'Creating v_cat_potential_duplicates...'

DROP VIEW IF EXISTS trapper.v_cat_potential_duplicates;

CREATE VIEW trapper.v_cat_potential_duplicates AS
WITH name_groups AS (
    SELECT
        LOWER(TRIM(c.display_name)) AS name_key,
        COUNT(*) AS cat_count,
        COUNT(*) FILTER (WHERE cq.quality_tier = 'A') AS tier_a_count,
        COUNT(*) FILTER (WHERE cq.quality_tier != 'A') AS non_tier_a_count
    FROM trapper.sot_cats c
    JOIN trapper.v_cat_quality cq ON cq.cat_id = c.cat_id
    GROUP BY LOWER(TRIM(c.display_name))
    HAVING COUNT(*) > 1
)
SELECT
    c.cat_id,
    c.display_name,
    cq.quality_tier,
    cq.quality_reason,
    cq.microchip,
    ng.cat_count AS same_name_count,
    ng.tier_a_count,
    ng.non_tier_a_count,
    -- Flag if this might be a duplicate (same name, different quality tiers)
    CASE
        WHEN ng.tier_a_count > 0 AND cq.quality_tier != 'A' THEN TRUE
        ELSE FALSE
    END AS is_potential_duplicate
FROM trapper.sot_cats c
JOIN trapper.v_cat_quality cq ON cq.cat_id = c.cat_id
JOIN name_groups ng ON ng.name_key = LOWER(TRIM(c.display_name))
ORDER BY ng.cat_count DESC, c.display_name, cq.quality_tier;

COMMENT ON VIEW trapper.v_cat_potential_duplicates IS
'Cats with duplicate names, flagged by quality tier.
is_potential_duplicate=TRUE when a higher-quality version exists.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_043 Complete'
\echo '============================================'

\echo ''
\echo 'Quality tier distribution:'
SELECT quality_tier, quality_reason, COUNT(*) AS cat_count
FROM trapper.v_cat_quality
GROUP BY quality_tier, quality_reason
ORDER BY quality_tier;

\echo ''
\echo 'Potential duplicates (top 10):'
SELECT display_name, quality_tier, microchip, same_name_count, is_potential_duplicate
FROM trapper.v_cat_potential_duplicates
WHERE is_potential_duplicate = TRUE
LIMIT 10;
