-- MIG_306: Immigration Tracking for Cat Populations
--
-- Adds arrival_type to cat_place_relationships to distinguish:
--   - Cats that were born at a location (born_locally)
--   - Cats that arrived as adults (immigrated)
--   - Cats relocated by FFSC (relocated)
--
-- This completes Beacon Gap #4: Colony Immigration vs Local Births
--
-- Inference rules:
--   - If cat has birth_event at this place → born_locally
--   - If cat first seen as kitten (<6 months) → likely_local_birth
--   - If cat first seen as adult (>6 months) → likely_immigrated
--   - If cat has movement_event TO this place → relocated/immigrated
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_306__immigration_tracking.sql

\echo ''
\echo '=============================================='
\echo 'MIG_306: Immigration Tracking'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Add arrival_type enum and column
-- ============================================

\echo 'Creating arrival_type enum...'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cat_arrival_type') THEN
    CREATE TYPE trapper.cat_arrival_type AS ENUM (
      'born_locally',       -- Confirmed born at this location
      'likely_local_birth', -- First seen as kitten, probably born here
      'immigrated',         -- Arrived as adult from unknown origin
      'relocated',          -- Moved here by FFSC/trapper
      'adopted_in',         -- Adopted into this location
      'unknown'             -- Cannot determine
    );
  END IF;
END$$;

\echo 'Adding arrival_type column...'

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS arrival_type trapper.cat_arrival_type DEFAULT 'unknown';

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS arrival_date DATE;

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS age_at_arrival_months INTEGER;

COMMENT ON COLUMN trapper.cat_place_relationships.arrival_type IS
'How the cat arrived at this location: born_locally, likely_local_birth, immigrated, relocated, adopted_in, unknown';

COMMENT ON COLUMN trapper.cat_place_relationships.arrival_date IS
'Date the cat first appeared at this location (if known)';

COMMENT ON COLUMN trapper.cat_place_relationships.age_at_arrival_months IS
'Estimated age in months when cat first appeared (used to infer arrival_type)';

-- ============================================
-- 2. Create function to infer arrival_type
-- ============================================

\echo 'Creating arrival type inference function...'

CREATE OR REPLACE FUNCTION trapper.infer_cat_arrival_type(
  p_cat_id UUID,
  p_place_id UUID
)
RETURNS trapper.cat_arrival_type AS $$
DECLARE
  v_has_birth_event BOOLEAN;
  v_has_movement_to BOOLEAN;
  v_first_age_months INTEGER;
  v_arrival_type trapper.cat_arrival_type;
BEGIN
  -- Check if cat has birth event at this place
  SELECT EXISTS (
    SELECT 1 FROM trapper.cat_birth_events cbe
    WHERE cbe.cat_id = p_cat_id AND cbe.place_id = p_place_id
  ) INTO v_has_birth_event;

  IF v_has_birth_event THEN
    RETURN 'born_locally';
  END IF;

  -- Check if cat was moved TO this place via movement event
  SELECT EXISTS (
    SELECT 1 FROM trapper.cat_movement_events cme
    WHERE cme.cat_id = p_cat_id
      AND cme.to_place_id = p_place_id
      AND cme.movement_type IN ('relocation', 'adoption')
  ) INTO v_has_movement_to;

  IF v_has_movement_to THEN
    RETURN 'relocated';
  END IF;

  -- Try to infer from age at first appointment at this place
  SELECT
    EXTRACT(YEAR FROM age(a.appointment_date, c.birth_date)) * 12 +
    EXTRACT(MONTH FROM age(a.appointment_date, c.birth_date))
  INTO v_first_age_months
  FROM trapper.sot_cats c
  JOIN trapper.sot_appointments a ON a.cat_id = c.cat_id
  WHERE c.cat_id = p_cat_id
    AND c.birth_date IS NOT NULL
    AND a.place_id = p_place_id
  ORDER BY a.appointment_date ASC
  LIMIT 1;

  IF v_first_age_months IS NOT NULL THEN
    IF v_first_age_months < 6 THEN
      RETURN 'likely_local_birth';
    ELSE
      RETURN 'immigrated';
    END IF;
  END IF;

  -- Cannot determine
  RETURN 'unknown';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.infer_cat_arrival_type IS
