-- MIG_3054: Generic Soft-Merge Pattern Standardization
--
-- Part of FFS-1150 (Atlas Data Hardening), Initiative 6 (FFS-1155).
--
-- Audit findings (2026-04-06):
--
--   Entity         | merged_into_*  | merge_*_into() | safe_to_merge_*()
--   ---------------|----------------|----------------|--------------------
--   sot.people     | yes            | yes (MIG_2044) | yes (MIG_2840)
--   sot.places     | yes            | yes (MIG_2506) | yes (MIG_2840)
--   sot.cats       | yes            | NO (gap)       | yes (MIG_2835)
--   sot.addresses  | yes            | yes (MIG_2838) | yes (MIG_2838)
--   ops.requests   | yes            | yes (MIG_2839) | yes (MIG_2839)
--
-- Cats have a safety gate but no merge function — manual SQL only. That's
-- a latent risk because manual SQL can easily forget the edge cases that
-- live inside merge_person_into() (transferring identifiers, FK relinking,
-- provenance logging).
--
-- Solution:
--   1. Create sot.merge_cat_into() following the merge_person_into pattern
--      and respecting MIG_3048 manually_overridden_fields.
--   2. Create ops.merge_log generic table for cross-entity merge audit.
--   3. (Deferred to follow-up) unmerge_*() rollback functions and dry-run
--      mode — design needs more thought given how widely cat_id is
--      referenced. Tracked in FFS-1155.
--
-- Created: 2026-04-06

\echo ''
\echo '=============================================='
\echo '  MIG_3054: Merge Standardization'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. ops.merge_log — generic cross-entity merge audit
-- ============================================================================

\echo '1. Creating ops.merge_log...'

