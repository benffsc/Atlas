-- MIG_2913: Fix Misidentified Trappers
-- Date: 2026-03-12
-- Issue: FFS-470
--
-- Five people in the trapper list with wrong identities or who shouldn't be there.
-- Discovered during FFS-469 trapper management audit.
--
-- Cases:
--   1. Susan Rose (f8d88cc0) → Actually Sharon Conley (Airtable email match sjcon1951@yahoo.com)
--      Merge phone-only Sharon (8515374c) into renamed record.
--   2. Ernie Lockner (cd5b3937) → Client at Michelle Gleed's Cazadero site, NOT a trapper.
--      Michelle (f559d5d7) is the actual trapper. Transfer trapper designation.
--   3. Caitlin Moneypenny-Johnston (b5536821) → ClinicHQ client with incorrect VH roles
--   4. Pam Jones (76bb53ff) → ClinicHQ client with incorrect VH roles
--   5. James Young (e1cc2a09) → ClinicHQ client with incorrect VH roles
--
-- Cases 3-5: All have staff/coordinator + volunteer roles from volunteerhub but
-- DO NOT appear in VH raw data (0 matches by email or phone). Incorrectly assigned
-- during backfill. They are regular ClinicHQ clients.

\echo ''
\echo '=============================================='
\echo '  MIG_2913: Fix Misidentified Trappers'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================
-- CASE 1: Susan Rose → Sharon Conley (rename + merge)
-- ============================================================
-- f8d88cc0 "Susan Rose" has email sjcon1951@yahoo.com (= S.J. Conley 1951)
-- 8515374c "Sharon Conley" has phone 7072924271 only
-- Both are clinichq-sourced. Winner keeps email + phone after merge.
-- ============================================================

\echo 'CASE 1: Susan Rose → Sharon Conley'

-- Step 1a: Rename Susan Rose to Sharon Conley
UPDATE sot.people
SET display_name = 'Sharon Conley',
    first_name = 'Sharon',
    last_name = 'Conley',
    updated_at = NOW()
WHERE person_id = 'f8d88cc0-b7e1-4b2f-8d20-caf6ed3aab45'
  AND display_name = 'Susan Rose';

-- Step 1b: Log the rename
INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
VALUES
  ('person', 'f8d88cc0-b7e1-4b2f-8d20-caf6ed3aab45', 'display_name',
   'Susan Rose', 'Sharon Conley', 'MIG_2913'),
  ('person', 'f8d88cc0-b7e1-4b2f-8d20-caf6ed3aab45', 'first_name',
   'Susan', 'Sharon', 'MIG_2913'),
  ('person', 'f8d88cc0-b7e1-4b2f-8d20-caf6ed3aab45', 'last_name',
   'Rose', 'Conley', 'MIG_2913');

-- Step 1c: Merge phone-only Sharon (loser) into renamed record (winner)
-- No trapper_profiles, trapper_service_places, or roles on loser — clean merge
SELECT sot.merge_person_into(
  '8515374c-8ad4-4399-92f5-27b580ae5fbe',  -- loser: phone-only Sharon Conley
  'f8d88cc0-b7e1-4b2f-8d20-caf6ed3aab45',  -- winner: renamed Sharon Conley (was Susan Rose)
  'MIG_2913/FFS-470: Susan Rose was actually Sharon Conley (sjcon1951@yahoo.com). Merge phone-only duplicate.',
  'MIG_2913'
);

\echo '  ✓ Susan Rose renamed to Sharon Conley, phone-only duplicate merged'

