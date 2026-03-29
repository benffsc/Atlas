-- MIG_2993: Audit Fix — Stale FKs, Appointment Divergence, Place Merges, merge_cats() Patch
--
-- FFS-881: ClinicHQ Data Quality Audit Remediation
-- FFS-882: Fix 79 appointment person_id divergence
-- FFS-885: Fix 16 stale FKs to merged cats + patch merge_cats()
-- FFS-886: Merge 3 duplicate-format address places
--
-- Created: 2026-03-27

\echo ''
\echo '=============================================='
\echo '  MIG_2993: Audit Fix — Stale FKs, Divergence, Places, merge_cats()'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- SECTION A: Fix 16 stale FKs to merged cats (FFS-885)
-- ============================================================================
-- Root cause: merge_cats() uses INSERT ON CONFLICT DO NOTHING but never
-- DELETEs the loser's old rows. 8 person_cat + 8 cat_place still reference
-- merged cat IDs from MIG_2987 merges.

\echo 'A. Fixing stale FKs to merged cats...'

DO $$
DECLARE
  v_pc_deleted INT := 0;
  v_cp_deleted INT := 0;
BEGIN
  -- A1. Delete person_cat rows pointing to merged cats
  -- The winner already has equivalent links (merge_cats copies via INSERT ON CONFLICT DO NOTHING).
  -- These stale rows exist because the old merge_cats() didn't DELETE after the copy.
  WITH deleted AS (
    DELETE FROM sot.person_cat pc
    USING sot.cats c
    WHERE pc.cat_id = c.cat_id
      AND c.merged_into_cat_id IS NOT NULL
    RETURNING pc.person_id, pc.cat_id
  )
  SELECT COUNT(*) INTO v_pc_deleted FROM deleted;

  -- A2. Delete cat_place rows pointing to merged cats (same reason)
  WITH deleted AS (
    DELETE FROM sot.cat_place cp
    USING sot.cats c
    WHERE cp.cat_id = c.cat_id
      AND c.merged_into_cat_id IS NOT NULL
    RETURNING cp.cat_id, cp.place_id
  )
  SELECT COUNT(*) INTO v_cp_deleted FROM deleted;

  RAISE NOTICE 'A: person_cat deleted=%; cat_place deleted=%',
    v_pc_deleted, v_cp_deleted;

  -- Log to entity_edits
  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES (
    'system', gen_random_uuid(), 'bulk_fix',
    jsonb_build_object(
      'person_cat_deleted', v_pc_deleted,
      'cat_place_deleted', v_cp_deleted
    ),
    jsonb_build_object('fix', 'Deleted stale FKs pointing to merged cats (winners already have links)'),
    'migration', 'migration',
    'FFS-885: Fix 16 stale FKs to merged cats (MIG_2993 Section A)',
    NOW()
  );
END $$;

\echo '  → Stale FKs fixed'

-- ============================================================================
-- SECTION B: Fix appointment person_id divergence (FFS-882)
-- ============================================================================
-- 79 appointments where appointment.person_id ≠ clinic_accounts.resolved_person_id
-- Also 2 stale clinic_accounts pointing to merged SCAS person

\echo 'B. Fixing appointment person_id divergence...'

DO $$
DECLARE
  v_stale_accounts INT := 0;
  v_synced INT := 0;
BEGIN
  -- B1. Fix stale clinic_accounts pointing to merged people
  WITH updated AS (
    UPDATE ops.clinic_accounts ca
    SET resolved_person_id = p.merged_into_person_id,
        updated_at = NOW()
    FROM sot.people p
    WHERE ca.resolved_person_id = p.person_id
      AND p.merged_into_person_id IS NOT NULL
    RETURNING ca.account_id
  )
  SELECT COUNT(*) INTO v_stale_accounts FROM updated;

  RAISE NOTICE 'B1: Fixed % stale clinic_accounts pointing to merged people', v_stale_accounts;

  -- B2. Sync appointment.person_id to match clinic_accounts.resolved_person_id
  -- The account resolution is authoritative (it runs through data_engine_resolve_identity)
  WITH updated AS (
    UPDATE ops.appointments a
    SET person_id = ca.resolved_person_id,
        updated_at = NOW()
    FROM ops.clinic_accounts ca
    WHERE a.owner_account_id = ca.account_id
      AND ca.resolved_person_id IS NOT NULL
      AND a.person_id IS NOT NULL
      AND a.person_id IS DISTINCT FROM ca.resolved_person_id
    RETURNING a.appointment_id, a.person_id AS new_person_id
  )
  SELECT COUNT(*) INTO v_synced FROM updated;

  RAISE NOTICE 'B2: Synced % appointments to match clinic_account resolution', v_synced;

  -- Log to entity_edits
  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES (
    'system', gen_random_uuid(), 'bulk_fix',
    jsonb_build_object(
      'stale_accounts_fixed', v_stale_accounts,
      'appointments_synced', v_synced
    ),
    jsonb_build_object('fix', 'Synced appointment.person_id to clinic_accounts.resolved_person_id'),
    'migration', 'migration',
    'FFS-882: Fix 79 appointment person_id divergence (MIG_2993 Section B)',
    NOW()
  );
