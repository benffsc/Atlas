-- MIG_2822: Reclassify Business-Name Person Records
--
-- PREREQUISITE: MIG_2821 must be applied first (expanded keywords + classification)
--
-- ROOT CAUSE:
-- ===========
-- 51 business/place names were stored as person records in sot.people.
-- MIG_2821 fixed the classification rules. This migration fixes the data.
--
-- PHASES:
-- 1. Audit — dynamically find all misclassified records using updated classify_owner_name()
-- 2. Robin Stovall identity restoration (person_id unchanged, rename only)
-- 3. Handle "Duplicate Report" records (mark as garbage)
-- 4. Bulk reclassify remaining business/place names
-- 5. Re-run entity linking
--
-- Created: 2026-03-05
-- Related: FFS-158, FFS-157 (MIG_2821 prerequisite)

\echo ''
\echo '=============================================='
\echo '  MIG_2822: Reclassify Business-Name Persons'
\echo '=============================================='
\echo ''

-- ============================================================================
-- PREREQUISITE CHECK: Verify MIG_2821 keywords exist
-- ============================================================================

DO $$
DECLARE
    v_hotel_exists BOOLEAN;
    v_school_exists BOOLEAN;
BEGIN
    SELECT EXISTS(SELECT 1 FROM ref.business_keywords WHERE keyword = 'hotel') INTO v_hotel_exists;
    SELECT EXISTS(SELECT 1 FROM ref.business_keywords WHERE keyword = 'school') INTO v_school_exists;

    IF NOT v_hotel_exists OR NOT v_school_exists THEN
        RAISE EXCEPTION 'MIG_2821 must be applied first! Missing keywords: hotel=%, school=%',
            v_hotel_exists, v_school_exists;
    END IF;

    RAISE NOTICE 'MIG_2822: MIG_2821 prerequisite verified';
END $$;

-- ============================================================================
-- PHASE 1: Audit — Find all misclassified records
-- ============================================================================

\echo '1. Auditing misclassified records...'

