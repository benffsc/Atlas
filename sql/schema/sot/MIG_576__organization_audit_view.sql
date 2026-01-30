\echo '=== MIG_576: Organization Name Audit Views ==='
\echo ''
\echo 'Creates views to audit appointments for organization names that might slip through.'
\echo 'Useful for finding gaps in organization detection patterns.'
\echo ''

-- ============================================================================
-- VIEW: Recent appointments with potential organization names
-- ============================================================================

\echo 'Creating v_appointments_potential_orgs view...'

CREATE OR REPLACE VIEW trapper.v_appointments_potential_orgs AS
SELECT
    a.appointment_id,
    a.appointment_date,
    a.owner_first_name,
    a.owner_last_name,
    CONCAT(a.owner_first_name, ' ', a.owner_last_name) as full_name,
    a.owner_email,
    a.owner_phone,
    a.person_id,
    p.display_name as matched_person_name,

    -- Flag potential issues
    CASE
        WHEN trapper.is_organization_name(CONCAT(a.owner_first_name, ' ', a.owner_last_name)) THEN 'DETECTED_ORG'
        WHEN a.owner_first_name IS NULL OR TRIM(a.owner_first_name) = '' THEN 'NO_FIRST_NAME'
        WHEN a.owner_last_name IS NULL OR TRIM(a.owner_last_name) = '' THEN 'NO_LAST_NAME'
        -- Potential org patterns NOT in our detection
        WHEN CONCAT(a.owner_first_name, ' ', a.owner_last_name) ~* '(guard|station|dept|division|unit|base|corps|battalion|squadron|brigade)' THEN 'POTENTIAL_MILITARY'
        WHEN CONCAT(a.owner_first_name, ' ', a.owner_last_name) ~* '(llc|inc|corp|company|co\.|ltd|enterprise|service|management)' THEN 'POTENTIAL_BUSINESS'
        WHEN CONCAT(a.owner_first_name, ' ', a.owner_last_name) ~* '(church|temple|ministry|catholic|baptist|lutheran|methodist|presbyterian)' THEN 'POTENTIAL_RELIGIOUS'
        WHEN CONCAT(a.owner_first_name, ' ', a.owner_last_name) ~* '(park|apartments|complex|estate|manor|villa|place|court|terrace|heights)' THEN 'POTENTIAL_PROPERTY'
        WHEN CONCAT(a.owner_first_name, ' ', a.owner_last_name) ~* '(rescue|shelter|humane|spca|animal|veterinary|clinic|hospital)' THEN 'POTENTIAL_ANIMAL_ORG'
        WHEN CONCAT(a.owner_first_name, ' ', a.owner_last_name) ~* '(foundation|charity|trust|association|society|organization|council|committee)' THEN 'POTENTIAL_NONPROFIT'
        WHEN LENGTH(a.owner_first_name) > 25 THEN 'LONG_FIRST_NAME'
        WHEN LENGTH(a.owner_last_name) > 25 THEN 'LONG_LAST_NAME'
        ELSE NULL
    END as potential_issue,

    -- Metadata
    a.source_system,
    a.created_at as appointment_created_at

FROM trapper.sot_appointments a
LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id
WHERE a.owner_first_name IS NOT NULL OR a.owner_last_name IS NOT NULL;

COMMENT ON VIEW trapper.v_appointments_potential_orgs IS
'Audits appointments for potential organization names that might slip through detection.
Use to identify gaps in organization pattern coverage.

Query examples:
-- Find potential orgs in past month:
SELECT * FROM trapper.v_appointments_potential_orgs
WHERE appointment_date >= NOW() - INTERVAL ''1 month''
  AND potential_issue IS NOT NULL
ORDER BY appointment_date DESC;

-- Count by issue type:
SELECT potential_issue, COUNT(*) FROM trapper.v_appointments_potential_orgs
WHERE appointment_date >= NOW() - INTERVAL ''1 month''
GROUP BY potential_issue ORDER BY COUNT(*) DESC;';

-- ============================================================================
-- VIEW: Upcoming appointments needing org review
-- ============================================================================

\echo 'Creating v_upcoming_appts_org_review view...'

