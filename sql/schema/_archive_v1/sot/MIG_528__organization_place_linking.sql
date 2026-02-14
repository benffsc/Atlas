\echo ''
\echo '=============================================='
\echo 'MIG_528: Organization to Place Linking'
\echo '=============================================='
\echo ''
\echo 'Organizations in ClinicHQ often represent trapping LOCATIONS, not owners.'
\echo 'This migration:'
\echo '  1. Creates organization_place_mappings to link org names to places'
\echo '  2. Adds inferred_place_id to appointments for location tracking'
\echo '  3. Links existing org appointments to places where possible'
\echo ''

-- ============================================================================
-- TABLE: organization_place_mappings
-- Maps organization names to their associated places (trapping locations)
-- ============================================================================

\echo 'Creating organization_place_mappings table...'

CREATE TABLE IF NOT EXISTS trapper.organization_place_mappings (
    mapping_id SERIAL PRIMARY KEY,

    -- The organization pattern (how it appears in ClinicHQ)
    org_pattern TEXT NOT NULL,
    org_pattern_type TEXT NOT NULL DEFAULT 'ilike',  -- 'ilike', 'exact', 'regex'

    -- The place this organization represents
    place_id UUID NOT NULL REFERENCES trapper.places(place_id),

    -- Metadata
    org_display_name TEXT,        -- Friendly name (e.g., "Howarth Park")
    notes TEXT,

    -- Tracking
    auto_link_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    appointments_linked_count INT DEFAULT 0,
    last_linked_at TIMESTAMPTZ,

    -- Audit
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_pattern, org_pattern_type)
);

COMMENT ON TABLE trapper.organization_place_mappings IS
'Maps organization names (as they appear in ClinicHQ) to places in Atlas.
These organizations often represent trapping locations, not actual owners.
Example: "Howarth Park FFSC" maps to the Howarth Park place_id.';

-- ============================================================================
-- ADD inferred_place_id TO sot_appointments
-- Tracks the inferred trapping location (distinct from owner address)
-- ============================================================================

\echo 'Adding inferred_place_id to sot_appointments...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'sot_appointments'
        AND column_name = 'inferred_place_id'
    ) THEN
        ALTER TABLE trapper.sot_appointments
        ADD COLUMN inferred_place_id UUID REFERENCES trapper.places(place_id),
        ADD COLUMN inferred_place_source TEXT;  -- 'org_mapping', 'owner_address', 'manual'

        COMMENT ON COLUMN trapper.sot_appointments.inferred_place_id IS
        'Inferred trapping location. May come from org name mapping or owner address.';

        COMMENT ON COLUMN trapper.sot_appointments.inferred_place_source IS
        'How inferred_place_id was determined: org_mapping, owner_address, manual';
    END IF;
END $$;

-- ============================================================================
-- FUNCTION: get_organization_place
-- Returns the place_id for an organization name
-- ============================================================================

\echo 'Creating get_organization_place function...'

CREATE OR REPLACE FUNCTION trapper.get_organization_place(p_owner_name TEXT)
RETURNS UUID AS $$
DECLARE
    v_place_id UUID;
BEGIN
    IF p_owner_name IS NULL OR TRIM(p_owner_name) = '' THEN
        RETURN NULL;
    END IF;

    -- Check for matching mapping
    SELECT place_id INTO v_place_id
    FROM trapper.organization_place_mappings m
    WHERE m.auto_link_enabled = TRUE
      AND (
          (m.org_pattern_type = 'exact' AND LOWER(p_owner_name) = LOWER(m.org_pattern)) OR
          (m.org_pattern_type = 'ilike' AND p_owner_name ILIKE m.org_pattern) OR
          (m.org_pattern_type = 'regex' AND p_owner_name ~* m.org_pattern)
      )
    ORDER BY
        CASE WHEN LOWER(p_owner_name) = LOWER(m.org_pattern) THEN 0 ELSE 1 END,
        m.created_at
    LIMIT 1;

    -- Update stats if found
    IF v_place_id IS NOT NULL THEN
        UPDATE trapper.organization_place_mappings
        SET appointments_linked_count = appointments_linked_count + 1,
            last_linked_at = NOW(),
            updated_at = NOW()
        WHERE place_id = v_place_id
          AND auto_link_enabled = TRUE;
    END IF;

    RETURN v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_organization_place IS
'Returns the place_id for an organization name.
Used to link appointments from org "owners" to their trapping locations.';

-- ============================================================================
-- CREATE INITIAL MAPPINGS FROM KNOWN LOCATIONS
-- These locations appeared frequently in the data
-- ============================================================================

\echo 'Creating initial organization-place mappings for known locations...'

-- First, create places for known trapping locations that don't exist
-- (These will need geocoding later)

-- West 6th Street already exists, let's create mappings for it and others

INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT
    '%' || lr.location_name || '%',
    'ilike',
    pl.place_id,
    lr.location_name,
    'Auto-created from FFSC appointment data',
    'MIG_528'
FROM (
    SELECT DISTINCT
        TRIM(REGEXP_REPLACE(p.display_name, '\s*(Ffsc|FFSC)$', '', 'i')) AS location_name
    FROM trapper.sot_people p
    WHERE p.display_name ~* 'FFSC$' OR p.display_name ~* 'Ffsc$'
) lr
JOIN trapper.places pl ON (
    pl.formatted_address ILIKE '%' || lr.location_name || '%'
    OR pl.display_name ILIKE '%' || lr.location_name || '%'
) AND pl.merged_into_place_id IS NULL
WHERE LENGTH(lr.location_name) > 3
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

\echo 'Initial mappings created.'

-- ============================================================================
-- LINK EXISTING APPOINTMENTS TO PLACES
-- For appointments with org "owners", set inferred_place_id
-- ============================================================================

\echo 'Linking existing appointments to places via org mappings...'

WITH org_appointments AS (
    SELECT
        a.appointment_id,
        p.display_name AS owner_name,
        trapper.get_organization_place(p.display_name) AS mapped_place_id
    FROM trapper.sot_appointments a
    JOIN trapper.sot_people p ON a.person_id = p.person_id
    WHERE p.is_canonical = FALSE
      AND a.inferred_place_id IS NULL
      AND trapper.is_organization_name(p.display_name)
)
UPDATE trapper.sot_appointments a
SET
    inferred_place_id = oa.mapped_place_id,
    inferred_place_source = 'org_mapping'
FROM org_appointments oa
WHERE a.appointment_id = oa.appointment_id
  AND oa.mapped_place_id IS NOT NULL;

-- ============================================================================
-- VIEW: v_organization_place_mappings
-- Shows all org-to-place mappings
-- ============================================================================

\echo 'Creating v_organization_place_mappings view...'

CREATE OR REPLACE VIEW trapper.v_organization_place_mappings AS
SELECT
    m.mapping_id,
    m.org_pattern,
    m.org_pattern_type,
    m.org_display_name,
    m.place_id,
    pl.formatted_address AS place_address,
    pl.display_name AS place_name,
    m.auto_link_enabled,
    m.appointments_linked_count,
    m.last_linked_at,
    m.notes,
    m.created_at
FROM trapper.organization_place_mappings m
JOIN trapper.places pl ON pl.place_id = m.place_id
ORDER BY m.appointments_linked_count DESC, m.org_display_name;

COMMENT ON VIEW trapper.v_organization_place_mappings IS
'Shows all organization-to-place mappings for linking appointments to locations';

-- ============================================================================
-- VIEW: v_org_appointments_without_place
-- Appointments from org "owners" that haven't been linked to a place yet
-- ============================================================================

\echo 'Creating v_org_appointments_without_place view...'

CREATE OR REPLACE VIEW trapper.v_org_appointments_without_place AS
SELECT
    a.appointment_id,
    a.appointment_date,
    p.display_name AS org_owner_name,
    TRIM(REGEXP_REPLACE(p.display_name, '\s*(Ffsc|FFSC|Forgotten Felines.*)$', '', 'i')) AS extracted_location,
    c.display_name AS cat_name,
    a.service_type
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON a.person_id = p.person_id
LEFT JOIN trapper.sot_cats c ON a.cat_id = c.cat_id
WHERE p.is_canonical = FALSE
  AND a.inferred_place_id IS NULL
  AND (
      trapper.is_organization_name(p.display_name) OR
      p.display_name ~* 'FFSC|Forgotten Felines'
  )
ORDER BY a.appointment_date DESC;

COMMENT ON VIEW trapper.v_org_appointments_without_place IS
'Appointments from organization "owners" that need place linking.
Use this to identify new org-place mappings to create.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_528 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Organization-Place Mappings' AS metric, COUNT(*)::text AS value
FROM trapper.organization_place_mappings
UNION ALL
SELECT 'Appointments Linked to Places', COUNT(*)::text
FROM trapper.sot_appointments
WHERE inferred_place_id IS NOT NULL AND inferred_place_source = 'org_mapping'
UNION ALL
SELECT 'Org Appointments Needing Link', COUNT(*)::text
FROM trapper.v_org_appointments_without_place;

\echo ''
\echo 'Created:'
\echo '  - organization_place_mappings table'
\echo '  - sot_appointments.inferred_place_id column'
\echo '  - get_organization_place() function'
\echo '  - v_organization_place_mappings view'
\echo '  - v_org_appointments_without_place view'
\echo ''
\echo 'Key insight: Organization "owners" in ClinicHQ represent trapping LOCATIONS.'
\echo 'This allows Beacon to attribute cats to places even when no real owner exists.'
\echo ''
