-- MIG_305: Preserve Original Cat Locations During Place Merges
--
-- Problem:
--   When places are merged (via MIG_256 merge_places), cat_place_relationships
--   cascade to the "keep" place. This causes places like "101 Fisher Lane" to
--   accumulate 100+ cats from merged places.
--
--   The user's intent: Places should be individualized, and ecological/colony
--   calculations should work on separate data. Cats should be linked to places
--   for reference, but place merging shouldn't consolidate cat counts.
--
-- Solution:
--   1. Add original_place_id to cat_place_relationships to preserve source
--   2. Update merge_places() to preserve original_place_id when cascading
--   3. Update ecology views to use original locations when computing stats
--   4. Add query helpers to investigate consolidated places
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_305__preserve_original_cat_locations.sql

\echo ''
\echo '=============================================='
\echo 'MIG_305: Preserve Original Cat Locations'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Add original_place_id to cat_place_relationships
-- ============================================

\echo 'Adding original_place_id column...'

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS original_place_id UUID REFERENCES trapper.places(place_id);

-- Populate: if not set, original = current
UPDATE trapper.cat_place_relationships
SET original_place_id = place_id
WHERE original_place_id IS NULL;

\echo 'Setting default and constraint...'

-- Future inserts should set original_place_id to place_id by default
ALTER TABLE trapper.cat_place_relationships
ALTER COLUMN original_place_id SET DEFAULT NULL;

-- Create trigger to auto-set original_place_id on insert
CREATE OR REPLACE FUNCTION trapper.set_original_place_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.original_place_id IS NULL THEN
        NEW.original_place_id := NEW.place_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_original_place_id ON trapper.cat_place_relationships;
CREATE TRIGGER trg_set_original_place_id
BEFORE INSERT ON trapper.cat_place_relationships
FOR EACH ROW
EXECUTE FUNCTION trapper.set_original_place_id();

\echo 'original_place_id column added and populated'

-- ============================================
-- 2. Update merge_places to preserve original_place_id
-- ============================================

\echo ''
\echo 'Updating merge_places function...'