-- ============================================================
-- CASE 2: Ernie Lockner → Client, not trapper. Michelle Gleed is the trapper.
-- ============================================================
-- cd5b3937 "Ernie Lockner" — email mgpurple@aol.com (Michelle Gleed's email),
--   phone 7076325767. 36 appointments, 40 cats. trapper_at Cazadero.
--   Has ffsc_trapper role + trapper_profile but NOT in VH.
-- f559d5d7 "Michelle Gleed" — phone 7078881253 only. Long-time FFSC volunteer.
--   Resident at same Cazadero address. No roles currently.
--
-- Michelle booked ClinicHQ appointments for Ernie's site using her email.
-- Ernie is the site client. Michelle is the actual trapper.
-- ============================================================

\echo 'CASE 2: Ernie Lockner → client; Michelle Gleed → trapper'

-- Step 2a: Remove Ernie's incorrect trapper roles (not in VH)
DELETE FROM sot.person_roles
WHERE person_id = 'cd5b3937-59cb-467f-8f82-f7aff5b5d220'
  AND role IN ('trapper', 'volunteer');

INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
VALUES
  ('person', 'cd5b3937-59cb-467f-8f82-f7aff5b5d220', 'person_roles',
   'trapper/ffsc_trapper (volunteerhub), volunteer (volunteerhub)',
   'removed — not in VH, is site client not trapper',
   'MIG_2913');

-- Step 2b: Remove Ernie's trapper_profile
DELETE FROM sot.trapper_profiles
WHERE person_id = 'cd5b3937-59cb-467f-8f82-f7aff5b5d220';

INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
VALUES
  ('person', 'cd5b3937-59cb-467f-8f82-f7aff5b5d220', 'trapper_profile',
   'ffsc_volunteer, active',
   'removed — site client, not trapper',
   'MIG_2913');

-- Step 2c: Transfer email from Ernie to Michelle (mgpurple@aol.com is Michelle's email)
-- Unique constraint on (id_type, id_value_norm) means we must delete first, then insert
DELETE FROM sot.person_identifiers
WHERE person_id = 'cd5b3937-59cb-467f-8f82-f7aff5b5d220'
  AND id_type = 'email'
  AND id_value_norm = 'mgpurple@aol.com';

INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
VALUES
  ('person', 'cd5b3937-59cb-467f-8f82-f7aff5b5d220', 'email',
   'mgpurple@aol.com (confidence 1.0)',
   'removed — email belongs to Michelle Gleed, transferred to her record',
   'MIG_2913');

-- Step 2d: Change Ernie's person_place from trapper_at to resident
UPDATE sot.person_place
SET relationship_type = 'resident'
WHERE person_id = 'cd5b3937-59cb-467f-8f82-f7aff5b5d220'
  AND relationship_type = 'trapper_at';

-- Step 2e: Transfer trapper_service_places from Ernie to Michelle
UPDATE sot.trapper_service_places
SET person_id = 'f559d5d7-53a4-44ef-8127-71a80eeaf9ba'
WHERE person_id = 'cd5b3937-59cb-467f-8f82-f7aff5b5d220'
  AND NOT EXISTS (
    SELECT 1 FROM sot.trapper_service_places tsp2
    WHERE tsp2.person_id = 'f559d5d7-53a4-44ef-8127-71a80eeaf9ba'
      AND tsp2.place_id = trapper_service_places.place_id
  );
-- Delete any remaining (conflict with Michelle's existing entries)
DELETE FROM sot.trapper_service_places
WHERE person_id = 'cd5b3937-59cb-467f-8f82-f7aff5b5d220';

-- Step 2f: Give Michelle Gleed trapper role + profile (Tier 3 — legacy informal)
INSERT INTO sot.person_roles (person_id, role, trapper_type, role_status, source_system, notes)
VALUES (
  'f559d5d7-53a4-44ef-8127-71a80eeaf9ba',
  'trapper',
  'community_trapper',
  'active',
  'atlas_ui',
  'MIG_2913/FFS-470: Long-time FFSC volunteer, trapper at Cazadero site. Not in VH. Transferred from Ernie Lockner misattribution.'
)
ON CONFLICT (person_id, role) DO UPDATE
SET trapper_type = 'community_trapper',
    role_status = 'active',
    notes = EXCLUDED.notes;

INSERT INTO sot.trapper_profiles (person_id, trapper_type, is_active, is_legacy_informal, has_signed_contract, source_system, notes)
VALUES (
  'f559d5d7-53a4-44ef-8127-71a80eeaf9ba',
  'community_trapper',
  TRUE,
  TRUE,
  FALSE,
  'atlas_ui',
  'MIG_2913/FFS-470: Long-time FFSC volunteer. Transferred from Ernie Lockner (cd5b3937) who was the site client, not the trapper.'
)
ON CONFLICT (person_id) DO UPDATE
SET trapper_type = 'community_trapper',
    is_active = TRUE,
    is_legacy_informal = TRUE,
    notes = EXCLUDED.notes;

-- Step 2g: Add mgpurple@aol.com to Michelle with high confidence (it's her email)
INSERT INTO sot.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
VALUES (
  'f559d5d7-53a4-44ef-8127-71a80eeaf9ba',
  'email',
  'mgpurple@aol.com',
  'mgpurple@aol.com',
  1.0,
  'atlas_ui'
)
ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING;

INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
VALUES
  ('person', 'f559d5d7-53a4-44ef-8127-71a80eeaf9ba', 'trapper_designation',
   'none',
   'community_trapper (Tier 3, legacy informal). Transferred from Ernie Lockner misattribution.',
   'MIG_2913');

\echo '  ✓ Ernie Lockner: trapper roles removed, reclassified as site client'
\echo '  ✓ Michelle Gleed: trapper designation transferred, email restored'

-- ============================================================
-- CASES 3-5: Remove incorrect VH roles
-- ============================================================
-- Caitlin Moneypenny-Johnston (b5536821), Pam Jones (76bb53ff),
-- James Young (e1cc2a09) — all ClinicHQ clients with staff/coordinator
-- + volunteer roles from volunteerhub. None appear in VH raw data.
-- ============================================================

\echo 'CASES 3-5: Remove incorrect VH roles'

-- Step 3a: Delete incorrect person_roles for all three
DELETE FROM sot.person_roles
WHERE person_id IN (
  'b5536821-3e72-4e9d-b4c3-660b74e13d7c',  -- Caitlin Moneypenny-Johnston
  '76bb53ff-23ea-463e-9c7b-76ab34538b86',  -- Pam Jones
  'e1cc2a09-bd93-4707-aa8a-e79bd124bb66'   -- James Young
);

-- Step 3b: Log removals
INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, change_source)
VALUES
  ('person', 'b5536821-3e72-4e9d-b4c3-660b74e13d7c', 'person_roles',
   'staff/coordinator (volunteerhub), volunteer (volunteerhub)',
   'removed — ClinicHQ client, not in VH raw data',
   'MIG_2913'),
  ('person', '76bb53ff-23ea-463e-9c7b-76ab34538b86', 'person_roles',
   'staff/coordinator (volunteerhub), volunteer (volunteerhub)',
   'removed — ClinicHQ client, not in VH raw data',
   'MIG_2913'),
  ('person', 'e1cc2a09-bd93-4707-aa8a-e79bd124bb66', 'person_roles',
   'staff/coordinator (volunteerhub), volunteer (volunteerhub)',
   'removed — ClinicHQ client, not in VH raw data',
   'MIG_2913');

\echo '  ✓ Caitlin Moneypenny-Johnston: incorrect VH roles removed'
\echo '  ✓ Pam Jones: incorrect VH roles removed'
\echo '  ✓ James Young: incorrect VH roles removed'

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo '--- Verification ---'
\echo ''

-- 1. Sharon Conley should appear once with email + phone
\echo 'Sharon Conley (should be 1 active record with email + phone):'
SELECT p.person_id, p.display_name, p.merged_into_person_id,
  (SELECT string_agg(pi.id_type || '=' || pi.id_value_raw, ', ') FROM sot.person_identifiers pi WHERE pi.person_id = p.person_id) as identifiers,
  (SELECT COUNT(*) FROM ops.appointments a WHERE a.person_id = p.person_id) as appts,
  (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cats
FROM sot.people p
WHERE (p.first_name ILIKE 'sharon' AND p.last_name ILIKE 'conley')
   OR (p.first_name ILIKE 'susan' AND p.last_name ILIKE 'rose')
ORDER BY p.merged_into_person_id NULLS FIRST;

-- 2. Susan Rose should NOT appear in trapper list
\echo ''
\echo 'Susan Rose in trapper view (should be 0 rows):'
SELECT * FROM ops.v_trapper_full_stats WHERE display_name ILIKE '%susan%rose%';

-- 3. Ernie Lockner should NOT be a trapper
\echo ''
\echo 'Ernie Lockner roles (should be 0 rows):'
SELECT pr.role, pr.trapper_type FROM sot.person_roles pr WHERE pr.person_id = 'cd5b3937-59cb-467f-8f82-f7aff5b5d220';

\echo ''
\echo 'Ernie Lockner in trapper view (should be 0 rows):'
SELECT person_id, display_name FROM ops.v_trapper_full_stats WHERE display_name ILIKE '%lockner%';

-- 4. Michelle Gleed should now be a trapper
\echo ''
\echo 'Michelle Gleed (should have trapper role + service places):'
SELECT p.display_name,
  (SELECT string_agg(pr.role || '/' || COALESCE(pr.trapper_type, '-'), ', ') FROM sot.person_roles pr WHERE pr.person_id = p.person_id) as roles,
  (SELECT COUNT(*) FROM sot.trapper_service_places tsp WHERE tsp.person_id = p.person_id) as service_places
FROM sot.people p WHERE p.person_id = 'f559d5d7-53a4-44ef-8127-71a80eeaf9ba';

-- 5. Cases 3-5 should NOT be in trapper view
\echo ''
\echo 'Caitlin/Pam/James in trapper view (should be 0 rows):'
SELECT person_id, display_name FROM ops.v_trapper_full_stats
WHERE person_id IN (
  'b5536821-3e72-4e9d-b4c3-660b74e13d7c',
  '76bb53ff-23ea-463e-9c7b-76ab34538b86',
  'e1cc2a09-bd93-4707-aa8a-e79bd124bb66'
);

-- 6. Audit trail
\echo ''
\echo 'MIG_2913 audit trail:'
SELECT entity_type, entity_id, field_name, change_source, changed_at::date
FROM ops.entity_edits
WHERE change_source = 'MIG_2913'
ORDER BY changed_at;

\echo ''
\echo '=============================================='
\echo '  MIG_2913: Complete'
\echo '=============================================='
\echo ''
