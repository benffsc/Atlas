-- MIG_2546: Update detect_owner_changes to use enhanced classification
--
-- Integrates the new sot.classify_identity_change() function into the
-- owner change detection pipeline for more accurate categorization.
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2546: Update detect_owner_changes'
\echo '=============================================='
\echo ''

CREATE OR REPLACE FUNCTION ops.detect_owner_changes(p_upload_id uuid)
RETURNS TABLE(changes_detected integer, auto_processed integer, queued_for_review integer)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_changes_detected INT := 0;
    v_auto_processed INT := 0;
    v_queued_for_review INT := 0;
    v_record RECORD;
    v_old_person RECORD;
    v_classification RECORD;
    v_affected_cats UUID[];
    v_new_person_id UUID;
BEGIN
    -- Find appointments where owner data differs from existing person
    FOR v_record IN
        SELECT
            sr.id as staged_id,
            sr.payload,
            sr.payload->>'Number' as appointment_number,
            a.appointment_id,
            a.person_id as existing_person_id,
            -- Incoming owner data
            NULLIF(TRIM(sr.payload->>'Owner First Name'), '') as new_first_name,
            NULLIF(TRIM(sr.payload->>'Owner Last Name'), '') as new_last_name,
            NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '') as new_email,
            sot.norm_phone_us(COALESCE(
                NULLIF(sr.payload->>'Owner Phone', ''),
                sr.payload->>'Owner Cell Phone'
            )) as new_phone,
            NULLIF(TRIM(sr.payload->>'Owner Address'), '') as new_address
        FROM ops.staged_records sr
        JOIN ops.appointments a ON a.appointment_number = sr.payload->>'Number'
        WHERE sr.source_system = 'clinichq'
            AND sr.source_table = 'owner_info'
            AND sr.file_upload_id = p_upload_id
            AND a.person_id IS NOT NULL  -- Has existing person
            AND (
                sr.payload->>'Owner Email' IS NOT NULL
                OR sr.payload->>'Owner Phone' IS NOT NULL
                OR sr.payload->>'Owner Cell Phone' IS NOT NULL
            )
    LOOP
        -- Get existing person info
        SELECT
            p.person_id,
            p.display_name,
            pi_email.id_value as email,
            pi_phone.id_value_norm as phone,
            pl.formatted_address as address
        INTO v_old_person
        FROM sot.people p
        LEFT JOIN sot.person_identifiers pi_email ON pi_email.person_id = p.person_id
            AND pi_email.id_type = 'email' AND pi_email.confidence >= 0.5
        LEFT JOIN sot.person_identifiers pi_phone ON pi_phone.person_id = p.person_id
            AND pi_phone.id_type = 'phone'
        LEFT JOIN sot.places pl ON pl.place_id = p.primary_address_id
        WHERE p.person_id = v_record.existing_person_id
        LIMIT 1;

        IF v_old_person IS NULL THEN
            CONTINUE;
        END IF;

        -- Use the enhanced classification function
        SELECT * INTO v_classification
        FROM sot.classify_identity_change(
            v_old_person.display_name,
            v_old_person.email,
            v_old_person.phone,
            v_old_person.address,
            CONCAT(v_record.new_first_name, ' ', v_record.new_last_name),
            v_record.new_email,
            v_record.new_phone,
            v_record.new_address
        );

        v_changes_detected := v_changes_detected + 1;

        -- Auto-process corrections and name updates
        IF v_classification.auto_process THEN
            -- Log to match_decisions for audit trail
            INSERT INTO sot.match_decisions (
                source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
                decision_type, decision_reason, resulting_person_id
            ) VALUES (
                'clinichq_change_detection',
                v_record.new_email, v_record.new_phone,
                CONCAT(v_record.new_first_name, ' ', v_record.new_last_name),
                v_record.new_address,
                'auto_match',
                v_classification.change_type || ': ' || v_classification.explanation,
                v_record.existing_person_id
            );

            v_auto_processed := v_auto_processed + 1;
            CONTINUE;
        END IF;

        -- Get cats affected by this potential change
        SELECT ARRAY_AGG(pc.cat_id)
        INTO v_affected_cats
        FROM sot.person_cat pc
        WHERE pc.person_id = v_record.existing_person_id;

        -- Try to find existing person matching new identifiers
        SELECT person_id INTO v_new_person_id
        FROM sot.people p
        JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
        WHERE p.merged_into_person_id IS NULL
            AND (
                (pi.id_type = 'email' AND pi.id_value_norm = v_record.new_email)
                OR (pi.id_type = 'phone' AND pi.id_value_norm = v_record.new_phone)
            )
        LIMIT 1;

        -- Queue for review with enhanced context
        INSERT INTO ops.review_queue (
            entity_type,
            entity_id,
            review_type,
            priority,
            status,
            notes,
            old_person_id,
            new_person_id,
            match_confidence,
            change_context,
            cats_affected,
            source_system,
            source_record_id
        ) VALUES (
            'person',
            v_record.existing_person_id,
            CASE v_classification.change_type
                WHEN 'ownership_transfer' THEN 'owner_transfer'
                WHEN 'household_member' THEN 'owner_household'
                WHEN 'new_entity' THEN 'owner_transfer'
                ELSE 'owner_change'
            END,
            CASE v_classification.change_type
                WHEN 'ownership_transfer' THEN 10  -- High priority
                WHEN 'new_entity' THEN 10          -- High priority
                WHEN 'household_member' THEN 5    -- Medium priority
                ELSE 1                             -- Low priority
            END,
            'pending',
            v_classification.action_recommended,
            v_record.existing_person_id,
            v_new_person_id,
            v_classification.confidence,
            JSONB_BUILD_OBJECT(
                'old_name', v_old_person.display_name,
                'new_name', CONCAT(v_record.new_first_name, ' ', v_record.new_last_name),
                'old_email', v_old_person.email,
                'new_email', v_record.new_email,
                'old_phone', v_old_person.phone,
                'new_phone', v_record.new_phone,
                'old_address', v_old_person.address,
                'new_address', v_record.new_address,
                'appointment_number', v_record.appointment_number,
                'change_type', v_classification.change_type,
                'detection_decision', v_classification.explanation,
                'action_recommended', v_classification.action_recommended
            ),
            v_affected_cats,
            'clinichq',
            v_record.appointment_number
        );

        v_queued_for_review := v_queued_for_review + 1;
    END LOOP;

    RETURN QUERY SELECT v_changes_detected, v_auto_processed, v_queued_for_review;
END;
$function$;

COMMENT ON FUNCTION ops.detect_owner_changes IS
'Detects owner changes in ClinicHQ data using enhanced classification:
- correction: Auto-processed (typo fixes)
- name_update: Auto-processed (married name, legal change)
- household_member: Queued for review (same phone, different person)
- ownership_transfer: Queued for review (same address, new identifiers)
- new_entity: Queued for review (everything different)

Uses sot.classify_identity_change() for industry-standard Fellegi-Sunter style matching.';

\echo ''
\echo '=============================================='
\echo '  MIG_2546 Complete'
\echo '=============================================='
\echo ''
\echo 'Updated ops.detect_owner_changes to use:'
\echo '  - sot.classify_identity_change() for classification'
\echo '  - Enhanced change_context with detailed explanation'
\echo '  - action_recommended field for staff guidance'
\echo ''
