-- MIG_629: Cat Presence Tracking
--
-- Adds presence tracking to cat_place_relationships to distinguish:
--   - Current cats (seen within 18 months)
--   - Uncertain cats (seen 18-36 months ago)
--   - Departed cats (not seen in 36+ months)
--
-- This enables:
--   1. Automatic inference of cat presence based on recency
--   2. Staff confirmation of presence when historical cats are discovered
--   3. Accurate ecology calculations for individual_cats (use current only)
--   4. Reconciliation UI for staff to triage historical discoveries
--
-- MANUAL APPLY:
--   source .env && psql "$DATABASE_URL" -f sql/schema/sot/MIG_629__cat_presence_tracking.sql

\echo ''
\echo '=============================================='
\echo 'MIG_629: Cat Presence Tracking'
\echo '=============================================='
\echo ''

-- ============================================
-- 1. Add presence columns to cat_place_relationships
-- ============================================

\echo 'Adding presence tracking columns...'

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS last_observed_at DATE;

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS presence_status TEXT DEFAULT 'unknown';

-- Add check constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cat_place_relationships_presence_status_check'
  ) THEN
    ALTER TABLE trapper.cat_place_relationships
    ADD CONSTRAINT cat_place_relationships_presence_status_check
    CHECK (presence_status IN ('current', 'uncertain', 'departed', 'unknown'));
  END IF;
END$$;

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS presence_confirmed_at TIMESTAMPTZ;

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS presence_confirmed_by TEXT;

ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS departure_reason TEXT;

-- Add check constraint for departure_reason if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cat_place_relationships_departure_reason_check'
  ) THEN
    ALTER TABLE trapper.cat_place_relationships
    ADD CONSTRAINT cat_place_relationships_departure_reason_check
    CHECK (departure_reason IN ('adopted', 'deceased', 'relocated', 'lost', 'unknown') OR departure_reason IS NULL);
  END IF;
END$$;

-- Add reactivation tracking
ALTER TABLE trapper.cat_place_relationships
ADD COLUMN IF NOT EXISTS reactivation_reason TEXT;

-- Add check constraint for reactivation_reason if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cat_place_relationships_reactivation_reason_check'
  ) THEN
    ALTER TABLE trapper.cat_place_relationships
    ADD CONSTRAINT cat_place_relationships_reactivation_reason_check
    CHECK (reactivation_reason IN ('client_confirmed', 'clinic_appointment', 'nearby_appointment', 'staff_override') OR reactivation_reason IS NULL);
  END IF;
END$$;

COMMENT ON COLUMN trapper.cat_place_relationships.reactivation_reason IS
'Why a departed cat was marked as current again: client_confirmed, clinic_appointment, nearby_appointment, staff_override';

COMMENT ON COLUMN trapper.cat_place_relationships.last_observed_at IS
'Date the cat was last observed at this place (auto-populated from appointments)';

COMMENT ON COLUMN trapper.cat_place_relationships.presence_status IS
'Explicit presence status: current, uncertain, departed, unknown. If unknown, use inferred status.';

COMMENT ON COLUMN trapper.cat_place_relationships.presence_confirmed_at IS
'When staff confirmed the presence status';

COMMENT ON COLUMN trapper.cat_place_relationships.presence_confirmed_by IS
'Who confirmed the presence status';

COMMENT ON COLUMN trapper.cat_place_relationships.departure_reason IS
'Why the cat departed: adopted, deceased, relocated, lost, unknown';

-- ============================================
-- 2. Create index for presence queries
-- ============================================

\echo 'Creating presence index...'

CREATE INDEX IF NOT EXISTS idx_cat_place_presence
  ON trapper.cat_place_relationships(place_id, presence_status, last_observed_at DESC);

-- ============================================
-- 3. Create presence inference function
-- ============================================

\echo 'Creating presence inference function...'

