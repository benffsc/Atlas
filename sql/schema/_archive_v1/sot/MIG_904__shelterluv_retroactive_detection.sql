-- ============================================================================
-- MIG_904: ShelterLuv Retroactive Change Detection
-- ============================================================================
-- Problem: ShelterLuv staff may edit adopter info (email, phone, address) after
-- the outcome was initially processed. Unlike ClinicHQ (MIG_898), ShelterLuv has
-- NO retroactive change detection. This creates data drift between source and Atlas.
--
-- Root Cause: ShelterLuv outcomes are processed once via process_shelterluv_events().
-- If SL staff corrects adopter email/address later, Atlas keeps the old data.
--
-- Solution (following MIG_898 pattern):
--   1. Add tracking columns to person_cat_relationships (source_row_hash, etc.)
--   2. Create detection view for changed ShelterLuv event records
--   3. Create detection function to flag stale relationships
--   4. Create reconciliation function with dry_run mode
-- ============================================================================

\echo '=== MIG_904: ShelterLuv Retroactive Change Detection ==='
\echo ''

-- ============================================================================
-- Phase 1: Add tracking columns to person_cat_relationships
-- ============================================================================

\echo 'Phase 1: Adding change tracking columns to person_cat_relationships...'

ALTER TABLE trapper.person_cat_relationships
ADD COLUMN IF NOT EXISTS source_row_hash TEXT;

ALTER TABLE trapper.person_cat_relationships
ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

ALTER TABLE trapper.person_cat_relationships
ADD COLUMN IF NOT EXISTS has_stale_source BOOLEAN DEFAULT FALSE;

-- Index for finding stale relationships efficiently
CREATE INDEX IF NOT EXISTS idx_pcr_stale_source
ON trapper.person_cat_relationships(has_stale_source) WHERE has_stale_source = TRUE;

COMMENT ON COLUMN trapper.person_cat_relationships.source_row_hash IS
'Hash of the staged_record this relationship was created from. Used to detect retroactive changes.';

COMMENT ON COLUMN trapper.person_cat_relationships.last_verified_at IS
'Timestamp when this relationship was last verified against the source staged_record.';

COMMENT ON COLUMN trapper.person_cat_relationships.has_stale_source IS
'TRUE if the source staged_record has been updated since this relationship was created. Requires reconciliation.';

-- ============================================================================
-- Phase 2: Backfill source_row_hash for existing ShelterLuv relationships
-- ============================================================================

\echo ''
\echo 'Phase 2: Backfilling source_row_hash for ShelterLuv relationships...'

-- For relationships from 'events' table (the primary source now per MIG_874)
WITH backfill_events AS (
    UPDATE trapper.person_cat_relationships pcr
    SET source_row_hash = sr.row_hash,
        last_verified_at = NOW()
    FROM trapper.staged_records sr
    WHERE pcr.source_system = 'shelterluv'
      AND pcr.source_table = 'events'
      AND sr.source_system = 'shelterluv'
      AND sr.source_table = 'events'
      AND sr.is_processed = TRUE
      -- Match via person_id in AssociatedRecords (stored as shelterluv_id)
      AND EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi
          WHERE pi.person_id = pcr.person_id
            AND pi.id_type = 'shelterluv_id'
            AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(sr.payload->'AssociatedRecords') r
                WHERE r->>'Type' = 'Person' AND r->>'Id' = pi.id_value_norm
            )
      )
      -- Match via cat_id in AssociatedRecords
      AND EXISTS (
          SELECT 1 FROM trapper.cat_identifiers ci
          WHERE ci.cat_id = pcr.cat_id
            AND ci.id_type = 'shelterluv_id'
            AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(sr.payload->'AssociatedRecords') r
                WHERE r->>'Type' = 'Animal' AND r->>'Id' = ci.id_value
            )
      )
      AND pcr.source_row_hash IS NULL
    RETURNING pcr.person_cat_id
)
SELECT COUNT(*) as events_backfilled FROM backfill_events;

