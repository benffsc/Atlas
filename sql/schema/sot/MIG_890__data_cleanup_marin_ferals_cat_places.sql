-- ============================================================================
-- MIG_890: Data Cleanup - Marin Ferals Identity Collision + Cat Place Pollution
-- ============================================================================
-- Fixes existing bad data produced by the root causes addressed in MIG_888/889:
-- - Carlos Lopez has 13 orphan duplicates (shared email collision)
-- - Jeanie Garcia has 4 duplicates
-- - Cat 981020053817972 wrong caretaker (Jeanie Garcia → Carlos Lopez)
-- - Cat 981020053837292 linked to 4 wrong places
-- - Duplicate 6930 Commerce Blvd places
-- - Itzel Martinez wrong person_place links
-- - Silveira Ranch missing house number (5403 San Antonio Rd)
-- ============================================================================

\echo '=== MIG_890: Data Cleanup - Marin Ferals + Cat Places ==='

-- ============================================================================
-- Phase 1: Merge Carlos Lopez duplicates (13 → 1)
-- ============================================================================

\echo ''
\echo 'Phase 1: Merging Carlos Lopez duplicates...'

DO $$
DECLARE
    v_canonical UUID := '2a6d16a6-6ed6-49f7-a94b-fea96eed1793';
    v_dup UUID;
    v_count INT := 0;
BEGIN
    FOR v_dup IN
        SELECT person_id FROM trapper.sot_people
        WHERE display_name ILIKE '%Carlos Lopez%'
          AND merged_into_person_id IS NULL
          AND person_id != v_canonical
    LOOP
        PERFORM trapper.merge_people(v_canonical, v_dup);
        v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'Merged % Carlos Lopez duplicates into canonical %', v_count, v_canonical;
END $$;

-- ============================================================================
-- Phase 2: Merge Jeanie Garcia duplicates (4 → 1)
-- ============================================================================

\echo ''
\echo 'Phase 2: Merging Jeanie Garcia duplicates...'

DO $$
DECLARE
    v_canonical UUID := '656b3dd9-1e09-4cb6-aa0c-f6f31f5a4473';
    v_dup UUID;
    v_count INT := 0;
BEGIN
    FOR v_dup IN
        SELECT person_id FROM trapper.sot_people
        WHERE display_name ILIKE '%Jeanie Garcia%'
          AND merged_into_person_id IS NULL
          AND person_id != v_canonical
    LOOP
        PERFORM trapper.merge_people(v_canonical, v_dup);
        v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'Merged % Jeanie Garcia duplicates into canonical %', v_count, v_canonical;
END $$;

-- ============================================================================
-- Phase 3: Seed Carlos Lopez phone identifier
-- All 13 duplicates had zero identifiers (orphan pattern from shared email).
-- Phone 7074799459 is in ClinicHQ exports. Confidence 0.5 since shared/soft-blacklisted.
-- Re-upload via UI will reinforce this naturally via Data Engine.
-- ============================================================================

\echo ''
\echo 'Phase 3: Seeding Carlos Lopez phone identifier...'

INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
VALUES ('2a6d16a6-6ed6-49f7-a94b-fea96eed1793', 'phone', '7074799459', '7074799459', 0.5, 'clinichq')
ON CONFLICT DO NOTHING;

-- Audit trail
INSERT INTO trapper.entity_edits (entity_type, entity_id, edit_type, field_name, new_value, reason, edited_by)
VALUES (
    'person', '2a6d16a6-6ed6-49f7-a94b-fea96eed1793',
    'field_update', 'person_identifiers',
    '"phone:7074799459 (confidence 0.5)"'::jsonb,
    'Bootstrap seed: Carlos Lopez had zero identifiers due to shared email orphan pattern. Phone from ClinicHQ export. Confidence 0.5 (shared org phone, soft-blacklisted).',
    'staff:mig_890'
);

-- ============================================================================
-- Phase 4: Fix cat 981020053817972 → Carlos Lopez
-- Currently linked to Jeanie Garcia due to shared email identity collision
-- ============================================================================

\echo ''
\echo 'Phase 4: Fixing cat 981020053817972 caretaker to Carlos Lopez...'

-- Update person_cat_relationships
UPDATE trapper.person_cat_relationships
SET person_id = '2a6d16a6-6ed6-49f7-a94b-fea96eed1793'
WHERE cat_id = '59f6c186-2b36-497e-9cf0-a4019b2883ee'
  AND person_id = '656b3dd9-1e09-4cb6-aa0c-f6f31f5a4473';