CREATE TABLE IF NOT EXISTS ops.merge_log (
  merge_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,        -- 'person'|'place'|'cat'|'address'|'request'|'appointment'
  loser_id     UUID NOT NULL,
  winner_id    UUID NOT NULL,
  reason       TEXT NOT NULL,
  changed_by   TEXT,
  fk_relinks   JSONB,                -- {table.column: row_count}
  warnings     TEXT[],
  merged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unmerged_at  TIMESTAMPTZ,
  unmerged_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_merge_log_loser
  ON ops.merge_log (loser_id);

CREATE INDEX IF NOT EXISTS idx_merge_log_winner
  ON ops.merge_log (winner_id);

CREATE INDEX IF NOT EXISTS idx_merge_log_entity_recent
  ON ops.merge_log (entity_type, merged_at DESC);

COMMENT ON TABLE ops.merge_log IS
'MIG_3054: Generic cross-entity merge audit. Captures every merge across
people, places, cats, addresses, requests, and appointments with a
structured FK relink summary. Supplements per-entity entity_edits rows
with a single queryable home for "find all cat merges in March".';

\echo '   Created ops.merge_log'

-- ============================================================================
-- 2. ops.log_merge — convenience writer
-- ============================================================================

\echo ''
\echo '2. Creating ops.log_merge helper...'

CREATE OR REPLACE FUNCTION ops.log_merge(
  p_entity_type TEXT,
  p_loser_id    UUID,
  p_winner_id   UUID,
  p_reason      TEXT,
  p_changed_by  TEXT DEFAULT NULL,
  p_fk_relinks  JSONB DEFAULT NULL,
  p_warnings    TEXT[] DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_merge_id UUID;
BEGIN
  INSERT INTO ops.merge_log (
    entity_type, loser_id, winner_id, reason,
    changed_by, fk_relinks, warnings
  ) VALUES (
    p_entity_type, p_loser_id, p_winner_id, p_reason,
    p_changed_by, p_fk_relinks, p_warnings
  )
  RETURNING merge_id INTO v_merge_id;

  RETURN v_merge_id;
END;
$$ LANGUAGE plpgsql;

\echo '   Created ops.log_merge'

-- ============================================================================
-- 3. sot.merge_cat_into — the main gap closer
-- ============================================================================
-- Mirrors sot.merge_person_into and sot.merge_address_into. Calls
-- sot.cat_safe_to_merge() as a precheck. Transfers identifiers, relinks
-- the critical FKs, transfers manually_overridden_fields (MIG_3048),
-- writes to ops.merge_log + ops.entity_edits.

\echo ''
\echo '3. Creating sot.merge_cat_into...'

CREATE OR REPLACE FUNCTION sot.merge_cat_into(
  p_loser_id   UUID,
  p_winner_id  UUID,
  p_reason     TEXT DEFAULT 'duplicate_cat',
  p_changed_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_safe_check    TEXT;
  v_loser         RECORD;
  v_winner        RECORD;
  v_relinks       JSONB := '{}'::JSONB;
  v_warnings      TEXT[] := ARRAY[]::TEXT[];
  v_merge_id      UUID;
  v_count         INT;
BEGIN
  -- Precheck via existing safety gate
  v_safe_check := sot.cat_safe_to_merge(p_loser_id, p_winner_id);
  IF v_safe_check != 'safe' THEN
    RAISE EXCEPTION 'Cat merge refused: % (loser=% winner=%)',
      v_safe_check, p_loser_id, p_winner_id;
  END IF;

  SELECT * INTO v_loser FROM sot.cats WHERE cat_id = p_loser_id;
  SELECT * INTO v_winner FROM sot.cats WHERE cat_id = p_winner_id;

  -- ── Cat identifiers (transfer + dedupe) ──
  UPDATE sot.cat_identifiers
     SET cat_id = p_winner_id
   WHERE cat_id = p_loser_id
     AND NOT EXISTS (
       SELECT 1 FROM sot.cat_identifiers ci2
       WHERE ci2.cat_id = p_winner_id
         AND ci2.id_type = cat_identifiers.id_type
         AND ci2.id_value = cat_identifiers.id_value
     );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_relinks := v_relinks || jsonb_build_object('sot.cat_identifiers', v_count);
  DELETE FROM sot.cat_identifiers WHERE cat_id = p_loser_id;

  -- ── Cat-place relationships (transfer + dedupe) ──
  BEGIN
    UPDATE sot.cat_place
       SET cat_id = p_winner_id
     WHERE cat_id = p_loser_id
       AND NOT EXISTS (
         SELECT 1 FROM sot.cat_place cp2
         WHERE cp2.cat_id = p_winner_id
           AND cp2.place_id = cat_place.place_id
           AND cp2.relationship_type = cat_place.relationship_type
       );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_relinks := v_relinks || jsonb_build_object('sot.cat_place', v_count);
    DELETE FROM sot.cat_place WHERE cat_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN
    v_warnings := array_append(v_warnings, 'sot.cat_place table does not exist');
  END;

  -- ── Person-cat relationships (transfer + dedupe) ──
  BEGIN
    UPDATE sot.person_cat
       SET cat_id = p_winner_id
     WHERE cat_id = p_loser_id
       AND NOT EXISTS (
         SELECT 1 FROM sot.person_cat pc2
         WHERE pc2.cat_id = p_winner_id
           AND pc2.person_id = person_cat.person_id
           AND pc2.relationship_type = person_cat.relationship_type
       );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_relinks := v_relinks || jsonb_build_object('sot.person_cat', v_count);
    DELETE FROM sot.person_cat WHERE cat_id = p_loser_id;
  EXCEPTION WHEN undefined_table THEN
    v_warnings := array_append(v_warnings, 'sot.person_cat table does not exist');
  END;

  -- ── Appointments ──
  UPDATE ops.appointments SET cat_id = p_winner_id WHERE cat_id = p_loser_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_relinks := v_relinks || jsonb_build_object('ops.appointments', v_count);

  -- ── Clinic day entries ──
  BEGIN
    UPDATE ops.clinic_day_entries SET cat_id = p_winner_id WHERE cat_id = p_loser_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_relinks := v_relinks || jsonb_build_object('ops.clinic_day_entries', v_count);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- ── Cat test results / procedures / lifecycle (medical history) ──
  FOR v_count IN
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'cat_test_results'
  LOOP
    EXECUTE 'UPDATE ops.cat_test_results SET cat_id = $1 WHERE cat_id = $2'
      USING p_winner_id, p_loser_id;
  END LOOP;

  FOR v_count IN
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_name = 'cat_procedures'
  LOOP
    EXECUTE 'UPDATE ops.cat_procedures SET cat_id = $1 WHERE cat_id = $2'
      USING p_winner_id, p_loser_id;
  END LOOP;

  FOR v_count IN
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_name = 'cat_lifecycle_events'
  LOOP
    EXECUTE 'UPDATE sot.cat_lifecycle_events SET cat_id = $1 WHERE cat_id = $2'
      USING p_winner_id, p_loser_id;
  END LOOP;

  -- ── MIG_3048: Transfer manually_overridden_fields from loser to winner ──
  -- Any field a human marked on the loser must remain protected on the winner.
  UPDATE sot.cats
     SET manually_overridden_fields = (
       SELECT ARRAY(
         SELECT DISTINCT unnest(
           sot.cats.manually_overridden_fields ||
           v_loser.manually_overridden_fields
         )
       )
     )
   WHERE cat_id = p_winner_id;

  -- ── Mark loser as merged ──
  UPDATE sot.cats
     SET merged_into_cat_id = p_winner_id, updated_at = NOW()
   WHERE cat_id = p_loser_id;

  -- ── Generic merge log ──
  v_merge_id := ops.log_merge(
    'cat', p_loser_id, p_winner_id, p_reason,
    p_changed_by, v_relinks, v_warnings
  );

  -- ── Per-field entity_edits ──
  INSERT INTO ops.entity_edits (
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, change_source
  ) VALUES (
    'sot.cats', p_loser_id, 'merged_into_cat_id',
    NULL, p_winner_id::TEXT, NULL, 'merge_cat_into:' || p_reason
  );

  RAISE NOTICE 'Merged cat % (%) into % (%) — relinks: %',
    p_loser_id, COALESCE(v_loser.name, '<no name>'),
    p_winner_id, COALESCE(v_winner.name, '<no name>'),
    v_relinks::TEXT;

  RETURN v_merge_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.merge_cat_into(UUID, UUID, TEXT, TEXT) IS
'MIG_3054: Soft-merge a duplicate cat into a canonical cat.
Calls sot.cat_safe_to_merge() as a precheck. Transfers cat_identifiers,
cat_place, person_cat, appointments, clinic_day_entries, test results,
procedures, and lifecycle events. Honors MIG_3048 manually_overridden_fields.
Logs to ops.merge_log + ops.entity_edits.';

\echo '   Created sot.merge_cat_into'

-- ============================================================================
-- 4. Verification
-- ============================================================================

\echo ''
\echo '4. Verification...'

SELECT
  n.nspname || '.' || p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE (n.nspname, p.proname) IN (
  ('sot', 'merge_person_into'),
  ('sot', 'merge_place_into'),
  ('sot', 'merge_cat_into'),
  ('sot', 'merge_address_into'),
  ('ops', 'merge_request_into'),
  ('ops', 'log_merge')
)
ORDER BY 1;

SELECT COUNT(*) AS merge_log_exists
FROM information_schema.tables
WHERE table_schema = 'ops' AND table_name = 'merge_log';

COMMIT;

\echo ''
\echo '=============================================='
\echo '  MIG_3054 Complete'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. Created ops.merge_log generic audit table'
\echo '  2. Created ops.log_merge() writer'
\echo '  3. Created sot.merge_cat_into() — closes the audit gap'
\echo '     (cats had safe_to_merge but no merge function)'
\echo ''
\echo 'Audit complete. All entities with merged_into_*_id columns now have'
\echo 'matching merge_*_into() functions.'
\echo ''
\echo 'Deferred to follow-up (FFS-1155):'
\echo '  - unmerge_*() rollback functions'
\echo '  - dry_run parameter on merge functions'
\echo '  - Standardize p_changed_by to UUID across all merge_*_into signatures'
\echo ''
