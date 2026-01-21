\echo ''
\echo '=============================================='
\echo 'MIG_534: FFSC Internal Appointment Categorization'
\echo '=============================================='
\echo ''
\echo 'Categorizes FFSC internal appointments into:'
\echo '  - Repeat clients (David Rom, Jahni Coyote, etc.)'
\echo '  - Supply vendors (Adts, Dhc Supplies, Redimat)'
\echo '  - Partner locations (homeless camps, schools)'
\echo ''

-- ============================================================================
-- ADD appointment_category ENUM
-- ============================================================================

\echo 'Adding appointment_category column...'

DO $$
BEGIN
    -- Create enum if not exists
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_category') THEN
        CREATE TYPE trapper.appointment_category AS ENUM (
            'client',              -- Regular client appointment
            'partner_org',         -- Partner rescue/shelter
            'ffsc_internal',       -- FFSC internal (supply runs, etc.)
            'community_location',  -- Known colony/community site
            'data_quality_issue'   -- Bad data that needs cleanup
        );
    END IF;

    -- Add column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'sot_appointments'
        AND column_name = 'appointment_category'
    ) THEN
        ALTER TABLE trapper.sot_appointments
        ADD COLUMN appointment_category trapper.appointment_category;

        COMMENT ON COLUMN trapper.sot_appointments.appointment_category IS
        'Category of appointment: client, partner_org, ffsc_internal, community_location, data_quality_issue';
    END IF;
END $$;

-- ============================================================================
-- STEP 1: Mark partner org appointments
-- ============================================================================

\echo 'Step 1: Marking partner org appointments...'

UPDATE trapper.sot_appointments
SET appointment_category = 'partner_org'
WHERE partner_org_id IS NOT NULL
  AND appointment_category IS NULL;

-- ============================================================================
-- STEP 2: Mark community location appointments
-- ============================================================================

\echo 'Step 2: Marking community location appointments...'

UPDATE trapper.sot_appointments
SET appointment_category = 'community_location'
WHERE inferred_place_id IS NOT NULL
  AND partner_org_id IS NULL
  AND appointment_category IS NULL;

-- ============================================================================
-- STEP 3: Create FFSC vendors as partner orgs (internal type)
-- ============================================================================

\echo 'Step 3: Creating FFSC vendor organizations...'

INSERT INTO trapper.partner_organizations (
    org_name, org_name_patterns, org_type, relationship_type, notes, created_by
) VALUES
    ('ADTS FFSC', ARRAY['%Adts%', '%ADTS%'], 'other', 'vendor', 'FFSC supply vendor', 'MIG_534'),
    ('DHC Supplies FFSC', ARRAY['%Dhc Supplies%', '%DHC%'], 'other', 'vendor', 'FFSC supply vendor', 'MIG_534'),
    ('Redimat FFSC', ARRAY['%Redimat%'], 'other', 'vendor', 'FFSC supply vendor', 'MIG_534'),
    ('Americas Tires FFSC', ARRAY['%America%s Tires%'], 'other', 'vendor', 'FFSC supply vendor', 'MIG_534')
ON CONFLICT DO NOTHING;

-- Link vendor appointments
UPDATE trapper.sot_appointments a
SET
    partner_org_id = po.org_id,
    appointment_category = 'ffsc_internal'
FROM trapper.sot_people p
JOIN trapper.partner_organizations po ON (
    EXISTS (
        SELECT 1 FROM unnest(po.org_name_patterns) AS pattern
        WHERE p.display_name ILIKE pattern
    )
)
WHERE a.person_id = p.person_id
  AND p.display_name ~* 'Adts|Dhc Supplies|Redimat|America.*Tires'
  AND a.appointment_category IS NULL;

-- ============================================================================
-- STEP 4: Create places for known FFSC community locations
-- ============================================================================

\echo 'Step 4: Creating places for known FFSC community locations...'

-- Petaluma Homeless Camp
SELECT trapper.find_or_create_place_deduped(
    'Petaluma Homeless Camp, Petaluma, CA',
    'Petaluma Homeless Camp',
    NULL, NULL, 'clinichq'
);

