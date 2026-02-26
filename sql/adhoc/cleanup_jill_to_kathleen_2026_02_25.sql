-- Cleanup Script: Jill Manning → Kathleen Sartori Owner Correction
-- Date: 2026-02-25
--
-- CONTEXT: Staff renamed ClinicHQ account from "Jill Manning" to "Kathleen Sartori"
-- because Jill was the referrer (daughter-in-law) and Kathleen is the actual resident.
--
-- PROBLEM: After import, both people will have person_cat relationships to the same 6 cats.
--
-- RUN THIS AFTER: Importing the February ClinicHQ export
-- RUN THIS BEFORE: Using Hand Off on the request
--
-- Usage: psql "$DATABASE_URL" -f sql/adhoc/cleanup_jill_to_kathleen_2026_02_25.sql

\echo ''
\echo '=============================================='
\echo '  Cleanup: Jill Manning → Kathleen Sartori'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. VERIFY KATHLEEN EXISTS (should exist after import)
-- ============================================================================

\echo '1. Checking if Kathleen Sartori was created...'

SELECT
    person_id,
    display_name,
    created_at::date
FROM sot.people
WHERE LOWER(display_name) LIKE '%kathleen%sartori%';

-- Verify phone
\echo ''
\echo '   Checking phone 7078782462...'
SELECT
    p.person_id,
    p.display_name,
    pi.id_value_norm as phone
FROM sot.person_identifiers pi
JOIN sot.people p ON p.person_id = pi.person_id
WHERE pi.id_value_norm = '7078782462';

-- ============================================================================
-- 2. VERIFY BOTH PEOPLE HAVE CAT RELATIONSHIPS (the duplicate state)
-- ============================================================================

\echo ''
\echo '2. Checking for duplicate ownership (should show both people)...'

SELECT
    p.display_name as owner,
    c.clinichq_animal_id,
    pc.relationship_type,
    pc.created_at::date
FROM sot.person_cat pc
JOIN sot.people p ON p.person_id = pc.person_id
JOIN sot.cats c ON c.cat_id = pc.cat_id
WHERE c.clinichq_animal_id IN ('26-601', '26-602', '26-609', '26-630', '26-634', '26-636')
ORDER BY c.clinichq_animal_id, pc.created_at;

-- ============================================================================
-- 3. DELETE JILL'S PERSON_CAT RELATIONSHIPS (the cleanup)
-- ============================================================================

\echo ''
\echo '3. Deleting old person_cat relationships for Jill Manning...'

-- First, show what will be deleted
SELECT
    'WILL DELETE' as action,
    c.clinichq_animal_id,
    p.display_name as from_person
FROM sot.person_cat pc
JOIN sot.people p ON p.person_id = pc.person_id
JOIN sot.cats c ON c.cat_id = pc.cat_id
WHERE pc.person_id = '4e815b2c-0d1b-4e84-949d-fac256697519'  -- Jill Manning
  AND c.clinichq_animal_id IN ('26-601', '26-602', '26-609', '26-630', '26-634', '26-636');

-- Actually delete
DELETE FROM sot.person_cat
WHERE person_id = '4e815b2c-0d1b-4e84-949d-fac256697519'  -- Jill Manning
  AND cat_id IN (
    '53779aa0-8bb3-4508-b47a-cb01a81a3d98',  -- 26-630
    'e9e74d61-5e11-47c5-bdab-c1cdbe661bb7',  -- 26-636
    '580a27d5-ea1f-482c-9c77-8851d98b3953',  -- 26-634
    '88c5a61d-91be-4470-880a-dd0d1a53892d',  -- 26-609
    '9deea0e2-6976-4fd3-b36e-61e39fa9dab8',  -- 26-601
    '02ba9c84-b159-471d-abe4-124f078faee3'   -- 26-602
  );

\echo ''
\echo '   Deleted old relationships.'

-- ============================================================================
-- 4. VERIFY CLEANUP
-- ============================================================================

\echo ''
\echo '4. Verifying cleanup (should only show Kathleen now)...'

SELECT
    p.display_name as owner,
    c.clinichq_animal_id,
    pc.relationship_type
FROM sot.person_cat pc
JOIN sot.people p ON p.person_id = pc.person_id
JOIN sot.cats c ON c.cat_id = pc.cat_id
WHERE c.clinichq_animal_id IN ('26-601', '26-602', '26-609', '26-630', '26-634', '26-636')
ORDER BY c.clinichq_animal_id;

-- ============================================================================
-- 5. LOG THE CHANGE
-- ============================================================================

\echo ''
\echo '5. Logging audit trail...'

INSERT INTO sot.entity_edits (
    entity_type,
    entity_id,
    edit_type,
    field_name,
    old_value,
    new_value,
    reason,
    edit_source,
    edited_by
)
SELECT
    'person_cat',
    c.cat_id,
    'delete',
    'person_id',
    '"4e815b2c-0d1b-4e84-949d-fac256697519"',  -- Jill's ID
    'null',
    'RISK_006: Owner correction in ClinicHQ. Jill Manning was referrer, not actual resident. Kathleen Sartori is the actual caretaker.',
    'adhoc_script',
    'cleanup_jill_to_kathleen_2026_02_25.sql'
FROM sot.cats c
WHERE c.clinichq_animal_id IN ('26-601', '26-602', '26-609', '26-630', '26-634', '26-636');

\echo ''
\echo '=============================================='
\echo '  Cleanup Complete'
\echo '=============================================='
\echo ''
\echo 'NEXT STEPS:'
\echo '  1. Use Hand Off on request e699d432-e9f1-4034-b2c9-29e5584b92ff'
\echo '  2. Transfer from Jill Manning to Kathleen Sartori'
\echo '  3. Reason: "Original caller was daughter-in-law, not actual resident"'
\echo ''
\echo 'NOTE: Jill Manning record is preserved (she may call again in future).'
\echo '      Only the cat ownership links were removed.'
\echo ''