END $$;

\echo '  → Appointment divergence fixed'

-- ============================================================================
-- SECTION C: Merge 3 duplicate-format address places (FFS-886)
-- ============================================================================

\echo 'C. Merging duplicate-format address places...'

-- C1. Westvale Court: comma variant
-- Loser: "2451, Westvale Court, Santa Rosa, CA 95403, Santa Rosa, CA 95403" (43 cats, 1 person)
-- Winner: "2451 Westvale Court, Santa Rosa, CA 95403" (9 cats, 2 persons, 6 appts)
SELECT sot.merge_place_into(
  '98a36333-f4de-4e57-a3f0-9bc7887697dc'::UUID,  -- loser
  '41e6055c-9fe0-4b3f-81e2-ba4d173d30a6'::UUID,  -- winner
  'FFS-886: Duplicate address format (comma variant)',
  'migration'
);
\echo '  → Westvale Court merged'

-- C2. Bodega Hwy: ZIP vs USA suffix
-- Loser: "Bodega Hwy, Sebastopol, CA, USA" (150 cats, 1 person)
-- Winner: "Bodega Hwy, Sebastopol, CA 95472" (150 cats, 1 person)
SELECT sot.merge_place_into(
  'a41a1185-6718-43c4-8f74-0b784df1b415'::UUID,  -- loser
  '5849c952-d62a-419c-bc1d-4ad88f61a0e9'::UUID,  -- winner
  'FFS-886: Duplicate address format (ZIP vs USA suffix)',
  'migration'
);
\echo '  → Bodega Hwy merged'

-- C3. 1080 Jennings Ave 211: #211 vs 211
-- Loser: "1080 Jennings Ave #211, Santa Rosa, CA 95401, USA" (0 cats, 1 person)
-- Winner: "1080 Jennings Ave 211, Santa Rosa, CA 95401" (4 cats, 2 persons)
SELECT sot.merge_place_into(
  'a51ba155-2fb4-4b57-ac68-afe5abd35a8d'::UUID,  -- loser
  '64622665-f3ad-4e4b-b058-dd7145fc3472'::UUID,  -- winner
  'FFS-886: Duplicate address format (#211 vs 211)',
  'migration'
);
\echo '  → 1080 Jennings Ave 211 merged'

-- ============================================================================
-- SECTION D: Patch merge_cats() to prevent stale FK recurrence (FFS-885)
-- ============================================================================
-- Add DELETE statements after INSERT ON CONFLICT DO NOTHING.
-- Without these, loser's old rows persist when the winner already has the link.

\echo 'D. Patching merge_cats() function...'

CREATE OR REPLACE FUNCTION sot.merge_cats(
  p_loser_id uuid,
  p_winner_id uuid,
  p_reason text DEFAULT 'duplicate'::text,
  p_changed_by text DEFAULT 'system'::text
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
  v_loser_name TEXT;
  v_winner_name TEXT;
BEGIN
  SELECT name INTO v_loser_name FROM sot.cats WHERE cat_id = p_loser_id;
  SELECT name INTO v_winner_name FROM sot.cats WHERE cat_id = p_winner_id;

  IF NOT EXISTS (SELECT 1 FROM sot.cats WHERE cat_id = p_loser_id AND merged_into_cat_id IS NULL) THEN
    RAISE EXCEPTION 'Loser cat % not found or already merged', p_loser_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sot.cats WHERE cat_id = p_winner_id AND merged_into_cat_id IS NULL) THEN
    RAISE EXCEPTION 'Winner cat % not found or already merged', p_winner_id;
  END IF;

  -- Reassign appointments
  UPDATE ops.appointments SET cat_id = p_winner_id WHERE cat_id = p_loser_id;

  -- Transfer identifiers (skip conflicts)
  INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, confidence, source_system, created_at)
  SELECT p_winner_id, id_type, id_value, confidence, source_system, created_at
  FROM sot.cat_identifiers WHERE cat_id = p_loser_id
  ON CONFLICT (id_type, id_value) DO NOTHING;

  -- Transfer cat_place links (skip conflicts), then DELETE loser's rows
  INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, confidence, source_system, created_at)
  SELECT p_winner_id, place_id, relationship_type, confidence, source_system, created_at
  FROM sot.cat_place WHERE cat_id = p_loser_id
  ON CONFLICT DO NOTHING;
  DELETE FROM sot.cat_place WHERE cat_id = p_loser_id;

  -- Transfer person_cat links (skip conflicts), then DELETE loser's rows
  INSERT INTO sot.person_cat (person_id, cat_id, relationship_type, confidence, source_system, created_at)
  SELECT person_id, p_winner_id, relationship_type, confidence, source_system, created_at
  FROM sot.person_cat WHERE cat_id = p_loser_id
  ON CONFLICT DO NOTHING;
  DELETE FROM sot.person_cat WHERE cat_id = p_loser_id;

  -- Copy denormalized SL ID to winner if missing
  UPDATE sot.cats
  SET shelterluv_animal_id = (SELECT shelterluv_animal_id FROM sot.cats WHERE cat_id = p_loser_id)
  WHERE cat_id = p_winner_id
    AND shelterluv_animal_id IS NULL
    AND (SELECT shelterluv_animal_id FROM sot.cats WHERE cat_id = p_loser_id) IS NOT NULL;

  -- Mark loser as merged
  UPDATE sot.cats
  SET merged_into_cat_id = p_winner_id, updated_at = NOW()
  WHERE cat_id = p_loser_id;

  -- Audit trail
  INSERT INTO sot.entity_edits (entity_type, entity_id, edit_type, old_value, new_value, edited_by, edit_source, reason, created_at)
  VALUES (
    'cat',
    p_loser_id,
    'merge',
    jsonb_build_object(
      'loser_id', p_loser_id,
      'loser_name', v_loser_name,
      'merged_into', p_winner_id,
      'winner_name', v_winner_name
    ),
    NULL,
    p_changed_by,
    'migration',
    p_reason,
    NOW()
  );

  RETURN TRUE;
