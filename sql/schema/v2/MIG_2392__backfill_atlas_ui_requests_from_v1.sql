-- MIG_2392: Backfill atlas_ui Requests from V1
--
-- Problem: 9 atlas_ui requests have no place/requester links in V2.
-- Root cause: V1→V2 migration mapping tables no longer exist.
--
-- Solution: V1 (East) database has all the data - requester contact info and addresses.
-- Process through Data Engine to create proper SOT entities.
--
-- Created: 2026-02-19

\echo ''
\echo '=============================================='
\echo '  MIG_2392: Backfill atlas_ui Requests from V1'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Step 1: Create temp table with V1 data
-- ============================================================================

\echo 'Step 1: Loading V1 atlas_ui request data...'

CREATE TEMP TABLE v1_atlas_ui_data (
    request_id UUID PRIMARY KEY,
    display_name TEXT,
    primary_email TEXT,
    primary_phone TEXT,
    formatted_address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION
);

-- V1 data (manually extracted from East DB)
INSERT INTO v1_atlas_ui_data VALUES
('353276bb-4c7c-43dc-9fca-fc748ba02ba5', 'Patricia Edgmon', NULL, '7075295590', '155 El Crystal Dr, Santa Rosa, CA 95407, USA', 38.3974712, -122.7097218),
('6903729a-5eca-427a-930a-83ab197b2763', 'Josephine Thornton', 'josthorton@comcast.net', '7077792485', '613 Corona Rd, Petaluma, CA 94954, USA', 38.2744207, -122.6502847),
('6ff7e174-1edc-41ea-8eaf-5cb2b354ba00', 'Kimberly Kiner', NULL, '7072319621', '23888 Arnold Dr, Sonoma, CA 95476, USA', 38.2240899, -122.4570447),
('7ee0344e-e5da-4682-9237-26b4422264a1', 'Ann Ferrari', NULL, '7073962420', '3455 Santa Rosa Ave space 45, Santa Rosa, CA 95407', 38.3934648, -122.714983),
('879c2d62-c098-41ca-83d9-4d83e11e8825', 'Christine Baker', NULL, '7076238946', '3590 Petaluma Blvd N, Petaluma, CA 94952', 38.2608526, -122.661399),
('8faf6405-19d4-4c2d-84ae-493a1262760c', 'Crystal Mittelstedter', 'c_mittelstedter@yahoo.com', '7078495469', '1638 McCarran Way, Santa Rosa, CA 95401', 38.4330953, -122.7399148),
('9f2f4091-e0a4-4c2e-8772-0d4971b5def4', 'Robert Cole', NULL, '7077634439', '1653 Del Oro Cir, Petaluma, CA 94954, USA', 38.2404204, -122.5980241),
('adce05d2-ba73-4b13-92ab-1910b1c5b956', 'Mike Guerrazzi', NULL, NULL, '5458 CA-12, Santa Rosa, CA 95409', 38.4621268, -122.6449431),
('afa5cdac-6c15-47ff-87a8-6cffe82fdc78', 'Laura Martinez', 'angeltinoco04050@gmail.com', '7079744118', '1225 Grand Ave, Santa Rosa, CA 95404, USA', 38.4266851, -122.7072536);

\echo ''
SELECT 'V1 atlas_ui data loaded' as step, COUNT(*) as count FROM v1_atlas_ui_data;

-- ============================================================================
-- Step 2: Create/find places
-- ============================================================================

\echo ''
\echo 'Step 2: Creating/finding places...'

CREATE TEMP TABLE resolved_places AS
SELECT
    v1.request_id,
    v1.formatted_address,
    sot.find_or_create_place_deduped(
        p_formatted_address := v1.formatted_address,
        p_display_name := NULL,
        p_lat := v1.latitude,
        p_lng := v1.longitude,
        p_source_system := 'atlas_ui'
    ) as v2_place_id
FROM v1_atlas_ui_data v1;

\echo ''
SELECT 'Places resolved' as step, COUNT(*) as count, COUNT(v2_place_id) as found FROM resolved_places;

-- ============================================================================
-- Step 3: Create/find people via Data Engine
-- ============================================================================

\echo ''
\echo 'Step 3: Resolving people via Data Engine...'

-- Parse first/last names
CREATE TEMP TABLE v1_parsed_names AS
SELECT
    v1.request_id,
    v1.display_name,
    v1.primary_email,
    v1.primary_phone,
    v1.formatted_address,
    SPLIT_PART(v1.display_name, ' ', 1) as first_name,
    CASE WHEN POSITION(' ' IN v1.display_name) > 0
         THEN SUBSTRING(v1.display_name FROM POSITION(' ' IN v1.display_name) + 1)
         ELSE NULL
    END as last_name
