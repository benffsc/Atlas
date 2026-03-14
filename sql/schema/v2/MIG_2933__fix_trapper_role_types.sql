-- MIG_2933: Fix trapper tier misclassification in person_roles
-- FFS-535: person_roles.trapper_type drifted from trapper_profiles.trapper_type
--
-- Root cause: MIG_2923 fixed trapper_profiles but never synced person_roles.
-- MIG_2924 added roles with NULL trapper_type.
--
-- Rule: Tier 1 (ffsc_trapper) = VolunteerHub "Approved Trappers" ONLY.
--       Tier 2 (community_trapper) = Airtable contracts.
--       Tier 3 (community_trapper + is_legacy_informal) = Data patterns.

\echo '=== MIG_2933: Fix trapper role types ==='

-- Step 0: Before snapshot
\echo ''
\echo 'BEFORE — person_roles.trapper_type distribution:'
SELECT trapper_type, role_status, COUNT(*)
FROM sot.person_roles
WHERE role = 'trapper'
GROUP BY trapper_type, role_status
ORDER BY trapper_type NULLS LAST, role_status;

-- Step 1: Sync person_roles.trapper_type from trapper_profiles for ALL mismatches.
-- trapper_profiles uses 'ffsc_volunteer' → map to 'ffsc_trapper' in person_roles.
-- trapper_profiles uses 'community_trapper' → keep as 'community_trapper'.
\echo ''
\echo 'Step 1: Syncing person_roles.trapper_type from trapper_profiles...'

WITH updates AS (
  UPDATE sot.person_roles pr
  SET trapper_type = CASE
    WHEN tp.trapper_type IN ('ffsc_staff', 'ffsc_volunteer') THEN 'ffsc_trapper'
    ELSE tp.trapper_type
  END,
  updated_at = NOW()
  FROM sot.trapper_profiles tp
  WHERE tp.person_id = pr.person_id
    AND pr.role = 'trapper'
    AND (
      pr.trapper_type IS NULL
      OR pr.trapper_type != CASE
        WHEN tp.trapper_type IN ('ffsc_staff', 'ffsc_volunteer') THEN 'ffsc_trapper'
        ELSE tp.trapper_type
      END
    )
  RETURNING pr.person_id, pr.trapper_type AS new_type
)
SELECT COUNT(*) AS roles_updated FROM updates;

-- Step 2: Any remaining NULL trapper_type without a profile → default to community_trapper
\echo ''
\echo 'Step 2: Defaulting remaining NULL types to community_trapper...'

WITH defaults AS (
  UPDATE sot.person_roles
  SET trapper_type = 'community_trapper', updated_at = NOW()
  WHERE role = 'trapper'
    AND trapper_type IS NULL
  RETURNING person_id
)
SELECT COUNT(*) AS defaulted FROM defaults;

-- Step 3: Add trigger to keep person_roles.trapper_type in sync with trapper_profiles
-- This prevents future drift.
\echo ''
\echo 'Step 3: Creating sync trigger to prevent future drift...'

CREATE OR REPLACE FUNCTION sot.sync_trapper_type_to_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_mapped_type TEXT;
BEGIN
  -- Map profile types to role types
  v_mapped_type := CASE
    WHEN NEW.trapper_type IN ('ffsc_staff', 'ffsc_volunteer') THEN 'ffsc_trapper'
    ELSE NEW.trapper_type
  END;

  UPDATE sot.person_roles
  SET trapper_type = v_mapped_type, updated_at = NOW()
  WHERE person_id = NEW.person_id
    AND role = 'trapper'
    AND (trapper_type IS DISTINCT FROM v_mapped_type);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_trapper_type ON sot.trapper_profiles;
CREATE TRIGGER trg_sync_trapper_type
  AFTER INSERT OR UPDATE OF trapper_type ON sot.trapper_profiles
  FOR EACH ROW
  EXECUTE FUNCTION sot.sync_trapper_type_to_role();

COMMENT ON FUNCTION sot.sync_trapper_type_to_role IS
'Keeps person_roles.trapper_type in sync when trapper_profiles.trapper_type changes.
Maps ffsc_staff/ffsc_volunteer → ffsc_trapper. Prevents the MIG_2923 drift bug (FFS-535).';

-- Step 4: After snapshot
\echo ''
\echo 'AFTER — person_roles.trapper_type distribution:'
SELECT trapper_type, role_status, COUNT(*)
FROM sot.person_roles
WHERE role = 'trapper'
GROUP BY trapper_type, role_status
ORDER BY trapper_type NULLS LAST, role_status;

-- Step 5: Verify no mismatches remain
\echo ''
\echo 'Verification — mismatches between roles and profiles (should be 0):'
SELECT COUNT(*) AS mismatches
FROM sot.person_roles pr
JOIN sot.trapper_profiles tp ON tp.person_id = pr.person_id
WHERE pr.role = 'trapper'
  AND pr.trapper_type != CASE
    WHEN tp.trapper_type IN ('ffsc_staff', 'ffsc_volunteer') THEN 'ffsc_trapper'
    ELSE tp.trapper_type
  END;

\echo ''
\echo '=== MIG_2933 complete ==='
\echo 'Created trigger trg_sync_trapper_type on sot.trapper_profiles'
\echo 'to prevent future drift between profiles and roles.'
