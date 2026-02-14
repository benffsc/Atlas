\echo ''
\echo '=============================================='
\echo 'MIG_570: Data Flow Status View & Verification'
\echo '=============================================='
\echo ''
\echo 'Creates unified view of all data flow statuses and'
\echo 'verification queries to identify records that may have'
\echo 'bypassed the Data Engine.'
\echo ''

-- ============================================================================
-- PART 1: Data Flow Status View
-- ============================================================================

\echo 'Creating v_data_flow_status view...'

CREATE OR REPLACE VIEW trapper.v_data_flow_status AS
-- Staged records status by source
SELECT
    source_system,
    source_table,
    COUNT(*) FILTER (WHERE processed_at IS NULL) AS pending,
    COUNT(*) FILTER (WHERE processed_at IS NOT NULL) AS processed,
    COUNT(*) AS total,
    MAX(created_at) AS latest_staged,
    MAX(processed_at) AS latest_processed
FROM trapper.staged_records
GROUP BY source_system, source_table

UNION ALL

-- Web intake submissions
SELECT
    'web_intake' AS source_system,
    'submissions' AS source_table,
    COUNT(*) FILTER (WHERE status = 'new') AS pending,
    COUNT(*) FILTER (WHERE status NOT IN ('new', 'spam', 'duplicate')) AS processed,
    COUNT(*) AS total,
    MAX(created_at),
    MAX(updated_at)
FROM trapper.web_intake_submissions

UNION ALL

-- Trapper reports
SELECT
    'trapper_reports' AS source_system,
    'submissions' AS source_table,
    COUNT(*) FILTER (WHERE extraction_status IN ('pending', 'extracting')) AS pending,
    COUNT(*) FILTER (WHERE extraction_status IN ('committed', 'reviewed')) AS processed,
    COUNT(*) AS total,
    MAX(created_at),
    MAX(reviewed_at)
FROM trapper.trapper_report_submissions

UNION ALL

-- Raw intake requests
SELECT
    'raw_intake' AS source_system,
    'requests' AS source_table,
    COUNT(*) FILTER (WHERE intake_status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE intake_status = 'promoted') AS processed,
    COUNT(*) AS total,
    MAX(created_at),
    MAX(promoted_at)
FROM trapper.raw_intake_request;

COMMENT ON VIEW trapper.v_data_flow_status IS
'Unified view of all data flow statuses across staging tables, intake, and processing jobs.
Shows pending vs processed counts for each source system.';

-- ============================================================================
-- PART 2: Data Engine Verification Views
-- ============================================================================

\echo ''
\echo 'Creating Data Engine verification views...'

-- People without Data Engine decisions (may have been created before MIG_314)
CREATE OR REPLACE VIEW trapper.v_people_without_data_engine AS
SELECT
    p.person_id,
    p.display_name,
    p.primary_email,
    p.primary_phone,
    p.data_source::text AS data_source,
    p.created_at,
    CASE
        WHEN p.created_at < '2024-06-01' THEN 'created_before_data_engine'
        WHEN p.data_source::text IN ('clinichq', 'airtable_sync', 'legacy_import') THEN 'bulk_import'
        ELSE 'needs_investigation'
    END AS reason
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
AND NOT EXISTS (
    SELECT 1 FROM trapper.data_engine_match_decisions d
    WHERE d.resulting_person_id = p.person_id
)
ORDER BY p.created_at DESC;

COMMENT ON VIEW trapper.v_people_without_data_engine IS
'People records that have no Data Engine decision trail.
These may have been created before the Data Engine was implemented
or through bulk imports that bypassed the standard process.';

-- Potential duplicate people (same email, different person_id)
CREATE OR REPLACE VIEW trapper.v_potential_duplicate_people AS
SELECT
    pi1.id_value_norm AS identifier,
    pi1.id_type,
    p1.person_id AS person_1_id,
    p1.display_name AS person_1_name,
    p1.data_source::text AS person_1_source,
    p1.created_at AS person_1_created,
    p2.person_id AS person_2_id,
    p2.display_name AS person_2_name,
    p2.data_source::text AS person_2_source,
    p2.created_at AS person_2_created
FROM trapper.person_identifiers pi1
JOIN trapper.person_identifiers pi2
    ON pi1.id_type = pi2.id_type
    AND pi1.id_value_norm = pi2.id_value_norm
    AND pi1.person_id < pi2.person_id  -- Avoid duplicates
