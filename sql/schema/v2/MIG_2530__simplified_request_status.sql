-- MIG_2530: Simplified Request Status System
--
-- Problem: Current status flow has 7 states with confusing transitions:
-- - new → triaged → scheduled → in_progress → completed
-- - "triaged" is meaningless (just "we looked at it")
-- - 2 clicks required to start work (triage first, then start)
--
-- Solution: Simplify to 4 states:
-- - new: Just received, not yet actioned
-- - working: Active work happening (trapping, scheduled, in progress)
-- - paused: On hold, waiting for something
-- - completed: Done (including cancelled)
--
-- Migration strategy:
-- 1. Add new status values to enum
-- 2. Map old statuses to new (triaged→new, scheduled/in_progress→working, on_hold→paused)
-- 3. Update UI to use new status buttons
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2530: Simplified Request Status'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Current status distribution
-- ============================================================================

\echo '1. Pre-check: Current status distribution...'

SELECT status::TEXT, COUNT(*) as count
FROM ops.requests
GROUP BY status
ORDER BY
  CASE status::TEXT
    WHEN 'new' THEN 1
    WHEN 'triaged' THEN 2
    WHEN 'scheduled' THEN 3
    WHEN 'in_progress' THEN 4
    WHEN 'on_hold' THEN 5
    WHEN 'completed' THEN 6
    WHEN 'cancelled' THEN 7
    ELSE 99
  END;

-- ============================================================================
-- 2. Add new status values to enum (if not already present)
-- ============================================================================

\echo ''
\echo '2. Adding new status values to enum...'

-- Check what enum values exist
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'ops.request_status'::regtype
ORDER BY enumsortorder;

-- Add 'working' and 'paused' if they don't exist
DO $$
BEGIN
  -- Add 'working' status
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'ops.request_status'::regtype
    AND enumlabel = 'working'
  ) THEN
    ALTER TYPE ops.request_status ADD VALUE 'working';
    RAISE NOTICE 'Added status: working';
  ELSE
    RAISE NOTICE 'Status working already exists';
  END IF;

  -- Add 'paused' status
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'ops.request_status'::regtype
    AND enumlabel = 'paused'
  ) THEN
    ALTER TYPE ops.request_status ADD VALUE 'paused';
    RAISE NOTICE 'Added status: paused';
  ELSE
    RAISE NOTICE 'Status paused already exists';
  END IF;
END;
$$;

-- ============================================================================
-- 3. Create status mapping table for reference
-- ============================================================================

\echo ''
\echo '3. Creating status mapping reference...'

CREATE TABLE IF NOT EXISTS ops.request_status_mapping (
  old_status TEXT PRIMARY KEY,
  new_status TEXT NOT NULL,
  notes TEXT
);

INSERT INTO ops.request_status_mapping (old_status, new_status, notes)
VALUES
  ('new', 'new', 'No change'),
  ('triaged', 'new', 'Triaged is meaningless - merge back to new'),
  ('scheduled', 'working', 'Has a scheduled date - work is happening'),
  ('in_progress', 'working', 'Active trapping - work is happening'),
  ('on_hold', 'paused', 'Waiting on something'),
  ('completed', 'completed', 'No change'),
  ('cancelled', 'completed', 'Merge into completed (with resolution_reason=cancelled)'),
  ('partial', 'completed', 'Merge into completed (with resolution_reason=partial)')
ON CONFLICT (old_status) DO UPDATE
SET new_status = EXCLUDED.new_status,
    notes = EXCLUDED.notes;

SELECT * FROM ops.request_status_mapping;

-- ============================================================================
-- 4. Migrate existing statuses
-- ============================================================================

\echo ''
\echo '4. Migrating existing statuses...'

-- First, record all transitions in status history for auditability
INSERT INTO ops.request_status_history (request_id, old_status, new_status, changed_by, reason)
SELECT
  r.request_id,
  r.status::TEXT,
  CASE r.status::TEXT
    WHEN 'triaged' THEN 'new'
    WHEN 'scheduled' THEN 'working'
    WHEN 'in_progress' THEN 'working'
    WHEN 'on_hold' THEN 'paused'
    ELSE r.status::TEXT
  END,
  'MIG_2530',
  'Status simplification migration'
FROM ops.requests r
WHERE r.status::TEXT IN ('triaged', 'scheduled', 'in_progress', 'on_hold');

-- Now update the actual statuses
-- triaged → new
UPDATE ops.requests
SET status = 'new'
WHERE status = 'triaged';

-- scheduled → working
UPDATE ops.requests
SET status = 'working'
WHERE status = 'scheduled';

