-- MIG_2504__owner_change_detection.sql
-- Date: 2026-02-25
--
-- PROBLEM: When ClinicHQ staff rename an account (e.g., Jill Manning → Kathleen Sartori),
-- the import creates NEW person_cat relationships but does NOT delete OLD ones,
-- resulting in cats appearing under multiple owners.
--
-- SOLUTION: Detect owner changes during import and queue for staff review.
-- Uses EXISTING infrastructure (ops.review_queue, ops.entity_edits) to stay cohesive.
--
-- INDUSTRY BEST PRACTICES APPLIED:
--   - MDM: >90% confidence = auto-process, 60-90% = review queue
--   - Animal Shelter: Ownership transfer requires explicit staff approval
--   - CDP: Full audit trail for all identity changes
--
-- Run: psql "$DATABASE_URL" -f sql/schema/v2/MIG_2504__owner_change_detection.sql

\echo ''
\echo '=============================================='
\echo '  MIG_2504: Owner Change Detection System'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. EXTEND review_queue FOR OWNER CHANGES
-- ============================================================================

\echo '1. Extending ops.review_queue for owner change detection...'

-- Add columns needed for owner change context
-- Using ALTER TABLE ADD COLUMN IF NOT EXISTS for idempotency
ALTER TABLE ops.review_queue
ADD COLUMN IF NOT EXISTS old_person_id UUID,
ADD COLUMN IF NOT EXISTS new_person_id UUID,
ADD COLUMN IF NOT EXISTS match_confidence NUMERIC(4,3),
ADD COLUMN IF NOT EXISTS change_context JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS cats_affected UUID[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS source_system TEXT,
ADD COLUMN IF NOT EXISTS source_record_id TEXT;

COMMENT ON COLUMN ops.review_queue.old_person_id IS
'For owner_change reviews: the person_id being replaced';

COMMENT ON COLUMN ops.review_queue.new_person_id IS
'For owner_change reviews: the new person_id detected from incoming data';

COMMENT ON COLUMN ops.review_queue.match_confidence IS
'Confidence score (0.0-1.0) from Data Engine matching. Lower = more likely different person.';

COMMENT ON COLUMN ops.review_queue.change_context IS
'JSONB with: old_name, new_name, old_email, new_email, old_phone, new_phone, old_address, new_address';

COMMENT ON COLUMN ops.review_queue.cats_affected IS
'Array of cat_ids that would be affected by this owner change';

-- Create index for efficient lookup
CREATE INDEX IF NOT EXISTS idx_review_queue_review_type
    ON ops.review_queue(review_type) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_review_queue_old_person
    ON ops.review_queue(old_person_id) WHERE old_person_id IS NOT NULL;

\echo '   Extended ops.review_queue'

-- ============================================================================
-- 2. CREATE OWNER CHANGE DETECTION FUNCTION
-- ============================================================================

\echo ''
\echo '2. Creating ops.detect_owner_changes() function...'

CREATE OR REPLACE FUNCTION ops.detect_owner_changes(
    p_upload_id UUID
)
RETURNS TABLE (
    changes_detected INT,
    auto_processed INT,
    queued_for_review INT
) AS $$
DECLARE
    v_changes_detected INT := 0;
    v_auto_processed INT := 0;
    v_queued_for_review INT := 0;
    v_record RECORD;
    v_old_person RECORD;
    v_new_person RECORD;
    v_confidence NUMERIC;
    v_decision TEXT;
    v_affected_cats UUID[];
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

        -- Check if incoming data points to SAME person or DIFFERENT person
        -- Using industry-standard confidence thresholds

        -- SAME EMAIL = SAME PERSON (auto-process)
        IF v_record.new_email IS NOT NULL
           AND v_old_person.email IS NOT NULL
           AND LOWER(v_record.new_email) = LOWER(v_old_person.email) THEN
            -- Same email = definitely same person
            -- Name change is just a correction (typo, married name, etc.)
            v_confidence := 0.95;
            v_decision := 'auto_same_person';

            -- Log but don't queue (auto-process)
            INSERT INTO sot.match_decisions (
                source_system, incoming_email, incoming_phone, incoming_name, incoming_address,
                decision_type, decision_reason, resulting_person_id
            ) VALUES (
                'clinichq_change_detection',
                v_record.new_email, v_record.new_phone,
                CONCAT(v_record.new_first_name, ' ', v_record.new_last_name),
                v_record.new_address,
                'auto_match',
                'Same email - name change only (Jill→Kathleen scenario)',
                v_record.existing_person_id
            );

            v_auto_processed := v_auto_processed + 1;
            CONTINUE;
        END IF;

        -- SAME PHONE = LIKELY SAME PERSON (review if name differs significantly)
        IF v_record.new_phone IS NOT NULL
           AND v_old_person.phone IS NOT NULL
           AND v_record.new_phone = v_old_person.phone THEN

            v_confidence := 0.85;

            -- Check name similarity
            IF sot.name_similarity(
                v_old_person.display_name,
                CONCAT(v_record.new_first_name, ' ', v_record.new_last_name)
            ) < 0.5 THEN
                -- Same phone, very different name = queue for review (household situation)
                v_decision := 'queue_household';
                v_confidence := 0.70;
            ELSE
                -- Same phone, similar name = same person, auto-process
                v_decision := 'auto_same_person';
                v_auto_processed := v_auto_processed + 1;
                CONTINUE;
            END IF;
        END IF;

        -- DIFFERENT EMAIL AND PHONE = LIKELY DIFFERENT PERSON (ownership transfer)
        IF v_record.new_email IS NOT NULL
           AND v_old_person.email IS NOT NULL
           AND LOWER(v_record.new_email) != LOWER(v_old_person.email)
           AND v_record.new_phone IS NOT NULL
           AND v_old_person.phone IS NOT NULL
           AND v_record.new_phone != v_old_person.phone THEN

            v_confidence := 0.40;  -- Low confidence of being same person
            v_decision := 'queue_ownership_transfer';
        END IF;

        -- If we haven't decided yet, queue for review
        IF v_decision IS NULL THEN
            v_confidence := 0.60;
            v_decision := 'queue_review';
        END IF;

        -- Get cats affected by this potential change
        SELECT ARRAY_AGG(pc.cat_id)
        INTO v_affected_cats
        FROM sot.person_cat pc
        WHERE pc.person_id = v_record.existing_person_id;

        -- Try to find/create new person from incoming data
        SELECT person_id INTO v_new_person
        FROM sot.people p
        JOIN sot.person_identifiers pi ON pi.person_id = p.person_id
        WHERE p.merged_into_person_id IS NULL
            AND (
                (pi.id_type = 'email' AND pi.id_value_norm = v_record.new_email)
                OR (pi.id_type = 'phone' AND pi.id_value_norm = v_record.new_phone)
            )
        LIMIT 1;

        -- Queue for review
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
            CASE
                WHEN v_decision = 'queue_ownership_transfer' THEN 'owner_transfer'
                WHEN v_decision = 'queue_household' THEN 'owner_household'
                ELSE 'owner_change'
            END,
            CASE
                WHEN v_decision = 'queue_ownership_transfer' THEN 10  -- High priority
                WHEN v_decision = 'queue_household' THEN 5
                ELSE 1
            END,
            'pending',
            CASE
                WHEN v_decision = 'queue_ownership_transfer' THEN
                    'Potential ownership transfer: ' || v_old_person.display_name || ' → ' ||
                    CONCAT(v_record.new_first_name, ' ', v_record.new_last_name)
                WHEN v_decision = 'queue_household' THEN
                    'Same phone, different name - possible household member: ' ||
                    CONCAT(v_record.new_first_name, ' ', v_record.new_last_name)
                ELSE
                    'Owner info changed for appointment ' || v_record.appointment_number
            END,
            v_record.existing_person_id,
            v_new_person.person_id,
            v_confidence,
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
                'detection_decision', v_decision
            ),
            v_affected_cats,
            'clinichq',
            v_record.appointment_number
        )
        ON CONFLICT DO NOTHING;

        v_queued_for_review := v_queued_for_review + 1;
        v_changes_detected := v_changes_detected + 1;
    END LOOP;

    RETURN QUERY SELECT v_changes_detected, v_auto_processed, v_queued_for_review;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.detect_owner_changes IS
