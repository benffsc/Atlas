-- MIG_174__fix_cat_detail_view.sql
-- Fixes v_cat_detail view to include all columns expected by the API
--
-- The API expects:
--   - altered_by_clinic (boolean) - TRUE if clinic performed spay/neuter
--   - ownership_type (text) - Community Cat, Owned, Foster, etc.
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_174__fix_cat_detail_view.sql

\echo ''
\echo 'MIG_174: Fix Cat Detail View'
\echo '============================='
\echo ''

-- ============================================================
-- 1. Add missing columns to sot_cats
-- ============================================================

\echo 'Adding missing columns to sot_cats...'

ALTER TABLE trapper.sot_cats
ADD COLUMN IF NOT EXISTS altered_by_clinic BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ownership_type TEXT;

COMMENT ON COLUMN trapper.sot_cats.altered_by_clinic IS 'TRUE if FFSC clinic performed the spay/neuter';
COMMENT ON COLUMN trapper.sot_cats.ownership_type IS 'Community Cat (Feral), Community Cat (Friendly), Owned, Foster, etc.';

-- ============================================================
-- 2. Recreate v_cat_detail with all expected columns
-- ============================================================

\echo 'Recreating v_cat_detail view...'

DROP VIEW IF EXISTS trapper.v_cat_detail CASCADE;

CREATE VIEW trapper.v_cat_detail AS
SELECT
    c.cat_id,
    c.display_name,
    c.sex,
    c.altered_status,
    c.altered_by_clinic,
    c.breed,
    c.primary_color AS color,
    NULL::TEXT AS coat_pattern,
    c.data_source,
    c.ownership_type,
    -- Extract microchip from identifiers
    (
        SELECT ci.id_value
        FROM trapper.cat_identifiers ci
        WHERE ci.cat_id = c.cat_id
        AND ci.id_type = 'microchip'
        LIMIT 1
    ) AS microchip,
    -- Quality tier from v_cat_quality
    cq.quality_tier,
    cq.quality_reason,
    c.notes,
    c.created_at,
    c.updated_at,
    -- Identifiers with API-expected structure
    (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'type', ci.id_type,
                'value', ci.id_value,
                'source', ci.source_system
            )
            ORDER BY ci.id_type
        ), '[]'::jsonb)
        FROM trapper.cat_identifiers ci
        WHERE ci.cat_id = c.cat_id
    ) AS identifiers,
    -- Owners with API-expected structure
    (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'person_id', trapper.canonical_person_id(pcr.person_id),
                'display_name', p.display_name,
                'role', pcr.relationship_type
            )
            ORDER BY pcr.relationship_type, p.display_name
        ), '[]'::jsonb)
        FROM trapper.person_cat_relationships pcr
        JOIN trapper.sot_people p ON p.person_id = trapper.canonical_person_id(pcr.person_id)
        WHERE pcr.cat_id = c.cat_id
    ) AS owners,
    -- Places with API-expected structure
    (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'place_id', cpr.place_id,
                'label', pl.display_name,
                'place_kind', pl.place_kind,
                'role', cpr.relationship_type
            )
            ORDER BY cpr.relationship_type
        ), '[]'::jsonb)
        FROM trapper.cat_place_relationships cpr
        JOIN trapper.places pl ON pl.place_id = cpr.place_id
        WHERE cpr.cat_id = c.cat_id
    ) AS places
FROM trapper.sot_cats c
LEFT JOIN trapper.v_cat_quality cq ON cq.cat_id = c.cat_id;

COMMENT ON VIEW trapper.v_cat_detail IS
'Cat detail view with all columns expected by the API.
Includes altered_by_clinic, ownership_type, data_source, quality_tier.';

-- ============================================================
-- 3. Populate altered_by_clinic from procedures
-- ============================================================

\echo 'Populating altered_by_clinic from procedures...'

UPDATE trapper.sot_cats c
SET altered_by_clinic = TRUE
WHERE EXISTS (
    SELECT 1 FROM trapper.cat_procedures cp
    WHERE cp.cat_id = c.cat_id
    AND (cp.is_spay = TRUE OR cp.is_neuter = TRUE)
    AND cp.status = 'completed'
);

-- ============================================================
-- 4. Populate ownership_type from clinic history
-- ============================================================

\echo 'Populating ownership_type from clinic history...'

-- Get the most recent ownership type from clinic visits
UPDATE trapper.sot_cats c
SET ownership_type = sub.ownership_type
FROM (
    SELECT DISTINCT ON (cat_id)
        cat_id,
        ownership_type
    FROM trapper.v_cat_clinic_history
    WHERE ownership_type IS NOT NULL
    ORDER BY cat_id, visit_date DESC
) sub
WHERE c.cat_id = sub.cat_id
AND c.ownership_type IS NULL;

-- ============================================================
-- 5. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Altered by clinic stats:'
SELECT
    altered_by_clinic,
    COUNT(*) as count
FROM trapper.sot_cats
GROUP BY altered_by_clinic;

\echo ''
\echo 'Ownership type distribution:'
SELECT
    COALESCE(ownership_type, '(null)') as type,
    COUNT(*) as count
FROM trapper.sot_cats
GROUP BY ownership_type
ORDER BY count DESC
LIMIT 10;

\echo ''
\echo 'View columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
AND table_name = 'v_cat_detail'
ORDER BY ordinal_position;

SELECT 'MIG_174 Complete' AS status;
