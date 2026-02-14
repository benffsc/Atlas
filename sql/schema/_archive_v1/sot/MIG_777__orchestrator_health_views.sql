-- ============================================================================
-- MIG_777: Orchestrator Health Views (ORCH_003)
-- ============================================================================
-- TASK_LEDGER reference: ORCH_003
-- ACTIVE Impact: No — read-only views, no schema changes
--
-- Creates diagnostic views:
--   1. v_orchestrator_health     — Pipeline throughput per source
--   2. v_data_why_missing        — Entities that should have data but don't
--   3. v_merge_chain_health      — Detects merge black holes (should be 0)
--   4. v_routing_anomalies       — Flags suspicious data
-- ============================================================================

\echo '=== MIG_777: Orchestrator Health Views (ORCH_003) ==='

-- ============================================================================
-- Step 1: v_orchestrator_health — Pipeline throughput
-- ============================================================================

\echo ''
\echo 'Step 1: Creating v_orchestrator_health'

CREATE OR REPLACE VIEW trapper.v_orchestrator_health AS
SELECT
    os.source_system,
    os.source_table,
    os.display_name,
    os.is_active,
    os.ingest_frequency,
    os.last_ingest_at,
    os.total_records_ingested,

    -- Processing pipeline status from processing_jobs
    COALESCE(pj.queued_count, 0) AS queued_jobs,
    COALESCE(pj.processing_count, 0) AS processing_jobs,
    COALESCE(pj.completed_24h, 0) AS completed_24h,
    COALESCE(pj.failed_24h, 0) AS failed_24h,
    COALESCE(pj.expired_count, 0) AS expired_jobs,

    -- Unprocessed staged records
    COALESCE(sr.unprocessed_staged, 0) AS unprocessed_staged,

    -- Staleness detection
    CASE
        WHEN NOT os.is_active THEN 'inactive'
        WHEN os.ingest_frequency = 'daily' AND os.last_ingest_at < NOW() - INTERVAL '3 days' THEN 'stale'
        WHEN os.ingest_frequency = 'weekly' AND os.last_ingest_at < NOW() - INTERVAL '14 days' THEN 'stale'
        WHEN os.ingest_frequency = 'monthly' AND os.last_ingest_at < NOW() - INTERVAL '45 days' THEN 'stale'
        WHEN COALESCE(pj.failed_24h, 0) > 0 THEN 'errors'
        WHEN COALESCE(pj.queued_count, 0) > 500 THEN 'backlogged'
        WHEN COALESCE(sr.unprocessed_staged, 0) > 1000 THEN 'processing_behind'
        ELSE 'healthy'
    END AS health_status,

    -- Time since last ingest
    CASE
        WHEN os.last_ingest_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM NOW() - os.last_ingest_at) / 3600.0
        ELSE NULL
    END AS hours_since_ingest

FROM trapper.orchestrator_sources os
LEFT JOIN (
    SELECT source_system, source_table,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued_count,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing_count,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours') AS completed_24h,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_24h,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired_count
    FROM trapper.processing_jobs
    GROUP BY source_system, source_table
) pj ON pj.source_system = os.source_system AND pj.source_table = os.source_table
LEFT JOIN (
    SELECT source_system, source_table,
        COUNT(*) AS unprocessed_staged
    FROM trapper.staged_records
    WHERE processed_at IS NULL
    GROUP BY source_system, source_table
) sr ON sr.source_system = os.source_system AND sr.source_table = os.source_table;

COMMENT ON VIEW trapper.v_orchestrator_health IS
'Pipeline health per registered source. Shows processing throughput, staleness, and errors.
health_status: healthy, stale, errors, backlogged, processing_behind, inactive.
Part of ORCH_003.';

-- ============================================================================
-- Step 2: v_data_why_missing — Entities missing expected data
-- ============================================================================

\echo ''
\echo 'Step 2: Creating v_data_why_missing'

CREATE OR REPLACE VIEW trapper.v_data_why_missing AS