CREATE OR REPLACE FUNCTION trapper.infer_cat_presence_status(p_last_observed DATE)
RETURNS TEXT AS $$
BEGIN
  IF p_last_observed IS NULL THEN
    RETURN 'unknown';
  ELSIF p_last_observed >= CURRENT_DATE - INTERVAL '18 months' THEN
    RETURN 'current';
  ELSIF p_last_observed >= CURRENT_DATE - INTERVAL '36 months' THEN
    RETURN 'uncertain';
  ELSE
    RETURN 'departed';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.infer_cat_presence_status(DATE) IS
'Infers cat presence status based on last observation date:
  - < 18 months ago: current
  - 18-36 months ago: uncertain
  - > 36 months ago: departed
  - NULL: unknown';

-- ============================================
-- 4. Create effective presence function
-- ============================================

\echo 'Creating effective presence function...'

CREATE OR REPLACE FUNCTION trapper.get_effective_presence_status(
  p_explicit_status TEXT,
  p_last_observed DATE
)
RETURNS TEXT AS $$
BEGIN
  -- If explicit status is set (not unknown), use it
  IF p_explicit_status IS NOT NULL AND p_explicit_status != 'unknown' THEN
    RETURN p_explicit_status;
  END IF;
  -- Otherwise infer from last observed date
  RETURN trapper.infer_cat_presence_status(p_last_observed);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.get_effective_presence_status(TEXT, DATE) IS
'Returns the effective presence status: explicit if set, otherwise inferred from last observed date';

-- ============================================
-- 5. Backfill last_observed_at from appointments
-- ============================================

\echo 'Backfilling last_observed_at from appointments...'

UPDATE trapper.cat_place_relationships cpr
SET last_observed_at = sub.last_appointment
FROM (
  SELECT
    a.cat_id,
    MAX(a.appointment_date) AS last_appointment
  FROM trapper.sot_appointments a
  WHERE a.cat_id IS NOT NULL
    AND a.appointment_date IS NOT NULL
  GROUP BY a.cat_id
) sub
WHERE cpr.cat_id = sub.cat_id
  AND cpr.last_observed_at IS NULL;

-- ============================================
-- 6. Create presence view
-- ============================================

\echo 'Creating v_cat_place_presence view...'

CREATE OR REPLACE VIEW trapper.v_cat_place_presence AS
SELECT
  cpr.cat_place_id,
  cpr.cat_id,
  cpr.place_id,
  c.display_name AS cat_name,
  c.altered_status,
  cpr.relationship_type,
  cpr.last_observed_at,
  cpr.presence_status AS explicit_status,
  -- Computed status (uses explicit if set, otherwise inferred)
  trapper.get_effective_presence_status(cpr.presence_status, cpr.last_observed_at) AS effective_status,
  -- Inferred status (always computed, for comparison)
  trapper.infer_cat_presence_status(cpr.last_observed_at) AS inferred_status,
  cpr.presence_confirmed_at,
  cpr.presence_confirmed_by,
  cpr.departure_reason,
  cpr.reactivation_reason,
  -- Recency for sorting and display
  cpr.last_observed_at IS NOT NULL AS has_observation,
  CASE
    WHEN cpr.last_observed_at IS NULL THEN NULL
    ELSE CURRENT_DATE - cpr.last_observed_at
  END AS days_since_observed,
  -- Procedure info
  (
    SELECT MAX(cp.procedure_date)
    FROM trapper.cat_procedures cp
    WHERE cp.cat_id = cpr.cat_id
      AND (cp.is_spay OR cp.is_neuter)
  ) AS altered_date,
  -- Is this cat altered?
  EXISTS (
    SELECT 1 FROM trapper.cat_procedures cp
    WHERE cp.cat_id = cpr.cat_id
      AND (cp.is_spay OR cp.is_neuter)
  ) AS is_altered
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id;

COMMENT ON VIEW trapper.v_cat_place_presence IS
'Cat-place relationships with computed presence status for reconciliation';

-- ============================================
-- 7. Create places needing reconciliation view
-- ============================================

\echo 'Creating v_places_needing_cat_reconciliation view...'

