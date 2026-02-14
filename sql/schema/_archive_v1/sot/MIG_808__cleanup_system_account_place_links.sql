\echo '=== MIG_808: Root-Cause Fix for System Account Place Pollution ==='
\echo 'MAP_007: Comprehensive fix — guard function + ingestion patch + data cleanup.'
\echo ''

-- ============================================================================
-- ROOT CAUSE
-- ============================================================================
-- process_clinichq_owner_info() (MIG_574 line 296) creates person_place_relationships
-- with role='resident' for ANYONE whose email/phone appears on a ClinicHQ appointment.
-- When FFSC staff (like Sandra Nicander) are listed as the contact on appointments for
-- colony cats, they get linked to every address they've handled — hundreds of spurious
-- "resident" links that pollute map popups, search results, and place detail pages.
--
-- The same vulnerability exists in ~30 other INSERT paths across the codebase.
--
-- FIX:
-- 1. Create reusable guard function: should_link_person_to_place(person_id)
-- 2. Patch process_clinichq_owner_info() to call the guard before INSERT
-- 3. Catch any FFSC-email people not yet flagged as system accounts
-- 4. Clean up ALL existing spurious links (not just >5)
-- 5. Log everything to entity_edits
-- ============================================================================

-- ============================================================================
-- STEP 1: Create reusable guard function
-- ============================================================================

\echo 'STEP 1: Creating should_link_person_to_place() guard function...'

CREATE OR REPLACE FUNCTION trapper.should_link_person_to_place(
  p_person_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
  v_person RECORD;
BEGIN
  -- Lookup person
  SELECT
    p.is_system_account,
    p.display_name,
    EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id
        AND pi.id_type = 'email'
        AND pi.id_value_norm LIKE '%@forgottenfelines.%'
    ) as has_ffsc_email,
    EXISTS (
      SELECT 1 FROM trapper.person_roles pr
      WHERE pr.person_id = p.person_id
        AND pr.trapper_type IN ('coordinator', 'head_trapper')
        AND pr.ended_at IS NULL
    ) as is_ffsc_staff
  INTO v_person
  FROM trapper.sot_people p
  WHERE p.person_id = p_person_id;

  -- Person not found — allow (defensive)
  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  -- Block: already flagged as system account
  IF COALESCE(v_person.is_system_account, FALSE) THEN
    RETURN FALSE;
  END IF;

  -- Block: organization name (e.g., "Food Maxx RP ffsc")
  IF trapper.is_organization_name(v_person.display_name) THEN
    -- Auto-flag as system account for future
    UPDATE trapper.sot_people SET is_system_account = TRUE
    WHERE person_id = p_person_id;
    RETURN FALSE;
  END IF;

  -- Block: FFSC staff email (e.g., sandra@forgottenfelines.org)
  IF v_person.has_ffsc_email THEN
    -- Auto-flag as system account for future
    UPDATE trapper.sot_people SET is_system_account = TRUE
    WHERE person_id = p_person_id;
    RETURN FALSE;
  END IF;

  -- Block: active FFSC coordinator/head_trapper
  IF v_person.is_ffsc_staff THEN
    RETURN FALSE;
  END IF;

  -- Allow: normal person
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.should_link_person_to_place IS
'Guard function: returns FALSE for system accounts, org names, FFSC staff emails,
and coordinator/head_trapper roles. Auto-flags newly-discovered system accounts.
Call this BEFORE inserting into person_place_relationships from ingestion pipelines.';

-- ============================================================================
-- STEP 2: Patch process_clinichq_owner_info() to use the guard
-- ============================================================================

\echo 'STEP 2: Patching process_clinichq_owner_info() with system account guard...'

CREATE OR REPLACE FUNCTION trapper.process_clinichq_owner_info(
    p_batch_size INT DEFAULT 500
)
RETURNS TABLE (
    processed INT,
    people_created INT,
    people_matched INT,
    places_created INT,
    places_matched INT,
    appointments_linked INT,
    errors INT
) AS $$
DECLARE
    v_processed INT := 0;
    v_people_created INT := 0;
    v_people_matched INT := 0;
    v_places_created INT := 0;
    v_places_matched INT := 0;
    v_appointments_linked INT := 0;
    v_errors INT := 0;
    v_rec RECORD;
    v_person_id UUID;
    v_place_id UUID;
    v_decision_type TEXT;
    v_first_clean TEXT;
    v_last_clean TEXT;
