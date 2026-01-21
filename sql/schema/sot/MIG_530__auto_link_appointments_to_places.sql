\echo ''
\echo '=============================================='
\echo 'MIG_530: Auto-Link Appointments to Places'
\echo '=============================================='
\echo ''
\echo 'Creates a trigger to automatically link appointments to places'
\echo 'when they are created or updated with an org-like owner.'
\echo 'This ensures future imports work correctly without manual intervention.'
\echo ''

-- ============================================================================
-- FUNCTION: auto_link_appointment_to_place
-- Triggered when an appointment's person_id changes
-- Checks if the person is an org and links to the mapped place
-- ============================================================================

\echo 'Creating auto_link_appointment_to_place trigger function...'

CREATE OR REPLACE FUNCTION trapper.auto_link_appointment_to_place()
RETURNS TRIGGER AS $$
DECLARE
    v_owner_name TEXT;
    v_place_id UUID;
BEGIN
    -- Only process if person_id is set and inferred_place_id is NULL
    IF NEW.person_id IS NULL OR NEW.inferred_place_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Get the person's display name
    SELECT display_name INTO v_owner_name
    FROM trapper.sot_people
    WHERE person_id = NEW.person_id;

    IF v_owner_name IS NULL THEN
        RETURN NEW;
    END IF;

    -- Check if this looks like an organization name
    IF NOT trapper.is_organization_name(v_owner_name) THEN
        -- Also check for FFSC suffix pattern which indicates trapping location
        IF v_owner_name !~* 'FFSC|Forgotten Felines' THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Look up the place mapping (don't increment counter, that's done by get_organization_place)
    SELECT m.place_id INTO v_place_id
    FROM trapper.organization_place_mappings m
    WHERE m.auto_link_enabled = TRUE
      AND (
          (m.org_pattern_type = 'exact' AND LOWER(v_owner_name) = LOWER(m.org_pattern)) OR
          (m.org_pattern_type = 'ilike' AND v_owner_name ILIKE m.org_pattern) OR
          (m.org_pattern_type = 'regex' AND v_owner_name ~* m.org_pattern)
      )
    ORDER BY
        CASE WHEN LOWER(v_owner_name) = LOWER(m.org_pattern) THEN 0 ELSE 1 END
    LIMIT 1;

    -- If we found a mapping, set the inferred_place_id
    IF v_place_id IS NOT NULL THEN
        NEW.inferred_place_id := v_place_id;
        NEW.inferred_place_source := 'org_mapping';

        -- Update the mapping stats
        UPDATE trapper.organization_place_mappings
        SET appointments_linked_count = appointments_linked_count + 1,
            last_linked_at = NOW(),
            updated_at = NOW()
        WHERE place_id = v_place_id
          AND auto_link_enabled = TRUE
          AND (
              (org_pattern_type = 'exact' AND LOWER(v_owner_name) = LOWER(org_pattern)) OR
              (org_pattern_type = 'ilike' AND v_owner_name ILIKE org_pattern) OR
              (org_pattern_type = 'regex' AND v_owner_name ~* org_pattern)
          );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.auto_link_appointment_to_place IS
'Trigger function that automatically links appointments to places
when the owner is an organization that has a place mapping.
This ensures future ClinicHQ imports work correctly.';

-- ============================================================================
-- TRIGGER: trg_auto_link_appointment_place
-- Fires on INSERT or UPDATE of person_id on sot_appointments
-- ============================================================================

\echo 'Creating trigger on sot_appointments...'

-- Drop if exists to avoid conflicts
DROP TRIGGER IF EXISTS trg_auto_link_appointment_place ON trapper.sot_appointments;

CREATE TRIGGER trg_auto_link_appointment_place
    BEFORE INSERT OR UPDATE OF person_id
    ON trapper.sot_appointments
    FOR EACH ROW
    EXECUTE FUNCTION trapper.auto_link_appointment_to_place();

COMMENT ON TRIGGER trg_auto_link_appointment_place ON trapper.sot_appointments IS
'Automatically links appointments to places when the owner is an organization.
This ensures future imports work correctly without manual intervention.';

-- ============================================================================
-- FUNCTION: link_all_org_appointments_to_places
-- One-time batch function to link all existing org appointments
-- ============================================================================

\echo 'Creating batch link function...'

CREATE OR REPLACE FUNCTION trapper.link_all_org_appointments_to_places()
RETURNS TABLE (
    appointments_processed INT,
    appointments_linked INT,
    mappings_used INT
) AS $$
DECLARE
    v_processed INT := 0;
    v_linked INT := 0;
    v_mappings_used INT := 0;