CREATE OR REPLACE VIEW trapper.v_places_needing_cat_reconciliation AS
WITH place_presence_stats AS (
  SELECT
    cpp.place_id,
    COUNT(*) AS total_cats,
    COUNT(*) FILTER (WHERE cpp.effective_status = 'current') AS current_cats,
    COUNT(*) FILTER (WHERE cpp.effective_status = 'uncertain') AS uncertain_cats,
    COUNT(*) FILTER (WHERE cpp.effective_status = 'departed') AS likely_departed,
    COUNT(*) FILTER (WHERE cpp.explicit_status = 'unknown' OR cpp.explicit_status IS NULL) AS unconfirmed_cats,
    COUNT(*) FILTER (WHERE cpp.is_altered) AS altered_cats,
    MAX(cpp.last_observed_at) AS most_recent_observation
  FROM trapper.v_cat_place_presence cpp
  GROUP BY cpp.place_id
)
SELECT
  p.place_id,
  p.formatted_address,
  p.display_name,
  p.colony_classification::TEXT AS colony_classification,
  p.authoritative_cat_count,
  pps.total_cats,
  pps.current_cats,
  pps.uncertain_cats,
  pps.likely_departed,
  pps.unconfirmed_cats,
  pps.altered_cats,
  pps.most_recent_observation,
  -- Flags for reconciliation priority
  CASE
    WHEN p.authoritative_cat_count IS NOT NULL
     AND p.authoritative_cat_count != pps.current_cats
    THEN TRUE
    ELSE FALSE
  END AS has_count_mismatch,
  pps.uncertain_cats > 0 AS has_uncertain_cats,
  pps.likely_departed > 0 AS has_likely_departed,
  -- Priority score (higher = more urgent)
  (
    CASE WHEN p.authoritative_cat_count IS NOT NULL
         AND p.authoritative_cat_count != pps.current_cats THEN 10 ELSE 0 END
    + pps.uncertain_cats * 2
    + pps.likely_departed
  ) AS reconciliation_priority
FROM trapper.places p
JOIN place_presence_stats pps ON pps.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
  AND (
    -- Has unconfirmed cats
    pps.unconfirmed_cats > 0
    -- Or has count mismatch for individual_cats
    OR (p.authoritative_cat_count IS NOT NULL
        AND p.authoritative_cat_count != pps.current_cats)
    -- Or has uncertain cats
    OR pps.uncertain_cats > 0
  )
ORDER BY reconciliation_priority DESC, pps.uncertain_cats DESC;

COMMENT ON VIEW trapper.v_places_needing_cat_reconciliation IS
'Places with cats that need presence reconciliation, prioritized by urgency';

-- ============================================
-- 8. Create function to update presence status
-- ============================================

\echo 'Creating update_cat_presence function...'

