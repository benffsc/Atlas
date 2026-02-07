-- ============================================================================
-- MIG_905: ClinicHQ Address Field Reconciliation
-- ============================================================================
-- Problem: MIG_898 detects retroactive changes but only reconciles email/phone.
-- Address field corrections from re-exports are detected but NOT processed.
--
-- Root Cause: Large ClinicHQ exports often have incomplete owner_address.
-- When staff re-export in smaller chunks, complete addresses come through.
-- The system needs to reconcile these address corrections to:
--   1. Update client_address on appointments
--   2. Trigger geocoding for new addresses
--   3. Create person_place_relationships
--
-- Solution: Extend MIG_898 infrastructure to handle address recovery:
--   1. Add address columns to v_retroactive_clinichq_changes
--   2. Extend reconcile_retroactive_changes() to handle addresses
--   3. Trigger geocoding and person_place linking for recovered addresses
-- ============================================================================

\echo '=== MIG_905: ClinicHQ Address Field Reconciliation ==='
\echo ''

-- ============================================================================
-- Phase 1: Extend retroactive changes view with address tracking
-- ============================================================================

\echo 'Phase 1: Extending v_retroactive_clinichq_changes with address tracking...'

-- Must DROP CASCADE first because we're adding new columns (PostgreSQL limitation)
DROP VIEW IF EXISTS trapper.v_retroactive_clinichq_changes CASCADE;

CREATE OR REPLACE VIEW trapper.v_retroactive_clinichq_changes AS
WITH latest_staged AS (
    -- Get the most recent staged_record for each source_row_id
    SELECT DISTINCT ON (source_system, source_table, source_row_id)
        id as staged_record_id,
        source_system,
        source_table,
        source_row_id,
        row_hash,
        payload,
        created_at as staged_created_at
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_row_id IS NOT NULL
    ORDER BY source_system, source_table, source_row_id, created_at DESC
),
older_staged AS (
    -- Get older versions to compare
    SELECT
        source_row_id,
        array_agg(DISTINCT row_hash) as older_hashes,
        COUNT(DISTINCT row_hash) - 1 as change_count
    FROM trapper.staged_records
    WHERE source_system = 'clinichq'
      AND source_row_id IS NOT NULL
    GROUP BY source_row_id
    HAVING COUNT(DISTINCT row_hash) > 1
)
SELECT
    a.appointment_id,
    a.appointment_number,
    a.appointment_date,
    a.person_id,
    a.owner_email as current_owner_email,
    a.owner_phone as current_owner_phone,
    a.client_address as current_address,
    a.source_row_hash as appointment_hash,
    ls.row_hash as latest_hash,
    CASE WHEN a.source_row_hash != ls.row_hash THEN TRUE ELSE FALSE END as hash_mismatch,
    os.change_count,
    ls.payload->>'Owner Name' as latest_owner_name,
    ls.payload->>'Owner Email' as latest_owner_email,
    ls.payload->>'Owner Phone' as latest_owner_phone,
    NULLIF(TRIM(ls.payload->>'Owner Address'), '') as latest_owner_address,
    ls.staged_created_at as latest_staged_at,
    p.display_name as linked_person_name,
    -- NEW: Address recovery flag
    CASE
        WHEN COALESCE(TRIM(a.client_address), '') = ''
         AND COALESCE(TRIM(ls.payload->>'Owner Address'), '') != ''
        THEN TRUE
        ELSE FALSE
    END as address_recovered,
    -- NEW: Address changed flag (for corrections)
    CASE
        WHEN COALESCE(TRIM(a.client_address), '') != ''
         AND COALESCE(TRIM(ls.payload->>'Owner Address'), '') != ''
         AND TRIM(a.client_address) != TRIM(ls.payload->>'Owner Address')
        THEN TRUE
        ELSE FALSE
    END as address_changed
FROM trapper.sot_appointments a
JOIN latest_staged ls ON ls.source_row_id = a.appointment_number AND ls.source_table = 'owner_info'
LEFT JOIN older_staged os ON os.source_row_id = a.appointment_number
LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id AND p.merged_into_person_id IS NULL
WHERE a.source_row_hash IS NOT NULL
  AND a.source_row_hash != ls.row_hash;