BEGIN
    -- Update all appointments that have org owners and no inferred_place_id
    WITH org_appointments AS (
        SELECT
            a.appointment_id,
            p.display_name AS owner_name,
            (
                SELECT m.place_id
                FROM trapper.organization_place_mappings m
                WHERE m.auto_link_enabled = TRUE
                  AND (
                      (m.org_pattern_type = 'ilike' AND p.display_name ILIKE m.org_pattern) OR
                      (m.org_pattern_type = 'exact' AND LOWER(p.display_name) = LOWER(m.org_pattern)) OR
                      (m.org_pattern_type = 'regex' AND p.display_name ~* m.org_pattern)
                  )
                ORDER BY CASE WHEN LOWER(p.display_name) = LOWER(m.org_pattern) THEN 0 ELSE 1 END
                LIMIT 1
            ) AS mapped_place_id
        FROM trapper.sot_appointments a
        JOIN trapper.sot_people p ON a.person_id = p.person_id
        WHERE p.is_canonical = FALSE
          AND a.inferred_place_id IS NULL
          AND (
              trapper.is_organization_name(p.display_name) OR
              p.display_name ~* 'FFSC|Forgotten Felines'
          )
    ),
    updates AS (
        UPDATE trapper.sot_appointments a
        SET
            inferred_place_id = oa.mapped_place_id,
            inferred_place_source = 'org_mapping'
        FROM org_appointments oa
        WHERE a.appointment_id = oa.appointment_id
          AND oa.mapped_place_id IS NOT NULL
        RETURNING a.appointment_id, oa.mapped_place_id
    )
    SELECT COUNT(*), COUNT(DISTINCT mapped_place_id)
    INTO v_linked, v_mappings_used
    FROM updates;

    SELECT COUNT(*) INTO v_processed
    FROM trapper.sot_appointments a
    JOIN trapper.sot_people p ON a.person_id = p.person_id
    WHERE p.is_canonical = FALSE
      AND (
          trapper.is_organization_name(p.display_name) OR
          p.display_name ~* 'FFSC|Forgotten Felines'
      );

    -- Update mapping stats
    UPDATE trapper.organization_place_mappings m
    SET
        appointments_linked_count = (
            SELECT COUNT(*)
            FROM trapper.sot_appointments a
            WHERE a.inferred_place_id = m.place_id
              AND a.inferred_place_source = 'org_mapping'
        ),
        last_linked_at = NOW(),
        updated_at = NOW()
    WHERE m.place_id IN (
        SELECT DISTINCT inferred_place_id
        FROM trapper.sot_appointments
        WHERE inferred_place_source = 'org_mapping'
    );

    RETURN QUERY SELECT v_processed, v_linked, v_mappings_used;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_all_org_appointments_to_places IS
'Batch function to link all existing org appointments to places.
Run this after adding new org_place_mappings to retroactively link.';

-- ============================================================================
-- VIEW: v_org_place_mapping_coverage
-- Shows how well our mappings are covering org appointments
-- ============================================================================

\echo 'Creating coverage view...'

CREATE OR REPLACE VIEW trapper.v_org_place_mapping_coverage AS
WITH org_stats AS (
    SELECT
        TRIM(REGEXP_REPLACE(
            p.display_name,
            '\s*(Ffsc|FFSC|Forgotten Felines.*)$', '', 'i'
        )) AS clean_org_name,
        COUNT(*) AS appointment_count,
        COUNT(*) FILTER (WHERE a.inferred_place_id IS NOT NULL) AS linked_count,
        MAX(a.appointment_date) AS last_appointment
    FROM trapper.sot_appointments a
    JOIN trapper.sot_people p ON a.person_id = p.person_id
    WHERE p.is_canonical = FALSE
      AND (
          trapper.is_organization_name(p.display_name) OR
          p.display_name ~* 'FFSC|Forgotten Felines'
      )
    GROUP BY 1
)
SELECT
    os.clean_org_name,
    os.appointment_count,
    os.linked_count,
    os.appointment_count - os.linked_count AS unlinked_count,
    ROUND(100.0 * os.linked_count / os.appointment_count, 1) AS coverage_pct,
    os.last_appointment,
    m.place_id IS NOT NULL AS has_mapping,
    m.org_display_name AS mapped_to
FROM org_stats os
LEFT JOIN trapper.organization_place_mappings m ON (
    (m.org_pattern_type = 'ilike' AND os.clean_org_name ILIKE m.org_pattern) OR
    (m.org_pattern_type = 'exact' AND LOWER(os.clean_org_name) = LOWER(m.org_pattern))
)
ORDER BY os.appointment_count DESC, os.clean_org_name;

COMMENT ON VIEW trapper.v_org_place_mapping_coverage IS
'Shows how well organization-place mappings cover org appointments.
Use this to identify orgs that need new mappings.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_530 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Trigger created' AS status, 'trg_auto_link_appointment_place' AS name
UNION ALL
SELECT 'Function created', 'auto_link_appointment_to_place()'
UNION ALL
SELECT 'Function created', 'link_all_org_appointments_to_places()'
UNION ALL
SELECT 'View created', 'v_org_place_mapping_coverage';

\echo ''
\echo 'Future Import Stability:'
\echo '  - New appointments with org owners will auto-link to places via trigger'
\echo '  - Add new org-place mappings to organization_place_mappings table'
\echo '  - Run link_all_org_appointments_to_places() to retroactively link'
\echo '  - Use v_org_place_mapping_coverage to identify coverage gaps'
\echo ''
\echo 'Example: Add a new mapping'
\echo '  INSERT INTO trapper.organization_place_mappings'
\echo '    (org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by)'
\echo '  VALUES ('
\echo '    ''%Some New Org%'', ''ilike'', ''<place-uuid>'', ''Some New Org'','
\echo '    ''Added for X reason'', ''admin'''
\echo '  );'
\echo ''
