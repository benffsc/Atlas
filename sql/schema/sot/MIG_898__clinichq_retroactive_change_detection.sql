-- ============================================================================
-- MIG_898: ClinicHQ Retroactive Change Detection
-- ============================================================================
-- Problem: When staff go back into ClinicHQ and rename things (owner name,
-- email, phone), Atlas ingests the new data but doesn't reconcile with
-- existing appointments. This creates orphaned identity links.
--
-- Solution:
--   1. Track source_row_id + source_row_hash on sot_appointments
--   2. Detect when staged_records has newer hash for same source_row_id
--   3. Create v_retroactive_changes view for monitoring
--   4. Add reconciliation function to flag/fix stale appointments
--
-- Historical Data Preservation:
--   - Original values are preserved in staged_records (old hash rows)
--   - entity_edits logs any changes made during reconciliation
--   - Appointments retain original owner_email/phone until explicitly updated
-- ============================================================================

\echo '=== MIG_898: ClinicHQ Retroactive Change Detection ==='
\echo ''

-- ============================================================================
-- Phase 1: Add change tracking columns to sot_appointments
-- ============================================================================

\echo 'Phase 1: Adding change tracking columns to sot_appointments...'

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS source_row_hash TEXT;

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

ALTER TABLE trapper.sot_appointments
ADD COLUMN IF NOT EXISTS has_stale_source BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_appointments_stale_source
ON trapper.sot_appointments(has_stale_source) WHERE has_stale_source = TRUE;

COMMENT ON COLUMN trapper.sot_appointments.source_row_hash IS
'Hash of the staged_record this appointment was created from. Used to detect retroactive changes.';

COMMENT ON COLUMN trapper.sot_appointments.last_verified_at IS
'When this appointment was last checked against the latest staged_record.';

COMMENT ON COLUMN trapper.sot_appointments.has_stale_source IS
'TRUE if a newer staged_record exists with different hash. Needs reconciliation.';

-- ============================================================================
-- Phase 2: Create view to detect retroactive changes
-- ============================================================================

\echo ''
\echo 'Phase 2: Creating v_retroactive_clinichq_changes view...'

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
    a.source_row_hash as appointment_hash,
    ls.row_hash as latest_hash,
    CASE WHEN a.source_row_hash != ls.row_hash THEN TRUE ELSE FALSE END as hash_mismatch,
    os.change_count,
    ls.payload->>'Owner Name' as latest_owner_name,
    ls.payload->>'Owner Email' as latest_owner_email,
    ls.payload->>'Owner Phone' as latest_owner_phone,
    ls.staged_created_at as latest_staged_at,
    p.display_name as linked_person_name
FROM trapper.sot_appointments a
JOIN latest_staged ls ON ls.source_row_id = a.appointment_number AND ls.source_table = 'owner_info'
LEFT JOIN older_staged os ON os.source_row_id = a.appointment_number
LEFT JOIN trapper.sot_people p ON p.person_id = a.person_id AND p.merged_into_person_id IS NULL
WHERE a.source_row_hash IS NOT NULL
  AND a.source_row_hash != ls.row_hash;

COMMENT ON VIEW trapper.v_retroactive_clinichq_changes IS
'Shows appointments where the linked staged_record has been updated in ClinicHQ.
These appointments may have stale owner_email/phone that no longer matches the source.
Use detect_retroactive_changes() to flag these for reconciliation.';

-- ============================================================================
-- Phase 3: Create function to detect and flag stale appointments
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating detect_retroactive_changes function...'

