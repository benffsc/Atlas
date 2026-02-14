\echo ''
\echo '=============================================='
\echo 'MIG_526: Organization to Person Mapping'
\echo '=============================================='
\echo ''
\echo 'Creates a system to map organizational "owners" to real people.'
\echo 'When ClinicHQ sends "Jehovahs Witnesses" as owner, we can auto-link'
\echo 'those cats to the designated representative (e.g., Jennifer Pratt).'
\echo ''

-- ============================================================================
-- TABLE: organization_person_mappings
-- Maps organization names to their designated representatives
-- ============================================================================

\echo 'Creating organization_person_mappings table...'

CREATE TABLE IF NOT EXISTS trapper.organization_person_mappings (
    mapping_id SERIAL PRIMARY KEY,

    -- The organization pattern (how it appears in ClinicHQ)
    org_pattern TEXT NOT NULL,
    org_pattern_type TEXT NOT NULL DEFAULT 'ilike',  -- 'ilike', 'exact', 'regex'

    -- The real person to link to
    representative_person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- Metadata
    org_display_name TEXT,        -- Friendly name for the org
    notes TEXT,                   -- Why this mapping exists

    -- Tracking
    auto_link_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    cats_linked_count INT DEFAULT 0,
    last_linked_at TIMESTAMPTZ,

    -- Audit
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_pattern, org_pattern_type)
);

COMMENT ON TABLE trapper.organization_person_mappings IS
'Maps organization names (as they appear in ClinicHQ) to real people in Atlas.
When an appointment comes in with owner = "Jehovahs Witnesses", we can auto-link
those cats to the designated representative (e.g., Jennifer Pratt).
The cat data is preserved in the appointment (original owner field), but the
person_id link goes to the real person.';

COMMENT ON COLUMN trapper.organization_person_mappings.org_pattern IS
'The pattern to match against incoming owner names from ClinicHQ';

COMMENT ON COLUMN trapper.organization_person_mappings.org_pattern_type IS
'How to match: ilike = case-insensitive LIKE, exact = exact match, regex = regular expression';

COMMENT ON COLUMN trapper.organization_person_mappings.representative_person_id IS
'The real person who represents this organization (e.g., Jennifer Pratt for JW cats)';

-- ============================================================================
-- FUNCTION: get_organization_representative
-- Returns the designated person for an organization name
-- ============================================================================

\echo 'Creating get_organization_representative function...'

CREATE OR REPLACE FUNCTION trapper.get_organization_representative(p_owner_name TEXT)
RETURNS UUID AS $$
DECLARE
    v_person_id UUID;
BEGIN
    IF p_owner_name IS NULL OR TRIM(p_owner_name) = '' THEN
        RETURN NULL;
    END IF;

    -- Check for matching mapping
    SELECT representative_person_id INTO v_person_id
    FROM trapper.organization_person_mappings m
    WHERE m.auto_link_enabled = TRUE
      AND (
          (m.org_pattern_type = 'exact' AND LOWER(p_owner_name) = LOWER(m.org_pattern)) OR
          (m.org_pattern_type = 'ilike' AND p_owner_name ILIKE m.org_pattern) OR
          (m.org_pattern_type = 'regex' AND p_owner_name ~* m.org_pattern)
      )
    ORDER BY
        -- Prefer exact matches over pattern matches
        CASE WHEN LOWER(p_owner_name) = LOWER(m.org_pattern) THEN 0 ELSE 1 END,
        m.created_at
    LIMIT 1;

    -- Update stats if found
    IF v_person_id IS NOT NULL THEN
        UPDATE trapper.organization_person_mappings
        SET cats_linked_count = cats_linked_count + 1,
            last_linked_at = NOW(),
            updated_at = NOW()
        WHERE representative_person_id = v_person_id
          AND auto_link_enabled = TRUE
          AND (
              (org_pattern_type = 'exact' AND LOWER(p_owner_name) = LOWER(org_pattern)) OR
              (org_pattern_type = 'ilike' AND p_owner_name ILIKE org_pattern) OR
              (org_pattern_type = 'regex' AND p_owner_name ~* org_pattern)
          );
    END IF;

    RETURN v_person_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.get_organization_representative IS
'Returns the designated person_id for an organization name.
Used to auto-link cats from organizational "owners" to real people.
Example: "Jehovahs Witnesses" → Jennifer Pratt''s person_id';

-- ============================================================================
-- UPDATE find_or_create_person TO CHECK ORG MAPPINGS
-- ============================================================================

\echo 'Note: To use org mappings, update find_or_create_person or create a wrapper.'
\echo 'For now, manual linking can be done via the mapping table.'

-- ============================================================================
-- VIEW: v_organization_mappings
-- Shows all mappings with person details
-- ============================================================================

\echo 'Creating v_organization_mappings view...'

CREATE OR REPLACE VIEW trapper.v_organization_mappings AS
SELECT
    m.mapping_id,
    m.org_pattern,
    m.org_pattern_type,
    m.org_display_name,
    m.representative_person_id,
    p.display_name AS representative_name,
    m.auto_link_enabled,
    m.cats_linked_count,
    m.last_linked_at,
    m.notes,
    m.created_at
FROM trapper.organization_person_mappings m
JOIN trapper.sot_people p ON p.person_id = m.representative_person_id
ORDER BY m.org_display_name, m.org_pattern;

COMMENT ON VIEW trapper.v_organization_mappings IS
'Shows all organization-to-person mappings with representative details';

-- ============================================================================
-- EXAMPLE DATA (commented out - add via admin UI or manually)
-- ============================================================================

-- Example: Link "Jehovahs Witnesses" cats to Jennifer Pratt
-- First, find Jennifer Pratt's person_id:
-- SELECT person_id FROM trapper.sot_people WHERE display_name ILIKE '%Jennifer Pratt%';
--
-- Then create the mapping:
-- INSERT INTO trapper.organization_person_mappings (
--     org_pattern, org_pattern_type, representative_person_id,
--     org_display_name, notes, created_by
-- ) VALUES (
--     '%Jehovah%', 'ilike', '<jennifer-pratt-person-id>',
--     'Jehovah''s Witnesses', 'Jennifer Pratt is the designated trapper', 'admin'
-- );

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_526 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - organization_person_mappings table'
\echo '  - get_organization_representative() function'
\echo '  - v_organization_mappings view'
\echo ''
\echo 'Usage:'
\echo '  1. Find the real person: SELECT person_id FROM sot_people WHERE display_name ILIKE ''%Jennifer Pratt%'';'
\echo '  2. Create mapping: INSERT INTO organization_person_mappings (...)'
\echo '  3. Future cats with that org name will auto-link via get_organization_representative()'
\echo ''
\echo 'Note: The original ClinicHQ owner name is preserved in the appointment,'
\echo '      but the person_id link goes to the designated representative.'
\echo ''