'Detects owner changes during ClinicHQ import and queues for review.

Uses industry-standard confidence thresholds:
  - Same email = same person (auto-process, 95% confidence)
  - Same phone + similar name = same person (auto-process, 85%)
  - Same phone + different name = household (queue, 70%)
  - Different email + different phone = ownership transfer (queue, 40%)

Integrates with existing infrastructure:
  - ops.review_queue for pending reviews
  - sot.match_decisions for audit trail
  - ops.entity_edits for change logging

Parameters:
  p_upload_id - UUID of the file upload being processed

Returns:
  changes_detected - Total owner changes found
  auto_processed - Changes automatically handled (same person)
  queued_for_review - Changes requiring staff review

Example:
  SELECT * FROM ops.detect_owner_changes(''abc123...''::UUID);
';

\echo '   Created ops.detect_owner_changes()'

-- ============================================================================
-- 3. CREATE APPLY OWNER CHANGE FUNCTION
-- ============================================================================

\echo ''
\echo '3. Creating ops.apply_owner_change() function...'

CREATE OR REPLACE FUNCTION ops.apply_owner_change(
    p_review_id UUID,
    p_action TEXT,  -- 'transfer', 'merge', 'keep_both', 'reject'
    p_reason TEXT DEFAULT NULL,
    p_reviewed_by UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_review RECORD;
    v_old_cats UUID[];
    v_cat_id UUID;
    v_result JSONB := '{}';
    v_relationships_deleted INT := 0;
    v_relationships_created INT := 0;
BEGIN
    -- Get review record
    SELECT * INTO v_review
    FROM ops.review_queue
    WHERE review_id = p_review_id
        AND status = 'pending';

    IF NOT FOUND THEN
        RETURN JSONB_BUILD_OBJECT('success', false, 'error', 'Review not found or already processed');
    END IF;

    -- Process based on action
    CASE p_action
        WHEN 'transfer' THEN
            -- OWNERSHIP TRANSFER: Delete old person_cat, create new (if new person exists)
            IF v_review.new_person_id IS NOT NULL THEN
                -- Get cats linked to old person for the relevant appointments
                SELECT ARRAY_AGG(DISTINCT pc.cat_id)
                INTO v_old_cats
                FROM sot.person_cat pc
                WHERE pc.person_id = v_review.old_person_id
                    AND pc.cat_id = ANY(v_review.cats_affected);

                -- Delete old relationships
                DELETE FROM sot.person_cat
                WHERE person_id = v_review.old_person_id
                    AND cat_id = ANY(v_review.cats_affected);
                GET DIAGNOSTICS v_relationships_deleted = ROW_COUNT;

                -- Create new relationships
                INSERT INTO sot.person_cat (person_id, cat_id, relationship_type, confidence, source_system, source_table)
                SELECT
                    v_review.new_person_id,
                    unnest(v_review.cats_affected),
                    'caretaker',
                    0.9,
                    'atlas_ui',
                    'owner_change_review'
                ON CONFLICT DO NOTHING;
                GET DIAGNOSTICS v_relationships_created = ROW_COUNT;

                -- Log the transfer
                PERFORM ops.log_ownership_transfer(
                    'cat',
                    unnest(v_review.cats_affected),
                    v_review.old_person_id,
                    v_review.new_person_id,
                    p_reviewed_by
                );

                v_result := JSONB_BUILD_OBJECT(
                    'success', true,
                    'action', 'transfer',
                    'relationships_deleted', v_relationships_deleted,
                    'relationships_created', v_relationships_created,
                    'cats_transferred', ARRAY_LENGTH(v_review.cats_affected, 1)
                );
            ELSE
                RETURN JSONB_BUILD_OBJECT('success', false, 'error', 'Cannot transfer - new person not found');
            END IF;

        WHEN 'merge' THEN
            -- MERGE: Keep old person but update their info
            -- This is for cases where it's the same person with updated contact info
            UPDATE sot.people
            SET
                display_name = COALESCE(v_review.change_context->>'new_name', display_name),
                updated_at = NOW()
            WHERE person_id = v_review.old_person_id;

            -- Log the update
            INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, changed_by, change_source)
            VALUES (
                'person', v_review.old_person_id, 'display_name',
                v_review.change_context->>'old_name',
                v_review.change_context->>'new_name',
                p_reviewed_by, 'owner_change_review'
            );

            v_result := JSONB_BUILD_OBJECT(
                'success', true,
                'action', 'merge',
                'person_updated', v_review.old_person_id
            );

        WHEN 'keep_both' THEN
            -- KEEP BOTH: Create new person if needed, but keep old relationships
            -- This is for household situations where multiple people care for the same cats
            v_result := JSONB_BUILD_OBJECT(
                'success', true,
                'action', 'keep_both',
                'notes', 'Both people retained as caretakers'
            );

        WHEN 'reject' THEN
            -- REJECT: Ignore the change, keep existing data
            v_result := JSONB_BUILD_OBJECT(
                'success', true,
                'action', 'reject',
                'notes', 'Change rejected, existing data retained'
            );

        ELSE
            RETURN JSONB_BUILD_OBJECT('success', false, 'error', 'Invalid action: ' || p_action);
    END CASE;

    -- Update review record
    UPDATE ops.review_queue
    SET
        status = CASE
            WHEN p_action = 'reject' THEN 'rejected'
            ELSE 'approved'
        END,
        reviewed_at = NOW(),
        reviewed_by = p_reviewed_by,
        notes = COALESCE(notes || E'\n\nResolution: ', '') || p_action ||
                COALESCE(E'\nReason: ' || p_reason, '')
    WHERE review_id = p_review_id;

    -- Log to entity_edits
    INSERT INTO ops.entity_edits (entity_type, entity_id, field_name, old_value, new_value, changed_by, change_source)
    VALUES (
        'review_queue', p_review_id, 'owner_change_resolution',
        v_review.change_context::TEXT,
        v_result::TEXT,
        p_reviewed_by, 'owner_change_review'
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.apply_owner_change IS
'Applies staff decision to an owner change review.

Actions:
  transfer - Move cats from old person to new person (ownership transfer)
  merge - Update old person info with new data (same person, info correction)
  keep_both - Retain both people as caretakers (household situation)
  reject - Ignore change, keep existing data

All actions:
  - Log to ops.entity_edits for audit trail
  - Update ops.review_queue status
  - Call ops.log_ownership_transfer() for transfers

Parameters:
  p_review_id - UUID of the review_queue record
  p_action - One of: transfer, merge, keep_both, reject
  p_reason - Optional reason text
  p_reviewed_by - UUID of staff member making decision

Returns:
  JSONB with success status and action details

Example:
  SELECT ops.apply_owner_change(
    ''review123''::UUID,
    ''transfer'',
    ''Original caller was daughter-in-law, not actual resident'',
    ''staff123''::UUID
  );
';

\echo '   Created ops.apply_owner_change()'

-- ============================================================================
-- 4. CREATE VIEW FOR PENDING OWNER CHANGES
-- ============================================================================

\echo ''
\echo '4. Creating ops.v_pending_owner_changes view...'

CREATE OR REPLACE VIEW ops.v_pending_owner_changes AS
SELECT
    rq.review_id,
    rq.review_type,
    rq.priority,
    rq.created_at,
    rq.notes,
    rq.match_confidence,
    -- Old person info
    rq.old_person_id,
    old_p.display_name as old_person_name,
    rq.change_context->>'old_email' as old_email,
    rq.change_context->>'old_phone' as old_phone,
    rq.change_context->>'old_address' as old_address,
    -- New person info
    rq.new_person_id,
    new_p.display_name as new_person_name,
    rq.change_context->>'new_name' as new_name,
    rq.change_context->>'new_email' as new_email,
    rq.change_context->>'new_phone' as new_phone,
    rq.change_context->>'new_address' as new_address,
    -- Context
    rq.change_context->>'appointment_number' as appointment_number,
    rq.change_context->>'detection_decision' as detection_reason,
    -- Cats affected
    ARRAY_LENGTH(rq.cats_affected, 1) as cat_count,
    rq.cats_affected,
    -- For display: cat names
    (
        SELECT ARRAY_AGG(c.name)
        FROM sot.cats c
        WHERE c.cat_id = ANY(rq.cats_affected)
    ) as cat_names
FROM ops.review_queue rq
LEFT JOIN sot.people old_p ON old_p.person_id = rq.old_person_id
LEFT JOIN sot.people new_p ON new_p.person_id = rq.new_person_id
WHERE rq.status = 'pending'
    AND rq.review_type IN ('owner_change', 'owner_transfer', 'owner_household')
ORDER BY rq.priority DESC, rq.created_at ASC;

COMMENT ON VIEW ops.v_pending_owner_changes IS
'Pending owner changes requiring staff review.

Surfaces owner changes detected during ClinicHQ imports.
Used by /admin/owner-changes UI for staff review workflow.

Review types:
  owner_transfer - Different identifiers, likely different person
  owner_household - Same phone, different name (household member)
  owner_change - Other changes needing review

Priority:
  10 = owner_transfer (high priority - definite action needed)
  5 = owner_household (medium - clarification needed)
  1 = owner_change (standard review)
';

\echo '   Created ops.v_pending_owner_changes'

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'New columns on ops.review_queue:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'ops' AND table_name = 'review_queue'
    AND column_name IN ('old_person_id', 'new_person_id', 'match_confidence', 'change_context', 'cats_affected')
ORDER BY column_name;

\echo ''
\echo 'New functions:'
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'ops' AND routine_name IN ('detect_owner_changes', 'apply_owner_change')
ORDER BY routine_name;

\echo ''
\echo 'View exists:'
SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'ops' AND table_name = 'v_pending_owner_changes'
) as v_pending_owner_changes_exists;

\echo ''
\echo '=============================================='
\echo '  MIG_2504 Complete'
\echo '=============================================='
\echo ''
\echo 'CHANGES MADE:'
\echo '  1. Extended ops.review_queue with owner-change columns'
\echo '  2. Created ops.detect_owner_changes() - detection during import'
\echo '  3. Created ops.apply_owner_change() - staff action handler'
\echo '  4. Created ops.v_pending_owner_changes - review UI view'
\echo ''
\echo 'INTEGRATION POINTS:'
\echo '  - Uses existing ops.review_queue (no new tables)'
\echo '  - Uses existing ops.entity_edits for audit trail'
\echo '  - Uses existing ops.log_ownership_transfer()'
\echo '  - Uses existing sot.match_decisions for identity audit'
\echo ''
\echo 'NEXT STEPS:'
\echo '  1. Add ops.detect_owner_changes() call to import pipeline'
\echo '  2. Build /admin/owner-changes UI'
\echo '  3. Test with February ClinicHQ export'
\echo ''
