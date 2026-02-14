\echo '=============================================='
\echo 'MIG_489: Migration Tracking Infrastructure'
\echo '=============================================='

-- Migration tracking table to record what's been deployed
-- This enables:
-- 1. Knowing which migrations are applied
-- 2. Preventing duplicate runs
-- 3. Auditing deployment history
-- 4. CI/CD automation

CREATE TABLE IF NOT EXISTS trapper.schema_migrations (
  migration_number INT PRIMARY KEY,
  migration_name TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  execution_time_ms INT,
  status TEXT DEFAULT 'success' CHECK (status IN ('success', 'failed', 'rolled_back')),
  checksum TEXT,  -- SHA256 of file content for change detection
  applied_by TEXT DEFAULT current_user,
  notes TEXT
);

COMMENT ON TABLE trapper.schema_migrations IS
  'Tracks which database migrations have been applied. Used by scripts/run-migrations.mjs';

COMMENT ON COLUMN trapper.schema_migrations.migration_number IS
  'The MIG_NNN number from the filename';
COMMENT ON COLUMN trapper.schema_migrations.checksum IS
  'SHA256 hash of file content - detects if migration was modified after initial run';

-- Function to check if migration was applied
CREATE OR REPLACE FUNCTION trapper.migration_applied(p_number INT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM trapper.schema_migrations
    WHERE migration_number = p_number AND status = 'success'
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.migration_applied IS
  'Returns true if migration number has been successfully applied';

-- Function to record migration execution
CREATE OR REPLACE FUNCTION trapper.record_migration(
  p_number INT,
  p_name TEXT,
  p_time_ms INT DEFAULT 0,
  p_checksum TEXT DEFAULT NULL
)
RETURNS VOID AS $$
  INSERT INTO trapper.schema_migrations (migration_number, migration_name, execution_time_ms, checksum)
  VALUES (p_number, p_name, p_time_ms, p_checksum)
  ON CONFLICT (migration_number) DO UPDATE SET
    applied_at = NOW(),
    status = 'success',
    execution_time_ms = EXCLUDED.execution_time_ms,
    checksum = COALESCE(EXCLUDED.checksum, trapper.schema_migrations.checksum);
$$ LANGUAGE sql;

COMMENT ON FUNCTION trapper.record_migration IS
  'Records a successful migration. Safe to call multiple times (idempotent).';

-- Function to mark migration as failed
CREATE OR REPLACE FUNCTION trapper.mark_migration_failed(p_number INT, p_error TEXT DEFAULT NULL)
RETURNS VOID AS $$
  INSERT INTO trapper.schema_migrations (migration_number, migration_name, status, notes)
  VALUES (p_number, 'FAILED', 'failed', p_error)
  ON CONFLICT (migration_number) DO UPDATE SET
    status = 'failed',
    notes = EXCLUDED.notes,
    applied_at = NOW();
$$ LANGUAGE sql;

-- View to see migration status
CREATE OR REPLACE VIEW trapper.v_migration_status AS
SELECT
  migration_number,
  migration_name,
  status,
  applied_at,
  execution_time_ms,
  CASE
    WHEN status = 'success' THEN 'deployed'
    WHEN status = 'failed' THEN 'FAILED - needs attention'
    ELSE status
  END as display_status
FROM trapper.schema_migrations
ORDER BY migration_number;

COMMENT ON VIEW trapper.v_migration_status IS
  'Human-readable view of migration deployment status';

-- Backfill known migrations that are already deployed
-- These are critical migrations we know exist based on running views
DO $$
BEGIN
  -- Only backfill if the table is empty (fresh install)
  IF NOT EXISTS (SELECT 1 FROM trapper.schema_migrations) THEN
    -- Core infrastructure migrations (assumed deployed if schema exists)
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'sot_people') THEN
      INSERT INTO trapper.schema_migrations (migration_number, migration_name, notes)
      VALUES (130, 'MIG_130__sot_layer_link_tables', 'Backfilled - table exists')
      ON CONFLICT DO NOTHING;
    END IF;

    -- Check for Beacon views
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_beacon_summary') THEN
      INSERT INTO trapper.schema_migrations (migration_number, migration_name, notes)
      VALUES (340, 'MIG_340__beacon_calculation_views', 'Backfilled - view exists')
      ON CONFLICT DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'trapper' AND matviewname = 'mv_beacon_clusters') THEN
      INSERT INTO trapper.schema_migrations (migration_number, migration_name, notes)
      VALUES (341, 'MIG_341__beacon_clustering', 'Backfilled - matview exists')
      ON CONFLICT DO NOTHING;
    END IF;

    -- Check for data quality functions
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'check_entity_quality' AND pronamespace = 'trapper'::regnamespace) THEN
      INSERT INTO trapper.schema_migrations (migration_number, migration_name, notes)
      VALUES (487, 'MIG_487__tippy_data_quality', 'Backfilled - function exists')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $$;

\echo 'Migration tracking table created'
\echo 'Use: SELECT * FROM trapper.v_migration_status;'