JOIN trapper.sot_people p1 ON p1.person_id = pi1.person_id
JOIN trapper.sot_people p2 ON p2.person_id = pi2.person_id
WHERE p1.merged_into_person_id IS NULL
AND p2.merged_into_person_id IS NULL
ORDER BY pi1.id_value_norm, p1.created_at;

COMMENT ON VIEW trapper.v_potential_duplicate_people IS
'People who share the same email or phone but have different person_ids.
These are potential duplicates that the Data Engine should have caught.
May indicate records created before Data Engine implementation.';

-- Potential duplicate places (same normalized address)
CREATE OR REPLACE VIEW trapper.v_potential_duplicate_places AS
SELECT
    p1.normalized_address,
    p1.place_id AS place_1_id,
    p1.formatted_address AS place_1_address,
    p1.created_at AS place_1_created,
    p2.place_id AS place_2_id,
    p2.formatted_address AS place_2_address,
    p2.created_at AS place_2_created
FROM trapper.places p1
JOIN trapper.places p2
    ON p1.normalized_address = p2.normalized_address
    AND p1.place_id < p2.place_id  -- Avoid duplicates
WHERE p1.merged_into_place_id IS NULL
AND p2.merged_into_place_id IS NULL
AND p1.normalized_address IS NOT NULL
ORDER BY p1.normalized_address, p1.created_at;

COMMENT ON VIEW trapper.v_potential_duplicate_places IS
'Places with the same normalized address but different place_ids.
These are potential duplicates that should be investigated for merging.';

-- Requests without proper person/place links
CREATE OR REPLACE VIEW trapper.v_requests_missing_links AS
SELECT
    r.request_id,
    r.summary,
    r.source_system,
    r.created_at,
    CASE WHEN r.place_id IS NULL THEN 'missing_place' ELSE 'has_place' END AS place_status,
    CASE WHEN r.requester_person_id IS NULL THEN 'missing_person' ELSE 'has_person' END AS person_status,
    r.status
FROM trapper.sot_requests r
WHERE r.place_id IS NULL
   OR r.requester_person_id IS NULL
ORDER BY r.created_at DESC;

COMMENT ON VIEW trapper.v_requests_missing_links IS
'Requests that are missing either a place_id or requester_person_id.
These may have been created before proper entity resolution was in place.';

-- ============================================================================
-- PART 3: Summary Statistics View
-- ============================================================================

\echo ''
\echo 'Creating v_data_engine_coverage view...'

CREATE OR REPLACE VIEW trapper.v_data_engine_coverage AS
SELECT
    -- People stats
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) AS total_people,
    (SELECT COUNT(*) FROM trapper.v_people_without_data_engine) AS people_without_engine_trail,
    (SELECT COUNT(*) FROM trapper.v_potential_duplicate_people) AS potential_duplicate_people,

    -- Place stats
    (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL) AS total_places,
    (SELECT COUNT(*) FROM trapper.v_potential_duplicate_places) AS potential_duplicate_places,

    -- Request stats
    (SELECT COUNT(*) FROM trapper.sot_requests) AS total_requests,
    (SELECT COUNT(*) FROM trapper.v_requests_missing_links WHERE place_status = 'missing_place') AS requests_missing_place,
    (SELECT COUNT(*) FROM trapper.v_requests_missing_links WHERE person_status = 'missing_person') AS requests_missing_person,

    -- Data Engine decision stats
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'auto_match') AS auto_match_decisions,
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'new_entity') AS new_entity_decisions,
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'review_pending') AS pending_review_decisions;

COMMENT ON VIEW trapper.v_data_engine_coverage IS
'Summary statistics showing Data Engine coverage and potential data quality issues.
Use this to monitor overall data integrity and identify areas needing attention.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_570 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created views:'
\echo '  - v_data_flow_status: Unified data flow monitoring'
\echo '  - v_people_without_data_engine: People missing Data Engine trail'
\echo '  - v_potential_duplicate_people: Possible duplicate people'
\echo '  - v_potential_duplicate_places: Possible duplicate places'
\echo '  - v_requests_missing_links: Requests without proper links'
\echo '  - v_data_engine_coverage: Summary statistics'
\echo ''
\echo 'Usage:'
\echo '  -- Check overall coverage'
\echo '  SELECT * FROM trapper.v_data_engine_coverage;'
\echo ''
\echo '  -- See data flow status'
\echo '  SELECT * FROM trapper.v_data_flow_status;'
\echo ''
