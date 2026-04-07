-- MIG_3058: Backfill service_area_status on existing intake submissions
--
-- Part of FFS-1181 (Out-of-Service-Area Email Pipeline epic),
-- Phase 1 / FFS-1183.
--
-- Pairs with MIG_3057 (which adds the columns + trigger). The trigger
-- only fires on INSERT/UPDATE going forward; this migration backfills
-- the historical rows.
--
-- Submissions without geocoded coords get service_area_status='unknown'.
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3058: Backfill service_area_status'
\echo '=============================================='
\echo ''

BEGIN;

\echo '1. Backfilling rows with geocoded coords...'

UPDATE ops.intake_submissions
   SET service_area_status     = sot.service_area_membership(geo_latitude::numeric, geo_longitude::numeric),
       service_area_status_set_at = NOW(),
       service_area_status_source = 'auto'
 WHERE service_area_status IS NULL
   AND geo_latitude IS NOT NULL
   AND geo_longitude IS NOT NULL;

\echo '2. Marking ungeocoded rows as unknown...'

UPDATE ops.intake_submissions
   SET service_area_status     = 'unknown',
       service_area_status_set_at = NOW(),
       service_area_status_source = 'auto'
 WHERE service_area_status IS NULL
   AND (geo_latitude IS NULL OR geo_longitude IS NULL);

\echo '3. Verification — counts by status...'

DO $$
DECLARE
  v_in INT;
  v_amb INT;
  v_out INT;
  v_unk INT;
BEGIN
  SELECT COUNT(*) INTO v_in
    FROM ops.intake_submissions WHERE service_area_status = 'in';
  SELECT COUNT(*) INTO v_amb
    FROM ops.intake_submissions WHERE service_area_status = 'ambiguous';
  SELECT COUNT(*) INTO v_out
    FROM ops.intake_submissions WHERE service_area_status = 'out';
  SELECT COUNT(*) INTO v_unk
    FROM ops.intake_submissions WHERE service_area_status = 'unknown';

  RAISE NOTICE '   in        : %', v_in;
  RAISE NOTICE '   ambiguous : %', v_amb;
  RAISE NOTICE '   out       : %', v_out;
  RAISE NOTICE '   unknown   : %', v_unk;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3058 complete'
\echo ''