BEGIN
    -- Process owner_info records
    FOR v_rec IN
        SELECT DISTINCT ON (sr.id)
            sr.id as staged_record_id,
            sr.payload,
            -- CRITICAL: Clean names to remove microchips
            trapper.clean_person_name(NULLIF(TRIM(sr.payload->>'Owner First Name'), '')) as first_name,
            trapper.clean_person_name(NULLIF(TRIM(sr.payload->>'Owner Last Name'), '')) as last_name,
            LOWER(TRIM(NULLIF(sr.payload->>'Owner Email', ''))) as email,
            trapper.norm_phone_us(
                COALESCE(
                    NULLIF(TRIM(sr.payload->>'Owner Cell Phone'), ''),
                    NULLIF(TRIM(sr.payload->>'Owner Phone'), '')
                )
            ) as phone,
            NULLIF(TRIM(sr.payload->>'Owner Address'), '') as address,
            sr.payload->>'Number' as appointment_number,
            sr.payload->>'Date' as appointment_date
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'owner_info'
          AND NOT sr.is_processed
        ORDER BY sr.id
        LIMIT p_batch_size
    LOOP
        BEGIN
            -- Skip if no usable identifiers after cleaning
            IF v_rec.email IS NULL AND v_rec.phone IS NULL THEN
                UPDATE trapper.staged_records
                SET is_processed = TRUE, processed_at = NOW()
                WHERE id = v_rec.staged_record_id;
                v_processed := v_processed + 1;
                CONTINUE;
            END IF;

            -- Resolve identity using Data Engine
            SELECT de.person_id, de.decision_type INTO v_person_id, v_decision_type
            FROM trapper.data_engine_resolve_identity(
                v_rec.email,
                v_rec.phone,
                v_rec.first_name,  -- Already cleaned above
                v_rec.last_name,   -- Already cleaned above
                v_rec.address,
                'clinichq',
                v_rec.staged_record_id
            ) de;

            IF v_person_id IS NOT NULL THEN
                IF v_decision_type IN ('new_entity', 'household_member') THEN
                    v_people_created := v_people_created + 1;
                ELSE
                    v_people_matched := v_people_matched + 1;
                END IF;

                -- Create/link place if address provided
                -- GUARD: Only link person to place if they're not a system account,
                -- org name, FFSC staff, etc. This prevents Sandra Nicander from
                -- being linked to every colony address she handles.
                IF v_rec.address IS NOT NULL AND v_rec.address != ''
                   AND trapper.should_link_person_to_place(v_person_id)
                THEN
                    v_place_id := trapper.find_or_create_place_deduped(
                        p_formatted_address := v_rec.address,
                        p_display_name := NULL,
                        p_lat := NULL,
                        p_lng := NULL,
                        p_source_system := 'clinichq'
                    );

                    IF v_place_id IS NOT NULL THEN
                        -- Link person to place
                        INSERT INTO trapper.person_place_relationships (
                            person_id, place_id, role, source_system
                        ) VALUES (
                            v_person_id, v_place_id, 'resident', 'clinichq'
                        ) ON CONFLICT (person_id, place_id, role) DO NOTHING;

                        v_places_created := v_places_created + 1;
                    END IF;
                END IF;

                -- Link to appointment if we have appointment number
                -- (appointment linking is fine — we DO want to know Sandra handled this cat,
                --  we just don't want to call her a "resident" of the address)
                IF v_rec.appointment_number IS NOT NULL THEN
                    UPDATE trapper.sot_appointments
                    SET person_id = v_person_id,
                        owner_email = v_rec.email,
                        owner_phone = v_rec.phone,
                        updated_at = NOW()
                    WHERE appointment_number = v_rec.appointment_number
                      AND person_id IS NULL;

                    IF FOUND THEN
                        v_appointments_linked := v_appointments_linked + 1;
                    END IF;
                END IF;
            END IF;

            -- Mark as processed
            UPDATE trapper.staged_records
            SET is_processed = TRUE, processed_at = NOW()
            WHERE id = v_rec.staged_record_id;

            v_processed := v_processed + 1;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE WARNING 'Error processing owner_info record %: %', v_rec.staged_record_id, SQLERRM;
        END;
    END LOOP;

    RETURN QUERY SELECT v_processed, v_people_created, v_people_matched,
                        v_places_created, v_places_matched, v_appointments_linked, v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_owner_info IS
'Processes ClinicHQ owner_info records from staged_records.
Creates/matches people, links to places and appointments.
MIG_808: Added should_link_person_to_place() guard to prevent system accounts,
org names, and FFSC staff from being linked as "residents" of client addresses.';

-- ============================================================================
-- STEP 3: Catch unflagged FFSC-email people
-- ============================================================================

\echo 'STEP 3: Flagging FFSC-email people not yet marked as system accounts...'

WITH newly_flagged AS (
  UPDATE trapper.sot_people p
  SET is_system_account = TRUE
  WHERE p.is_system_account IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.person_id = p.person_id
        AND pi.id_type = 'email'
        AND pi.id_value_norm LIKE '%@forgottenfelines.%'
    )
  RETURNING p.person_id, p.display_name
)
INSERT INTO trapper.entity_edits (
  entity_type, entity_id, field_name, old_value, new_value,
  edit_source, edit_reason, performed_by
)
SELECT
  'person',
  nf.person_id,
  'is_system_account',
  'false',
  'true',
  'migration',
  'MIG_808: Auto-flagged FFSC-email person as system account: ' || nf.display_name,
  'system'
FROM newly_flagged nf;

-- Also flag org-name people
\echo 'Flagging org-name people as system accounts...'