-- For relationships from 'outcomes' table (legacy, if any remain)
WITH backfill_outcomes AS (
    UPDATE trapper.person_cat_relationships pcr
    SET source_row_hash = sr.row_hash,
        last_verified_at = NOW()
    FROM trapper.staged_records sr
    WHERE pcr.source_system = 'shelterluv'
      AND pcr.source_table = 'outcomes'
      AND sr.source_system = 'shelterluv'
      AND sr.source_table = 'outcomes'
      -- Match via cat shelterluv_id
      AND EXISTS (
          SELECT 1 FROM trapper.cat_identifiers ci
          WHERE ci.cat_id = pcr.cat_id
            AND ci.id_type = 'shelterluv_id'
            AND sr.payload->>'Animal ID' = ci.id_value
      )
      AND pcr.source_row_hash IS NULL
    RETURNING pcr.person_cat_id
)
SELECT COUNT(*) as outcomes_backfilled FROM backfill_outcomes;

-- ============================================================================
-- Phase 3: Create detection view for retroactive changes
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating v_retroactive_shelterluv_changes view...'

CREATE OR REPLACE VIEW trapper.v_retroactive_shelterluv_changes AS
WITH latest_staged AS (
    -- Get the most recent staged_record for each ShelterLuv event
    SELECT DISTINCT ON (source_row_id)
        id as staged_record_id,
        source_row_id,
        row_hash,
        payload,
        created_at as staged_created_at
    FROM trapper.staged_records
    WHERE source_system = 'shelterluv'
      AND source_table = 'events'
      AND payload->>'Type' LIKE 'Outcome.%'
    ORDER BY source_row_id, created_at DESC
),
change_history AS (
    -- Count how many versions exist per source_row_id
    SELECT
        source_row_id,
        COUNT(DISTINCT row_hash) - 1 as change_count
    FROM trapper.staged_records
    WHERE source_system = 'shelterluv'
      AND source_table = 'events'
    GROUP BY source_row_id
    HAVING COUNT(DISTINCT row_hash) > 1
)
SELECT
    pcr.person_cat_id,
    pcr.person_id,
    pcr.cat_id,
    pcr.relationship_type,
    pcr.effective_date,
    pcr.source_row_hash as stored_hash,
    ls.row_hash as latest_hash,
    CASE WHEN pcr.source_row_hash != ls.row_hash THEN TRUE ELSE FALSE END as hash_mismatch,
    ch.change_count,
    -- Extract person info from latest staged record
    (SELECT r->>'Id' FROM jsonb_array_elements(ls.payload->'AssociatedRecords') r WHERE r->>'Type' = 'Person' LIMIT 1) as latest_person_sl_id,
    -- Current person info for comparison
    p.display_name as current_person_name,
    p.primary_email as current_person_email,
    p.primary_phone as current_person_phone,
    -- Current cat info
    c.display_name as current_cat_name,
    -- Timestamps
    pcr.created_at as relationship_created_at,
    ls.staged_created_at as latest_staged_at,
    pcr.last_verified_at
FROM trapper.person_cat_relationships pcr
JOIN trapper.person_identifiers pi ON pi.person_id = pcr.person_id AND pi.id_type = 'shelterluv_id'
JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id AND ci.id_type = 'shelterluv_id'
JOIN latest_staged ls ON EXISTS (
    SELECT 1 FROM jsonb_array_elements(ls.payload->'AssociatedRecords') r
    WHERE (r->>'Type' = 'Person' AND r->>'Id' = pi.id_value_norm)
       OR (r->>'Type' = 'Animal' AND r->>'Id' = ci.id_value)
)
LEFT JOIN change_history ch ON ch.source_row_id = ls.source_row_id
LEFT JOIN trapper.sot_people p ON p.person_id = pcr.person_id AND p.merged_into_person_id IS NULL
LEFT JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id AND c.merged_into_cat_id IS NULL
WHERE pcr.source_system = 'shelterluv'
  AND pcr.source_row_hash IS NOT NULL
  AND pcr.source_row_hash != ls.row_hash;

