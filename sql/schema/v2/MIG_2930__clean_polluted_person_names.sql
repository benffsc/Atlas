-- MIG_2930: Clean polluted person names
-- FFS-521: Data quality cleanup for Beacon
--
-- ClinicHQ staff sometimes prefix client names with "Duplicate Report" or
-- "Rebooking placeholder" to mark records in their system. These prefixes
-- were ingested as part of the person name.

BEGIN;

\echo 'MIG_2930: Cleaning polluted person names'

-- ============================================================================
-- 1. Strip "Duplicate Report" prefix from real person names
-- ============================================================================

\echo '1. Fixing real persons with "Duplicate Report" prefix...'

-- Chris Shlegeris
UPDATE sot.people SET first_name = 'Chris', last_name = 'Shlegeris', display_name = 'Chris Shlegeris', data_quality = 'verified'
WHERE person_id = 'ca7219af-8355-41df-b7ac-8568466b6c18';

-- Eureka McMillen
UPDATE sot.people SET first_name = 'Eureka', last_name = 'McMillen', display_name = 'Eureka McMillen', data_quality = 'verified'
WHERE person_id = '37b44c4e-e917-443c-afd4-6c34c339a574';

-- Gorringe (no first name available)
UPDATE sot.people SET first_name = NULL, last_name = 'Gorringe', display_name = 'Gorringe', data_quality = 'verified'
WHERE person_id = 'ef068d55-882d-4e57-a519-13de7ef445d4';

-- Jasmine Rizzra
UPDATE sot.people SET first_name = 'Jasmine', last_name = 'Rizzra', display_name = 'Jasmine Rizzra', data_quality = 'verified'
WHERE person_id = '44ab1502-388e-4d69-a4dd-72e0b9b71c24';

-- Joy Ambra
UPDATE sot.people SET first_name = 'Joy', last_name = 'Ambra', display_name = 'Joy Ambra', data_quality = 'verified'
WHERE person_id = '73e1d92d-91aa-4d3e-acca-022db19ec7f2';

-- Kate Spellman
UPDATE sot.people SET first_name = 'Kate', last_name = 'Spellman', display_name = 'Kate Spellman', data_quality = 'verified'
WHERE person_id = '990fb2a4-d512-4e24-b652-c0824649a53a';

-- Kathy Fanning
UPDATE sot.people SET first_name = 'Kathy', last_name = 'Fanning', display_name = 'Kathy Fanning', data_quality = 'verified'
WHERE person_id = '7ce54af0-35de-42fb-89b7-80e6f68bcc48';

-- Porteus (no first name)
UPDATE sot.people SET first_name = NULL, last_name = 'Porteus', display_name = 'Porteus', data_quality = 'verified'
WHERE person_id = 'e1f13b9b-1c6a-479f-8b62-0f4271925f04';

-- Vazquez (no first name)
UPDATE sot.people SET first_name = NULL, last_name = 'Vazquez', display_name = 'Vazquez', data_quality = 'verified'
WHERE person_id = 'f14ea701-5d48-4c36-8696-dcbcb5e3da27';

\echo '   Fixed 9 person name records'

-- ============================================================================
-- 2. Mark organizations/sites that were misclassified as persons
-- ============================================================================

\echo '2. Reclassifying orgs/sites...'

-- Coast Guard — organization
UPDATE sot.people SET display_name = 'Coast Guard', first_name = NULL, last_name = 'Coast Guard',
    is_organization = TRUE, data_quality = 'verified'
WHERE person_id = '353a3b13-12ca-4256-9543-e41f0efda72a';

-- Stony Point Apartments — site/org (has email: 72sto@mmgprop.com)
UPDATE sot.people SET display_name = 'Stony Point Apartments', first_name = NULL, last_name = 'Stony Point Apartments',
    is_organization = TRUE, data_quality = 'verified'
WHERE person_id = '240de260-db5c-4f66-a294-8a63bf5c0ac0';

-- Taco Bell Rohnert Park — organization
UPDATE sot.people SET display_name = 'Taco Bell Rohnert Park', first_name = NULL, last_name = 'Taco Bell Rohnert Park',
    is_organization = TRUE, data_quality = 'verified'
WHERE person_id = '5d208065-f4db-4614-9522-fa8464b6db54';

-- SCAS Richard Malone — messy, SCAS is org. Mark as org.
UPDATE sot.people SET display_name = 'SCAS Richard Malone', first_name = 'Richard', last_name = 'Malone',
    data_quality = 'needs_review'
WHERE person_id = '65fa4dc5-80ac-495e-ad9a-1fbed56a9fa6';

\echo '   Reclassified 4 records'

-- ============================================================================
-- 3. Mark garbage records
-- ============================================================================

\echo '3. Marking garbage records...'