-- People without identifiers
SELECT
    'person' AS entity_type,
    'no_identifiers' AS issue,
    sp.person_id AS entity_id,
    sp.display_name AS entity_label,
    sp.data_source::text AS source,
    sp.created_at,
    'Person has no email or phone in person_identifiers. Cannot be found by search.' AS explanation
FROM trapper.sot_people sp
WHERE sp.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.person_identifiers pi WHERE pi.person_id = sp.person_id
  )

UNION ALL

-- Cats without microchips
SELECT
    'cat',
    'no_microchip',
    sc.cat_id,
    sc.display_name,
    sc.data_source::text,
    sc.created_at,
    'Cat has no microchip in cat_identifiers. Cannot be deduplicated across sources.'
FROM trapper.sot_cats sc
WHERE sc.merged_into_cat_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_identifiers ci
    WHERE ci.cat_id = sc.cat_id AND ci.id_type = 'microchip'
  )

UNION ALL

-- Cats without place links
SELECT
    'cat',
    'no_place_link',
    sc.cat_id,
    sc.display_name,
    sc.data_source::text,
    sc.created_at,
    'Cat has no linked place. Cannot appear on Beacon map or in place-based queries.'
FROM trapper.sot_cats sc
WHERE sc.merged_into_cat_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = sc.cat_id
  )

UNION ALL

-- Active requests without trapper assignments
SELECT
    'request',
    'no_trapper',
    sr.request_id,
    COALESCE(p.formatted_address, sr.request_id::text),
    sr.source_system::text,
    sr.created_at,
    'Active request has no trapper assigned. May be stuck in triage queue.'
FROM trapper.sot_requests sr
LEFT JOIN trapper.places p ON p.place_id = sr.place_id
WHERE sr.status IN ('new', 'triaged', 'scheduled')
  AND sr.resolved_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.request_trapper_assignments rta
    WHERE rta.request_id = sr.request_id AND rta.unassigned_at IS NULL
  );

COMMENT ON VIEW trapper.v_data_why_missing IS
'Surfaces entities that are missing expected data — people without identifiers,
cats without microchips, cats without places, requests without trappers.
Use for data quality dashboards. Part of ORCH_003.';

-- ============================================================================
-- Step 3: v_merge_chain_health — Detect merge black holes
-- ============================================================================

\echo ''
\echo 'Step 3: Creating v_merge_chain_health'

CREATE OR REPLACE VIEW trapper.v_merge_chain_health AS
SELECT
    'person' AS entity_type,
    sp.person_id AS entity_id,
    sp.merged_into_person_id AS merged_into,
    target.merged_into_person_id AS target_also_merged_into,
    2 AS chain_depth
FROM trapper.sot_people sp
JOIN trapper.sot_people target ON target.person_id = sp.merged_into_person_id
WHERE sp.merged_into_person_id IS NOT NULL
  AND target.merged_into_person_id IS NOT NULL

UNION ALL

SELECT
    'place',
    p.place_id,
    p.merged_into_place_id,
    target.merged_into_place_id,
    2
FROM trapper.places p
JOIN trapper.places target ON target.place_id = p.merged_into_place_id
WHERE p.merged_into_place_id IS NOT NULL
  AND target.merged_into_place_id IS NOT NULL

UNION ALL

SELECT
    'cat',
    sc.cat_id,
    sc.merged_into_cat_id,
    target.merged_into_cat_id,
    2
FROM trapper.sot_cats sc
JOIN trapper.sot_cats target ON target.cat_id = sc.merged_into_cat_id
WHERE sc.merged_into_cat_id IS NOT NULL
  AND target.merged_into_cat_id IS NOT NULL;

COMMENT ON VIEW trapper.v_merge_chain_health IS
'Detects merge chain black holes across all entity types. Should return 0 rows
after TASK_002/003 fixes. If rows appear, chains are re-forming.
Part of ORCH_003.';

-- ============================================================================
-- Step 4: v_routing_anomalies — Suspicious data flags
-- ============================================================================