CREATE OR REPLACE VIEW trapper.v_upcoming_appts_org_review AS
SELECT
    u.id,
    u.appt_date,
    u.client_first_name,
    u.client_last_name,
    CONCAT(u.client_first_name, ' ', u.client_last_name) as full_name,
    u.client_email,
    u.client_cell_phone,
    u.client_phone,
    u.animal_name,
    u.client_address,

    -- Detection status
    trapper.is_organization_name(CONCAT(u.client_first_name, ' ', u.client_last_name)) as is_detected_org,
    trapper.get_organization_representative(CONCAT(u.client_first_name, ' ', u.client_last_name)) as representative_person_id,

    -- Potential patterns not detected
    CASE
        WHEN CONCAT(u.client_first_name, ' ', u.client_last_name) ~* '(guard|station|dept|base|corps|battalion)' THEN 'POTENTIAL_MILITARY'
        WHEN CONCAT(u.client_first_name, ' ', u.client_last_name) ~* '(llc|inc|corp|company|enterprise|management)' THEN 'POTENTIAL_BUSINESS'
        WHEN CONCAT(u.client_first_name, ' ', u.client_last_name) ~* '(church|temple|ministry)' THEN 'POTENTIAL_RELIGIOUS'
        WHEN CONCAT(u.client_first_name, ' ', u.client_last_name) ~* '(park|apartments|complex|estate|manor)' THEN 'POTENTIAL_PROPERTY'
        WHEN CONCAT(u.client_first_name, ' ', u.client_last_name) ~* '(rescue|shelter|humane|spca)' THEN 'POTENTIAL_ANIMAL_ORG'
        ELSE NULL
    END as undetected_pattern,

    u.is_current,
    u.first_seen_at

FROM trapper.clinichq_upcoming_appointments u
WHERE u.is_current = TRUE
  AND u.appt_date >= CURRENT_DATE;

COMMENT ON VIEW trapper.v_upcoming_appts_org_review IS
'Reviews upcoming appointments for organization names.
Helps catch organization appointments BEFORE they are processed.

Query examples:
-- Find upcoming orgs not yet detected:
SELECT * FROM trapper.v_upcoming_appts_org_review
WHERE undetected_pattern IS NOT NULL
  AND NOT is_detected_org
ORDER BY appt_date;

-- Find orgs that need representative mapping:
SELECT * FROM trapper.v_upcoming_appts_org_review
WHERE is_detected_org = TRUE
  AND representative_person_id IS NULL
ORDER BY appt_date;';

-- ============================================================================
-- VIEW: Data Engine decisions for organizations
-- ============================================================================

\echo 'Creating v_data_engine_org_decisions view...'

CREATE OR REPLACE VIEW trapper.v_data_engine_org_decisions AS
SELECT
    d.decision_id,
    d.created_at,
    d.incoming_name,
    d.incoming_email,
    d.incoming_phone,
    d.decision_type,
    d.decision_reason,
    d.resulting_person_id,
    p.display_name as resulting_person_name,
    p.is_organization as person_is_org_flagged,
    d.source_system

FROM trapper.data_engine_match_decisions d
LEFT JOIN trapper.sot_people p ON p.person_id = d.resulting_person_id
WHERE d.decision_type IN ('org_representative', 'rejected')
   OR d.decision_reason ILIKE '%organization%'
   OR trapper.is_organization_name(d.incoming_name);

COMMENT ON VIEW trapper.v_data_engine_org_decisions IS
'Shows Data Engine decisions related to organizations.
Useful for tracking how org names are being routed.

Query examples:
-- Recent org decisions:
SELECT * FROM trapper.v_data_engine_org_decisions
WHERE created_at >= NOW() - INTERVAL ''1 week''
ORDER BY created_at DESC;

-- Rejected orgs (no representative):
SELECT * FROM trapper.v_data_engine_org_decisions
WHERE decision_type = ''rejected''
  AND decision_reason ILIKE ''%organization%'';

-- Orgs successfully routed to representative:
SELECT * FROM trapper.v_data_engine_org_decisions
WHERE decision_type = ''org_representative'';';

-- ============================================================================
-- PART 4: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_576 Complete ==='
\echo 'Created audit views:'
\echo '  - v_appointments_potential_orgs: Audit historical appointments'
\echo '  - v_upcoming_appts_org_review: Review upcoming appointments'
\echo '  - v_data_engine_org_decisions: Track Data Engine org routing'
\echo ''
\echo 'To audit past month of appointments:'
\echo '  SELECT potential_issue, COUNT(*) FROM trapper.v_appointments_potential_orgs'
\echo '  WHERE appointment_date >= NOW() - INTERVAL ''1 month'''
\echo '  AND potential_issue IS NOT NULL'
\echo '  GROUP BY potential_issue ORDER BY COUNT(*) DESC;'
\echo ''
\echo 'To find upcoming Coast Guard appointments:'
\echo '  SELECT * FROM trapper.v_upcoming_appts_org_review'
\echo '  WHERE full_name ILIKE ''%coast guard%'';'
\echo ''