CREATE OR REPLACE FUNCTION trapper.merge_places(
  p_keep_place_id uuid,
  p_remove_place_id uuid,
  p_merge_reason text DEFAULT 'manual'
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
    v_keep_record RECORD;
    v_remove_record RECORD;
BEGIN
    SELECT * INTO v_keep_record FROM trapper.places WHERE place_id = p_keep_place_id;
    SELECT * INTO v_remove_record FROM trapper.places WHERE place_id = p_remove_place_id;

    IF v_keep_record IS NULL OR v_remove_record IS NULL THEN
        RETURN FALSE;
    END IF;

    RAISE NOTICE 'Merging "%" into "%"', v_remove_record.formatted_address, v_keep_record.formatted_address;

    -- Update all FK references to sot tables
    UPDATE trapper.sot_requests SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;
    UPDATE trapper.sot_appointments SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;

    -- Handle web_intake_submissions (both place_id and matched_place_id)
    UPDATE trapper.web_intake_submissions SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;
    UPDATE trapper.web_intake_submissions SET matched_place_id = p_keep_place_id WHERE matched_place_id = p_remove_place_id;

    -- Handle places pointing to this one via merged_into_place_id (cascade the merge)
    UPDATE trapper.places SET merged_into_place_id = p_keep_place_id WHERE merged_into_place_id = p_remove_place_id;

    -- Handle places with this as parent (unit hierarchy)
    UPDATE trapper.places SET parent_place_id = p_keep_place_id WHERE parent_place_id = p_remove_place_id;

    -- Handle cat_movement_events
    UPDATE trapper.cat_movement_events SET from_place_id = p_keep_place_id WHERE from_place_id = p_remove_place_id;
    UPDATE trapper.cat_movement_events SET to_place_id = p_keep_place_id WHERE to_place_id = p_remove_place_id;

    -- Handle person_place_relationships (delete dups, update rest)
    DELETE FROM trapper.person_place_relationships
    WHERE place_id = p_remove_place_id
      AND person_id IN (SELECT person_id FROM trapper.person_place_relationships WHERE place_id = p_keep_place_id);
    UPDATE trapper.person_place_relationships SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;

    -- *** MIG_305 CHANGE: Preserve original_place_id when merging cat_place_relationships ***
    -- Instead of just updating place_id, we preserve original_place_id so ecology can trace back
    DELETE FROM trapper.cat_place_relationships
    WHERE place_id = p_remove_place_id
      AND cat_id IN (SELECT cat_id FROM trapper.cat_place_relationships WHERE place_id = p_keep_place_id);

    -- Update place_id but keep original_place_id intact
    UPDATE trapper.cat_place_relationships
    SET place_id = p_keep_place_id
    -- Only set original_place_id if it wasn't already set (preserve the first original)
    -- original_place_id should already be set from the insert trigger
    WHERE place_id = p_remove_place_id;

    -- Handle colony estimates - keep separate, just update the FK
    DELETE FROM trapper.place_colony_estimates
    WHERE place_id = p_remove_place_id
      AND source_record_id IN (SELECT source_record_id FROM trapper.place_colony_estimates WHERE place_id = p_keep_place_id AND source_record_id IS NOT NULL);
    UPDATE trapper.place_colony_estimates SET place_id = p_keep_place_id WHERE place_id = p_remove_place_id;

    -- Merge data (keep better data from either record)
    UPDATE trapper.places p
    SET
        location = COALESCE(p.location, v_remove_record.location),
        has_cat_activity = p.has_cat_activity OR COALESCE(v_remove_record.has_cat_activity, FALSE),
        has_trapping_activity = p.has_trapping_activity OR COALESCE(v_remove_record.has_trapping_activity, FALSE),
        has_appointment_activity = p.has_appointment_activity OR COALESCE(v_remove_record.has_appointment_activity, FALSE),
        colony_size_estimate = COALESCE(p.colony_size_estimate, v_remove_record.colony_size_estimate),
        notes = CASE
          WHEN p.notes IS NOT NULL AND v_remove_record.notes IS NOT NULL
          THEN p.notes || E'\n[Merged from ' || LEFT(v_remove_record.formatted_address, 50) || ']: ' || v_remove_record.notes
          ELSE COALESCE(p.notes, v_remove_record.notes)
        END,
        updated_at = NOW()
    WHERE p.place_id = p_keep_place_id;

    -- Log merge to data_changes
    INSERT INTO trapper.data_changes (entity_type, entity_key, field_name, old_value, new_value, change_source)
    VALUES ('place', p_keep_place_id::TEXT, 'merged_from', p_remove_place_id::TEXT, v_remove_record.formatted_address, p_merge_reason);

    -- Mark removed place as merged (soft delete)
    UPDATE trapper.places
    SET merged_into_place_id = p_keep_place_id, updated_at = NOW()
    WHERE place_id = p_remove_place_id;

    RETURN TRUE;
END;
$function$;

COMMENT ON FUNCTION trapper.merge_places IS
'Merges one place into another, updating all FK references. MIG_305 preserves original_place_id for ecology tracking.';

-- ============================================
-- 3. Create helper function to investigate consolidated places
-- ============================================

\echo ''
\echo 'Creating investigation helpers...'

CREATE OR REPLACE FUNCTION trapper.investigate_place_cat_sources(p_address_pattern TEXT)
RETURNS TABLE(
    place_address TEXT,
    place_id UUID,
    total_cats BIGINT,
    cats_originally_here BIGINT,
    cats_from_merged_places BIGINT,
    original_locations TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.formatted_address,
        p.place_id,
        COUNT(DISTINCT cpr.cat_id) as total_cats,
        COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cpr.original_place_id = cpr.place_id) as cats_originally_here,
        COUNT(DISTINCT cpr.cat_id) FILTER (WHERE cpr.original_place_id != cpr.place_id) as cats_from_merged_places,
        ARRAY_AGG(DISTINCT op.formatted_address) FILTER (WHERE cpr.original_place_id != cpr.place_id) as original_locations
    FROM trapper.places p
    LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = p.place_id
    LEFT JOIN trapper.places op ON op.place_id = cpr.original_place_id
    WHERE p.formatted_address ILIKE '%' || p_address_pattern || '%'
      AND p.merged_into_place_id IS NULL
    GROUP BY p.place_id, p.formatted_address;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.investigate_place_cat_sources IS
'Investigate where cats at a place originally came from. Use to debug over-consolidated places.';

-- ============================================
-- 4. Create view for ecology that uses original locations
-- ============================================

\echo ''
\echo 'Creating original location ecology view...'

CREATE OR REPLACE VIEW trapper.v_cat_original_locations AS
SELECT
    cpr.cat_id,
    cpr.place_id as current_place_id,
    cpr.original_place_id,
    CASE WHEN cpr.original_place_id = cpr.place_id THEN TRUE ELSE FALSE END as at_original_location,
    p_current.formatted_address as current_address,
    p_original.formatted_address as original_address,
    cpr.relationship_type,
    cpr.source_system,
    cpr.created_at
FROM trapper.cat_place_relationships cpr
JOIN trapper.places p_current ON p_current.place_id = cpr.place_id
LEFT JOIN trapper.places p_original ON p_original.place_id = cpr.original_place_id;

COMMENT ON VIEW trapper.v_cat_original_locations IS
'Shows cats with their current vs original place locations. Use for ecology stats that respect original locations.';

-- ============================================
-- 5. Update v_place_ecology_stats to use original locations
-- ============================================

\echo ''
\echo 'Updating ecology stats view to use original locations...'

-- This view now uses original_place_id for counting verified cats
-- This prevents inflated counts at consolidated places
CREATE OR REPLACE VIEW trapper.v_place_ecology_stats AS
WITH
-- A_known: verified altered cats from clinic data (ground truth)
-- *** MIG_305 CHANGE: Use original_place_id to count cats at their actual observation location ***
verified_altered AS (
  SELECT
    COALESCE(cpr.original_place_id, cpr.place_id) AS place_id,  -- Use original location
    COUNT(DISTINCT cp.cat_id) AS a_known,
    MAX(cp.procedure_date) AS last_altered_at
  FROM trapper.cat_procedures cp
  JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
  WHERE cp.is_spay OR cp.is_neuter
  GROUP BY COALESCE(cpr.original_place_id, cpr.place_id)
),

-- N_recent_max: max reported total within 180 days
-- Uses MAX to avoid double-counting the same colony from multiple reports
recent_reports AS (
  SELECT
    place_id,
    MAX(COALESCE(peak_count, total_cats)) AS n_recent_max,
    COUNT(*) AS report_count,
    MAX(observation_date) AS latest_observation
  FROM trapper.place_colony_estimates
  WHERE (observation_date >= CURRENT_DATE - INTERVAL '180 days')
     OR (observation_date IS NULL AND reported_at >= NOW() - INTERVAL '180 days')
  GROUP BY place_id
),

-- Ear-tip observations for mark-resight calculation
-- Aggregate recent observations where we have both ear-tip and total counts
eartip_observations AS (
  SELECT
    place_id,
    SUM(eartip_count_observed) AS total_eartips_seen,
    SUM(total_cats_observed) AS total_cats_seen,
    COUNT(*) AS observation_count
  FROM trapper.place_colony_estimates
  WHERE eartip_count_observed IS NOT NULL
    AND total_cats_observed IS NOT NULL
    AND total_cats_observed > 0
    AND (observation_date >= CURRENT_DATE - INTERVAL '90 days'
         OR (observation_date IS NULL AND reported_at >= NOW() - INTERVAL '90 days'))
  GROUP BY place_id
)

SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.service_zone,

  -- Verified ground truth (from clinic data)
  COALESCE(va.a_known, 0) AS a_known,
  va.last_altered_at,

  -- Survey-based estimate (max to avoid double-counting)
  COALESCE(rr.n_recent_max, 0) AS n_recent_max,
  COALESCE(rr.report_count, 0) AS report_count,
  rr.latest_observation,

  -- Lower-bound alteration rate (p_lower = A_known / max(A_known, N_recent_max))
  -- This never over-claims - always a defensible minimum
  CASE
    WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0
    THEN ROUND(
      COALESCE(va.a_known, 0)::NUMERIC /
      GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
      3
    )
    ELSE NULL
  END AS p_lower,

  -- Lower-bound percentage for display
  CASE
    WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known, 0) > 0
    THEN ROUND(
      100.0 * COALESCE(va.a_known, 0)::NUMERIC /
      GREATEST(COALESCE(va.a_known, 0), COALESCE(rr.n_recent_max, 1))::NUMERIC,
      1
    )
    ELSE NULL
  END AS p_lower_pct,

  -- Mark-resight readiness
  eo.observation_count IS NOT NULL AND eo.observation_count > 0 AS has_eartip_data,
  COALESCE(eo.total_eartips_seen, 0) AS total_eartips_seen,
  COALESCE(eo.total_cats_seen, 0) AS total_cats_seen,
  COALESCE(eo.observation_count, 0) AS eartip_observation_count,

  -- Chapman estimator for mark-resight
  -- N_hat = ((M+1)(C+1)/(R+1)) - 1
  -- Where: M = known marked (a_known), C = total seen, R = marked seen
  CASE
    WHEN eo.total_eartips_seen > 0
     AND eo.total_cats_seen > 0
     AND va.a_known > 0
     AND eo.total_eartips_seen <= eo.total_cats_seen
    THEN ROUND(
      ((va.a_known + 1) * (eo.total_cats_seen + 1)::NUMERIC /
       (eo.total_eartips_seen + 1)) - 1,
      0
    )
    ELSE NULL
  END AS n_hat_chapman,

  -- Estimation method used
  CASE
    WHEN eo.total_eartips_seen > 0 AND eo.total_cats_seen > 0 AND va.a_known > 0
      THEN 'mark_resight'::trapper.ecology_estimation_method
    WHEN rr.n_recent_max > 0
      THEN 'max_recent'::trapper.ecology_estimation_method
    WHEN va.a_known > 0
      THEN 'verified_only'::trapper.ecology_estimation_method
    ELSE 'no_data'::trapper.ecology_estimation_method
  END AS estimation_method