WITH org_flagged AS (
  UPDATE trapper.sot_people p
  SET is_system_account = TRUE
  WHERE p.is_system_account IS NOT TRUE
    AND trapper.is_organization_name(p.display_name)
  RETURNING p.person_id, p.display_name
)
INSERT INTO trapper.entity_edits (
  entity_type, entity_id, field_name, old_value, new_value,
  edit_source, edit_reason, performed_by
)
SELECT
  'person',
  of.person_id,
  'is_system_account',
  'false',
  'true',
  'migration',
  'MIG_808: Auto-flagged org-name person as system account: ' || of.display_name,
  'system'
FROM org_flagged of;

-- ============================================================================
-- STEP 4: Clean up ALL existing spurious links for system accounts
-- ============================================================================

\echo 'STEP 4: Removing ALL person_place_relationships for system accounts...'

-- Log before deleting
INSERT INTO trapper.entity_edits (
  entity_type, entity_id, field_name, old_value, new_value,
  edit_source, edit_reason, performed_by
)
SELECT
  'person',
  p.person_id,
  'person_place_relationships_count',
  link_count::text,
  '0',
  'migration',
  'MIG_808: Root-cause cleanup — removing all non-office place links for system account: ' || p.display_name,
  'system'
FROM trapper.sot_people p
JOIN (
  SELECT person_id, COUNT(*) as link_count
  FROM trapper.person_place_relationships
  GROUP BY person_id
) lc ON lc.person_id = p.person_id
WHERE p.is_system_account = TRUE
  AND lc.link_count > 0;

-- Delete ALL non-office place links for system accounts (not just >5)
WITH deleted AS (
  DELETE FROM trapper.person_place_relationships ppr
  USING trapper.sot_people p
  WHERE ppr.person_id = p.person_id
    AND p.is_system_account = TRUE
    -- Keep links to known FFSC offices
    AND NOT EXISTS (
      SELECT 1 FROM trapper.places pl
      WHERE pl.place_id = ppr.place_id
        AND pl.place_kind = 'office'
    )
  RETURNING ppr.person_id, ppr.place_id
)
SELECT
  COUNT(*) as removed_links,
  COUNT(DISTINCT person_id) as affected_accounts
FROM deleted \gset

\echo 'Removed :removed_links place links across :affected_accounts system accounts.'

-- ============================================================================
-- STEP 5: Also clean up FFSC coordinator/head_trapper place links
-- These staff members shouldn't be "residents" of client addresses either
-- ============================================================================

\echo 'STEP 5: Cleaning coordinator/head_trapper place links from clinichq source...'

WITH staff_cleanup AS (
  DELETE FROM trapper.person_place_relationships ppr
  USING trapper.person_roles pr
  WHERE ppr.person_id = pr.person_id
    AND pr.trapper_type IN ('coordinator', 'head_trapper')
    AND pr.ended_at IS NULL
    AND ppr.source_system = 'clinichq'
    -- Only remove clinichq-sourced links (they still may have legitimate home links from other sources)
    AND NOT EXISTS (
      SELECT 1 FROM trapper.places pl
      WHERE pl.place_id = ppr.place_id
        AND pl.place_kind = 'office'
    )
  RETURNING ppr.person_id, ppr.place_id
)
SELECT COUNT(*) as removed, COUNT(DISTINCT person_id) as staff_count
FROM staff_cleanup;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=================================================='
\echo 'MIG_808 Complete — Root-Cause Fix'
\echo '=================================================='
\echo ''
\echo 'Root cause: process_clinichq_owner_info() created person_place_relationships'
\echo 'with role=resident for anyone whose email/phone appeared on ClinicHQ appointments,'
\echo 'including FFSC staff who handle colony cats (not residents of client addresses).'
\echo ''
\echo 'Fixes applied:'
\echo '  1. Created should_link_person_to_place() reusable guard function'
\echo '     - Blocks: is_system_account, is_organization_name(), @forgottenfelines emails,'
\echo '       coordinator/head_trapper roles'
\echo '     - Auto-flags newly-discovered system accounts'
\echo '  2. Patched process_clinichq_owner_info() to call guard before INSERT'
\echo '     - Appointment linking preserved (we track who handled the cat)'
\echo '     - Only person_place_relationship creation is blocked'
\echo '  3. Flagged all FFSC-email and org-name people as system accounts'
\echo '  4. Cleaned ALL spurious place links for system accounts'
\echo '  5. Cleaned clinichq-sourced links for coordinator/head_trapper staff'
\echo ''
\echo 'Verification:'
\echo '  -- Should return 0 for system accounts:'
\echo '  SELECT p.display_name, COUNT(*) FROM trapper.sot_people p'
\echo '  JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id'
\echo '  WHERE p.is_system_account = TRUE GROUP BY p.display_name;'
\echo ''
\echo '  -- Guard function test (should return FALSE for Sandra):'
\echo '  SELECT trapper.should_link_person_to_place(person_id)'
\echo '  FROM trapper.sot_people WHERE display_name ILIKE ''%Sandra Nicander%'';'
\echo ''
\echo '  -- Future-proof: new clinichq ingestion runs will skip system accounts automatically'
\echo ''
