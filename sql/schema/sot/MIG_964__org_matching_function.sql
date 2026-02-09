-- ============================================================================
-- MIG_964: Organization Matching Function
-- ============================================================================
-- Creates the match_org() function to match appointment owner names to
-- external organizations. This is the unified replacement for:
--   - find_partner_org_by_name() from MIG_531
--   - match_known_organization() from MIG_555
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_964: Organization Matching Function'
\echo '=============================================='
\echo ''

-- ============================================================================
-- FUNCTION: match_org
-- Matches an input name against the orgs table
-- ============================================================================

\echo 'Creating match_org function...'

CREATE OR REPLACE FUNCTION trapper.match_org(p_name TEXT)
RETURNS UUID AS $$
DECLARE
    v_org_id UUID;
    v_normalized TEXT;
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN NULL;
    END IF;

    -- Normalize input
    v_normalized := LOWER(TRIM(REGEXP_REPLACE(p_name, '\s+', ' ', 'g')));

    -- 1. Try exact name match
    SELECT id INTO v_org_id
    FROM trapper.orgs
    WHERE is_active = TRUE
      AND LOWER(name) = v_normalized
    LIMIT 1;

    IF v_org_id IS NOT NULL THEN
        RETURN v_org_id;
    END IF;

    -- 2. Try short name match
    SELECT id INTO v_org_id
    FROM trapper.orgs
    WHERE is_active = TRUE
      AND short_name IS NOT NULL
      AND LOWER(short_name) = v_normalized
    LIMIT 1;

    IF v_org_id IS NOT NULL THEN
        RETURN v_org_id;
    END IF;

    -- 3. Try alias match
    SELECT id INTO v_org_id
    FROM trapper.orgs
    WHERE is_active = TRUE
      AND aliases IS NOT NULL
      AND v_normalized = ANY(SELECT LOWER(a) FROM UNNEST(aliases) a)
    LIMIT 1;

    IF v_org_id IS NOT NULL THEN
        RETURN v_org_id;
    END IF;

    -- 4. Try pattern match against name_patterns array
    SELECT id INTO v_org_id
    FROM trapper.orgs o
    WHERE o.is_active = TRUE
      AND o.name_patterns IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM unnest(o.name_patterns) AS pattern
          WHERE v_normalized ILIKE pattern
      )
    -- Prefer more specific patterns (longer ones)
    ORDER BY (
        SELECT MAX(LENGTH(pattern))
        FROM unnest(o.name_patterns) AS pattern
        WHERE v_normalized ILIKE pattern
    ) DESC NULLS LAST
    LIMIT 1;

    IF v_org_id IS NOT NULL THEN
        RETURN v_org_id;
    END IF;

    -- 5. Try fuzzy contains match (input contains org name or short name)
    SELECT id INTO v_org_id
    FROM trapper.orgs
    WHERE is_active = TRUE
      AND (
          v_normalized ILIKE '%' || LOWER(name) || '%'
          OR (short_name IS NOT NULL AND v_normalized ILIKE '%' || LOWER(short_name) || '%')
      )
    -- Prefer longer name matches
    ORDER BY LENGTH(name) DESC
    LIMIT 1;

    RETURN v_org_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.match_org IS
'Matches an input name against the unified orgs table.
Returns org_id if found, NULL otherwise.

Match priority:
  1. Exact name match
  2. Short name match
  3. Alias match
  4. Pattern match (name_patterns array)
  5. Fuzzy contains match

Used by:
  - Appointment auto-linking trigger
  - Entity linking pipeline
  - ClinicHQ import processing';

-- ============================================================================
-- FUNCTION: match_org_detailed
-- Returns detailed match info (for debugging and UI)
-- ============================================================================

\echo 'Creating match_org_detailed function...'

CREATE OR REPLACE FUNCTION trapper.match_org_detailed(p_name TEXT)
RETURNS TABLE (
    org_id UUID,
    org_name TEXT,
    short_name TEXT,
    org_type TEXT,
    match_type TEXT,
    confidence NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_normalized TEXT;
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN;
    END IF;

    v_normalized := LOWER(TRIM(REGEXP_REPLACE(p_name, '\s+', ' ', 'g')));

    -- Try exact name
    RETURN QUERY
    SELECT o.id, o.name, o.short_name, o.org_type, 'exact'::TEXT, 1.0::NUMERIC
    FROM trapper.orgs o
    WHERE o.is_active = TRUE AND LOWER(o.name) = v_normalized
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- Try short name
    RETURN QUERY
    SELECT o.id, o.name, o.short_name, o.org_type, 'short_name'::TEXT, 0.95::NUMERIC
    FROM trapper.orgs o
    WHERE o.is_active = TRUE AND o.short_name IS NOT NULL AND LOWER(o.short_name) = v_normalized
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- Try alias
    RETURN QUERY
    SELECT o.id, o.name, o.short_name, o.org_type, 'alias'::TEXT, 0.90::NUMERIC
    FROM trapper.orgs o
    WHERE o.is_active = TRUE
      AND o.aliases IS NOT NULL
      AND v_normalized = ANY(SELECT LOWER(a) FROM UNNEST(o.aliases) a)
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- Try pattern
    RETURN QUERY
    SELECT o.id, o.name, o.short_name, o.org_type, 'pattern'::TEXT, 0.85::NUMERIC
    FROM trapper.orgs o
    WHERE o.is_active = TRUE
      AND o.name_patterns IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest(o.name_patterns) AS p WHERE v_normalized ILIKE p)
    ORDER BY (SELECT MAX(LENGTH(p)) FROM unnest(o.name_patterns) AS p WHERE v_normalized ILIKE p) DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- Try fuzzy contains
    RETURN QUERY
    SELECT o.id, o.name, o.short_name, o.org_type, 'fuzzy'::TEXT, 0.70::NUMERIC
    FROM trapper.orgs o
    WHERE o.is_active = TRUE
      AND (v_normalized ILIKE '%' || LOWER(o.name) || '%'
           OR (o.short_name IS NOT NULL AND v_normalized ILIKE '%' || LOWER(o.short_name) || '%'))
    ORDER BY LENGTH(o.name) DESC
    LIMIT 1;

    RETURN;