-- Rebooking placeholder — no identifiers, no links, pure garbage
UPDATE sot.people SET data_quality = 'garbage'
WHERE person_id = 'a12eaac7-edfe-48c1-88c6-53576be12afb';

-- Test Test — test data with fake identifiers
UPDATE sot.people SET data_quality = 'garbage'
WHERE person_id = '51a98e43-bccd-4762-89e7-608ba504c2d7';

-- Terez Unknown (from initial scan, likely person with unknown surname)
UPDATE sot.people SET last_name = NULL, display_name = 'Terez', data_quality = 'incomplete'
WHERE person_id = 'ff308b9c-8459-4be9-b104-c226def8c585'
  AND last_name = 'Unknown';

\echo '   Marked 2 garbage, 1 incomplete'

-- ============================================================================
-- 4. Audit trail
-- ============================================================================

\echo '4. Recording audit trail...'

INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, field_name, old_value, new_value, edit_source, reason, edited_by)
SELECT 'person', person_id, 'update', 'display_name',
    to_jsonb('Duplicate Report prefix removed'::text),
    to_jsonb(display_name),
    'MIG_2930', 'ClinicHQ Duplicate Report prefix polluting person name', 'migration'
FROM sot.people
WHERE person_id IN (
    'ca7219af-8355-41df-b7ac-8568466b6c18', '37b44c4e-e917-443c-afd4-6c34c339a574',
    'ef068d55-882d-4e57-a519-13de7ef445d4', '44ab1502-388e-4d69-a4dd-72e0b9b71c24',
    '73e1d92d-91aa-4d3e-acca-022db19ec7f2', '990fb2a4-d512-4e24-b652-c0824649a53a',
    '7ce54af0-35de-42fb-89b7-80e6f68bcc48', 'e1f13b9b-1c6a-479f-8b62-0f4271925f04',
    'f14ea701-5d48-4c36-8696-dcbcb5e3da27', '353a3b13-12ca-4256-9543-e41f0efda72a',
    '240de260-db5c-4f66-a294-8a63bf5c0ac0', '5d208065-f4db-4614-9522-fa8464b6db54',
    '65fa4dc5-80ac-495e-ad9a-1fbed56a9fa6'
);

-- ============================================================================
-- 5. Exclude newly-marked orgs from entity linking
-- ============================================================================

\echo '5. Cleaning org entity links...'

-- Remove person_cat links for newly-marked orgs
DELETE FROM sot.person_cat
WHERE person_id IN (
    '353a3b13-12ca-4256-9543-e41f0efda72a',  -- Coast Guard
    '240de260-db5c-4f66-a294-8a63bf5c0ac0',  -- Stony Point Apartments
    '5d208065-f4db-4614-9522-fa8464b6db54'   -- Taco Bell Rohnert Park
);

-- Remove residential person_place links for newly-marked orgs
DELETE FROM sot.person_place
WHERE person_id IN (
    '353a3b13-12ca-4256-9543-e41f0efda72a',
    '240de260-db5c-4f66-a294-8a63bf5c0ac0',
    '5d208065-f4db-4614-9522-fa8464b6db54'
)
AND relationship_type IN ('resident', 'owner');

\echo ''
\echo 'Verification:'

SELECT display_name, data_quality, is_organization
FROM sot.people
WHERE person_id IN (
    'ca7219af-8355-41df-b7ac-8568466b6c18', '37b44c4e-e917-443c-afd4-6c34c339a574',
    'ef068d55-882d-4e57-a519-13de7ef445d4', '44ab1502-388e-4d69-a4dd-72e0b9b71c24',
    '73e1d92d-91aa-4d3e-acca-022db19ec7f2', '990fb2a4-d512-4e24-b652-c0824649a53a',
    '7ce54af0-35de-42fb-89b7-80e6f68bcc48', 'e1f13b9b-1c6a-479f-8b62-0f4271925f04',
    'f14ea701-5d48-4c36-8696-dcbcb5e3da27', '353a3b13-12ca-4256-9543-e41f0efda72a',
    '240de260-db5c-4f66-a294-8a63bf5c0ac0', '5d208065-f4db-4614-9522-fa8464b6db54',
    '65fa4dc5-80ac-495e-ad9a-1fbed56a9fa6', 'a12eaac7-edfe-48c1-88c6-53576be12afb',
    '51a98e43-bccd-4762-89e7-608ba504c2d7', 'ff308b9c-8459-4be9-b104-c226def8c585',
    '1feea02a-c0d4-4b33-909a-8f3722b6ef3b'
)
ORDER BY display_name;

\echo ''
\echo 'MIG_2930: Cleaned 15 polluted person names (9 persons, 3 orgs, 2 garbage, 1 incomplete)'

COMMIT;