FROM v1_atlas_ui_data v1
WHERE v1.primary_email IS NOT NULL OR v1.primary_phone IS NOT NULL;

-- Resolve through Data Engine
CREATE TEMP TABLE resolved_people AS
SELECT
    v1.request_id,
    v1.display_name,
    v1.primary_email,
    v1.primary_phone,
    de.decision_type,
    de.resolved_person_id,
    de.reason
FROM v1_parsed_names v1
CROSS JOIN LATERAL (
    SELECT *
    FROM sot.data_engine_resolve_identity(
        v1.primary_email,
        v1.primary_phone,
        v1.first_name,
        v1.last_name,
        v1.formatted_address,
        'atlas_ui'
    )
) de;

\echo ''
\echo 'Person resolution results:'
SELECT
    decision_type,
    COUNT(*) as count
FROM resolved_people
GROUP BY 1
ORDER BY 2 DESC;

-- ============================================================================
-- Step 4: Update requests with resolved entities
-- ============================================================================

\echo ''
\echo 'Step 4: Updating requests with resolved entities...'

-- Update place_id
UPDATE ops.requests r
SET
    place_id = rp.v2_place_id,
    updated_at = NOW()
FROM resolved_places rp
WHERE r.request_id = rp.request_id
  AND rp.v2_place_id IS NOT NULL
  AND r.place_id IS NULL;

-- Update requester_person_id
UPDATE ops.requests r
SET
    requester_person_id = rpe.resolved_person_id,
    updated_at = NOW()
FROM resolved_people rpe
WHERE r.request_id = rpe.request_id
  AND rpe.resolved_person_id IS NOT NULL
  AND r.requester_person_id IS NULL;

-- ============================================================================
-- Step 5: Handle Mike Guerrazzi (no email or phone)
-- ============================================================================

\echo ''
\echo 'Step 5: Handling records without contact info...'

-- Mike Guerrazzi has no email or phone - need to create manually
-- Per CLAUDE.md we can't match by name alone, but we can create a new person
-- since this is verified V1 data

INSERT INTO sot.people (first_name, last_name, display_name, source_system)
SELECT 'Mike', 'Guerrazzi', 'Mike Guerrazzi', 'atlas_ui'
WHERE NOT EXISTS (
    SELECT 1 FROM resolved_people WHERE request_id = 'adce05d2-ba73-4b13-92ab-1910b1c5b956'
    AND resolved_person_id IS NOT NULL
);

-- If we just created Mike, get his ID and link to request
DO $$
DECLARE
    v_mike_id UUID;
BEGIN
    -- Check if request still needs person
    IF EXISTS (
        SELECT 1 FROM ops.requests
        WHERE request_id = 'adce05d2-ba73-4b13-92ab-1910b1c5b956'
          AND requester_person_id IS NULL
    ) THEN
        -- Find or create Mike
        SELECT person_id INTO v_mike_id
        FROM sot.people
        WHERE display_name = 'Mike Guerrazzi'
          AND source_system = 'atlas_ui'
          AND merged_into_person_id IS NULL
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_mike_id IS NOT NULL THEN
            UPDATE ops.requests
            SET requester_person_id = v_mike_id, updated_at = NOW()
            WHERE request_id = 'adce05d2-ba73-4b13-92ab-1910b1c5b956';
            RAISE NOTICE 'Linked Mike Guerrazzi (%) to request', v_mike_id;
        END IF;
    END IF;
END $$;

-- ============================================================================
-- Step 6: Verification
-- ============================================================================

\echo ''
\echo '=== Final atlas_ui Request Status ==='

SELECT
    r.request_id,
    r.summary,
    CASE WHEN r.place_id IS NOT NULL THEN '✓' ELSE '✗' END as has_place,
    CASE WHEN r.requester_person_id IS NOT NULL THEN '✓' ELSE '✗' END as has_requester,
    p.formatted_address,
    per.display_name as requester
FROM ops.requests r
LEFT JOIN sot.places p ON p.place_id = r.place_id
LEFT JOIN sot.people per ON per.person_id = r.requester_person_id
WHERE r.source_system = 'atlas_ui'
ORDER BY r.created_at;

\echo ''
\echo '=== Overall Request Link Status ==='

SELECT
    source_system,
    COUNT(*) as total,
    COUNT(place_id) as with_place,
    COUNT(requester_person_id) as with_requester,
    ROUND(COUNT(place_id)::numeric / COUNT(*) * 100, 1) as place_pct,
    ROUND(COUNT(requester_person_id)::numeric / COUNT(*) * 100, 1) as requester_pct
FROM ops.requests
GROUP BY source_system
ORDER BY total DESC;

\echo ''
\echo 'MIG_2392 complete!'
\echo ''
