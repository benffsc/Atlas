-- MIG_021__link_cats_to_places.sql
-- Cat-to-Place Linker Function + Views
--
-- Creates:
--   - trapper.link_cats_to_places(): links cats to places via owner addresses
--   - trapper.v_cat_primary_place: best place per cat
--   - trapper.v_places_with_cat_activity: places with cat counts
--
-- Purpose:
--   - Automatically link cats to places using existing person-place relationships
--   - Provide "best known place" for each cat for maps/triage
--   - No new geocoding - uses existing resolved addresses only
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_021__link_cats_to_places.sql

\echo '============================================'
\echo 'MIG_021: Cat-Place Linker + Views'
\echo '============================================'

-- ============================================
-- PART 1: Link Cats to Places Function
-- ============================================
\echo ''
\echo 'Creating link_cats_to_places function...'

CREATE OR REPLACE FUNCTION trapper.link_cats_to_places()
RETURNS TABLE (
    cats_linked_home INT,
    cats_linked_appointment INT,
    total_edges INT
) AS $$
DECLARE
    v_cats_linked_home INT := 0;
    v_cats_linked_appointment INT := 0;
    v_total_edges INT := 0;

    v_rec RECORD;
    v_canonical_person_id UUID;
    v_place_id UUID;
    v_inserted BOOLEAN;
BEGIN
    -- ============================================
    -- PATH 1: Owner Address → Place ("home")
    -- ============================================
    -- For each cat with an owner, find the owner's place via person_place_relationships

    FOR v_rec IN
        SELECT DISTINCT
            pcr.cat_id,
            pcr.person_id AS owner_person_id,
            pcr.source_system AS cat_source_system,
            pcr.source_table AS cat_source_table
        FROM trapper.person_cat_relationships pcr
        WHERE pcr.relationship_type = 'owner'
    LOOP
        -- Get canonical person ID
        v_canonical_person_id := trapper.canonical_person_id(v_rec.owner_person_id);

        -- Find the owner's best place (highest confidence)
        SELECT ppr.place_id INTO v_place_id
        FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = v_canonical_person_id
        ORDER BY ppr.confidence DESC, ppr.created_at ASC
        LIMIT 1;

        IF v_place_id IS NOT NULL THEN
            -- Insert cat-place relationship
            INSERT INTO trapper.cat_place_relationships (
                cat_id, place_id, relationship_type, confidence,
                source_system, source_table, evidence
            ) VALUES (
                v_rec.cat_id,
                v_place_id,
                'home',
                'high',
                v_rec.cat_source_system,
                v_rec.cat_source_table,
                jsonb_build_object(
                    'link_method', 'owner_address',
                    'owner_person_id', v_canonical_person_id::text,
                    'linked_at', NOW()::text
                )
            )
            ON CONFLICT (cat_id, place_id, relationship_type, source_system, source_table)
            DO UPDATE SET
                evidence = trapper.cat_place_relationships.evidence ||
                    jsonb_build_object('last_seen', NOW()::text);

            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            IF v_inserted THEN
                v_cats_linked_home := v_cats_linked_home + 1;
                v_total_edges := v_total_edges + 1;
            END IF;
        END IF;
    END LOOP;

    -- ============================================
    -- PATH 2: Appointment Location → Place ("appointment_site")
    -- ============================================
    -- Note: ClinicHQ appointment_info doesn't have location fields,
    -- so appointment site linking is deferred until we have venue data.
    -- This is a placeholder for future expansion.

    -- For now, we could potentially link cats to a "ClinicHQ Clinic" place
    -- if we create one, but that requires knowing the clinic address.
    -- Skipping for minimal implementation.

    v_cats_linked_appointment := 0;  -- No appointment site links yet

    RETURN QUERY SELECT v_cats_linked_home, v_cats_linked_appointment, v_total_edges;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_cats_to_places IS
'Links cats to places using owner address signals.
Primary path: cat → owner (person_cat_relationships) → place (person_place_relationships).
Creates "home" relationship type with high confidence when owner has a resolved address.
Appointment site linking is deferred (no location data in current sources).';

-- ============================================
-- PART 2: v_cat_primary_place View
-- ============================================
\echo ''
\echo 'Creating v_cat_primary_place view...'

CREATE OR REPLACE VIEW trapper.v_cat_primary_place AS
WITH ranked_places AS (
    SELECT
        cpr.cat_id,
        cpr.place_id,
        cpr.relationship_type,
        cpr.confidence,
        cpr.source_system,
        cpr.evidence,
        -- Rank: home/high > home/medium > appointment_site/high > appointment_site/low
        ROW_NUMBER() OVER (
            PARTITION BY cpr.cat_id
            ORDER BY
                CASE cpr.relationship_type
                    WHEN 'home' THEN 1
                    WHEN 'appointment_site' THEN 2
                    WHEN 'trapped_at' THEN 3
                    ELSE 4
                END,
                CASE cpr.confidence
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    WHEN 'low' THEN 3
                    ELSE 4
                END,
                cpr.created_at
        ) AS rank
    FROM trapper.cat_place_relationships cpr
)
SELECT
    c.cat_id,
    c.display_name AS cat_name,
    rp.place_id,
    p.display_name AS place_name,
    p.formatted_address,
    rp.relationship_type,
    rp.confidence,
    rp.source_system,
    p.location  -- PostGIS point for mapping