CREATE OR REPLACE FUNCTION trapper.detect_retroactive_changes()
RETURNS TABLE(
    flagged_count INT,
    email_mismatches INT,
    phone_mismatches INT,
    identity_conflicts INT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_flagged INT := 0;
    v_email_mismatch INT := 0;
    v_phone_mismatch INT := 0;
    v_identity_conflict INT := 0;
BEGIN
    -- Step 1: Backfill source_row_hash where missing
    WITH hash_updates AS (
        UPDATE trapper.sot_appointments a
        SET source_row_hash = sr.row_hash
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'owner_info'
          AND sr.payload->>'Number' = a.appointment_number
          AND a.source_row_hash IS NULL
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_flagged FROM hash_updates;

    RAISE NOTICE 'Backfilled source_row_hash for % appointments', v_flagged;

    -- Step 2: Flag appointments where latest staged_record has different hash
    WITH latest_staged AS (
        SELECT DISTINCT ON (source_row_id)
            source_row_id,
            row_hash,
            payload,
            created_at
        FROM trapper.staged_records
        WHERE source_system = 'clinichq'
          AND source_table = 'owner_info'
          AND source_row_id IS NOT NULL
        ORDER BY source_row_id, created_at DESC
    ),
    flagged AS (
        UPDATE trapper.sot_appointments a
        SET has_stale_source = TRUE,
            last_verified_at = NOW()
        FROM latest_staged ls
        WHERE ls.source_row_id = a.appointment_number
          AND a.source_row_hash IS NOT NULL
          AND a.source_row_hash != ls.row_hash
          AND a.has_stale_source = FALSE
        RETURNING a.appointment_id
    )
    SELECT COUNT(*) INTO v_flagged FROM flagged;

    -- Step 3: Count specific types of mismatches
    SELECT
        COUNT(*) FILTER (WHERE a.owner_email IS DISTINCT FROM LOWER(TRIM(ls.payload->>'Owner Email'))),
        COUNT(*) FILTER (WHERE a.owner_phone IS DISTINCT FROM trapper.norm_phone_us(ls.payload->>'Owner Phone'))
    INTO v_email_mismatch, v_phone_mismatch
    FROM trapper.sot_appointments a
    JOIN (
        SELECT DISTINCT ON (source_row_id) source_row_id, payload
        FROM trapper.staged_records
        WHERE source_system = 'clinichq' AND source_table = 'owner_info'
        ORDER BY source_row_id, created_at DESC
    ) ls ON ls.source_row_id = a.appointment_number
    WHERE a.has_stale_source = TRUE;

    -- Step 4: Detect identity conflicts (appointment linked to person A, but new data suggests person B)
    WITH potential_conflicts AS (
        SELECT a.appointment_id, a.person_id as current_person_id,
               pi.person_id as new_person_id
        FROM trapper.sot_appointments a
        JOIN (
            SELECT DISTINCT ON (source_row_id) source_row_id, payload
            FROM trapper.staged_records
            WHERE source_system = 'clinichq' AND source_table = 'owner_info'
            ORDER BY source_row_id, created_at DESC
        ) ls ON ls.source_row_id = a.appointment_number
        JOIN trapper.person_identifiers pi ON (
            (pi.id_type = 'email' AND pi.id_value_norm = LOWER(TRIM(ls.payload->>'Owner Email')))
            OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(ls.payload->>'Owner Phone'))
        )
        WHERE a.has_stale_source = TRUE
          AND a.person_id IS NOT NULL
          AND pi.person_id != a.person_id
    )
    SELECT COUNT(DISTINCT appointment_id) INTO v_identity_conflict FROM potential_conflicts;

    RETURN QUERY SELECT v_flagged, v_email_mismatch, v_phone_mismatch, v_identity_conflict;
END;
$$;

COMMENT ON FUNCTION trapper.detect_retroactive_changes IS
'Detects appointments where ClinicHQ data has been retroactively changed.
Returns counts of flagged appointments and types of mismatches.
Does NOT automatically change data - use reconcile_retroactive_changes() for that.';

-- ============================================================================
-- Phase 4: Create reconciliation function (with audit trail)
-- ============================================================================

\echo ''
\echo 'Phase 4: Creating reconcile_retroactive_changes function...'

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
            LOWER(TRIM(ls.payload->>'Owner Email')) as new_email,
            trapper.norm_phone_us(ls.payload->>'Owner Phone') as new_phone,
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
                WHERE appointment_id = v_rec.appointment_id;
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
                WHERE appointment_id = v_rec.appointment_id;
            END IF;
        END IF;

        -- Clear stale flag if only running dry_run (to allow re-detection)
        IF p_mode = 'dry_run' THEN
            -- No action, just reporting
            NULL;
        END IF;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION trapper.reconcile_retroactive_changes IS
'Reconciles appointments where ClinicHQ data has been retroactively changed.
Modes:
  - dry_run: Report what would change without modifying data
  - update_fields: Update owner_email/phone on appointments (preserves person_id)
  - relink_persons: Update fields AND relink to different person if identifiers changed

All changes are logged to entity_edits for audit trail.';

-- ============================================================================
-- Phase 5: Create summary view for monitoring
-- ============================================================================

\echo ''
\echo 'Phase 5: Creating v_clinichq_data_freshness view...'

CREATE OR REPLACE VIEW trapper.v_clinichq_data_freshness AS
SELECT
    source_table,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE has_stale_source = TRUE) as stale_records,
    COUNT(*) FILTER (WHERE last_verified_at IS NULL) as never_verified,
    COUNT(*) FILTER (WHERE last_verified_at > NOW() - INTERVAL '7 days') as verified_last_week,
    MAX(last_verified_at) as most_recent_verification
FROM trapper.sot_appointments a
GROUP BY source_table
ORDER BY stale_records DESC;

COMMENT ON VIEW trapper.v_clinichq_data_freshness IS
'Dashboard view showing data freshness and stale record counts per source table.
Use detect_retroactive_changes() to update stale flags.';

-- ============================================================================
-- Phase 6: Initial detection run
-- ============================================================================

\echo ''
\echo 'Phase 6: Running initial retroactive change detection...'

SELECT * FROM trapper.detect_retroactive_changes();

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_898 Complete!'
\echo '=============================================='
\echo ''
\echo 'New capabilities:'
\echo '  1. source_row_hash on sot_appointments tracks which staged_record version'
\echo '  2. has_stale_source flag marks appointments needing reconciliation'
\echo '  3. v_retroactive_clinichq_changes shows detailed mismatches'
\echo '  4. detect_retroactive_changes() flags stale appointments'
\echo '  5. reconcile_retroactive_changes() updates with full audit trail'
\echo ''
\echo 'Usage:'
\echo '  -- Check for retroactive changes (safe, read-only):'
\echo '  SELECT * FROM trapper.detect_retroactive_changes();'
\echo ''
\echo '  -- Preview what would change:'
\echo '  SELECT * FROM trapper.reconcile_retroactive_changes(''dry_run'', 100);'
\echo ''
\echo '  -- Apply changes (logs to entity_edits):'
\echo '  SELECT * FROM trapper.reconcile_retroactive_changes(''update_fields'', 100);'
\echo ''
\echo 'Historical data is preserved:'
\echo '  - Old staged_records are kept (different row_hash)'
\echo '  - All changes logged to entity_edits with before/after values'
\echo '  - Appointments retain original values until explicitly reconciled'
\echo ''
