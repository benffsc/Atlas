-- MIG_1000: V2 Architecture - Create New Schemas
-- Phase 1, Part 1: Schema Infrastructure
--
-- This migration creates the new schema structure for the 3-layer architecture.
-- Existing `trapper` schema remains untouched - we add NEW schemas alongside.
--
-- IMPORTANT: This is NON-DESTRUCTIVE. All existing workflows continue to work.

-- ============================================================================
-- LAYER 1: SOURCE (Bronze) - Raw ingested data
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS source;
COMMENT ON SCHEMA source IS 'Layer 1: Raw ingested data from external systems. Append-only, full provenance.';

-- ============================================================================
-- LAYER 2: OPS (Silver) - Operational/workflow data
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS ops;
COMMENT ON SCHEMA ops IS 'Layer 2: Structured operational data. Requests, intakes, clinic, volunteers.';

-- ============================================================================
-- LAYER 3: SOT (Gold) - Canonical entities
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS sot;
COMMENT ON SCHEMA sot IS 'Layer 3: Canonical Source of Truth entities. People, Cats, Places, Addresses.';

-- ============================================================================
-- LAYER 3b: BEACON - Analytics and ecological data
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS beacon;
COMMENT ON SCHEMA beacon IS 'Layer 3b: Analytics, colony estimates, ecological calculations. Views for now.';

-- ============================================================================
-- SUPPORTING: Core functions (renamed from trapper)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS atlas;
COMMENT ON SCHEMA atlas IS 'Core Atlas functions: find_or_create_*, link_*, data_engine_*, pattern detection.';

-- ============================================================================
-- SUPPORTING: Quarantine for failed validation
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS quarantine;
COMMENT ON SCHEMA quarantine IS 'Records that failed validation, routed for review.';

-- ============================================================================
-- SUPPORTING: Reference/configuration tables
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS reference;
COMMENT ON SCHEMA reference IS 'Configuration, lookup tables, reference data.';

-- ============================================================================
-- SUPPORTING: Audit trails
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS audit;
COMMENT ON SCHEMA audit IS 'Audit logs, entity_edits, merge history, pattern alerts.';

-- ============================================================================
-- SUPPORTING: Archive for pre-drop backup
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS archive;
COMMENT ON SCHEMA archive IS 'Temporary holding for tables before DROP. External backup required.';

-- ============================================================================
-- Grant permissions (adjust roles as needed)
-- ============================================================================
-- These grants ensure the service role can access all schemas
DO $$
BEGIN
    -- Grant usage on all new schemas
    EXECUTE 'GRANT USAGE ON SCHEMA source TO postgres, authenticated, service_role';
    EXECUTE 'GRANT USAGE ON SCHEMA ops TO postgres, authenticated, service_role';
    EXECUTE 'GRANT USAGE ON SCHEMA sot TO postgres, authenticated, service_role';
    EXECUTE 'GRANT USAGE ON SCHEMA beacon TO postgres, authenticated, service_role';
    EXECUTE 'GRANT USAGE ON SCHEMA atlas TO postgres, authenticated, service_role';
    EXECUTE 'GRANT USAGE ON SCHEMA quarantine TO postgres, authenticated, service_role';
    EXECUTE 'GRANT USAGE ON SCHEMA reference TO postgres, authenticated, service_role';
    EXECUTE 'GRANT USAGE ON SCHEMA audit TO postgres, authenticated, service_role';
    EXECUTE 'GRANT USAGE ON SCHEMA archive TO postgres, authenticated, service_role';
EXCEPTION WHEN OTHERS THEN
    -- Ignore errors if roles don't exist (local dev)
    NULL;
END $$;

-- ============================================================================
-- Verify schemas created
-- ============================================================================
DO $$
DECLARE
    v_schemas TEXT[] := ARRAY['source', 'ops', 'sot', 'beacon', 'atlas', 'quarantine', 'reference', 'audit', 'archive'];
    v_schema TEXT;
    v_missing TEXT[];
BEGIN
    FOREACH v_schema IN ARRAY v_schemas LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = v_schema) THEN
            v_missing := array_append(v_missing, v_schema);
        END IF;
    END LOOP;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Failed to create schemas: %', array_to_string(v_missing, ', ');
    END IF;

    RAISE NOTICE 'V2 schemas created successfully: %', array_to_string(v_schemas, ', ');
END $$;