COMMENT ON VIEW trapper.v_retroactive_shelterluv_changes IS
'Shows person_cat_relationships where the linked ShelterLuv event has been updated.
Use detect_shelterluv_retroactive_changes() to flag and reconcile_shelterluv_changes() to fix.';

-- ============================================================================
-- Phase 4: Create detection function
-- ============================================================================

\echo ''
\echo 'Phase 4: Creating detect_shelterluv_retroactive_changes function...'

CREATE OR REPLACE FUNCTION trapper.detect_shelterluv_retroactive_changes()
RETURNS TABLE(
    relationships_checked INT,
    hashes_backfilled INT,
    stale_flagged INT
) AS $$
DECLARE
    v_checked INT := 0;
    v_backfilled INT := 0;
    v_flagged INT := 0;
BEGIN
    -- Step 1: Backfill source_row_hash where missing (for events)
    WITH hash_updates AS (
        UPDATE trapper.person_cat_relationships pcr
        SET source_row_hash = sr.row_hash,
            last_verified_at = NOW()
        FROM trapper.staged_records sr
        WHERE pcr.source_system = 'shelterluv'
          AND pcr.source_table = 'events'
          AND sr.source_system = 'shelterluv'
          AND sr.source_table = 'events'
          AND sr.is_processed = TRUE
          -- Match person in AssociatedRecords via shelterluv_id
          AND EXISTS (
              SELECT 1 FROM trapper.person_identifiers pi
              WHERE pi.person_id = pcr.person_id
                AND pi.id_type = 'shelterluv_id'
                AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(sr.payload->'AssociatedRecords') r
                    WHERE r->>'Type' = 'Person' AND r->>'Id' = pi.id_value_norm
                )
          )
          -- Match cat in AssociatedRecords via shelterluv_id
          AND EXISTS (
              SELECT 1 FROM trapper.cat_identifiers ci
              WHERE ci.cat_id = pcr.cat_id
                AND ci.id_type = 'shelterluv_id'
                AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(sr.payload->'AssociatedRecords') r
                    WHERE r->>'Type' = 'Animal' AND r->>'Id' = ci.id_value
                )
          )
          AND pcr.source_row_hash IS NULL
        RETURNING pcr.person_cat_id
    )
    SELECT COUNT(*) INTO v_backfilled FROM hash_updates;

    RAISE NOTICE 'Backfilled source_row_hash for % relationships', v_backfilled;

    -- Step 2: Flag relationships where latest staged_record has different hash
    WITH latest_staged AS (
        SELECT DISTINCT ON (source_row_id)
            source_row_id,
            row_hash,
            payload,
            created_at
        FROM trapper.staged_records
        WHERE source_system = 'shelterluv'
          AND source_table = 'events'
          AND payload->>'Type' LIKE 'Outcome.%'
        ORDER BY source_row_id, created_at DESC
    ),
    stale_rels AS (
        UPDATE trapper.person_cat_relationships pcr
        SET has_stale_source = TRUE,
            last_verified_at = NOW()
        FROM latest_staged ls
        WHERE pcr.source_system = 'shelterluv'
          AND pcr.source_table = 'events'
          -- Match via person's shelterluv_id in AssociatedRecords
          AND EXISTS (
              SELECT 1 FROM trapper.person_identifiers pi
              WHERE pi.person_id = pcr.person_id
                AND pi.id_type = 'shelterluv_id'
                AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(ls.payload->'AssociatedRecords') r
                    WHERE r->>'Type' = 'Person' AND r->>'Id' = pi.id_value_norm
                )
          )
          -- Match via cat's shelterluv_id in AssociatedRecords
          AND EXISTS (
              SELECT 1 FROM trapper.cat_identifiers ci
              WHERE ci.cat_id = pcr.cat_id
                AND ci.id_type = 'shelterluv_id'
                AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(ls.payload->'AssociatedRecords') r
                    WHERE r->>'Type' = 'Animal' AND r->>'Id' = ci.id_value
                )
          )
          AND pcr.source_row_hash IS NOT NULL
          AND pcr.source_row_hash != ls.row_hash
          AND pcr.has_stale_source = FALSE
        RETURNING pcr.person_cat_id
    )
    SELECT COUNT(*) INTO v_flagged FROM stale_rels;

    RAISE NOTICE 'Flagged % relationships as stale', v_flagged;

    -- Count total SL relationships checked
    SELECT COUNT(*) INTO v_checked
    FROM trapper.person_cat_relationships
    WHERE source_system = 'shelterluv';

    RETURN QUERY SELECT v_checked, v_backfilled, v_flagged;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.detect_shelterluv_retroactive_changes IS
