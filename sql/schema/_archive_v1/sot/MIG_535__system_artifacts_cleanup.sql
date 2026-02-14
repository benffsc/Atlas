\echo ''
\echo '=============================================='
\echo 'MIG_535: System Artifacts Cleanup'
\echo '=============================================='
\echo ''
\echo 'Marks "Duplicate Report" and other system artifacts as data quality issues.'
\echo 'Creates monitoring views for ongoing data quality tracking.'
\echo ''

-- ============================================================================
-- STEP 1: Mark Duplicate Report appointments
-- ============================================================================

\echo 'Step 1: Marking Duplicate Report appointments...'

UPDATE trapper.sot_appointments a
SET appointment_category = 'data_quality_issue'
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND p.display_name ~* 'Duplicate Report'
  AND a.appointment_category IS NULL;

-- Also mark the people records
UPDATE trapper.sot_people
SET data_quality = 'duplicate_marker'
WHERE display_name ~* 'Duplicate Report'
  AND merged_into_person_id IS NULL;

-- ============================================================================
-- STEP 2: Mark other known data quality issues
-- ============================================================================

\echo 'Step 2: Marking other data quality issues...'

-- Test entries
UPDATE trapper.sot_appointments a
SET appointment_category = 'data_quality_issue'
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND (
      p.display_name ~* '^Test\s' OR
      p.display_name ~* '\sTest$' OR
      p.display_name = 'Test' OR
      p.display_name ~* 'Forgotten Felines Office Cat'
  )
  AND a.appointment_category IS NULL;

-- ============================================================================
-- VIEW: v_data_quality_issues
-- Shows data quality issues by category
-- ============================================================================

\echo 'Creating v_data_quality_issues view...'

CREATE OR REPLACE VIEW trapper.v_data_quality_issues AS
SELECT
    CASE
        WHEN p.display_name ~* 'Duplicate Report' THEN 'Duplicate marker'
        WHEN p.display_name ~* '^Test|Test$' THEN 'Test entry'
        WHEN p.display_name ~* 'Office Cat' THEN 'Internal test'
        WHEN p.display_name ~* '^\d+\s+\w+' AND NOT p.display_name ~* 'FFSC|Scas' THEN 'Address as name'
        WHEN trapper.is_organization_name(p.display_name) AND a.partner_org_id IS NULL AND a.inferred_place_id IS NULL THEN 'Unmapped organization'
        ELSE 'Other'
    END AS issue_type,
    p.display_name AS owner_name,
    COUNT(*) AS appointment_count,
    MAX(a.appointment_date) AS last_appointment
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON a.person_id = p.person_id
WHERE a.appointment_category = 'data_quality_issue'
   OR (p.is_canonical = FALSE AND a.appointment_category IS NULL)
GROUP BY 1, 2
ORDER BY appointment_count DESC;

COMMENT ON VIEW trapper.v_data_quality_issues IS
'Shows appointments with data quality issues for manual review.';

-- ============================================================================
-- VIEW: v_org_appointment_coverage
-- Shows overall coverage of org appointments
-- ============================================================================

\echo 'Creating v_org_appointment_coverage view...'

CREATE OR REPLACE VIEW trapper.v_org_appointment_coverage AS
WITH org_appts AS (
    SELECT
        a.appointment_id,
        a.partner_org_id,
        a.inferred_place_id,
        a.appointment_category,
        p.display_name AS owner_name,
        p.is_canonical
    FROM trapper.sot_appointments a
    JOIN trapper.sot_people p ON a.person_id = p.person_id
    WHERE p.is_canonical = FALSE
)
SELECT
    'Total org appointments' AS metric,
    COUNT(*)::text AS value,
    '100%' AS percentage
FROM org_appts
UNION ALL
SELECT
    'With partner_org_id',
    COUNT(*)::text,
    ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM org_appts), 0), 1) || '%'
FROM org_appts WHERE partner_org_id IS NOT NULL
UNION ALL
SELECT
    'With inferred_place_id',
    COUNT(*)::text,
    ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM org_appts), 0), 1) || '%'
FROM org_appts WHERE inferred_place_id IS NOT NULL
UNION ALL
SELECT
    'With category assigned',
    COUNT(*)::text,
    ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM org_appts), 0), 1) || '%'
FROM org_appts WHERE appointment_category IS NOT NULL
UNION ALL
SELECT
    'Fully linked (org OR place)',
    COUNT(*)::text,
    ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM org_appts), 0), 1) || '%'
FROM org_appts WHERE partner_org_id IS NOT NULL OR inferred_place_id IS NOT NULL
UNION ALL
SELECT
    'Uncategorized remaining',
    COUNT(*)::text,
    ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM org_appts), 0), 1) || '%'
FROM org_appts WHERE appointment_category IS NULL;

COMMENT ON VIEW trapper.v_org_appointment_coverage IS
'Shows overall coverage metrics for organization appointments.';

-- ============================================================================
-- VIEW: v_uncategorized_org_appointments
-- Appointments that still need attention
-- ============================================================================

\echo 'Creating v_uncategorized_org_appointments view...'

CREATE OR REPLACE VIEW trapper.v_uncategorized_org_appointments AS
SELECT
    p.display_name AS owner_name,
    COUNT(*) AS appointment_count,
    array_agg(DISTINCT a.service_type) AS service_types,
    MIN(a.appointment_date) AS first_appointment,
    MAX(a.appointment_date) AS last_appointment,
    CASE
        WHEN p.display_name ~* 'Rescue|Shelter|Humane|Animal Services' THEN 'Likely partner org'
        WHEN p.display_name ~* '^\d+\s+\w+' THEN 'Likely address'
        WHEN p.display_name ~* 'FFSC|Forgotten Felines' THEN 'FFSC related'
        ELSE 'Unknown'
    END AS suggested_category
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON a.person_id = p.person_id
WHERE p.is_canonical = FALSE
  AND a.appointment_category IS NULL
  AND a.partner_org_id IS NULL
  AND a.inferred_place_id IS NULL
GROUP BY p.display_name
ORDER BY appointment_count DESC;

COMMENT ON VIEW trapper.v_uncategorized_org_appointments IS
'Org appointments that still need categorization. Use this for ongoing maintenance.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_535 Complete!'
\echo '=============================================='
\echo ''

SELECT * FROM trapper.v_org_appointment_coverage;

\echo ''
\echo 'Remaining uncategorized appointments:'
SELECT * FROM trapper.v_uncategorized_org_appointments LIMIT 20;

\echo ''
