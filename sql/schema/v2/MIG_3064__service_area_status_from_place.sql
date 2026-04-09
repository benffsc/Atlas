-- MIG_3064: Service Area Status Falls Through to sot.places.location
--
-- Part of FFS-1181 Follow-Up — Phase 1 (production hardening).
--
-- Purpose: the FFS-1181 trigger from MIG_3057 only fires on changes to
-- ops.intake_submissions.geo_latitude/longitude. In production, ~0 of
-- 1303 submissions have those columns populated directly — the real
-- geographic truth lives on sot.places.location via place_id. This
-- migration fixes the trigger to:
--
--   Priority 1: if the submission has its own geo_latitude/longitude, use it
--   Priority 2: fall through to the linked sot.places.location via place_id
--
-- Also extends the BEFORE INSERT OR UPDATE trigger to fire on place_id
-- changes, so linking a place retroactively classifies the submission.
--
-- Backfills the 391 existing submissions that have a place with location
-- but status='unknown'.
--
-- Depends on:
--   - MIG_3057 (service area boundary + trigger)
--   - sot.places (location geography column)
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3064: service_area_status from places'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Replace compute_service_area_status() to read from linked place
-- ============================================================================

\echo '1. Replacing ops.compute_service_area_status()...'

CREATE OR REPLACE FUNCTION ops.compute_service_area_status()
RETURNS TRIGGER AS $$
DECLARE
  v_lat NUMERIC;
  v_lng NUMERIC;
BEGIN
  -- Never overwrite a staff override
  IF NEW.service_area_status_source = 'staff_override' THEN
    RETURN NEW;
  END IF;

  -- Priority 1: submission's own geo_latitude/geo_longitude (legacy path
  -- still used by /api/intake call sheet which geocodes inline).
  IF NEW.geo_latitude IS NOT NULL AND NEW.geo_longitude IS NOT NULL THEN
    v_lat := NEW.geo_latitude::numeric;
    v_lng := NEW.geo_longitude::numeric;
  -- Priority 2: fall through to linked sot.places.location.
  -- This is where the real geographic truth lives (MIG_3064).
  ELSIF NEW.place_id IS NOT NULL THEN
    SELECT
      ST_Y(location::geometry)::numeric,
      ST_X(location::geometry)::numeric
      INTO v_lat, v_lng
    FROM sot.places
    WHERE place_id = NEW.place_id
      AND location IS NOT NULL;
  END IF;

  IF v_lat IS NOT NULL AND v_lng IS NOT NULL THEN
    NEW.service_area_status := sot.service_area_membership(v_lat, v_lng);
    NEW.service_area_status_set_at := NOW();
    NEW.service_area_status_source := 'auto';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.compute_service_area_status IS
'MIG_3064 (FFS-1181 follow-up): Trigger function. Reads coordinates
from NEW.geo_latitude/geo_longitude if present, else falls through to
sot.places.location via NEW.place_id. Never overwrites staff_override.';

-- ============================================================================
-- 2. Extend the trigger to fire on place_id changes
-- ============================================================================

\echo '2. Recreating trigger to also fire on place_id changes...'

DROP TRIGGER IF EXISTS trg_intake_submissions_service_area
  ON ops.intake_submissions;

CREATE TRIGGER trg_intake_submissions_service_area
  BEFORE INSERT OR UPDATE OF geo_latitude, geo_longitude, place_id
  ON ops.intake_submissions
  FOR EACH ROW
  EXECUTE FUNCTION ops.compute_service_area_status();

-- ============================================================================
-- 3. Backfill existing submissions that have a place but unknown status
-- ============================================================================

\echo '3. Backfilling existing submissions from linked places...'

DO $$
DECLARE
  v_before_unknown INT;
  v_before_in INT;
  v_before_out INT;
  v_before_ambiguous INT;
  v_after_unknown INT;
  v_after_in INT;
  v_after_out INT;
  v_after_ambiguous INT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE service_area_status IS NULL OR service_area_status = 'unknown'),
    COUNT(*) FILTER (WHERE service_area_status = 'in'),
    COUNT(*) FILTER (WHERE service_area_status = 'out'),
    COUNT(*) FILTER (WHERE service_area_status = 'ambiguous')
    INTO v_before_unknown, v_before_in, v_before_out, v_before_ambiguous
    FROM ops.intake_submissions;

  RAISE NOTICE '   Before backfill:';
  RAISE NOTICE '     unknown/null : %', v_before_unknown;
  RAISE NOTICE '     in           : %', v_before_in;
  RAISE NOTICE '     out          : %', v_before_out;
  RAISE NOTICE '     ambiguous    : %', v_before_ambiguous;

  -- Backfill. We use a direct UPDATE instead of touching place_id so we
  -- don't re-fire the trigger on rows that already have an auto value.
  UPDATE ops.intake_submissions s
     SET service_area_status = sot.service_area_membership(
           ST_Y(p.location::geometry)::numeric,
           ST_X(p.location::geometry)::numeric
         ),
         service_area_status_source = 'auto',
         service_area_status_set_at = NOW()
    FROM sot.places p
   WHERE s.place_id = p.place_id
     AND p.location IS NOT NULL
     AND (s.service_area_status IS NULL OR s.service_area_status = 'unknown')
     AND (s.service_area_status_source IS NULL OR s.service_area_status_source = 'auto');

  SELECT
    COUNT(*) FILTER (WHERE service_area_status IS NULL OR service_area_status = 'unknown'),
    COUNT(*) FILTER (WHERE service_area_status = 'in'),
    COUNT(*) FILTER (WHERE service_area_status = 'out'),
    COUNT(*) FILTER (WHERE service_area_status = 'ambiguous')
    INTO v_after_unknown, v_after_in, v_after_out, v_after_ambiguous
    FROM ops.intake_submissions;

  RAISE NOTICE '   After backfill:';
  RAISE NOTICE '     unknown/null : %', v_after_unknown;
  RAISE NOTICE '     in           : %  (+%)', v_after_in, v_after_in - v_before_in;
  RAISE NOTICE '     out          : %  (+%)', v_after_out, v_after_out - v_before_out;
  RAISE NOTICE '     ambiguous    : %  (+%)', v_after_ambiguous, v_after_ambiguous - v_before_ambiguous;
END $$;

-- ============================================================================
-- 4. Verification
-- ============================================================================

\echo '4. Verification — trigger definition...'

DO $$
DECLARE
  v_trigger_def TEXT;
BEGIN
  SELECT pg_get_triggerdef(oid) INTO v_trigger_def
    FROM pg_trigger
   WHERE tgname = 'trg_intake_submissions_service_area'
     AND tgrelid = 'ops.intake_submissions'::regclass;

  IF v_trigger_def IS NULL THEN
    RAISE EXCEPTION 'trg_intake_submissions_service_area not found';
  END IF;

  IF v_trigger_def NOT LIKE '%place_id%' THEN
    RAISE EXCEPTION 'Trigger definition missing place_id: %', v_trigger_def;
  END IF;

  RAISE NOTICE '   Trigger OK: %', v_trigger_def;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3064 complete'
\echo ''