'Detects ShelterLuv person_cat_relationships where the source event has been updated.
Step 1: Backfills source_row_hash where missing
Step 2: Flags relationships where hash no longer matches latest staged_record
Returns counts of checked, backfilled, and flagged relationships.';

-- ============================================================================
-- Phase 5: Create reconciliation function
-- ============================================================================

\echo ''
\echo 'Phase 5: Creating reconcile_shelterluv_changes function...'

CREATE OR REPLACE FUNCTION trapper.reconcile_shelterluv_changes(
    p_mode TEXT DEFAULT 'dry_run',  -- 'dry_run' or 'update'
    p_limit INT DEFAULT 100
)
RETURNS TABLE(
    person_cat_id UUID,
    relationship_type TEXT,
    action_taken TEXT,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT
) AS $$
DECLARE
    v_rec RECORD;
    v_person_sr RECORD;
    v_new_email TEXT;
    v_new_phone TEXT;
    v_new_address TEXT;
    v_current_email TEXT;
    v_current_phone TEXT;
BEGIN
    IF p_mode NOT IN ('dry_run', 'update') THEN
        RAISE EXCEPTION 'Invalid mode: %. Use dry_run or update', p_mode;
    END IF;

    FOR v_rec IN
        SELECT
            pcr.person_cat_id,
            pcr.person_id,
            pcr.cat_id,
            pcr.relationship_type,
            pcr.source_row_hash,
            ls.row_hash as new_hash,
            ls.payload,
            ls.staged_record_id,
            -- Get person SL ID for lookup
            (SELECT r->>'Id' FROM jsonb_array_elements(ls.payload->'AssociatedRecords') r
             WHERE r->>'Type' = 'Person' LIMIT 1) as person_sl_id
        FROM trapper.person_cat_relationships pcr
        JOIN (
            SELECT DISTINCT ON (source_row_id)
                id as staged_record_id,
                source_row_id,
                row_hash,
                payload
            FROM trapper.staged_records
            WHERE source_system = 'shelterluv'
              AND source_table = 'events'
              AND payload->>'Type' LIKE 'Outcome.%'
            ORDER BY source_row_id, created_at DESC
        ) ls ON TRUE
        JOIN trapper.person_identifiers pi ON pi.person_id = pcr.person_id AND pi.id_type = 'shelterluv_id'
        JOIN trapper.cat_identifiers ci ON ci.cat_id = pcr.cat_id AND ci.id_type = 'shelterluv_id'
        WHERE pcr.has_stale_source = TRUE
          AND pcr.source_system = 'shelterluv'
          -- Match via AssociatedRecords
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ls.payload->'AssociatedRecords') r
              WHERE r->>'Type' = 'Person' AND r->>'Id' = pi.id_value_norm
          )
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(ls.payload->'AssociatedRecords') r
              WHERE r->>'Type' = 'Animal' AND r->>'Id' = ci.id_value
          )
        LIMIT p_limit
    LOOP
        -- Look up the person's staged_record for updated contact info
        SELECT sr.payload INTO v_person_sr
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'shelterluv'
          AND sr.source_table = 'people'
          AND (sr.source_row_id = v_rec.person_sl_id
               OR sr.payload->>'Internal ID (API)' = v_rec.person_sl_id)
        ORDER BY sr.created_at DESC
        LIMIT 1;

        IF v_person_sr IS NOT NULL THEN
            v_new_email := LOWER(TRIM(COALESCE(
                v_person_sr.payload->>'Primary Email',
                v_person_sr.payload->>'Email'
            )));
            v_new_phone := trapper.norm_phone_us(COALESCE(
                v_person_sr.payload->>'Primary Phone',
                v_person_sr.payload->>'Phone'
            ));
            v_new_address := NULLIF(TRIM(CONCAT_WS(', ',
                NULLIF(TRIM(v_person_sr.payload->>'Street Address 1'), ''),
                NULLIF(TRIM(v_person_sr.payload->>'City'), ''),
                NULLIF(TRIM(v_person_sr.payload->>'State'), ''),
                NULLIF(TRIM(v_person_sr.payload->>'Zip'), '')
            )), '');

            -- Get current person values
            SELECT p.primary_email, p.primary_phone
            INTO v_current_email, v_current_phone
            FROM trapper.sot_people p
            WHERE p.person_id = v_rec.person_id;

            -- Report email changes
            IF v_new_email IS NOT NULL AND v_new_email != ''
               AND v_current_email IS DISTINCT FROM v_new_email THEN
                person_cat_id := v_rec.person_cat_id;
                relationship_type := v_rec.relationship_type;
                action_taken := CASE WHEN p_mode = 'dry_run' THEN 'would_update_person_email' ELSE 'updated_person_email' END;
                field_name := 'primary_email';
                old_value := v_current_email;
                new_value := v_new_email;
                RETURN NEXT;

                IF p_mode = 'update' THEN
                    -- Log the change
                    INSERT INTO trapper.entity_edits (
                        entity_type, entity_id, edit_type, field_name,
                        old_value, new_value, reason, edited_by, edit_source
                    ) VALUES (
                        'person', v_rec.person_id, 'field_update', 'primary_email',
                        to_jsonb(v_current_email), to_jsonb(v_new_email),
                        'Retroactive ShelterLuv update detected', 'reconcile_shelterluv_changes', 'system'
                    );

                    -- Update person email
                    UPDATE trapper.sot_people
                    SET primary_email = v_new_email
                    WHERE person_id = v_rec.person_id;

                    -- Also update person_identifiers
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                    VALUES (v_rec.person_id, 'email', v_new_email, v_new_email, 'shelterluv')
                    ON CONFLICT DO NOTHING;
                END IF;
            END IF;

            -- Report phone changes
            IF v_new_phone IS NOT NULL AND v_new_phone != ''
               AND v_current_phone IS DISTINCT FROM v_new_phone THEN
                person_cat_id := v_rec.person_cat_id;
                relationship_type := v_rec.relationship_type;
                action_taken := CASE WHEN p_mode = 'dry_run' THEN 'would_update_person_phone' ELSE 'updated_person_phone' END;
                field_name := 'primary_phone';
                old_value := v_current_phone;
                new_value := v_new_phone;
                RETURN NEXT;

                IF p_mode = 'update' THEN
                    -- Log the change
                    INSERT INTO trapper.entity_edits (
                        entity_type, entity_id, edit_type, field_name,
                        old_value, new_value, reason, edited_by, edit_source
                    ) VALUES (
                        'person', v_rec.person_id, 'field_update', 'primary_phone',
                        to_jsonb(v_current_phone), to_jsonb(v_new_phone),
                        'Retroactive ShelterLuv update detected', 'reconcile_shelterluv_changes', 'system'
                    );

                    -- Update person phone
                    UPDATE trapper.sot_people
                    SET primary_phone = v_new_phone
                    WHERE person_id = v_rec.person_id;

                    -- Also update person_identifiers
                    INSERT INTO trapper.person_identifiers (person_id, id_type, id_value, id_value_norm, source_system)
                    VALUES (v_rec.person_id, 'phone', v_new_phone, v_new_phone, 'shelterluv')
                    ON CONFLICT DO NOTHING;
                END IF;
            END IF;
        END IF;

        -- Mark relationship as no longer stale (regardless of whether changes were found)
        IF p_mode = 'update' THEN
            UPDATE trapper.person_cat_relationships
            SET source_row_hash = v_rec.new_hash,
                has_stale_source = FALSE,
                last_verified_at = NOW()
            WHERE person_cat_id = v_rec.person_cat_id;

            -- Report reconciliation completed
            person_cat_id := v_rec.person_cat_id;
            relationship_type := v_rec.relationship_type;
            action_taken := 'reconciled';
            field_name := 'source_row_hash';
            old_value := v_rec.source_row_hash;
            new_value := v_rec.new_hash;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.reconcile_shelterluv_changes IS