-- Update appointment 26-483
UPDATE trapper.sot_appointments
SET person_id = '2a6d16a6-6ed6-49f7-a94b-fea96eed1793'
WHERE appointment_number = '26-483';

-- Audit trail
INSERT INTO trapper.entity_edits (entity_type, entity_id, edit_type, field_name, old_value, new_value, reason, edited_by)
VALUES (
    'cat', '59f6c186-2b36-497e-9cf0-a4019b2883ee',
    'field_update', 'caretaker_person_id',
    '"656b3dd9-1e09-4cb6-aa0c-f6f31f5a4473"'::jsonb,
    '"2a6d16a6-6ed6-49f7-a94b-fea96eed1793"'::jsonb,
    'Cat 981020053817972 was linked to Jeanie Garcia via shared org email marinferals@yahoo.com. Actual caretaker is Carlos Lopez per ClinicHQ appointment 26-483.',
    'staff:mig_890'
);

-- ============================================================================
-- Phase 5: Fix cat 981020053837292 place links (4 → 1 correct)
-- Should only be at 6930 Commerce Blvd, Rohnert Park
-- ============================================================================

\echo ''
\echo 'Phase 5: Fixing cat 981020053837292 place links...'

DELETE FROM trapper.cat_place_relationships
WHERE cat_id = 'cd06eaea-bc49-4dba-9c4e-fae3f006fe31'
  AND place_id NOT IN ('c50086bc-d79c-46df-85f9-16737ce1e4b2');

INSERT INTO trapper.entity_edits (entity_type, entity_id, edit_type, field_name, new_value, reason, edited_by)
VALUES (
    'cat', 'cd06eaea-bc49-4dba-9c4e-fae3f006fe31',
    'field_update', 'cat_place_relationships',
    '"kept only c50086bc (6930 Commerce Blvd, Rohnert Park)"'::jsonb,
    'Removed wrong place links caused by link_cats_to_places() linking to ALL person_place_relationships. Cat should only be at 6930 Commerce Blvd.',
    'staff:mig_890'
);

-- ============================================================================
-- Phase 6: Merge duplicate 6930 Commerce Blvd places
-- ============================================================================

\echo ''
\echo 'Phase 6: Merging duplicate 6930 Commerce Blvd places...'

-- Only merge if the duplicate places exist and aren't already merged
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = '03b3bd19-3363-42d5-90b8-a2fe93f71faa' AND merged_into_place_id IS NULL) THEN
        PERFORM trapper.merge_places('c50086bc-d79c-46df-85f9-16737ce1e4b2', '03b3bd19-3363-42d5-90b8-a2fe93f71faa');
        RAISE NOTICE 'Merged 03b3bd19 into c50086bc';
    END IF;

    IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = 'bf6febf2-28d1-46d4-8012-7580d297b04d' AND merged_into_place_id IS NULL) THEN
        PERFORM trapper.merge_places('c50086bc-d79c-46df-85f9-16737ce1e4b2', 'bf6febf2-28d1-46d4-8012-7580d297b04d');
        RAISE NOTICE 'Merged bf6febf2 into c50086bc';
    END IF;
END $$;

-- ============================================================================
-- Phase 7: Remove Itzel Martinez's wrong person_place links
-- ============================================================================

\echo ''
\echo 'Phase 7: Removing Itzel Martinez wrong person_place links...'

DELETE FROM trapper.person_place_relationships
WHERE person_id = 'c5c9ae53-f6b7-49f7-bfde-c8ae3cbef41c'
  AND place_id IN (
    '842a0246-5b87-49df-b610-cc5d813cbc0d',  -- Santa Alicia Dr
    '73324d25-5804-41c1-bf57-b6cd8031ef57'   -- 5930 Commerce Blvd (wrong number)
  );

-- ============================================================================
-- Phase 8: Merge Silveira Ranch (missing house number) into correct place
-- ClinicHQ stores "5403 San Antonio Road Petaluma" in Owner First Name field,
-- not in the Owner Address field. The physical address field only has
-- "San Antonio Rd , Petaluma, CA 94952" without the house number.
-- A correct place already exists: 29715880-1c94-42f1-bc1f-908a1e60fa41
-- ============================================================================

\echo ''
\echo 'Phase 8: Merging Silveira Ranch into correct address...'

DO $$
BEGIN
    -- Only merge if old place exists and isn't already merged
    IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = '67893810-25db-46c7-941d-4e850307361e' AND merged_into_place_id IS NULL) THEN
        PERFORM trapper.merge_places(
            '29715880-1c94-42f1-bc1f-908a1e60fa41',  -- canonical (has 5403 San Antonio Rd)
            '67893810-25db-46c7-941d-4e850307361e'   -- duplicate (missing house number)
        );
        RAISE NOTICE 'Merged Silveira Ranch (missing house number) into correct place';
    END IF;