\echo ''
\echo 'Step 4: Creating v_routing_anomalies'

CREATE OR REPLACE VIEW trapper.v_routing_anomalies AS

-- Places with implausibly high cat counts
SELECT
    'high_cat_count' AS anomaly_type,
    'place' AS entity_type,
    p.place_id AS entity_id,
    p.formatted_address AS entity_label,
    jsonb_build_object(
        'authoritative_cat_count', p.authoritative_cat_count,
        'colony_size_estimate', p.colony_size_estimate
    ) AS details,
    'Place has >100 cats — verify this is not a data entry error.' AS explanation
FROM trapper.places p
WHERE p.merged_into_place_id IS NULL
  AND (p.authoritative_cat_count > 100 OR p.colony_size_estimate > 100)

UNION ALL

-- People with unusually many identifiers (possible data quality issue)
SELECT
    'many_identifiers',
    'person',
    pi.person_id,
    sp.display_name,
    jsonb_build_object('identifier_count', COUNT(*)),
    'Person has >10 identifiers — possible data quality issue.'
FROM trapper.person_identifiers pi
JOIN trapper.sot_people sp ON sp.person_id = pi.person_id
WHERE sp.merged_into_person_id IS NULL
GROUP BY pi.person_id, sp.display_name
HAVING COUNT(*) > 10

UNION ALL

-- Sources that haven't ingested when they should have
SELECT
    'stale_source',
    'source',
    os.source_id,
    os.display_name,
    jsonb_build_object(
        'last_ingest_at', os.last_ingest_at,
        'ingest_frequency', os.ingest_frequency,
        'hours_since', EXTRACT(EPOCH FROM NOW() - os.last_ingest_at) / 3600.0
    ),
    'Source has not ingested within expected frequency window.'
FROM trapper.orchestrator_sources os
WHERE os.is_active
  AND os.last_ingest_at IS NOT NULL
  AND (
    (os.ingest_frequency = 'daily' AND os.last_ingest_at < NOW() - INTERVAL '3 days')
    OR (os.ingest_frequency = 'weekly' AND os.last_ingest_at < NOW() - INTERVAL '14 days')
    OR (os.ingest_frequency = 'monthly' AND os.last_ingest_at < NOW() - INTERVAL '45 days')
  );

COMMENT ON VIEW trapper.v_routing_anomalies IS
'Flags suspicious data: implausible cat counts, excessive identifiers, stale sources.
Use for proactive data quality monitoring. Part of ORCH_003.';

-- ============================================================================
-- Step 5: Verify all views
-- ============================================================================

\echo ''
\echo 'Step 5: Verifying views'

\echo 'v_orchestrator_health:'
SELECT health_status, COUNT(*) FROM trapper.v_orchestrator_health GROUP BY health_status ORDER BY health_status;

\echo ''
\echo 'v_data_why_missing counts by issue:'
SELECT entity_type, issue, COUNT(*) AS cnt
FROM trapper.v_data_why_missing
GROUP BY entity_type, issue
ORDER BY entity_type, issue;

\echo ''
\echo 'v_merge_chain_health (should be 0):'
SELECT entity_type, COUNT(*) AS chains
FROM trapper.v_merge_chain_health
GROUP BY entity_type;

\echo ''
\echo 'v_routing_anomalies:'
SELECT anomaly_type, COUNT(*) AS cnt
FROM trapper.v_routing_anomalies
GROUP BY anomaly_type
ORDER BY anomaly_type;

-- ============================================================================
-- Step 6: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_777 SUMMARY ======'
\echo 'Created 4 diagnostic views:'
\echo '  v_orchestrator_health    — Pipeline throughput and staleness per source'
\echo '  v_data_why_missing       — Entities missing expected data'
\echo '  v_merge_chain_health     — Merge chain black hole detector'
\echo '  v_routing_anomalies      — Suspicious data flags'
\echo ''
\echo 'All read-only. No schema changes. No active flow impact.'
\echo '=== MIG_777 Complete ==='