'Reconciles person_cat_relationships where ShelterLuv data has been retroactively changed.

Modes:
  - dry_run: Report what would change without modifying data
  - update: Apply changes to sot_people, person_identifiers, and update relationship hash

What it reconciles:
  - Person email changes → updates sot_people.primary_email and person_identifiers
  - Person phone changes → updates sot_people.primary_phone and person_identifiers
  - All changes logged to entity_edits with before/after values

Usage:
  -- Check what needs reconciliation:
  SELECT * FROM trapper.reconcile_shelterluv_changes(''dry_run'', 100);

  -- Apply changes:
  SELECT * FROM trapper.reconcile_shelterluv_changes(''update'', 100);';

-- ============================================================================
-- Phase 6: Create summary view
-- ============================================================================

\echo ''
\echo 'Phase 6: Creating v_shelterluv_change_status view...'

CREATE OR REPLACE VIEW trapper.v_shelterluv_change_status AS
SELECT
    'Total SL relationships' as category,
    COUNT(*) as count
FROM trapper.person_cat_relationships
WHERE source_system = 'shelterluv'

UNION ALL

SELECT
    'With source_row_hash' as category,
    COUNT(*) as count
FROM trapper.person_cat_relationships
WHERE source_system = 'shelterluv'
  AND source_row_hash IS NOT NULL