FROM trapper.sot_cats c
LEFT JOIN ranked_places rp ON rp.cat_id = c.cat_id AND rp.rank = 1
LEFT JOIN trapper.places p ON p.place_id = rp.place_id;

COMMENT ON VIEW trapper.v_cat_primary_place IS
'One row per cat with their "best" known place.
Priority: home/high > home/medium > appointment_site/high > appointment_site/low.
Use for maps and triage views.';

-- ============================================
-- PART 3: v_places_with_cat_activity View
-- ============================================
\echo ''
\echo 'Creating v_places_with_cat_activity view...'

CREATE OR REPLACE VIEW trapper.v_places_with_cat_activity AS
SELECT
    p.place_id,
    p.display_name AS place_name,
    p.formatted_address,
    p.effective_type,
    p.location,

    -- Total cats linked to this place
    (
        SELECT COUNT(DISTINCT cpr.cat_id)
        FROM trapper.cat_place_relationships cpr
        WHERE cpr.place_id = p.place_id
    ) AS total_cats,

    -- Cats with home links
    (
        SELECT COUNT(DISTINCT cpr.cat_id)
        FROM trapper.cat_place_relationships cpr
        WHERE cpr.place_id = p.place_id
          AND cpr.relationship_type = 'home'
    ) AS cats_home,

    -- Cats with appointment site links
    (
        SELECT COUNT(DISTINCT cpr.cat_id)
        FROM trapper.cat_place_relationships cpr
        WHERE cpr.place_id = p.place_id
          AND cpr.relationship_type = 'appointment_site'
    ) AS cats_appointment,

    -- Cat names preview
    (
        SELECT string_agg(DISTINCT c.display_name, ', ' ORDER BY c.display_name)
        FROM trapper.cat_place_relationships cpr
        JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
        WHERE cpr.place_id = p.place_id
          AND c.display_name IS NOT NULL
        LIMIT 5
    ) AS cat_names_preview,

    p.has_trapping_activity,
    p.has_appointment_activity,
    p.has_cat_activity,
    p.last_activity_at

FROM trapper.places p
WHERE EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr
    WHERE cpr.place_id = p.place_id
);

COMMENT ON VIEW trapper.v_places_with_cat_activity IS
'Places that have cats linked to them, with counts and activity flags.
Use for identifying locations with cat populations.';

-- ============================================
-- PART 4: Update places.has_cat_activity flag
-- ============================================
\echo ''
\echo 'Creating update_place_cat_activity_flags function...'

CREATE OR REPLACE FUNCTION trapper.update_place_cat_activity_flags()
RETURNS INT AS $$
DECLARE
    v_count INT;
BEGIN
    UPDATE trapper.places p
    SET
        has_cat_activity = TRUE,
        last_activity_at = COALESCE(last_activity_at, NOW()),
        updated_at = NOW()
    WHERE EXISTS (
        SELECT 1 FROM trapper.cat_place_relationships cpr
        WHERE cpr.place_id = p.place_id
    )
    AND (has_cat_activity IS NULL OR has_cat_activity = FALSE);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_place_cat_activity_flags IS
'Updates has_cat_activity flag on places that have cat relationships.';

-- ============================================
-- PART 5: Cat-Place Stats View
-- ============================================
\echo ''
\echo 'Creating v_cat_place_stats view...'

CREATE OR REPLACE VIEW trapper.v_cat_place_stats AS
SELECT
    (SELECT COUNT(*) FROM trapper.cat_place_relationships) AS total_relationships,
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) AS cats_with_place,
    (SELECT COUNT(DISTINCT place_id) FROM trapper.cat_place_relationships) AS places_with_cats,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE relationship_type = 'home') AS home_links,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE relationship_type = 'appointment_site') AS appointment_links,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE confidence = 'high') AS high_confidence,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE confidence = 'medium') AS medium_confidence,
    (SELECT COUNT(*) FROM trapper.cat_place_relationships WHERE confidence = 'low') AS low_confidence;

COMMENT ON VIEW trapper.v_cat_place_stats IS
'Summary statistics for cat-place relationships.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_021 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Functions created:'
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name IN ('link_cats_to_places', 'update_place_cat_activity_flags')
ORDER BY routine_name;

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name IN ('v_cat_primary_place', 'v_places_with_cat_activity', 'v_cat_place_stats')
ORDER BY table_name;

\echo ''
\echo 'Next steps:'
\echo '  1. Run: SELECT * FROM trapper.link_cats_to_places();'
\echo '  2. Run: SELECT trapper.update_place_cat_activity_flags();'
\echo '  3. Check: SELECT * FROM trapper.v_cat_place_stats;'
\echo '  4. Query: SELECT * FROM trapper.v_cat_primary_place WHERE place_id IS NOT NULL LIMIT 10;'
\echo ''