'Infers how a cat arrived at a location based on birth events, movements, and age at first sighting.';

-- ============================================
-- 3. Populate arrival_type for existing records
-- ============================================

\echo 'Inferring arrival_type for existing cat-place relationships...'

-- This may take a while for large datasets, so we batch it
DO $$
DECLARE
  v_batch_size INT := 1000;
  v_updated INT := 0;
  v_total INT := 0;
BEGIN
  -- Count records needing update
  SELECT COUNT(*) INTO v_total
  FROM trapper.cat_place_relationships
  WHERE arrival_type = 'unknown' OR arrival_type IS NULL;

  RAISE NOTICE 'Inferring arrival_type for % records...', v_total;

  -- Update in batches
  LOOP
    WITH batch AS (
      SELECT cat_place_id, cat_id, place_id
      FROM trapper.cat_place_relationships
      WHERE arrival_type = 'unknown' OR arrival_type IS NULL
      LIMIT v_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE trapper.cat_place_relationships cpr
    SET arrival_type = trapper.infer_cat_arrival_type(b.cat_id, b.place_id)
    FROM batch b
    WHERE cpr.cat_place_id = b.cat_place_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    EXIT WHEN v_updated = 0;

    RAISE NOTICE 'Updated % records...', v_updated;
  END LOOP;
END$$;

-- ============================================
-- 4. Create view for immigration analysis
-- ============================================

\echo 'Creating immigration analysis view...'

CREATE OR REPLACE VIEW trapper.v_place_immigration_stats AS
SELECT
  p.place_id,
  p.formatted_address,
  p.display_name,
  COUNT(DISTINCT cpr.cat_id) as total_cats,
  COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cpr.arrival_type = 'born_locally') as born_locally,
  COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cpr.arrival_type = 'likely_local_birth') as likely_local_birth,
  COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cpr.arrival_type = 'immigrated') as immigrated,
  COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cpr.arrival_type = 'relocated') as relocated,
  COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cpr.arrival_type = 'adopted_in') as adopted_in,
  COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cpr.arrival_type = 'unknown') as unknown_origin,
  -- Immigration rate (cats that arrived vs born locally)
  CASE
    WHEN COUNT(DISTINCT cpr.cat_id) > 0 THEN
      ROUND(100.0 * COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cpr.arrival_type IN ('immigrated', 'relocated', 'adopted_in')) / COUNT(DISTINCT cpr.cat_id), 1)
    ELSE 0
  END as immigration_rate_pct
FROM trapper.places p
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
  AND COALESCE(p.is_ffsc_facility, FALSE) = FALSE
GROUP BY p.place_id, p.formatted_address, p.display_name
HAVING COUNT(DISTINCT cpr.cat_id) > 0;

COMMENT ON VIEW trapper.v_place_immigration_stats IS
'Immigration statistics per place - shows how cats arrived (born locally vs immigrated). Used by Beacon for population modeling.';

-- ============================================
-- 5. Summary
-- ============================================

\echo ''
\echo 'Arrival type distribution:'
SELECT arrival_type, COUNT(*) as count
FROM trapper.cat_place_relationships
GROUP BY arrival_type
ORDER BY count DESC;

\echo ''
\echo 'Sample immigration stats:'
SELECT formatted_address, total_cats, born_locally, likely_local_birth, immigrated, immigration_rate_pct
FROM trapper.v_place_immigration_stats
WHERE total_cats >= 10
ORDER BY total_cats DESC
LIMIT 10;

\echo ''
\echo '=============================================='
\echo 'MIG_306 Complete!'
\echo ''
\echo 'Added:'
\echo '  - arrival_type column on cat_place_relationships'
\echo '  - arrival_date and age_at_arrival_months columns'
\echo '  - infer_cat_arrival_type() function'
\echo '  - v_place_immigration_stats view'
\echo ''
\echo 'Beacon can now model immigration rates per location.'
\echo ''