END;
$$;

COMMENT ON FUNCTION trapper.match_org_detailed IS
'Like match_org() but returns detailed match information including
match type and confidence score. Useful for debugging and admin UI.';

-- ============================================================================
-- FUNCTION: link_appointment_to_org
-- Links a single appointment to its organization
-- ============================================================================

\echo 'Creating link_appointment_to_org function...'

CREATE OR REPLACE FUNCTION trapper.link_appointment_to_org(
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

    -- Find matching org
    v_org_id := trapper.match_org(v_owner_name);

    -- Update appointment if found
    IF v_org_id IS NOT NULL THEN
        UPDATE trapper.sot_appointments
        SET org_id = v_org_id
        WHERE appointment_id = p_appointment_id
          AND (org_id IS NULL OR org_id != v_org_id);
    END IF;

    RETURN v_org_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointment_to_org IS
'Links an appointment to its organization based on owner name.
Uses match_org() to find the matching organization.';

-- ============================================================================
-- FUNCTION: link_all_appointments_to_orgs
-- Batch links unlinked appointments to organizations
-- ============================================================================

\echo 'Creating link_all_appointments_to_orgs function...'

CREATE OR REPLACE FUNCTION trapper.link_all_appointments_to_orgs(p_limit INT DEFAULT 1000)
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
    WITH org_matches AS (
        SELECT
            a.appointment_id,
            p.display_name AS owner_name,
            trapper.match_org(p.display_name) AS matched_org_id
        FROM trapper.sot_appointments a
        JOIN trapper.sot_people p ON a.person_id = p.person_id
        WHERE a.org_id IS NULL
          AND (a.partner_org_id IS NULL)  -- Skip if already linked via old system
          AND p.is_canonical = FALSE       -- Only org accounts, not individuals
        LIMIT p_limit
    ),
    updates AS (
        UPDATE trapper.sot_appointments a
        SET org_id = om.matched_org_id
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

    RETURN QUERY SELECT v_processed, v_linked, v_orgs_matched;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_all_appointments_to_orgs IS
'Batch links unlinked appointments to organizations.
Run after adding new orgs or patterns to retroactively link appointments.';

-- ============================================================================
-- TRIGGER: Auto-link new appointments to orgs
-- ============================================================================

\echo 'Creating auto-link trigger for orgs...'

CREATE OR REPLACE FUNCTION trapper.auto_link_appointment_to_org()
RETURNS TRIGGER AS $$
DECLARE
    v_owner_name TEXT;
    v_org_id UUID;
BEGIN
    -- Only process if org_id is NULL
    IF NEW.org_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Get owner name
    SELECT display_name INTO v_owner_name
    FROM trapper.sot_people
    WHERE person_id = NEW.person_id;

    IF v_owner_name IS NULL THEN
        RETURN NEW;
    END IF;

    -- Find matching org
    v_org_id := trapper.match_org(v_owner_name);

    IF v_org_id IS NOT NULL THEN
        NEW.org_id := v_org_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_link_org ON trapper.sot_appointments;

CREATE TRIGGER trg_auto_link_org
    BEFORE INSERT OR UPDATE OF person_id
    ON trapper.sot_appointments
    FOR EACH ROW
    EXECUTE FUNCTION trapper.auto_link_appointment_to_org();

COMMENT ON TRIGGER trg_auto_link_org ON trapper.sot_appointments IS
'Automatically links new appointments to organizations based on owner name.
Uses the unified match_org() function to find matching orgs.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'Verification - Test matching'
\echo '=============================================='
\echo ''

\echo 'Testing match_org_detailed with common org names:'

SELECT * FROM trapper.match_org_detailed('SCAS');
SELECT * FROM trapper.match_org_detailed('Sonoma County Animal Services');
SELECT * FROM trapper.match_org_detailed('Humane Society');
SELECT * FROM trapper.match_org_detailed('JW Petaluma');

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_964 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Created' AS status, 'match_org() - unified org matching' AS detail
UNION ALL SELECT 'Created', 'match_org_detailed() - with match type/confidence'
UNION ALL SELECT 'Created', 'link_appointment_to_org() - single appointment linking'
UNION ALL SELECT 'Created', 'link_all_appointments_to_orgs() - batch linking'
UNION ALL SELECT 'Created', 'trg_auto_link_org trigger for new appointments';

\echo ''
\echo 'The match_org() function is now the primary way to match org names.'
\echo 'Legacy functions (find_partner_org_by_name, match_known_organization)'
\echo 'remain for backward compatibility but should be migrated to match_org().'
\echo ''
\echo 'Next: Run MIG_965 to create stats triggers'
\echo ''
