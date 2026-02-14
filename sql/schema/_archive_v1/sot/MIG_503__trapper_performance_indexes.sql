-- MIG_503: Trapper Query Performance Indexes
--
-- Problem:
--   Tippy trapper queries can be slow due to missing indexes on
--   commonly filtered columns.
--
-- Solution:
--   Add indexes on role, role_status, trapper_type for person_roles table.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_503__trapper_performance_indexes.sql

\echo ''
\echo '=============================================='
\echo 'MIG_503: Trapper Performance Indexes'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Add indexes on person_roles for fast trapper queries
-- ============================================================

\echo '1. Adding indexes on person_roles...'

-- Index for role filtering (trappers vs other roles)
CREATE INDEX IF NOT EXISTS idx_person_roles_role
  ON trapper.person_roles(role);

-- Index for active trapper queries
CREATE INDEX IF NOT EXISTS idx_person_roles_trapper_active
  ON trapper.person_roles(person_id, trapper_type, role_status)
  WHERE role = 'trapper' AND role_status = 'active';

-- Index for trapper type filtering
CREATE INDEX IF NOT EXISTS idx_person_roles_trapper_type
  ON trapper.person_roles(trapper_type)
  WHERE role = 'trapper';

-- ============================================================
-- 2. Add indexes for request_trapper_assignments
-- ============================================================

\echo '2. Adding indexes on request_trapper_assignments...'

CREATE INDEX IF NOT EXISTS idx_rta_trapper_person
  ON trapper.request_trapper_assignments(trapper_person_id)
  WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rta_request
  ON trapper.request_trapper_assignments(request_id)
  WHERE unassigned_at IS NULL;

-- ============================================================
-- 3. Add indexes for clinichq_visits if table exists
-- ============================================================

\echo '3. Adding indexes for clinic visit queries (if table exists)...'

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'trapper' AND tablename = 'clinichq_visits') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clinichq_visits_client_email ON trapper.clinichq_visits(LOWER(client_email))';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clinichq_visits_visit_date ON trapper.clinichq_visits(visit_date)';
    RAISE NOTICE 'Added indexes on clinichq_visits';
  ELSE
    RAISE NOTICE 'clinichq_visits table not found, skipping';
  END IF;
END $$;

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'MIG_503 Complete!'
\echo '=============================================='
\echo ''
\echo 'Indexes added for:'
\echo '  - person_roles (role, trapper_type, role_status)'
\echo '  - request_trapper_assignments (trapper_person_id, request_id)'
\echo '  - clinichq_visits (client_email, visit_date) if exists'
\echo ''
\echo 'Performance improvement: Tippy trapper queries should be faster'
\echo ''

-- Record migration
SELECT trapper.record_migration(503, 'MIG_503__trapper_performance_indexes');
