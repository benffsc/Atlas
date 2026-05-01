-- MIG_3115: Field Contact Enrichment — referral attribution, completeness flag, constraint fix
--
-- Context: Dutton Ave case exposed gaps — staff captured 3 contacts from one call,
-- one had no last name, all were referred by Tom Kendrick. The DB constraint rejected
-- 'tenant'/'family_member'/'cat_owner' even though the form offers them.
--
-- Changes:
--   1. Add referred_by_person_id to ops.request_related_people
--   2. Add info_completeness enum column
--   3. Fix sot.person_place CHECK to include tenant, family_member, cat_owner
--
-- Fixes FFS-1422

BEGIN;

-- ============================================================================
-- 1. Add referral attribution to request_related_people
-- ============================================================================

\echo '1. Adding referred_by_person_id to ops.request_related_people...'

ALTER TABLE ops.request_related_people
  ADD COLUMN IF NOT EXISTS referred_by_person_id UUID REFERENCES sot.people(person_id);

CREATE INDEX IF NOT EXISTS idx_rrp_referred_by
  ON ops.request_related_people (referred_by_person_id)
  WHERE referred_by_person_id IS NOT NULL;

-- ============================================================================
-- 2. Add info_completeness column
-- ============================================================================

\echo '2. Adding info_completeness to ops.request_related_people...'

ALTER TABLE ops.request_related_people
  ADD COLUMN IF NOT EXISTS info_completeness TEXT NOT NULL DEFAULT 'full'
    CHECK (info_completeness IN ('full', 'partial', 'phone_only', 'name_only'));

-- ============================================================================
-- 3. Fix sot.person_place relationship_type CHECK — add tenant, family_member, cat_owner
-- ============================================================================

\echo '3. Expanding person_place relationship_type CHECK...'

ALTER TABLE sot.person_place
  DROP CONSTRAINT IF EXISTS person_place_relationship_type_check;

ALTER TABLE sot.person_place
  ADD CONSTRAINT person_place_relationship_type_check
  CHECK (relationship_type IN (
    'resident', 'property_owner', 'landlord', 'property_manager',
    'colony_caretaker', 'colony_supervisor', 'feeder',
    'transporter', 'referrer', 'neighbor', 'site_contact',
    'works_at', 'volunteers_at', 'contact_address',
    'owner', 'manager', 'caretaker', 'requester', 'trapper_at',
    'tenant', 'family_member', 'cat_owner'
  ));

-- ============================================================================
-- Verify
-- ============================================================================

\echo ''
\echo 'Verifying...'

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'request_related_people'
  AND column_name IN ('referred_by_person_id', 'info_completeness');

\echo 'MIG_3115 complete.'

COMMIT;