END;
$function$;

COMMENT ON FUNCTION sot.merge_cats(uuid, uuid, text, text) IS
'Merge loser cat into winner. Transfers appointments, identifiers, cat_place, person_cat.
MIG_2993/FFS-885: Now DELETEs loser rows after INSERT ON CONFLICT DO NOTHING to prevent stale FKs.';

\echo '  → merge_cats() patched with DELETE after INSERT ON CONFLICT'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verification...'

DO $$
DECLARE
  v_stale_pc INT;
  v_stale_cp INT;
  v_divergent INT;
  v_stale_accts INT;
  v_westvale_merged BOOLEAN;
  v_bodega_merged BOOLEAN;
  v_jennings_merged BOOLEAN;
BEGIN
  -- Check stale FKs (expect 0)
  SELECT COUNT(*) INTO v_stale_pc
  FROM sot.person_cat pc
  JOIN sot.cats c ON pc.cat_id = c.cat_id
  WHERE c.merged_into_cat_id IS NOT NULL;

  SELECT COUNT(*) INTO v_stale_cp
  FROM sot.cat_place cp
  JOIN sot.cats c ON cp.cat_id = c.cat_id
  WHERE c.merged_into_cat_id IS NOT NULL;

  RAISE NOTICE 'Stale person_cat: % (expect 0)', v_stale_pc;
  RAISE NOTICE 'Stale cat_place: % (expect 0)', v_stale_cp;

  -- Check divergent appointments (expect 0)
  SELECT COUNT(*) INTO v_divergent
  FROM ops.appointments a
  JOIN ops.clinic_accounts ca ON a.owner_account_id = ca.account_id
  WHERE ca.resolved_person_id IS NOT NULL
    AND a.person_id IS NOT NULL
    AND a.person_id IS DISTINCT FROM ca.resolved_person_id;

  RAISE NOTICE 'Divergent appointments: % (expect 0)', v_divergent;

  -- Check stale accounts pointing to merged people (expect 0)
  SELECT COUNT(*) INTO v_stale_accts
  FROM ops.clinic_accounts ca
  JOIN sot.people p ON ca.resolved_person_id = p.person_id
  WHERE p.merged_into_person_id IS NOT NULL;

  RAISE NOTICE 'Stale clinic_accounts to merged people: % (expect 0)', v_stale_accts;

  -- Check place merges
  SELECT merged_into_place_id IS NOT NULL INTO v_westvale_merged
  FROM sot.places WHERE place_id = '98a36333-f4de-4e57-a3f0-9bc7887697dc';
  RAISE NOTICE 'Westvale Court loser merged: %', v_westvale_merged;

  SELECT merged_into_place_id IS NOT NULL INTO v_bodega_merged
  FROM sot.places WHERE place_id = 'a41a1185-6718-43c4-8f74-0b784df1b415';
  RAISE NOTICE 'Bodega Hwy loser merged: %', v_bodega_merged;

  SELECT merged_into_place_id IS NOT NULL INTO v_jennings_merged
  FROM sot.places WHERE place_id = 'a51ba155-2fb4-4b57-ac68-afe5abd35a8d';
  RAISE NOTICE 'Jennings 211 loser merged: %', v_jennings_merged;

  -- Fail-safe assertions
  IF v_stale_pc > 0 OR v_stale_cp > 0 THEN
    RAISE WARNING 'STALE FKs REMAIN — investigate before proceeding';
  END IF;

  IF v_divergent > 0 THEN
    RAISE WARNING 'APPOINTMENT DIVERGENCE REMAINS — investigate before proceeding';
  END IF;
END $$;

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_2993 COMPLETE'
\echo '=============================================='
\echo ''
