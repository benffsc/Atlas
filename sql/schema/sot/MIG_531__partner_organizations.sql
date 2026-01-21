\echo ''
\echo '=============================================='
\echo 'MIG_531: Partner Organizations Registry'
\echo '=============================================='
\echo ''
\echo 'Creates a registry for partner organizations (rescues, shelters, etc.)'
\echo 'that bring cats to FFSC for spay/neuter services.'
\echo ''
\echo 'Distinct from colony sites (MIG_528-530) which are LOCATIONS.'
\echo 'Partner orgs are ENTITIES that may have their own location.'
\echo ''

-- ============================================================================
-- TABLE: partner_organizations
-- Registry of partner rescues, shelters, and animal welfare organizations
-- ============================================================================

\echo 'Creating partner_organizations table...'

CREATE TABLE IF NOT EXISTS trapper.partner_organizations (
    org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    org_name TEXT NOT NULL,                      -- Canonical name (e.g., "Sonoma County Animal Services")
    org_name_short TEXT,                         -- Short name (e.g., "SCAS")
    org_name_patterns TEXT[] DEFAULT '{}',       -- Patterns that match this org (e.g., '%SCAS%', '%Sonoma County Animal%')
    org_type TEXT NOT NULL,                      -- 'rescue', 'shelter', 'animal_services', 'vet_clinic', 'other'

    -- Location
    place_id UUID REFERENCES trapper.places(place_id),  -- Their physical facility
    address TEXT,                                -- Address text (for display if place not geocoded)

    -- Contact
    contact_person_id UUID REFERENCES trapper.sot_people(person_id),
    contact_name TEXT,                           -- Contact name (for display)
    contact_email TEXT,
    contact_phone TEXT,
    website TEXT,

    -- Relationship with FFSC
    relationship_type TEXT NOT NULL DEFAULT 'partner',  -- 'partner', 'referral_source', 'transfer_destination'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,

    -- Statistics (denormalized for quick access)
    appointments_count INT DEFAULT 0,
    cats_processed INT DEFAULT 0,
    first_appointment_date DATE,
    last_appointment_date DATE,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_partner_orgs_name ON trapper.partner_organizations(org_name);
CREATE INDEX IF NOT EXISTS idx_partner_orgs_type ON trapper.partner_organizations(org_type);
CREATE INDEX IF NOT EXISTS idx_partner_orgs_active ON trapper.partner_organizations(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_partner_orgs_place ON trapper.partner_organizations(place_id) WHERE place_id IS NOT NULL;

-- GIN index for pattern array searching
CREATE INDEX IF NOT EXISTS idx_partner_orgs_patterns ON trapper.partner_organizations USING GIN(org_name_patterns);

COMMENT ON TABLE trapper.partner_organizations IS
'Registry of partner organizations (rescues, shelters, animal services) that bring cats to FFSC.
These are ENTITIES, not LOCATIONS. Each may have an associated place_id for their facility.
Examples: Sonoma County Animal Services, Humane Society for Inland Mendocino Co, Bitten by a Kitten Rescue';

COMMENT ON COLUMN trapper.partner_organizations.org_name_patterns IS
'Array of ILIKE patterns that match this organization in ClinicHQ data.
Example: {"%SCAS%", "%Sonoma County Animal%", "%Sc Animal Services%"}';

COMMENT ON COLUMN trapper.partner_organizations.org_type IS
'Organization type: rescue, shelter, animal_services, vet_clinic, other';

-- ============================================================================
-- ADD partner_org_id TO sot_appointments
-- Links appointments to the partner org that brought the cat
-- ============================================================================

\echo 'Adding partner_org_id to sot_appointments...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'sot_appointments'
        AND column_name = 'partner_org_id'
    ) THEN
        ALTER TABLE trapper.sot_appointments
        ADD COLUMN partner_org_id UUID REFERENCES trapper.partner_organizations(org_id);

        COMMENT ON COLUMN trapper.sot_appointments.partner_org_id IS
        'The partner organization that brought this cat to FFSC (if applicable).
        Distinct from inferred_place_id which tracks the cat''s origin location.';

        CREATE INDEX idx_appointments_partner_org ON trapper.sot_appointments(partner_org_id)
        WHERE partner_org_id IS NOT NULL;
    END IF;
END $$;

-- ============================================================================
-- FUNCTION: find_partner_org_by_name
-- Finds a partner org matching the given name
-- ============================================================================

\echo 'Creating find_partner_org_by_name function...'

CREATE OR REPLACE FUNCTION trapper.find_partner_org_by_name(p_name TEXT)
RETURNS UUID AS $$
DECLARE
    v_org_id UUID;
    v_pattern TEXT;
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN NULL;
    END IF;

    -- First try exact name match
    SELECT org_id INTO v_org_id
    FROM trapper.partner_organizations
    WHERE is_active = TRUE
      AND (LOWER(org_name) = LOWER(p_name) OR LOWER(org_name_short) = LOWER(p_name))
    LIMIT 1;

    IF v_org_id IS NOT NULL THEN
        RETURN v_org_id;
    END IF;

    -- Then try pattern matching
    SELECT org_id INTO v_org_id
    FROM trapper.partner_organizations po
    WHERE po.is_active = TRUE
      AND EXISTS (
          SELECT 1 FROM unnest(po.org_name_patterns) AS pattern
          WHERE p_name ILIKE pattern
      )
    ORDER BY
        -- Prefer more specific patterns (longer patterns)
        (SELECT MAX(LENGTH(pattern)) FROM unnest(po.org_name_patterns) AS pattern WHERE p_name ILIKE pattern) DESC
    LIMIT 1;

    RETURN v_org_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.find_partner_org_by_name IS
'Finds a partner organization by name or pattern match.
Returns the org_id if found, NULL otherwise.';

-- ============================================================================
-- FUNCTION: link_appointment_to_partner_org
-- Links an appointment to its partner org based on owner name
-- ============================================================================

\echo 'Creating link_appointment_to_partner_org function...'

CREATE OR REPLACE FUNCTION trapper.link_appointment_to_partner_org(
    p_appointment_id UUID,
    p_owner_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_org_id UUID;
    v_owner_name TEXT;
BEGIN
    -- Get owner name if not provided
    IF p_owner_name IS NULL THEN
        SELECT p.display_name INTO v_owner_name
        FROM trapper.sot_appointments a
        JOIN trapper.sot_people p ON a.person_id = p.person_id
        WHERE a.appointment_id = p_appointment_id;
    ELSE
        v_owner_name := p_owner_name;
    END IF;

    IF v_owner_name IS NULL THEN
        RETURN NULL;
    END IF;

    -- Find matching partner org
    v_org_id := trapper.find_partner_org_by_name(v_owner_name);

    -- Update appointment if found
    IF v_org_id IS NOT NULL THEN
        UPDATE trapper.sot_appointments
        SET partner_org_id = v_org_id
        WHERE appointment_id = p_appointment_id
          AND (partner_org_id IS NULL OR partner_org_id != v_org_id);

        -- Update org stats
        UPDATE trapper.partner_organizations
        SET
            appointments_count = (
                SELECT COUNT(*) FROM trapper.sot_appointments
                WHERE partner_org_id = v_org_id
            ),
            last_appointment_date = (
                SELECT MAX(appointment_date) FROM trapper.sot_appointments
                WHERE partner_org_id = v_org_id
            ),
            first_appointment_date = COALESCE(first_appointment_date, (
                SELECT MIN(appointment_date) FROM trapper.sot_appointments
                WHERE partner_org_id = v_org_id
            )),
            updated_at = NOW()
        WHERE org_id = v_org_id;
    END IF;

    RETURN v_org_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointment_to_partner_org IS
'Links an appointment to its partner organization based on the owner name.
Updates the appointment''s partner_org_id and the org''s statistics.';

-- ============================================================================
-- FUNCTION: link_all_appointments_to_partner_orgs
-- Batch links all unlinked appointments to partner orgs
-- ============================================================================

\echo 'Creating link_all_appointments_to_partner_orgs function...'

CREATE OR REPLACE FUNCTION trapper.link_all_appointments_to_partner_orgs()
RETURNS TABLE (
    appointments_processed INT,
    appointments_linked INT,
    orgs_matched INT
) AS $$
DECLARE
    v_processed INT := 0;
    v_linked INT := 0;
    v_orgs_matched INT := 0;
BEGIN
    -- Find and link appointments
    WITH org_matches AS (
        SELECT
            a.appointment_id,
            p.display_name AS owner_name,
            trapper.find_partner_org_by_name(p.display_name) AS matched_org_id
        FROM trapper.sot_appointments a
        JOIN trapper.sot_people p ON a.person_id = p.person_id
        WHERE a.partner_org_id IS NULL
          AND p.is_canonical = FALSE
          AND (
              trapper.is_organization_name(p.display_name) OR
              p.display_name ~* 'SCAS|Animal Services|Rescue|Humane Society|Shelter'
          )
    ),
    updates AS (
        UPDATE trapper.sot_appointments a
        SET partner_org_id = om.matched_org_id
        FROM org_matches om
        WHERE a.appointment_id = om.appointment_id
          AND om.matched_org_id IS NOT NULL
        RETURNING a.appointment_id, om.matched_org_id
    )
    SELECT
        (SELECT COUNT(*) FROM org_matches),
        COUNT(*),
        COUNT(DISTINCT matched_org_id)
    INTO v_processed, v_linked, v_orgs_matched
    FROM updates;

    -- Update org statistics
    UPDATE trapper.partner_organizations po
    SET
        appointments_count = sub.cnt,
        first_appointment_date = sub.first_date,
        last_appointment_date = sub.last_date,
        updated_at = NOW()
    FROM (
        SELECT
            partner_org_id,
            COUNT(*) AS cnt,
            MIN(appointment_date) AS first_date,
            MAX(appointment_date) AS last_date
        FROM trapper.sot_appointments
        WHERE partner_org_id IS NOT NULL
        GROUP BY partner_org_id
    ) sub
    WHERE po.org_id = sub.partner_org_id;

    RETURN QUERY SELECT v_processed, v_linked, v_orgs_matched;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_all_appointments_to_partner_orgs IS
'Batch links all unlinked appointments to partner organizations.
Run after adding new partner orgs to retroactively link appointments.';

-- ============================================================================
-- TRIGGER: Auto-link appointments to partner orgs
-- ============================================================================

\echo 'Creating auto-link trigger for partner orgs...'

CREATE OR REPLACE FUNCTION trapper.auto_link_appointment_to_partner_org()
RETURNS TRIGGER AS $$
DECLARE
    v_owner_name TEXT;
    v_org_id UUID;
BEGIN
    -- Only process if partner_org_id is NULL
    IF NEW.partner_org_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Get owner name
    SELECT display_name INTO v_owner_name
    FROM trapper.sot_people
    WHERE person_id = NEW.person_id;

    IF v_owner_name IS NULL THEN
        RETURN NEW;
    END IF;

    -- Find matching partner org
    v_org_id := trapper.find_partner_org_by_name(v_owner_name);

    IF v_org_id IS NOT NULL THEN
        NEW.partner_org_id := v_org_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_link_partner_org ON trapper.sot_appointments;

CREATE TRIGGER trg_auto_link_partner_org
    BEFORE INSERT OR UPDATE OF person_id
    ON trapper.sot_appointments
    FOR EACH ROW
    EXECUTE FUNCTION trapper.auto_link_appointment_to_partner_org();

COMMENT ON TRIGGER trg_auto_link_partner_org ON trapper.sot_appointments IS
'Automatically links appointments to partner organizations based on owner name.
Fires when appointments are created or person_id is updated.';

-- ============================================================================
-- VIEW: v_partner_org_stats
-- Partner organization statistics
-- ============================================================================

\echo 'Creating v_partner_org_stats view...'

CREATE OR REPLACE VIEW trapper.v_partner_org_stats AS
SELECT
    po.org_id,
    po.org_name,
    po.org_name_short,
    po.org_type,
    po.is_active,
    po.place_id,
    pl.formatted_address AS facility_address,
    po.contact_name,
    po.contact_email,
    po.contact_phone,
    po.appointments_count,
    po.cats_processed,
    po.first_appointment_date,
    po.last_appointment_date,
    po.relationship_type,
    po.notes,
    array_length(po.org_name_patterns, 1) AS pattern_count,
    po.created_at
FROM trapper.partner_organizations po
LEFT JOIN trapper.places pl ON pl.place_id = po.place_id
ORDER BY po.appointments_count DESC NULLS LAST, po.org_name;

COMMENT ON VIEW trapper.v_partner_org_stats IS
'Partner organization statistics with facility address and appointment counts.';

-- ============================================================================
-- VIEW: v_appointments_by_partner_org
-- Appointments grouped by partner organization
-- ============================================================================

\echo 'Creating v_appointments_by_partner_org view...'

CREATE OR REPLACE VIEW trapper.v_appointments_by_partner_org AS
SELECT
    COALESCE(po.org_name, '(No Partner Org)') AS partner_org,
    po.org_type,
    COUNT(*) AS appointment_count,
    COUNT(DISTINCT a.cat_id) AS unique_cats,
    MIN(a.appointment_date) AS first_appointment,
    MAX(a.appointment_date) AS last_appointment,
    COUNT(*) FILTER (WHERE a.appointment_date >= CURRENT_DATE - INTERVAL '1 year') AS last_year_count
FROM trapper.sot_appointments a
LEFT JOIN trapper.partner_organizations po ON po.org_id = a.partner_org_id
JOIN trapper.sot_people p ON a.person_id = p.person_id
WHERE p.is_canonical = FALSE  -- Org appointments only
GROUP BY po.org_id, po.org_name, po.org_type
ORDER BY appointment_count DESC;

COMMENT ON VIEW trapper.v_appointments_by_partner_org IS
'Appointment counts grouped by partner organization.
Shows which orgs bring the most cats to FFSC.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_531 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Tables created' AS status, 'partner_organizations' AS name
UNION ALL SELECT 'Columns added', 'sot_appointments.partner_org_id'
UNION ALL SELECT 'Functions created', 'find_partner_org_by_name()'
UNION ALL SELECT 'Functions created', 'link_appointment_to_partner_org()'
UNION ALL SELECT 'Functions created', 'link_all_appointments_to_partner_orgs()'
UNION ALL SELECT 'Triggers created', 'trg_auto_link_partner_org'
UNION ALL SELECT 'Views created', 'v_partner_org_stats'
UNION ALL SELECT 'Views created', 'v_appointments_by_partner_org';

\echo ''
\echo 'Next steps:'
\echo '  1. Run MIG_532 to populate partner organizations'
\echo '  2. Run link_all_appointments_to_partner_orgs() to link existing appointments'
\echo ''