CREATE OR REPLACE FUNCTION trapper.update_cat_presence(
  p_cat_id UUID,
  p_place_id UUID,
  p_status TEXT,
  p_reason TEXT DEFAULT NULL,  -- departure_reason OR reactivation_reason depending on status
  p_confirmed_by TEXT DEFAULT 'staff'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_updated INT;
BEGIN
  -- Validate status
  IF p_status NOT IN ('current', 'uncertain', 'departed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status;
  END IF;

  -- Validate departure_reason if status is departed
  IF p_status = 'departed' AND p_reason IS NOT NULL
     AND p_reason NOT IN ('adopted', 'deceased', 'relocated', 'lost', 'unknown') THEN
    RAISE EXCEPTION 'Invalid departure reason: %', p_reason;
  END IF;

  -- Validate reactivation_reason if status is current
  IF p_status = 'current' AND p_reason IS NOT NULL
     AND p_reason NOT IN ('client_confirmed', 'clinic_appointment', 'nearby_appointment', 'staff_override') THEN
    RAISE EXCEPTION 'Invalid reactivation reason: %', p_reason;
  END IF;

  UPDATE trapper.cat_place_relationships
  SET
    presence_status = p_status,
    departure_reason = CASE WHEN p_status = 'departed' THEN COALESCE(p_reason, 'unknown') ELSE NULL END,
    reactivation_reason = CASE WHEN p_status = 'current' THEN p_reason ELSE NULL END,
    presence_confirmed_at = NOW(),
    presence_confirmed_by = p_confirmed_by
  WHERE cat_id = p_cat_id
    AND place_id = p_place_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.update_cat_presence(UUID, UUID, TEXT, TEXT, TEXT) IS
'Updates the presence status for a cat at a place';

-- ============================================
-- 9. Create trigger to auto-update last_observed_at
-- ============================================

\echo 'Creating auto-update trigger for last_observed_at...'

CREATE OR REPLACE FUNCTION trapper.update_cat_last_observed()
RETURNS TRIGGER AS $$
DECLARE
  v_appointment_place_id UUID;
BEGIN
  -- Only update if we have a cat_id and appointment_date
  IF NEW.cat_id IS NOT NULL AND NEW.appointment_date IS NOT NULL THEN

    -- Get the place_id for this appointment (via owner's place)
    SELECT ppr.place_id INTO v_appointment_place_id
    FROM trapper.person_identifiers pi
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = pi.person_id
    WHERE pi.id_value_norm = LOWER(TRIM(NEW.owner_email))
      AND pi.id_type = 'email'
    LIMIT 1;

    -- Update last_observed_at for all cat-place relationships
    UPDATE trapper.cat_place_relationships cpr
    SET last_observed_at = GREATEST(
      COALESCE(cpr.last_observed_at, '1900-01-01'::DATE),
      NEW.appointment_date
    )
    WHERE cpr.cat_id = NEW.cat_id;

    -- Auto-reactivate departed cats at same place
    UPDATE trapper.cat_place_relationships cpr
    SET
      presence_status = 'current',
      reactivation_reason = 'clinic_appointment',
      presence_confirmed_at = NOW(),
      presence_confirmed_by = 'system_auto'
    WHERE cpr.cat_id = NEW.cat_id
      AND cpr.place_id = v_appointment_place_id
      AND cpr.presence_status = 'departed';

    -- Auto-reactivate departed cats at nearby places (within 200m)
    IF v_appointment_place_id IS NOT NULL THEN
      UPDATE trapper.cat_place_relationships cpr
      SET
        presence_status = 'current',
        reactivation_reason = 'nearby_appointment',
        presence_confirmed_at = NOW(),
        presence_confirmed_by = 'system_auto'
      FROM trapper.places p1, trapper.places p2
      WHERE cpr.cat_id = NEW.cat_id
        AND cpr.presence_status = 'departed'
        AND cpr.place_id = p1.place_id
        AND p2.place_id = v_appointment_place_id
        AND p1.location IS NOT NULL
        AND p2.location IS NOT NULL
        AND ST_DWithin(p1.location::geography, p2.location::geography, 200)
        AND cpr.place_id != v_appointment_place_id;  -- Don't double-update same place
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger to ensure it's current
DROP TRIGGER IF EXISTS trg_update_cat_last_observed ON trapper.sot_appointments;

CREATE TRIGGER trg_update_cat_last_observed
AFTER INSERT OR UPDATE ON trapper.sot_appointments
FOR EACH ROW
EXECUTE FUNCTION trapper.update_cat_last_observed();

COMMENT ON FUNCTION trapper.update_cat_last_observed() IS
'Trigger function to auto-update last_observed_at when appointments are added';

-- ============================================
-- 10. Update v_place_ecology_stats to use presence-aware counts
-- ============================================

\echo 'Updating v_place_ecology_stats with presence awareness...'

CREATE OR REPLACE VIEW trapper.v_place_ecology_stats AS
WITH verified_altered AS (
    -- Count both total and current altered cats
    SELECT
        cpr.place_id,
        COUNT(DISTINCT cp.cat_id) AS a_known_total,
        COUNT(DISTINCT cp.cat_id) FILTER (
          WHERE trapper.get_effective_presence_status(cpr.presence_status, cpr.last_observed_at) = 'current'
        ) AS a_known_current,
        MAX(cp.procedure_date) AS last_altered_at
    FROM trapper.cat_procedures cp
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = cp.cat_id
    WHERE cp.is_spay OR cp.is_neuter
    GROUP BY cpr.place_id
),

recent_reports AS (
    SELECT
        place_id,
        MAX(COALESCE(peak_count, total_cats)) AS n_recent_max,
        COUNT(*) AS report_count,
        MAX(observation_date) AS latest_observation
    FROM trapper.place_colony_estimates
    WHERE observation_date >= CURRENT_DATE - INTERVAL '180 days'
       OR (observation_date IS NULL AND reported_at >= NOW() - INTERVAL '180 days')
    GROUP BY place_id
),

eartip_observations AS (
    SELECT
        place_id,
        SUM(eartip_count_observed) AS total_eartips_seen,
        SUM(total_cats_observed) AS total_cats_seen,
        COUNT(*) AS observation_count,
        MAX(observation_date) AS latest_eartip_observation
    FROM trapper.place_colony_estimates
    WHERE eartip_count_observed IS NOT NULL
      AND total_cats_observed IS NOT NULL
      AND total_cats_observed > 0
      AND (observation_date >= CURRENT_DATE - INTERVAL '365 days'
           OR (observation_date IS NULL AND reported_at >= NOW() - INTERVAL '365 days'))
    GROUP BY place_id
),

active_requests AS (
    -- Get cats_needing_tnr from active requests at each place
    SELECT
        r.place_id,
        SUM(COALESCE(r.estimated_cat_count, 0)) AS cats_needing_tnr
    FROM trapper.sot_requests r
    WHERE r.place_id IS NOT NULL
      AND r.status NOT IN ('completed', 'cancelled')
      AND r.cat_count_semantic = 'needs_tnr'
    GROUP BY r.place_id
)

SELECT
    p.place_id,
    p.display_name,
    p.formatted_address,
    p.service_zone,
    p.is_ffsc_facility,
    p.colony_classification,

    -- Total historical altered (for FFSC impact metrics)
    COALESCE(va.a_known_total, 0) AS a_known,

    -- Current altered (for individual_cats ecology)
    COALESCE(va.a_known_current, 0) AS a_known_current,

    va.last_altered_at,
    COALESCE(rr.n_recent_max, 0) AS n_recent_max,
    COALESCE(rr.report_count, 0) AS report_count,
    rr.latest_observation,

    -- Active request cats needing TNR
    COALESCE(ar.cats_needing_tnr, 0) AS cats_needing_tnr,

    -- Effective a_known based on classification
    -- For individual_cats: use current only
    -- For colonies: use total
    CASE
        WHEN p.colony_classification = 'individual_cats'
        THEN COALESCE(va.a_known_current, 0)
        ELSE COALESCE(va.a_known_total, 0)
    END AS a_known_effective,

    -- p_lower: proportion altered (capped at 1.0)
    -- Uses effective a_known based on classification
    CASE
        WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known_total, 0) > 0
        THEN ROUND(
            CASE
                WHEN p.colony_classification = 'individual_cats'
                THEN COALESCE(va.a_known_current, 0)::NUMERIC
                ELSE COALESCE(va.a_known_total, 0)::NUMERIC
            END /
            GREATEST(
                CASE
                    WHEN p.colony_classification = 'individual_cats'
                    THEN COALESCE(va.a_known_current, 0)
                    ELSE COALESCE(va.a_known_total, 0)
                END,
                COALESCE(rr.n_recent_max, 1)
            )::NUMERIC,
            3
        )
        ELSE NULL
    END AS p_lower,

    -- p_lower_pct: percentage (capped at 100%)
    CASE
        WHEN COALESCE(rr.n_recent_max, 0) > 0 OR COALESCE(va.a_known_total, 0) > 0
        THEN ROUND(
            100.0 *
            CASE
                WHEN p.colony_classification = 'individual_cats'
                THEN COALESCE(va.a_known_current, 0)::NUMERIC
                ELSE COALESCE(va.a_known_total, 0)::NUMERIC
            END /
            GREATEST(
                CASE
                    WHEN p.colony_classification = 'individual_cats'
                    THEN COALESCE(va.a_known_current, 0)
                    ELSE COALESCE(va.a_known_total, 0)
                END,
                COALESCE(rr.n_recent_max, 1)
            )::NUMERIC,
            1
        )
        ELSE NULL
    END AS p_lower_pct,

    -- Eartip observation flags
    eo.observation_count IS NOT NULL AND eo.observation_count > 0 AS has_eartip_data,
    COALESCE(eo.total_eartips_seen, 0) AS total_eartips_seen,
    COALESCE(eo.total_cats_seen, 0) AS total_cats_seen,
    COALESCE(eo.observation_count, 0) AS eartip_observation_count,
    eo.latest_eartip_observation,

    -- Chapman mark-recapture estimate (only if valid eartip data)
    CASE
        WHEN eo.total_eartips_seen > 0
         AND eo.total_cats_seen > 0
         AND va.a_known_total > 0
         AND eo.total_eartips_seen <= eo.total_cats_seen
        THEN ROUND(
            ((va.a_known_total + 1) * (eo.total_cats_seen + 1)::NUMERIC /
             (eo.total_eartips_seen + 1)) - 1,
            0
        )
        ELSE NULL
    END AS n_hat_chapman,

    -- Estimation method used
    CASE
        WHEN eo.total_eartips_seen > 0 AND eo.total_cats_seen > 0 AND va.a_known_total > 0
        THEN 'mark_resight'
        WHEN rr.n_recent_max > 0
        THEN 'max_recent'
        WHEN va.a_known_total > 0
        THEN 'verified_only'
        ELSE 'no_data'
    END AS estimation_method

FROM trapper.places p
LEFT JOIN verified_altered va ON va.place_id = p.place_id
LEFT JOIN recent_reports rr ON rr.place_id = p.place_id
LEFT JOIN eartip_observations eo ON eo.place_id = p.place_id
LEFT JOIN active_requests ar ON ar.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL
  AND COALESCE(p.is_ffsc_facility, FALSE) = FALSE;

COMMENT ON VIEW trapper.v_place_ecology_stats IS
'Ecology statistics for each place with presence-aware counts.
Updated in MIG_629 to include:
  - a_known_current: Only cats with effective_status = current
  - a_known_effective: Uses current for individual_cats, total for colonies
  - cats_needing_tnr: From active requests (population growth signal)';

-- ============================================
-- VERIFICATION
-- ============================================

\echo ''
\echo 'Verification:'

\echo 'Presence status distribution after backfill:'
SELECT
  trapper.infer_cat_presence_status(last_observed_at) AS inferred_status,
  COUNT(*) AS count,
  COUNT(*) FILTER (WHERE last_observed_at IS NOT NULL) AS has_observation
FROM trapper.cat_place_relationships
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
\echo 'Places needing reconciliation:'
SELECT COUNT(*) AS places_needing_reconciliation
FROM trapper.v_places_needing_cat_reconciliation;

\echo ''
\echo 'Crystal place check (4a9f2cf2-876c-4a97-9f61-4faf3c1ecc6f):'
SELECT
  cat_name,
  last_observed_at,
  effective_status,
  altered_status,
  days_since_observed
FROM trapper.v_cat_place_presence
WHERE place_id = '4a9f2cf2-876c-4a97-9f61-4faf3c1ecc6f'
ORDER BY last_observed_at DESC NULLS LAST;

\echo ''
\echo '=============================================='
\echo 'MIG_629 Complete!'
\echo '=============================================='
\echo ''
\echo 'Added presence tracking to cat_place_relationships:'
\echo '  - last_observed_at: Auto-populated from appointments'
\echo '  - presence_status: current, uncertain, departed, unknown'
\echo '  - Automatic inference with 18mo/36mo thresholds'
\echo ''
\echo 'Created views:'
\echo '  - v_cat_place_presence: Cat presence with computed status'
\echo '  - v_places_needing_cat_reconciliation: Places to review'
\echo ''
\echo 'Updated v_place_ecology_stats with:'
\echo '  - a_known_current for individual_cats'
\echo '  - cats_needing_tnr from active requests'
\echo ''