-- in_progress → working
UPDATE ops.requests
SET status = 'working'
WHERE status = 'in_progress';

-- on_hold → paused
UPDATE ops.requests
SET status = 'paused'
WHERE status = 'on_hold';

-- cancelled → completed (with resolution marking)
UPDATE ops.requests
SET status = 'completed',
    resolution = COALESCE(resolution, 'cancelled')
WHERE status = 'cancelled';

-- partial → completed (with resolution marking)
UPDATE ops.requests
SET status = 'completed',
    resolution = COALESCE(resolution, 'partial')
WHERE status = 'partial';

-- ============================================================================
-- 5. Post-check: New status distribution
-- ============================================================================

\echo ''
\echo '5. Post-check: New status distribution...'

SELECT status::TEXT, COUNT(*) as count
FROM ops.requests
GROUP BY status
ORDER BY
  CASE status::TEXT
    WHEN 'new' THEN 1
    WHEN 'working' THEN 2
    WHEN 'paused' THEN 3
    WHEN 'completed' THEN 4
    ELSE 99
  END;

-- ============================================================================
-- 6. Create status transition helper
-- ============================================================================

\echo ''
\echo '6. Creating status transition helper...'

CREATE OR REPLACE FUNCTION ops.get_valid_status_transitions(p_current_status TEXT)
RETURNS TEXT[] AS $$
BEGIN
  CASE p_current_status
    WHEN 'new' THEN
      RETURN ARRAY['working', 'paused', 'completed'];
    WHEN 'working' THEN
      RETURN ARRAY['completed', 'paused'];
    WHEN 'paused' THEN
      RETURN ARRAY['working', 'completed'];  -- Resume or complete
    WHEN 'completed' THEN
      RETURN ARRAY['new'];  -- Reopen
    ELSE
      RETURN ARRAY['new', 'working', 'paused', 'completed'];
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION ops.get_valid_status_transitions(TEXT) IS
'Returns valid next statuses for the given current status.
Simplified flow: new → working ↔ paused → completed (with reopen to new)';

-- ============================================================================
-- 7. Create status display helper
-- ============================================================================

\echo ''
\echo '7. Creating status display helper...'

CREATE OR REPLACE FUNCTION ops.get_status_display(p_status TEXT)
RETURNS TABLE(label TEXT, color TEXT, icon TEXT) AS $$
BEGIN
  CASE p_status
    WHEN 'new' THEN
      RETURN QUERY SELECT 'New'::TEXT, '#3b82f6'::TEXT, '📥'::TEXT;
    WHEN 'working' THEN
      RETURN QUERY SELECT 'Working'::TEXT, '#f59e0b'::TEXT, '🔄'::TEXT;
    WHEN 'paused' THEN
      RETURN QUERY SELECT 'Paused'::TEXT, '#ec4899'::TEXT, '⏸️'::TEXT;
    WHEN 'completed' THEN
      RETURN QUERY SELECT 'Completed'::TEXT, '#10b981'::TEXT, '✅'::TEXT;
    -- Legacy statuses (shouldn't appear after migration)
    WHEN 'triaged' THEN
      RETURN QUERY SELECT 'New'::TEXT, '#3b82f6'::TEXT, '📥'::TEXT;
    WHEN 'scheduled' THEN
      RETURN QUERY SELECT 'Working'::TEXT, '#f59e0b'::TEXT, '🔄'::TEXT;
    WHEN 'in_progress' THEN
      RETURN QUERY SELECT 'Working'::TEXT, '#f59e0b'::TEXT, '🔄'::TEXT;
    WHEN 'on_hold' THEN
      RETURN QUERY SELECT 'Paused'::TEXT, '#ec4899'::TEXT, '⏸️'::TEXT;
    WHEN 'cancelled' THEN
      RETURN QUERY SELECT 'Completed'::TEXT, '#6b7280'::TEXT, '❌'::TEXT;
    ELSE
      RETURN QUERY SELECT p_status::TEXT, '#6b7280'::TEXT, '❓'::TEXT;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 8. Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2530 Complete'
\echo '=============================================='
\echo ''
\echo 'Simplified status flow:'
\echo '  new → working ↔ paused → completed'
\echo ''
\echo 'Migrations applied:'
\echo '  triaged → new'
\echo '  scheduled → working'
\echo '  in_progress → working'
\echo '  on_hold → paused'
\echo '  cancelled → completed (with resolution=cancelled)'
\echo ''
\echo 'NEXT: Update UI status buttons and badges'
\echo ''
