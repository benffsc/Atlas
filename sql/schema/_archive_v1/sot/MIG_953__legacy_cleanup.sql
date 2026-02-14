\echo ''
\echo '=============================================='
\echo 'MIG_953: Legacy Code Cleanup and Documentation'
\echo '=============================================='
\echo ''
\echo 'Archives legacy matching_rules table and documents the transition'
\echo 'to Fellegi-Sunter probabilistic matching.'
\echo ''

-- ============================================================================
-- PART 1: Archive data_engine_matching_rules
-- ============================================================================

\echo '1. Archiving data_engine_matching_rules table...'

-- Create archive schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS archive;

-- Archive the matching_rules table (preserve for historical reference)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'trapper' AND table_name = 'data_engine_matching_rules') THEN
        -- Create archive copy with timestamp
        CREATE TABLE IF NOT EXISTS archive.data_engine_matching_rules_20260208 AS
        SELECT *, NOW() as archived_at
        FROM trapper.data_engine_matching_rules;

        -- Add comment explaining the archive
        COMMENT ON TABLE archive.data_engine_matching_rules_20260208 IS
        'Archived 2026-02-08: Legacy fixed-weight matching rules, superseded by fellegi_sunter_parameters. See MIG_947-949 for new F-S matching system.';

        RAISE NOTICE 'Archived % rows from data_engine_matching_rules', (SELECT COUNT(*) FROM archive.data_engine_matching_rules_20260208);
    ELSE
        RAISE NOTICE 'No data_engine_matching_rules table found to archive';
    END IF;
END $$;

-- ============================================================================
-- PART 2: Document the dual-scoring transition
-- ============================================================================

\echo '2. Creating documentation view for matching system status...'

-- Create a view documenting the current matching system configuration
CREATE OR REPLACE VIEW trapper.v_matching_system_config AS
SELECT
    'fellegi_sunter' AS system,
    'active' AS status,
    'Probabilistic log-odds scoring' AS description,
    (SELECT COUNT(*) FROM trapper.fellegi_sunter_parameters WHERE is_active) AS active_parameters,
    (SELECT COUNT(*) FROM trapper.fellegi_sunter_thresholds WHERE is_active) AS active_thresholds,
    'MIG_947, MIG_948, MIG_949' AS implemented_in

UNION ALL

SELECT
    'legacy_fixed_weight',
    'deprecated',
    'Fixed percentage weights (40/25/25/10)',
    (SELECT COUNT(*) FROM trapper.data_engine_matching_rules WHERE is_active) AS active_parameters,
    NULL,
    'Pre-2026'

UNION ALL

SELECT
    'identity_graph',
    'active',
    'Edge-based merge tracking with transitive closure',
    (SELECT COUNT(*) FROM trapper.identity_edges),
    NULL,
    'MIG_951, MIG_952';

COMMENT ON VIEW trapper.v_matching_system_config IS
'Documents the current state of Atlas identity matching systems. Fellegi-Sunter is now primary.';

-- ============================================================================
-- PART 3: Create unified scoring audit view
-- ============================================================================

\echo '3. Creating scoring audit view...'

CREATE OR REPLACE VIEW trapper.v_identity_decisions_summary AS
SELECT
    DATE_TRUNC('day', processed_at) AS decision_date,
    decision_type,
    COUNT(*) AS decision_count,
    AVG(COALESCE(fs_match_probability, top_candidate_score)) AS avg_score,
    COUNT(*) FILTER (WHERE fs_match_probability IS NOT NULL) AS fs_scored,
    COUNT(*) FILTER (WHERE fs_match_probability IS NULL AND top_candidate_score IS NOT NULL) AS legacy_scored
FROM trapper.data_engine_match_decisions
WHERE processed_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', processed_at), decision_type
ORDER BY decision_date DESC, decision_type;

COMMENT ON VIEW trapper.v_identity_decisions_summary IS
'Daily summary of identity matching decisions with F-S vs legacy scoring breakdown';

-- ============================================================================
-- PART 4: Add deprecation comments to legacy functions
-- ============================================================================

\echo '4. Adding deprecation comments to legacy functions...'

COMMENT ON FUNCTION trapper.data_engine_score_candidates(TEXT, TEXT, TEXT, TEXT) IS
'@deprecated Use data_engine_score_candidates_fs() instead. This legacy function uses fixed weights (40/25/25/10) instead of Fellegi-Sunter log-odds. Kept for backwards compatibility during transition period.';

-- ============================================================================
-- PART 5: Verify F-S adoption metrics
-- ============================================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Matching system configuration:'
SELECT * FROM trapper.v_matching_system_config;

\echo ''
\echo 'Recent decision scoring breakdown (last 7 days):'
SELECT
    decision_type,
    SUM(decision_count) AS total_decisions,
    SUM(fs_scored) AS using_fs_scoring,
    SUM(legacy_scored) AS using_legacy_scoring
FROM trapper.v_identity_decisions_summary
WHERE decision_date > NOW() - INTERVAL '7 days'
GROUP BY decision_type
ORDER BY total_decisions DESC;

\echo ''
\echo 'F-S parameter configuration:'
SELECT field_name, m_probability, u_probability, agreement_weight, disagreement_weight
FROM trapper.fellegi_sunter_parameters
WHERE is_active
ORDER BY ABS(agreement_weight) DESC;

\echo ''
\echo '=============================================='
\echo 'MIG_953 Complete!'
\echo '=============================================='
\echo ''
\echo 'Summary:'
\echo '  - Archived data_engine_matching_rules to archive schema'
\echo '  - Created v_matching_system_config documentation view'
\echo '  - Created v_identity_decisions_summary audit view'
\echo '  - Added deprecation comment to legacy scoring function'
\echo ''
\echo 'Note: Legacy scoring function (data_engine_score_candidates) is still'
\echo 'available for backwards compatibility. It should be removed in a future'
\echo 'migration after confirming all code paths use F-S scoring.'
\echo ''
