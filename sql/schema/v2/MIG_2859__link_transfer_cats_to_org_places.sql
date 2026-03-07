-- MIG_2859: Link shelter_transfer and rescue_transfer cats to org places (FFS-289)
--
-- Problem: ~235 shelter_transfer + rescue_transfer cats (MIG_2855) have the
-- receiving org name in client_name but no place link. These are invisible on map.
--
-- Approach:
-- 1. Define known orgs with addresses in a staging/mapping table
-- 2. Create places for each org via find_or_create_place_deduped()
-- 3. Match appointments by ffsc_program + client_name patterns
-- 4. Set inferred_place_id on matched appointments
-- 5. Clean up entity_linking_skipped for newly linked cats
-- 6. Create monitoring view
--
-- Depends on: MIG_2855 (ffsc_program classification)

BEGIN;

-- =============================================================================
-- Step 1: Create mapping table for transfer orgs
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.ffsc_transfer_org_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_key TEXT NOT NULL UNIQUE,         -- lowercase match key (e.g., 'scas', 'marin humane')
    org_display_name TEXT NOT NULL,       -- display name
    org_address TEXT,                     -- known address (if available)
    ffsc_program TEXT NOT NULL,           -- 'shelter_transfer' or 'rescue_transfer'
    place_kind TEXT DEFAULT 'shelter',    -- place_kind for created place
    matched_place_id UUID REFERENCES sot.places(place_id),
    cat_count INTEGER DEFAULT 0,
    appointment_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Step 2: Populate with known orgs and their addresses
-- =============================================================================

INSERT INTO ops.ffsc_transfer_org_matches (org_key, org_display_name, org_address, ffsc_program, place_kind) VALUES
    -- Shelter transfers (municipal)
    ('scas',                          'Sonoma County Animal Services',              '1247 Century Ct, Santa Rosa, CA 95403',      'shelter_transfer', 'shelter'),
    ('rpas',                          'Rohnert Park Animal Shelter',                '301 J Rogers Ln, Rohnert Park, CA 94928',    'shelter_transfer', 'shelter'),
    ('northbay animal services',      'Northbay Animal Services',                   NULL,                                          'shelter_transfer', 'shelter'),
    ('sc animal services',            'SC Animal Services',                         '1247 Century Ct, Santa Rosa, CA 95403',      'shelter_transfer', 'shelter'),
    ('sonoma county animal services', 'Sonoma County Animal Services',              '1247 Century Ct, Santa Rosa, CA 95403',      'shelter_transfer', 'shelter'),

    -- Rescue transfers (external orgs)
    ('humane society for inland mendocino', 'Humane Society for Inland Mendocino',  '9700 Uva Dr, Redwood Valley, CA 95470',     'rescue_transfer', 'shelter'),
    ('twenty tails rescue',                 'Twenty Tails Rescue',                  NULL,                                          'rescue_transfer', 'shelter'),
    ('bitten by a kitten',                  'Bitten By A Kitten Rescue',            NULL,                                          'rescue_transfer', 'shelter'),
    ('marin humane',                        'Marin Humane',                         '171 Bel Marin Keys Blvd, Novato, CA 94949', 'rescue_transfer', 'shelter'),
    ('cat rescue of cloverdale',            'Cat Rescue of Cloverdale',             NULL,                                          'rescue_transfer', 'shelter'),
    ('dogwood animal rescue',               'Dogwood Animal Rescue',                NULL,                                          'rescue_transfer', 'shelter'),
    ('countryside rescue',                  'Countryside Rescue',                   NULL,                                          'rescue_transfer', 'shelter'),
    ('esther pruitt feline rescue',         'Esther Pruitt Feline Rescue',          NULL,                                          'rescue_transfer', 'shelter'),
    ('sonoma county wildlife rescue',       'Sonoma County Wildlife Rescue',        '403 Mecham Rd, Petaluma, CA 94952',          'rescue_transfer', 'shelter'),
    ('little paws kitten rescue',           'Little Paws Kitten Rescue',            NULL,                                          'rescue_transfer', 'shelter')
ON CONFLICT (org_key) DO NOTHING;

-- =============================================================================
-- Step 3: Create/match places for orgs with known addresses
-- =============================================================================

DO $$
DECLARE
    r RECORD;
    v_place_id UUID;
    v_count INTEGER;