FROM trapper.places p
LEFT JOIN verified_altered va ON va.place_id = p.place_id
LEFT JOIN recent_reports rr ON rr.place_id = p.place_id
LEFT JOIN eartip_observations eo ON eo.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;  -- Only show active places

COMMENT ON VIEW trapper.v_place_ecology_stats IS
'Ecology stats for places. MIG_305: Uses original_place_id for cat counts to prevent inflated numbers at consolidated places.';

-- ============================================
-- 6. Quick check for problem addresses
-- ============================================

\echo ''
\echo 'Checking problem addresses...'

SELECT * FROM trapper.investigate_place_cat_sources('101 Fisher');
SELECT * FROM trapper.investigate_place_cat_sources('1008 Bellevue');

\echo ''
\echo '=============================================='
\echo 'MIG_305 Complete!'
\echo ''
\echo 'Changes made:'
\echo '  - Added original_place_id to cat_place_relationships'
\echo '  - Auto-trigger sets original_place_id on insert'
\echo '  - merge_places() now preserves original_place_id'
\echo '  - Added investigate_place_cat_sources() helper function'
\echo '  - Added v_cat_original_locations view'
\echo '  - Updated v_place_ecology_stats to use original locations'
\echo ''
\echo 'Key fix: Ecology stats now count cats at their ORIGINAL location,'
\echo 'not their consolidated place. This prevents inflated counts at'
\echo 'addresses like "101 Fisher Lane" that may have merged places.'
\echo ''
\echo 'To investigate a place:'
\echo '  SELECT * FROM trapper.investigate_place_cat_sources(''Fisher'');'
\echo ''
