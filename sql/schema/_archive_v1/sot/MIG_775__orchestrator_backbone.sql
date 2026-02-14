-- ============================================================================
-- MIG_775: Orchestrator Backbone (ORCH_001)
-- ============================================================================
-- TASK_LEDGER reference: ORCH_001
-- ACTIVE Impact: No — purely additive tables alongside existing system
--
-- Creates the orchestrator coordination layer:
--   1. orchestrator_sources — registry of all data sources
--   2. orchestrator_routing_rules — field-to-surface mappings
--   3. orchestrator_job_log — debuggable routing audit trail
-- ============================================================================

\echo '=== MIG_775: Orchestrator Backbone (ORCH_001) ==='

-- ============================================================================
-- Step 1: Source Registry
-- ============================================================================

\echo ''
\echo 'Step 1: Creating orchestrator_sources'

CREATE TABLE IF NOT EXISTS trapper.orchestrator_sources (
    source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    display_name TEXT NOT NULL,

    -- Schema declaration
    expected_fields JSONB,
    id_field_candidates TEXT[],

    -- Pipeline configuration
    entity_types_produced TEXT[],
    processor_name TEXT,
    ingest_method TEXT NOT NULL,
    ingest_frequency TEXT,

    -- Health tracking
    last_ingest_at TIMESTAMPTZ,
    last_ingest_record_count INT,
    total_records_ingested BIGINT DEFAULT 0,
    total_entities_created BIGINT DEFAULT 0,

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (source_system, source_table)
);

COMMENT ON TABLE trapper.orchestrator_sources IS
'Registry of all data sources that feed Atlas. Part of ORCH_001.
Each row declares a source, its schema, how it ingests, what entities it produces.
This is the "phone book" — one query to see all sources.';

-- ============================================================================
-- Step 2: Routing Rules
-- ============================================================================

\echo ''
\echo 'Step 2: Creating orchestrator_routing_rules'

CREATE TABLE IF NOT EXISTS trapper.orchestrator_routing_rules (
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source declaration
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,

    -- Field mapping
    source_field TEXT NOT NULL,
    target_surface TEXT NOT NULL,
    target_field TEXT,
    target_function TEXT,

    -- Routing behavior
    routing_type TEXT NOT NULL DEFAULT 'direct',
    transform_expression TEXT,
    is_required BOOLEAN DEFAULT FALSE,
    skip_if_empty BOOLEAN DEFAULT TRUE,

    -- Provenance
    provenance_template JSONB,

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    FOREIGN KEY (source_system, source_table)
        REFERENCES trapper.orchestrator_sources(source_system, source_table)
);

COMMENT ON TABLE trapper.orchestrator_routing_rules IS
'Declarative field-to-surface mappings. Describes how each source field
routes to a canonical surface (sot_people, places, etc.). Part of ORCH_001.
routing_type: direct (copy), transform (apply expression), function_call (delegate to function).';

CREATE INDEX IF NOT EXISTS idx_orchestrator_routing_source
    ON trapper.orchestrator_routing_rules(source_system, source_table);

-- ============================================================================
-- Step 3: Job Log
-- ============================================================================

\echo ''
\echo 'Step 3: Creating orchestrator_job_log'

CREATE TABLE IF NOT EXISTS trapper.orchestrator_job_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID,

    -- What happened
    action TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_table TEXT NOT NULL,
    source_record_id TEXT,

    -- Where it went
    target_surface TEXT,
    target_entity_id UUID,
    routing_rule_id UUID,

    -- Decision context
    decision_reason TEXT,
    decision_details JSONB,

    -- Timing
    logged_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.orchestrator_job_log IS
'Append-only audit trail of orchestrator routing decisions. Part of ORCH_001.
Actions: routed, skipped, merged, rejected, anomaly_flagged, error.
Enables debugging: "what happened to source record X?" is one query.';

CREATE INDEX IF NOT EXISTS idx_orchestrator_log_source
    ON trapper.orchestrator_job_log(source_system, source_table, source_record_id);

CREATE INDEX IF NOT EXISTS idx_orchestrator_log_target
    ON trapper.orchestrator_job_log(target_entity_id)
    WHERE target_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orchestrator_log_errors
    ON trapper.orchestrator_job_log(logged_at DESC)
    WHERE action IN ('error', 'anomaly_flagged', 'rejected');

-- ============================================================================
-- Step 4: Verification
-- ============================================================================

\echo ''
\echo 'Step 4: Verification'

\echo 'Tables created:'
SELECT tablename
FROM pg_tables
WHERE schemaname = 'trapper'
  AND tablename LIKE 'orchestrator_%'
ORDER BY tablename;

\echo ''
\echo 'Indexes created:'
SELECT indexname
FROM pg_indexes
WHERE schemaname = 'trapper'
  AND indexname LIKE '%orchestrator%'
ORDER BY indexname;

-- ============================================================================
-- Step 5: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_775 SUMMARY ======'
\echo 'Created 3 orchestrator tables:'
\echo '  orchestrator_sources        — Source registry'
\echo '  orchestrator_routing_rules  — Field-to-surface mappings'
\echo '  orchestrator_job_log        — Routing audit trail'
\echo ''
\echo 'Shadow mode: No existing pipelines changed.'
\echo '=== MIG_775 Complete ==='