BEGIN
    -- Create places for orgs with addresses
    FOR r IN
        SELECT id, org_key, org_display_name, org_address, place_kind
        FROM ops.ffsc_transfer_org_matches
        WHERE org_address IS NOT NULL
          AND matched_place_id IS NULL
    LOOP
        v_place_id := sot.find_or_create_place_deduped(
            r.org_address,
            r.org_display_name,
            NULL, NULL,
            'atlas_ui'
        );

        IF v_place_id IS NOT NULL THEN
            UPDATE ops.ffsc_transfer_org_matches
            SET matched_place_id = v_place_id
            WHERE id = r.id;

            -- Set place_kind on the place if it's new
            UPDATE sot.places
            SET place_kind = r.place_kind
            WHERE place_id = v_place_id
              AND (place_kind IS NULL OR place_kind = 'unknown');
        END IF;
    END LOOP;

    -- For orgs without addresses, try display_name match against existing places
    UPDATE ops.ffsc_transfer_org_matches m
    SET matched_place_id = sub.place_id
    FROM (
        SELECT DISTINCT ON (LOWER(m2.org_display_name))
            m2.id AS match_id,
            p.place_id
        FROM ops.ffsc_transfer_org_matches m2
        JOIN sot.places p
            ON LOWER(BTRIM(p.display_name)) = LOWER(m2.org_display_name)
        WHERE m2.matched_place_id IS NULL
          AND p.merged_into_place_id IS NULL
        ORDER BY LOWER(m2.org_display_name), p.created_at
    ) sub
    WHERE m.id = sub.match_id;

    -- Deduplicate: SCAS and SC Animal Services and Sonoma County Animal Services
    -- should all point to the same place
    UPDATE ops.ffsc_transfer_org_matches
    SET matched_place_id = (
        SELECT matched_place_id FROM ops.ffsc_transfer_org_matches
        WHERE org_key = 'scas' AND matched_place_id IS NOT NULL
    )
    WHERE org_key IN ('sc animal services', 'sonoma county animal services')
      AND matched_place_id IS NULL
      AND EXISTS (
          SELECT 1 FROM ops.ffsc_transfer_org_matches
          WHERE org_key = 'scas' AND matched_place_id IS NOT NULL
      );

    -- =========================================================================
    -- Step 4: Count cats and appointments per org
    -- =========================================================================

    UPDATE ops.ffsc_transfer_org_matches m
    SET cat_count = sub.cats,
        appointment_count = sub.appts
    FROM (
        SELECT
            om.id AS match_id,
            COUNT(DISTINCT a.cat_id) AS cats,
            COUNT(*) AS appts
        FROM ops.ffsc_transfer_org_matches om
        JOIN ops.appointments a
            ON a.ffsc_program = om.ffsc_program
           AND LOWER(TRIM(a.client_name)) LIKE '%' || om.org_key || '%'
        GROUP BY om.id
    ) sub
    WHERE m.id = sub.match_id;

    -- =========================================================================
    -- Step 5: Link appointments to org places
    -- Only for orgs with a matched place. Does NOT overwrite existing links.
    -- =========================================================================

    UPDATE ops.appointments a
    SET inferred_place_id = m.matched_place_id
    FROM ops.ffsc_transfer_org_matches m
    WHERE m.matched_place_id IS NOT NULL
      AND a.ffsc_program = m.ffsc_program
      AND LOWER(TRIM(a.client_name)) LIKE '%' || m.org_key || '%'
      AND a.inferred_place_id IS NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 5: Linked % transfer appointments to org places', v_count;

    -- =========================================================================
    -- Step 6: Clean up entity_linking_skipped for newly linked cats
    -- =========================================================================

    DELETE FROM ops.entity_linking_skipped els
    WHERE els.entity_type = 'cat'
      AND els.reason = 'ffsc_program_cat'
      AND EXISTS (
          SELECT 1 FROM ops.appointments a
          WHERE a.cat_id = els.entity_id
            AND a.ffsc_program IN ('shelter_transfer', 'rescue_transfer')
            AND a.inferred_place_id IS NOT NULL
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Step 6: Removed % entity_linking_skipped entries for linked transfer cats', v_count;
END $$;

-- =============================================================================
-- Step 7: Create monitoring view
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_ffsc_transfer_match_status AS
SELECT
    m.ffsc_program,
    m.org_display_name,
    m.org_key,
    m.cat_count,
    m.appointment_count,
    CASE WHEN m.matched_place_id IS NOT NULL THEN 'matched' ELSE 'unmatched' END AS match_status,
    p.display_name AS place_name,
    p.formatted_address AS place_address
FROM ops.ffsc_transfer_org_matches m
LEFT JOIN sot.places p ON p.place_id = m.matched_place_id
ORDER BY m.ffsc_program, m.cat_count DESC;

COMMIT;