-- 2151 West Steele Lane (known FFSC location)
SELECT trapper.find_or_create_place_deduped(
    '2151 West Steele Lane, Santa Rosa, CA 95403',
    '2151 West Steele Lane',
    NULL, NULL, 'clinichq'
);

-- 1698 Barsuglia St (known FFSC location)
SELECT trapper.find_or_create_place_deduped(
    '1698 Barsuglia St, Santa Rosa, CA',
    '1698 Barsuglia St',
    NULL, NULL, 'clinichq'
);

-- Add org-place mappings for these locations
INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%Petaluma Homeless Camp%',
    'ilike',
    place_id,
    'Petaluma Homeless Camp',
    'Community location - homeless encampment TNR site',
    'MIG_534'
FROM trapper.places
WHERE display_name ILIKE '%Petaluma Homeless Camp%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%2151 West Steele%',
    'ilike',
    place_id,
    '2151 West Steele Lane',
    'Known FFSC community location',
    'MIG_534'
FROM trapper.places
WHERE formatted_address ILIKE '%2151 West Steele%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%1698 Barsuglia%',
    'ilike',
    place_id,
    '1698 Barsuglia St',
    'Known FFSC community location',
    'MIG_534'
FROM trapper.places
WHERE formatted_address ILIKE '%1698 Barsuglia%'
LIMIT 1
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

-- Link appointments to these places
SELECT * FROM trapper.link_all_org_appointments_to_places();

-- Mark as community locations
UPDATE trapper.sot_appointments
SET appointment_category = 'community_location'
WHERE inferred_place_id IS NOT NULL
  AND appointment_category IS NULL;

-- ============================================================================
-- STEP 5: Handle repeat clients (these are real people, not orgs)
-- ============================================================================

\echo 'Step 5: Handling repeat clients...'

-- Note: David Rom, Jahni Coyote, Rusty Wood etc. are repeat clients
-- They should NOT be marked as organizations - they're valid canonical people
-- For now, we just mark their appointments appropriately

UPDATE trapper.sot_appointments a
SET appointment_category = 'client'
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND p.display_name IN ('David Rom', 'Jahni Coyote', 'Rusty Wood', 'Kendra Scherrer', 'Jen Untalan')
  AND a.appointment_category IS NULL;

-- Actually, these people should probably be canonical
-- Let's check if they have valid identifiers and mark them canonical
UPDATE trapper.sot_people
SET is_canonical = TRUE
WHERE display_name IN ('David Rom', 'Jahni Coyote', 'Rusty Wood', 'Kendra Scherrer', 'Jen Untalan')
  AND merged_into_person_id IS NULL
  AND EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = sot_people.person_id
  );

-- ============================================================================
-- VIEW: v_appointment_categories
-- Shows appointment distribution by category
-- ============================================================================

\echo 'Creating v_appointment_categories view...'

CREATE OR REPLACE VIEW trapper.v_appointment_categories AS
SELECT
    COALESCE(appointment_category::text, 'uncategorized') AS category,
    COUNT(*) AS appointment_count,
    COUNT(DISTINCT cat_id) AS unique_cats,
    MIN(appointment_date) AS first_appointment,
    MAX(appointment_date) AS last_appointment
FROM trapper.sot_appointments
GROUP BY appointment_category
ORDER BY appointment_count DESC;

COMMENT ON VIEW trapper.v_appointment_categories IS
'Appointment distribution by category (client, partner_org, ffsc_internal, etc.)';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_534 Complete!'
\echo '=============================================='
\echo ''

SELECT * FROM trapper.v_appointment_categories;

\echo ''
\echo 'Remaining uncategorized org appointments:'
SELECT
    p.display_name AS owner_name,
    COUNT(*) AS appt_count
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON a.person_id = p.person_id
WHERE p.is_canonical = FALSE
  AND a.appointment_category IS NULL
GROUP BY p.display_name
ORDER BY appt_count DESC
LIMIT 15;

\echo ''