COMMENT ON VIEW trapper.v_retroactive_clinichq_changes IS
'Shows appointments where the linked staged_record has been updated in ClinicHQ.
Extended in MIG_905 to include address recovery detection.
Key columns:
  - address_recovered: TRUE if appointment had no address but source now has one
  - address_changed: TRUE if both have addresses but they differ
Use detect_retroactive_changes() to flag and reconcile_retroactive_changes() to fix.';

-- ============================================================================
-- Phase 2: Extend reconcile function to handle addresses
-- ============================================================================

\echo ''
\echo 'Phase 2: Extending reconcile_retroactive_changes to handle addresses...'

CREATE OR REPLACE FUNCTION trapper.reconcile_retroactive_changes(
    p_mode TEXT DEFAULT 'dry_run',  -- 'dry_run', 'update_fields', 'relink_persons'
    p_limit INT DEFAULT 100
)
RETURNS TABLE(
    appointment_id UUID,
    appointment_number TEXT,
    action_taken TEXT,
    old_value TEXT,
    new_value TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_rec RECORD;
    v_place_id UUID;
BEGIN
    IF p_mode NOT IN ('dry_run', 'update_fields', 'relink_persons') THEN
        RAISE EXCEPTION 'Invalid mode: %. Use dry_run, update_fields, or relink_persons', p_mode;
    END IF;

    FOR v_rec IN
        SELECT
            a.appointment_id,
            a.appointment_number,
            a.person_id as current_person_id,
            a.owner_email as current_email,
            a.owner_phone as current_phone,
            a.client_address as current_address,
            LOWER(TRIM(ls.payload->>'Owner Email')) as new_email,
            trapper.norm_phone_us(ls.payload->>'Owner Phone') as new_phone,
            NULLIF(TRIM(ls.payload->>'Owner Address'), '') as new_address,
            ls.payload->>'Owner Name' as new_owner_name,
            ls.row_hash as new_hash
        FROM trapper.sot_appointments a
        JOIN (
            SELECT DISTINCT ON (source_row_id) source_row_id, row_hash, payload
            FROM trapper.staged_records
            WHERE source_system = 'clinichq' AND source_table = 'owner_info'
            ORDER BY source_row_id, created_at DESC
        ) ls ON ls.source_row_id = a.appointment_number
        WHERE a.has_stale_source = TRUE
        LIMIT p_limit
    LOOP
        -- Report email changes
        IF v_rec.current_email IS DISTINCT FROM v_rec.new_email THEN
            appointment_id := v_rec.appointment_id;
            appointment_number := v_rec.appointment_number;
            action_taken := CASE WHEN p_mode = 'dry_run' THEN 'would_update_email' ELSE 'updated_email' END;
            old_value := v_rec.current_email;
            new_value := v_rec.new_email;
            RETURN NEXT;

            IF p_mode IN ('update_fields', 'relink_persons') THEN
                -- Log the change
                INSERT INTO trapper.entity_edits (
                    entity_type, entity_id, edit_type, field_name,
                    old_value, new_value, reason, edited_by, edit_source
                ) VALUES (
                    'appointment', v_rec.appointment_id, 'field_update', 'owner_email',
                    to_jsonb(v_rec.current_email), to_jsonb(v_rec.new_email),
                    'Retroactive ClinicHQ update detected', 'reconcile_retroactive_changes', 'system'
                );

                -- Update the field
                UPDATE trapper.sot_appointments
                SET owner_email = v_rec.new_email,
                    source_row_hash = v_rec.new_hash,
                    has_stale_source = FALSE,
                    last_verified_at = NOW()
                WHERE sot_appointments.appointment_id = v_rec.appointment_id;
            END IF;
        END IF;

        -- Report phone changes
        IF v_rec.current_phone IS DISTINCT FROM v_rec.new_phone THEN
            appointment_id := v_rec.appointment_id;
            appointment_number := v_rec.appointment_number;
            action_taken := CASE WHEN p_mode = 'dry_run' THEN 'would_update_phone' ELSE 'updated_phone' END;
            old_value := v_rec.current_phone;
            new_value := v_rec.new_phone;
            RETURN NEXT;

            IF p_mode IN ('update_fields', 'relink_persons') THEN
                -- Log the change
                INSERT INTO trapper.entity_edits (
                    entity_type, entity_id, edit_type, field_name,
                    old_value, new_value, reason, edited_by, edit_source
                ) VALUES (
                    'appointment', v_rec.appointment_id, 'field_update', 'owner_phone',
                    to_jsonb(v_rec.current_phone), to_jsonb(v_rec.new_phone),
                    'Retroactive ClinicHQ update detected', 'reconcile_retroactive_changes', 'system'
                );

                -- Update the field
                UPDATE trapper.sot_appointments
                SET owner_phone = v_rec.new_phone,
                    source_row_hash = v_rec.new_hash,
                    has_stale_source = FALSE,
                    last_verified_at = NOW()
                WHERE sot_appointments.appointment_id = v_rec.appointment_id;
            END IF;
        END IF;

        -- NEW: Handle address recovery (NULL/empty -> populated)
        IF COALESCE(TRIM(v_rec.current_address), '') = ''
           AND v_rec.new_address IS NOT NULL
           AND v_rec.new_address != '' THEN

            appointment_id := v_rec.appointment_id;
            appointment_number := v_rec.appointment_number;
            action_taken := CASE WHEN p_mode = 'dry_run' THEN 'would_recover_address' ELSE 'recovered_address' END;
            old_value := v_rec.current_address;
            new_value := v_rec.new_address;
            RETURN NEXT;

            IF p_mode IN ('update_fields', 'relink_persons') THEN
                -- Log the address recovery
                INSERT INTO trapper.entity_edits (
                    entity_type, entity_id, edit_type, field_name,
                    old_value, new_value, reason, edited_by, edit_source
                ) VALUES (
                    'appointment', v_rec.appointment_id, 'field_update', 'client_address',
                    to_jsonb(v_rec.current_address), to_jsonb(v_rec.new_address),
                    'Address recovered from re-export (incomplete export bug fix)',
                    'reconcile_retroactive_changes', 'system'
                );

                -- Update the address on appointment
                UPDATE trapper.sot_appointments
                SET client_address = v_rec.new_address,
                    source_row_hash = v_rec.new_hash,
                    has_stale_source = FALSE,
                    last_verified_at = NOW()
                WHERE sot_appointments.appointment_id = v_rec.appointment_id;

                -- Create place from address (deduped)
                SELECT trapper.find_or_create_place_deduped(
                    p_formatted_address := v_rec.new_address,
                    p_display_name := NULL,
                    p_lat := NULL,
                    p_lng := NULL,
                    p_source_system := 'clinichq'
                ) INTO v_place_id;

                -- Create person_place_relationship if person exists
                IF v_rec.current_person_id IS NOT NULL AND v_place_id IS NOT NULL THEN
                    INSERT INTO trapper.person_place_relationships (
                        person_id, place_id, role, confidence,
                        source_system, source_table
                    ) VALUES (
                        v_rec.current_person_id,
                        v_place_id,
                        'resident',
                        0.80,  -- High confidence from re-export
                        'clinichq',
                        'mig_905_address_recovery'
                    ) ON CONFLICT DO NOTHING;

                    -- Log relationship creation
                    appointment_id := v_rec.appointment_id;
                    appointment_number := v_rec.appointment_number;
                    action_taken := 'created_person_place_relationship';
                    old_value := NULL;
                    new_value := v_place_id::TEXT;
                    RETURN NEXT;
                END IF;
            END IF;

        -- Handle address changes (both have values, but differ)
        ELSIF COALESCE(TRIM(v_rec.current_address), '') != ''
              AND v_rec.new_address IS NOT NULL
              AND TRIM(v_rec.current_address) != v_rec.new_address THEN

            appointment_id := v_rec.appointment_id;
            appointment_number := v_rec.appointment_number;
            action_taken := CASE WHEN p_mode = 'dry_run' THEN 'would_update_address' ELSE 'updated_address' END;
            old_value := v_rec.current_address;
            new_value := v_rec.new_address;
            RETURN NEXT;

            IF p_mode IN ('update_fields', 'relink_persons') THEN
                -- Log the address change
                INSERT INTO trapper.entity_edits (
                    entity_type, entity_id, edit_type, field_name,
                    old_value, new_value, reason, edited_by, edit_source
                ) VALUES (
                    'appointment', v_rec.appointment_id, 'field_update', 'client_address',
                    to_jsonb(v_rec.current_address), to_jsonb(v_rec.new_address),
                    'Address corrected from re-export',
                    'reconcile_retroactive_changes', 'system'
                );

                -- Update the address
                UPDATE trapper.sot_appointments
                SET client_address = v_rec.new_address,
                    source_row_hash = v_rec.new_hash,
                    has_stale_source = FALSE,
                    last_verified_at = NOW()
                WHERE sot_appointments.appointment_id = v_rec.appointment_id;
            END IF;
        END IF;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION trapper.reconcile_retroactive_changes IS
'Reconciles appointments where ClinicHQ data has been retroactively changed.
Extended in MIG_905 to handle address recovery from re-exports.

Modes:
  - dry_run: Report what would change without modifying data
  - update_fields: Update owner_email/phone/address on appointments
  - relink_persons: Update fields AND relink to different person if identifiers changed

Address Recovery Features (MIG_905):
  - Detects when appointment had no address but re-export has one
  - Creates place via find_or_create_place_deduped()
  - Creates person_place_relationship for linked person
  - All changes logged to entity_edits

After running reconciliation, call:
  SELECT * FROM trapper.run_cat_place_linking();
  SELECT * FROM trapper.link_cats_to_requests_safe();
to connect cats to newly-recovered places.';

-- ============================================================================
-- Phase 3: Create address recovery summary view
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating v_clinichq_address_recovery_status view...'

CREATE OR REPLACE VIEW trapper.v_clinichq_address_recovery_status AS
SELECT
    'Appointments with stale source' as category,
    COUNT(*) as count
FROM trapper.sot_appointments
WHERE has_stale_source = TRUE

UNION ALL

SELECT
    'Address recoverable (NULL -> populated)' as category,
    COUNT(*) as count
FROM trapper.v_retroactive_clinichq_changes
WHERE address_recovered = TRUE

UNION ALL

SELECT
    'Address changed (correction)' as category,
    COUNT(*) as count
FROM trapper.v_retroactive_clinichq_changes
WHERE address_changed = TRUE

UNION ALL

SELECT
    'Email changed' as category,
    COUNT(*) as count
FROM trapper.v_retroactive_clinichq_changes
WHERE current_owner_email IS DISTINCT FROM latest_owner_email

UNION ALL

SELECT
    'Phone changed' as category,
    COUNT(*) as count
FROM trapper.v_retroactive_clinichq_changes
WHERE current_owner_phone IS DISTINCT FROM latest_owner_phone;

COMMENT ON VIEW trapper.v_clinichq_address_recovery_status IS
'Summary of retroactive changes available for reconciliation.
Focus on address_recoverable for the "incomplete export" bug fix.';

-- ============================================================================
-- Phase 4: Audit current state
-- ============================================================================

\echo ''
\echo 'Phase 4: Auditing current address recovery status...'

SELECT * FROM trapper.v_clinichq_address_recovery_status;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_905 Complete!'
\echo '=============================================='
\echo ''
\echo 'Extended MIG_898 with address reconciliation:'
\echo '  1. v_retroactive_clinichq_changes now includes address_recovered flag'
\echo '  2. reconcile_retroactive_changes() handles address recovery:'
\echo '     - Updates client_address on appointment'
\echo '     - Creates place via find_or_create_place_deduped()'
\echo '     - Creates person_place_relationship'
\echo '  3. v_clinichq_address_recovery_status shows summary'
\echo ''
\echo 'Usage:'
\echo '  -- Check what needs to be recovered:'
\echo '  SELECT * FROM trapper.v_clinichq_address_recovery_status;'
\echo ''
\echo '  -- Preview address recovery:'
\echo '  SELECT * FROM trapper.reconcile_retroactive_changes(''dry_run'', 100)'
\echo '  WHERE action_taken LIKE ''%address%'';'
\echo ''
\echo '  -- Apply address recovery:'
\echo '  SELECT * FROM trapper.reconcile_retroactive_changes(''update_fields'', 100);'
\echo ''
\echo '  -- After reconciliation, re-run entity linking:'
\echo '  SELECT * FROM trapper.run_cat_place_linking();'
\echo '  SELECT * FROM trapper.link_cats_to_requests_safe();'
\echo ''
\echo 'This fixes the "incomplete export" bug where large ClinicHQ exports'
\echo 'have truncated addresses. Re-exporting in smaller chunks brings'
\echo 'complete data, and this migration properly reconciles it.'
\echo ''