END $$;

INSERT INTO trapper.entity_edits (entity_type, entity_id, edit_type, field_name, old_value, new_value, reason, edited_by)
VALUES (
    'place', '67893810-25db-46c7-941d-4e850307361e',
    'merge', 'merged_into_place_id',
    NULL,
    '"29715880-1c94-42f1-bc1f-908a1e60fa41"'::jsonb,
    'Silveira Ranch was missing house number (San Antonio Rd → 5403 San Antonio Rd). Merged into correct geocoded place.',
    'staff:mig_890'
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- Phase 9: Merge duplicate 2384 Stony Point Rd places
-- Three duplicates with different zip codes / normalizations
-- ============================================================================

\echo ''
\echo 'Phase 9: Merging duplicate 2384 Stony Point Rd places...'

DO $$
BEGIN
    -- Canonical: 4a812efe (Google geocoded, 95407)
    IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = 'faecd07f-3302-4931-9d4e-cfa3602c8508' AND merged_into_place_id IS NULL) THEN
        PERFORM trapper.merge_places('4a812efe-2c7b-458e-8520-3b879d811425', 'faecd07f-3302-4931-9d4e-cfa3602c8508');
        RAISE NOTICE 'Merged faecd07f into 4a812efe (2384 Stony Point Rd)';
    END IF;

    IF EXISTS (SELECT 1 FROM trapper.places WHERE place_id = 'fe96e238-786f-4195-9026-5ccac3a41941' AND merged_into_place_id IS NULL) THEN
        PERFORM trapper.merge_places('4a812efe-2c7b-458e-8520-3b879d811425', 'fe96e238-786f-4195-9026-5ccac3a41941');
        RAISE NOTICE 'Merged fe96e238 into 4a812efe (2384 Stony Point Rd)';
    END IF;
END $$;

-- ============================================================================
-- Phase 10: Fix cat 981020053843023 place links (6 → 1 at Stony Point Rd)
-- Cat is from "Old Stony Point Rd" colony site, booked under Cassie Thomson's email.
-- link_cats_to_places() linked to ALL of Cassie's addresses (Silver Spur, Taylor Ave).
-- ============================================================================

\echo ''
\echo 'Phase 10: Fixing cat 981020053843023 place links...'

-- Keep only the Stony Point Rd canonical place
DELETE FROM trapper.cat_place_relationships
WHERE cat_id = '3d99e11d-9c8c-42d2-9829-777748a3259d'
  AND place_id NOT IN ('4a812efe-2c7b-458e-8520-3b879d811425');

-- Fix inferred_place_id on appointment 26-463 to Stony Point Rd (not Silver Spur)
UPDATE trapper.sot_appointments
SET inferred_place_id = '4a812efe-2c7b-458e-8520-3b879d811425',
    inferred_place_source = 'booking_address'
WHERE appointment_number = '26-463';

INSERT INTO trapper.entity_edits (entity_type, entity_id, edit_type, field_name, new_value, reason, edited_by)
VALUES (
    'cat', '3d99e11d-9c8c-42d2-9829-777748a3259d',
    'field_update', 'cat_place_relationships',
    '"kept only 4a812efe (2384 Stony Point Rd, Santa Rosa)"'::jsonb,
    'Cat booked under "Old Stony Point Rd" colony site. link_cats_to_places() linked to all of Cassie Thomson addresses (Silver Spur, Taylor Ave). Correct place is 2384 Stony Point Rd.',
    'staff:mig_890'
);

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_890 Complete!'
\echo '=============================================='
\echo ''
\echo 'Phase 1: Merged Carlos Lopez duplicates (13 → 1)'
\echo 'Phase 2: Merged Jeanie Garcia duplicates (4 → 1)'
\echo 'Phase 3: Seeded Carlos Lopez phone identifier (7074799459)'
\echo 'Phase 4: Fixed cat 981020053817972 caretaker (Jeanie Garcia → Carlos Lopez)'
\echo 'Phase 5: Fixed cat 981020053837292 place links (4 → 1 at 6930 Commerce Blvd)'
\echo 'Phase 6: Merged duplicate 6930 Commerce Blvd places'
\echo 'Phase 7: Removed Itzel Martinez wrong person_place links'
\echo 'Phase 8: Merged Silveira Ranch into correct place (5403 San Antonio Rd)'
\echo 'Phase 9: Merged duplicate 2384 Stony Point Rd places'
\echo 'Phase 10: Fixed cat 981020053843023 place links (Stony Point Rd, not Silver Spur)'