CREATE TEMP TABLE misclassified_audit AS
SELECT
    p.person_id,
    p.display_name,
    p.first_name,
    p.last_name,
    p.entity_type,
    p.is_organization,
    p.data_quality,
    p.source_system,
    sot.classify_owner_name(p.display_name) as new_classification,
    (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cat_count,
    (SELECT COUNT(*) FROM sot.person_place pp WHERE pp.person_id = p.person_id) as place_count,
    (SELECT pi.id_value_norm FROM sot.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
     AND pi.confidence >= 0.5
     ORDER BY pi.confidence DESC LIMIT 1) as primary_email,
    (SELECT pi.id_value_norm FROM sot.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.id_type = 'phone'
     AND pi.confidence >= 0.5
     ORDER BY pi.confidence DESC LIMIT 1) as primary_phone
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND sot.classify_owner_name(p.display_name) IN ('organization', 'site_name', 'garbage')
  AND p.entity_type != 'organization'
  AND p.is_organization IS NOT TRUE;

-- Show what we found
\echo ''
\echo 'Misclassified records found:'
SELECT
    display_name,
    entity_type,
    new_classification,
    cat_count,
    place_count,
    primary_email,
    primary_phone
FROM misclassified_audit
ORDER BY new_classification, display_name;

DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM misclassified_audit;
    RAISE NOTICE 'MIG_2822: Found % misclassified records', v_count;
END $$;

-- ============================================================================
-- PHASE 2: Robin Stovall Identity Restoration
-- ============================================================================

\echo ''
\echo '2. Restoring Robin Stovall identity...'

-- Robin Stovall's person_id was consumed by "Peterbilt Truck Stop" because
-- the booking used her email (rstovall313@gmail.com). The person_id is correct
-- (it IS Robin Stovall by email identity), but display_name is wrong.
-- person_id: 47b2b0fe-11be-433e-9147-b686f8d48d4d

DO $$
DECLARE
    v_person_id UUID;
    v_current_name TEXT;
    v_email TEXT;
    v_has_trapper_profile BOOLEAN;
BEGIN
    -- Verify the person exists and has the expected email
    SELECT p.person_id, p.display_name
    INTO v_person_id, v_current_name
    FROM sot.people p
    WHERE p.person_id = '47b2b0fe-11be-433e-9147-b686f8d48d4d'
      AND p.merged_into_person_id IS NULL;

    IF v_person_id IS NULL THEN
        RAISE NOTICE 'MIG_2822: Robin Stovall person_id not found or already merged — skipping';
        RETURN;
    END IF;

    -- Check email matches expected
    SELECT pi.id_value_norm INTO v_email
    FROM sot.person_identifiers pi
    WHERE pi.person_id = v_person_id
      AND pi.id_type = 'email'
      AND pi.confidence >= 0.5
    LIMIT 1;

    IF v_email IS NULL OR v_email NOT LIKE '%rstovall%' THEN
        RAISE NOTICE 'MIG_2822: Person % email is "%" (expected rstovall*) — skipping rename to be safe',
            v_person_id, v_email;
        RETURN;
    END IF;

    -- Check for trapper profile (should stay intact)
    SELECT EXISTS(
        SELECT 1 FROM sot.trapper_profiles tp WHERE tp.person_id = v_person_id
    ) INTO v_has_trapper_profile;

    RAISE NOTICE 'MIG_2822: Restoring Robin Stovall — current name: "%", email: %, trapper_profile: %',
        v_current_name, v_email, v_has_trapper_profile;

    -- Restore identity
    UPDATE sot.people
    SET
        display_name = 'Robin Stovall',
        first_name = 'Robin',
        last_name = 'Stovall',
        entity_type = 'person',
        is_organization = FALSE,
        updated_at = NOW()
    WHERE person_id = v_person_id;

    -- Log to entity_edits for audit trail
    INSERT INTO sot.entity_edits (
        entity_type, entity_id, edit_type, field_name, old_value, new_value,
        reason, edited_by, edit_source
    ) VALUES
        ('person', v_person_id, 'update', 'display_name', to_jsonb(v_current_name), to_jsonb('Robin Stovall'::text),
         'MIG_2822/FFS-158: Restore stolen identity — was business booking name', 'MIG_2822', 'migration'),
        ('person', v_person_id, 'update', 'first_name', NULL, to_jsonb('Robin'::text),
         'MIG_2822/FFS-158: Restore stolen identity', 'MIG_2822', 'migration'),
        ('person', v_person_id, 'update', 'last_name', NULL, to_jsonb('Stovall'::text),
         'MIG_2822/FFS-158: Restore stolen identity', 'MIG_2822', 'migration');

    -- Remove from misclassified audit (already handled)
    DELETE FROM misclassified_audit WHERE person_id = v_person_id;

    RAISE NOTICE 'MIG_2822: Robin Stovall identity restored. person_id unchanged, trapper profile intact.';
END $$;

-- ============================================================================
-- PHASE 3: Handle "Duplicate Report" records
-- ============================================================================

\echo ''
\echo '3. Handling Duplicate Report records...'

DO $$
DECLARE
    v_count INT;
    rec RECORD;
BEGIN
    -- Find Duplicate Report records
    FOR rec IN
        SELECT person_id, display_name, cat_count, place_count, primary_email
        FROM misclassified_audit
        WHERE new_classification = 'garbage'
          AND display_name ~* '\m(duplicate|report)\M'
    LOOP
        RAISE NOTICE 'MIG_2822: Garbage record "%": cats=%, places=%, email=%',
            rec.display_name, rec.cat_count, rec.place_count, rec.primary_email;

        -- Mark as garbage quality
        UPDATE sot.people
        SET data_quality = 'garbage', updated_at = NOW()
        WHERE person_id = rec.person_id
          AND merged_into_person_id IS NULL;

        -- Nullify appointment.person_id references
        UPDATE ops.appointments
        SET
            person_id = NULL,
            resolution_status = 'pseudo_profile',
            resolution_notes = 'MIG_2822: Duplicate Report garbage name, person_id nullified'
        WHERE person_id = rec.person_id;

        -- Log to entity_edits
        INSERT INTO sot.entity_edits (
            entity_type, entity_id, edit_type, field_name, old_value, new_value,
            reason, edited_by, edit_source
        ) VALUES (
            'person', rec.person_id, 'update', 'data_quality', NULL, to_jsonb('garbage'::text),
            'MIG_2822/FFS-158: Duplicate Report garbage name', 'MIG_2822', 'migration'
        );
    END LOOP;

    -- Remove handled records from audit table
    DELETE FROM misclassified_audit WHERE new_classification = 'garbage';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'MIG_2822: Handled % garbage records', v_count;
END $$;

-- ============================================================================
-- PHASE 4: Bulk reclassify remaining business/place names
-- ============================================================================

\echo ''
\echo '4. Reclassifying remaining business/place names...'

-- First, check if any remaining records have real identifiers that suggest
-- a person behind the business name (like the Robin Stovall case)
\echo 'Checking for records with real person identifiers...'

DO $$
DECLARE
    rec RECORD;
    v_real_person_name TEXT;
    v_reclassified INT := 0;
    v_identity_cases INT := 0;
BEGIN
    FOR rec IN
        SELECT person_id, display_name, entity_type, new_classification, primary_email, primary_phone,
               cat_count, place_count
        FROM misclassified_audit
        ORDER BY display_name
    LOOP
        -- Check if this record has a real email/phone that could identify a different person
        -- These are cases like Robin Stovall where the person_id belongs to a real person
        -- but got the wrong display_name from a booking
        IF rec.primary_email IS NOT NULL
           AND rec.primary_email NOT LIKE '%@noemail.com'
           AND rec.primary_email NOT LIKE '%@petestablished.com'
           AND rec.primary_email NOT LIKE '%@nomail.com'
        THEN
            -- This might be a real person with a wrong name — log for manual review
            RAISE NOTICE 'MIG_2822: REVIEW NEEDED: "%" has real email "%" — may need identity restoration like Robin Stovall',
                rec.display_name, rec.primary_email;
            v_identity_cases := v_identity_cases + 1;

            -- Still reclassify the entity_type but flag for review
            UPDATE sot.people
            SET
                entity_type = CASE
                    WHEN rec.new_classification = 'site_name' THEN 'organization'
                    ELSE 'organization'
                END,
                is_organization = TRUE,
                data_quality = 'needs_review',
                updated_at = NOW()
            WHERE person_id = rec.person_id
              AND merged_into_person_id IS NULL;
        ELSE
            -- No real identifier — safe to reclassify as organization
            UPDATE sot.people
            SET
                entity_type = 'organization',
                is_organization = TRUE,
                updated_at = NOW()
            WHERE person_id = rec.person_id
              AND merged_into_person_id IS NULL;
        END IF;

        -- Log to entity_edits
        INSERT INTO sot.entity_edits (
            entity_type, entity_id, edit_type, field_name, old_value, new_value,
            reason, edited_by, edit_source
        ) VALUES (
            'person', rec.person_id, 'update', 'entity_type', to_jsonb(rec.entity_type), to_jsonb('organization'::text),
            'MIG_2822/FFS-158: Business name "' || rec.display_name || '" reclassified from '
                || rec.entity_type || ' to organization (classify_owner_name=' || rec.new_classification || ')',
            'MIG_2822', 'migration'
        );

        v_reclassified := v_reclassified + 1;
    END LOOP;

    RAISE NOTICE 'MIG_2822: Reclassified % records (% flagged for manual review)',
        v_reclassified, v_identity_cases;
END $$;

-- ============================================================================
-- PHASE 5: Re-run entity linking
-- ============================================================================

\echo ''
\echo '5. Re-running entity linking...'

SELECT sot.run_all_entity_linking();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2822: Verification'
\echo '=============================================='
\echo ''

-- Check Robin Stovall
\echo 'Robin Stovall verification:'
SELECT
    p.person_id,
    p.display_name,
    p.first_name,
    p.last_name,
    p.entity_type,
    p.is_organization,
    (SELECT pi.id_value_norm FROM sot.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
     AND pi.confidence >= 0.5 LIMIT 1) as email,
    EXISTS(SELECT 1 FROM sot.trapper_profiles tp WHERE tp.person_id = p.person_id) as has_trapper_profile
FROM sot.people p
WHERE p.person_id = '47b2b0fe-11be-433e-9147-b686f8d48d4d';

-- Check no more misclassified records
\echo ''
\echo 'Remaining misclassified records (should be 0 or very few):'
SELECT
    p.display_name,
    p.entity_type,
    p.is_organization,
    sot.classify_owner_name(p.display_name) as classification
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND sot.classify_owner_name(p.display_name) IN ('organization', 'site_name')
  AND p.entity_type != 'organization'
  AND p.is_organization IS NOT TRUE
ORDER BY p.display_name;

-- Show records flagged for manual review
\echo ''
\echo 'Records flagged for manual review (identity restoration candidates):'
SELECT
    p.person_id,
    p.display_name,
    p.data_quality,
    (SELECT pi.id_value_norm FROM sot.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
     AND pi.confidence >= 0.5 LIMIT 1) as email
FROM sot.people p
WHERE p.data_quality = 'needs_review'
  AND EXISTS (
      SELECT 1 FROM sot.entity_edits ee
      WHERE ee.entity_id = p.person_id
        AND ee.edited_by = 'MIG_2822'
  )
ORDER BY p.display_name;

-- Show entity_edits from this migration
\echo ''
\echo 'Entity edits logged:'
SELECT
    entity_id,
    field_name,
    old_value,
    new_value,
    LEFT(reason, 80) as reason
FROM sot.entity_edits
WHERE edited_by = 'MIG_2822'
ORDER BY created_at;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2822 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo ''
\echo '1. Audited all records where classify_owner_name() now returns'
\echo '   organization/site_name/garbage but entity_type was not organization.'
\echo ''
\echo '2. Restored Robin Stovall identity:'
\echo '   - person_id 47b2b0fe-... renamed from business booking name to "Robin Stovall"'
\echo '   - Trapper profile and all FK relationships preserved'
\echo '   - ops.clinic_accounts preserves original booking name'
\echo ''
\echo '3. Handled "Duplicate Report" garbage records:'
\echo '   - Marked data_quality = garbage'
\echo '   - Nullified appointment.person_id references'
\echo ''
\echo '4. Bulk reclassified remaining business/place names:'
\echo '   - Set entity_type = organization, is_organization = TRUE'
\echo '   - Records with real identifiers flagged data_quality = needs_review'
\echo ''
\echo '5. Re-ran entity linking to propagate changes.'
\echo ''
\echo 'MANUAL REVIEW: Check records flagged as needs_review above.'
\echo 'These may need identity restoration similar to Robin Stovall.'
\echo ''