UNION ALL

SELECT
    'Stale (needs reconciliation)' as category,
    COUNT(*) as count
FROM trapper.person_cat_relationships
WHERE source_system = 'shelterluv'
  AND has_stale_source = TRUE

UNION ALL

SELECT
    'Hash mismatch detected' as category,
    COUNT(*) as count
FROM trapper.v_retroactive_shelterluv_changes;

COMMENT ON VIEW trapper.v_shelterluv_change_status IS
'Summary of ShelterLuv retroactive change detection status.
Shows total relationships, those with tracking hashes, and those needing reconciliation.';

-- ============================================================================
-- Phase 7: Run initial detection
-- ============================================================================

\echo ''
\echo 'Phase 7: Running initial detection...'

SELECT * FROM trapper.detect_shelterluv_retroactive_changes();

-- Show current status
\echo ''
\echo 'Current ShelterLuv change status:'
SELECT * FROM trapper.v_shelterluv_change_status;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_904 Complete!'
\echo '=============================================='
\echo ''
\echo 'ShelterLuv now has retroactive change detection (matching MIG_898 pattern):'
\echo '  1. source_row_hash on person_cat_relationships tracks which staged_record version'
\echo '  2. has_stale_source flag marks relationships needing reconciliation'
\echo '  3. v_retroactive_shelterluv_changes shows detailed mismatches'
\echo '  4. detect_shelterluv_retroactive_changes() flags stale relationships'
\echo '  5. reconcile_shelterluv_changes() applies changes with full audit trail'
\echo ''
\echo 'Usage:'
\echo '  -- Run detection (safe, read-mostly):'
\echo '  SELECT * FROM trapper.detect_shelterluv_retroactive_changes();'
\echo ''
\echo '  -- Check status:'
\echo '  SELECT * FROM trapper.v_shelterluv_change_status;'
\echo ''
\echo '  -- Preview reconciliation:'
\echo '  SELECT * FROM trapper.reconcile_shelterluv_changes(''dry_run'', 100);'
\echo ''
\echo '  -- Apply reconciliation:'
\echo '  SELECT * FROM trapper.reconcile_shelterluv_changes(''update'', 100);'
\echo ''
