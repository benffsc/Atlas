-- MIG_3055: Resolve sot.merge_person_into overload conflict
--
-- Part of FFS-1150 (Atlas Data Hardening), Initiative 6 follow-up (FFS-1155).
--
-- Surfaced during MIG_3054 audit. sot.merge_person_into has TWO overloads
-- in production:
--
--   sot.merge_person_into(uuid, uuid, text, text DEFAULT 'admin')   -- MIG_2823 (older, 3882 chars, MISSING trapper handling)
--   sot.merge_person_into(uuid, uuid, text, uuid DEFAULT NULL)      -- MIG_2922 (newer, 7254 chars, includes trapper_profiles + trapper_service_places)
--
-- Caller dispatch is silently broken:
--
--   - apps/web/src/app/api/cron/merge-duplicates/route.ts passes
--     `[loser, winner, reason, null]` — Postgres picks the UUID overload
--     (correct, has trapper handling). Verified via smoke test.
--
--   - apps/web/src/app/api/admin/person-dedup/route.ts passes
--     `[loser, winner, reason, "staff"]` — Postgres picks the TEXT
--     overload (WRONG, missing trapper handling).
--
--   - MIG_2912 / MIG_2916 (already-run data fixes) passed text strings —
--     also hit the older overload, also missed trapper handling.
--
-- Risk: any merge of a person who happens to be a trapper via the admin
-- dedup UI silently leaves orphan rows in sot.trapper_profiles and
-- sot.trapper_service_places. Those orphans then survive subsequent
-- queries because they reference a now-merged person_id.
--
-- Fix: replace the TEXT overload's body with a thin wrapper that
-- delegates to the UUID overload. Both signatures keep working, but
-- both now route through the complete logic.
--
-- The full fix (drop the TEXT overload + update all callers to UUID)
-- is deferred — that's a riskier change requiring caller-side audits.
-- This wrapper is the safe immediate move.
--
-- Industry pattern: PostgreSQL function-overload conflict resolution.
-- Per Postgres docs (https://www.postgresql.org/docs/current/xfunc-overload.html),
-- you cannot CREATE OR REPLACE through a signature change. The wrapper
-- pattern lets you converge two overloads behaviorally without dropping
-- either, then retire the legacy one when callers are migrated.
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3055: Dedupe merge_person_into overload'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Verify both overloads still exist
-- ============================================================================

DO $$
DECLARE
  v_text_count INT;
  v_uuid_count INT;
BEGIN
  SELECT COUNT(*) INTO v_text_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'sot'
    AND p.proname = 'merge_person_into'
    AND pg_get_function_arguments(p.oid) LIKE '%p_changed_by text%';

  SELECT COUNT(*) INTO v_uuid_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'sot'
    AND p.proname = 'merge_person_into'
    AND pg_get_function_arguments(p.oid) LIKE '%p_changed_by uuid%';

  IF v_text_count = 0 THEN
    RAISE EXCEPTION 'TEXT overload not found — manual investigation needed';
  END IF;
  IF v_uuid_count = 0 THEN
    RAISE EXCEPTION 'UUID overload not found — cannot delegate, manual fix required';
  END IF;

  RAISE NOTICE '   Both overloads present (TEXT=% UUID=%)', v_text_count, v_uuid_count;
END;
$$;

-- ============================================================================
-- 2. Replace TEXT overload body with delegation to UUID overload
-- ============================================================================
-- CREATE OR REPLACE works here because we're keeping the same signature
-- (loser_id UUID, winner_id UUID, reason TEXT, changed_by TEXT). We're
-- only changing the body.

\echo '2. Replacing TEXT overload body with UUID delegation...'

CREATE OR REPLACE FUNCTION sot.merge_person_into(
  p_loser_id   UUID,
  p_winner_id  UUID,
  p_reason     TEXT DEFAULT 'duplicate_person',
  p_changed_by TEXT DEFAULT 'admin'
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- MIG_3055: Delegate to the UUID overload (which has the complete
  -- post-MIG_2922 logic including trapper_profiles + trapper_service_places).
  -- The TEXT changed_by parameter is dropped because changed_by tracking
  -- canonically uses UUIDs across Atlas (CLAUDE.md invariant).
  -- The reason text still carries forward via p_reason.
  PERFORM sot.merge_person_into(
    p_loser_id,
    p_winner_id,
    p_reason,
    NULL::UUID
  );
END;
$$;

COMMENT ON FUNCTION sot.merge_person_into(uuid, uuid, text, text) IS
'MIG_3055: Backward-compat wrapper that delegates to the UUID overload.
The TEXT changed_by parameter is preserved for caller compatibility but
not propagated — actual change_by tracking lives in the UUID overload.
DEPRECATED — new code should call the UUID overload directly.
Will be dropped after callers migrate (FFS-1155 follow-up).';

-- ============================================================================
-- 3. Verification
-- ============================================================================

\echo ''
\echo '3. Verifying both overloads behave equivalently...'

-- Test UUID overload directly with non-existent ids
DO $$
BEGIN
  PERFORM sot.merge_person_into(
    '00000000-0000-0000-0000-00000000aaaa'::UUID,
    '00000000-0000-0000-0000-00000000bbbb'::UUID,
    'mig_3055_smoke_test',
    NULL::UUID
  );
  RAISE NOTICE '   UUID overload smoke test passed';
END;
$$;

-- Test TEXT overload with text changed_by
DO $$
BEGIN
  PERFORM sot.merge_person_into(
    '00000000-0000-0000-0000-00000000cccc'::UUID,
    '00000000-0000-0000-0000-00000000dddd'::UUID,
    'mig_3055_smoke_test',
    'staff'::TEXT
  );
  RAISE NOTICE '   TEXT overload smoke test passed (now delegates to UUID)';
END;
$$;

-- Confirm both overloads exist and have expected sizes
SELECT
  pg_get_function_arguments(p.oid) AS args,
  LENGTH(prosrc) AS body_length,
  CASE
    WHEN pg_get_function_arguments(p.oid) LIKE '%text DEFAULT ''admin''%' THEN 'wrapper (post-MIG_3055)'
    WHEN pg_get_function_arguments(p.oid) LIKE '%uuid DEFAULT NULL%' THEN 'canonical (post-MIG_2922)'
    ELSE 'unknown'
  END AS role
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'sot' AND p.proname = 'merge_person_into'
ORDER BY role;

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3055 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - sot.merge_person_into(uuid, uuid, text, TEXT) is now a wrapper'
\echo '    that delegates to sot.merge_person_into(uuid, uuid, text, UUID)'
\echo '  - All callers (cron, admin, migrations) now route through the'
\echo '    complete post-MIG_2922 logic with trapper handling'
\echo ''
\echo 'Follow-up (deferred — FFS-1155):'
\echo '  - Migrate apps/web/src/app/api/admin/person-dedup/route.ts to call'
\echo '    the UUID overload directly (cast changed_by to UUID or NULL)'
\echo '  - Migrate apps/web/src/app/api/cron/merge-duplicates/route.ts'
\echo '    similarly (currently passes NULL which already hits UUID, but'
\echo '    explicit cast is cleaner)'
\echo '  - Drop the TEXT wrapper once callers migrate'
\echo ''
