-- MIG_3110: Close Cat Presence Gaps — Clinic-Derived Presence
--
-- Closes 4 structural breaks in cat presence tracking:
--   B1: ClinicHQ TNR cats now auto-confirmed current at origin place
--   B2: NULL presence_status → 'unknown' (semantic distinction from 'never evaluated')
--   B3: Clinic TNR = return to field → confirmed current
--   B4: 3yr+ stale unknowns → presumed_departed (auto-sweep)
--
-- Steps:
--   1. Expand check constraint for 'presumed_departed'
--   2. Fix NULL presence_status → 'unknown'
--   3. Create sot.is_present() helper
--   4. Populate missing last_observed_at from appointments
--   5. Update lifecycle→presence propagation for tnr_complete
--   6. Create sot.confirm_cat_presence_from_appointment()
--   7. Clinic TNR backfill → confirmed current
--   8. Deceased safety-net backfill
--   9. Re-run ShelterLuv lifecycle propagation (overrides TNR for later departures)
--  10. Presumed_departed sweep (3yr+)
--  11. Rebuild views/functions with presumed_departed filter
--  12. Recompute Kalman floor counts
--  13. Verification
--
-- Dependencies: MIG_3091, MIG_3092, MIG_3093, MIG_3094, MIG_3095, MIG_3096

\echo ''
\echo '=============================================='
\echo '  MIG_3110: Clinic-Derived Presence'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Expand check constraint to include 'presumed_departed'
-- ============================================================================

\echo '1. Expanding presence_status check constraint...'

ALTER TABLE sot.cat_place DROP CONSTRAINT IF EXISTS chk_cat_place_presence_status;

ALTER TABLE sot.cat_place
ADD CONSTRAINT chk_cat_place_presence_status
CHECK (presence_status IN ('current', 'uncertain', 'departed', 'presumed_departed', 'unknown'));

-- ============================================================================
-- 2. Fix NULL presence_status → 'unknown'
-- ============================================================================

\echo '2. Setting NULL presence_status → unknown...'

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE sot.cat_place
  SET presence_status = 'unknown'
  WHERE presence_status IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Fixed % NULL presence_status rows → unknown', v_count;
END $$;

-- Ensure column default is 'unknown' (already set by MIG_2952, but confirm)
ALTER TABLE sot.cat_place ALTER COLUMN presence_status SET DEFAULT 'unknown';

-- ============================================================================
-- 3. Create sot.is_present() helper
-- ============================================================================

\echo '3. Creating sot.is_present() helper...'

CREATE OR REPLACE FUNCTION sot.is_present(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(p_status, 'unknown') NOT IN ('departed', 'presumed_departed')
$$;

COMMENT ON FUNCTION sot.is_present IS
  'Returns TRUE for presence statuses that count toward colony estimates '
  '(current, uncertain, unknown). FALSE for departed, presumed_departed. MIG_3110.';

-- ============================================================================
-- 4. Populate missing last_observed_at from appointment data
-- ============================================================================

\echo '4. Backfilling last_observed_at from appointments...'

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE sot.cat_place cp
  SET last_observed_at = sub.last_appt_date,
      updated_at = NOW()
  FROM (
    SELECT
      cp2.id,
      MAX(a.appointment_date)::TIMESTAMPTZ AS last_appt_date
    FROM sot.cat_place cp2
    JOIN ops.appointments a
      ON a.cat_id = cp2.cat_id
      AND COALESCE(a.inferred_place_id, a.place_id) = cp2.place_id
    WHERE cp2.last_observed_at IS NULL
      AND a.appointment_date IS NOT NULL
    GROUP BY cp2.id
  ) sub
  WHERE cp.id = sub.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Populated last_observed_at for % cat_place rows from appointments', v_count;
END $$;

-- ============================================================================
-- 5. Update lifecycle→presence propagation to handle tnr_complete
-- ============================================================================

\echo '5. Updating lifecycle → presence propagation function...'

-- Must drop first: return type changed (added tnr_confirmed OUT parameter)
DROP FUNCTION IF EXISTS sot.update_cat_place_from_lifecycle_events();

CREATE OR REPLACE FUNCTION sot.update_cat_place_from_lifecycle_events()
RETURNS TABLE(
  cats_processed INT,
  departures_set INT,
  returns_confirmed INT,
  already_departed INT,
  staff_overrides_skipped INT,
  tnr_confirmed INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_cats_processed INT := 0;
  v_departures_set INT := 0;
  v_returns_confirmed INT := 0;
  v_already_departed INT := 0;
  v_staff_overrides_skipped INT := 0;
  v_tnr_confirmed INT := 0;
  v_row_count INT;
  v_skip_count INT;
  v_already_count INT;
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT
      cs.cat_id,
      cs.current_status,
      cs.last_event_subtype,
      cs.last_event_at,
      CASE
        WHEN cs.current_status = 'adopted' AND cs.last_event_subtype = 'Relocation'
          THEN 'relocated'
        WHEN cs.current_status = 'adopted'
          THEN 'adopted'
        WHEN cs.current_status = 'transferred'
          THEN 'transferred'
        WHEN cs.current_status = 'deceased'
          THEN 'deceased'
        WHEN cs.current_status = 'in_foster'
          THEN 'in_foster'
      END AS mapped_departure_reason,
      -- RTF and TNR-complete cats should be marked current
      (cs.current_status IN ('community_cat', 'tnr_complete')) AS is_rtf
    FROM sot.v_cat_current_status cs
    WHERE cs.current_status IN (
      'adopted', 'transferred', 'deceased', 'in_foster', 'community_cat', 'tnr_complete'
    )
  LOOP
    v_cats_processed := v_cats_processed + 1;

    IF v_rec.is_rtf THEN
      -- RTF / TNR-complete: Confirm as current, clear any departure info
      UPDATE sot.cat_place cp
      SET
        presence_status = 'current',
        departure_reason = NULL,
        departed_at = NULL,
        presence_confirmed_at = NOW(),
        presence_confirmed_by = CASE
          WHEN v_rec.current_status = 'tnr_complete' THEN 'clinic_tnr'
          ELSE 'shelterluv_lifecycle'
        END,
        updated_at = NOW()
      WHERE cp.cat_id = v_rec.cat_id
        AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
        AND EXISTS (SELECT 1 FROM sot.places pl WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL)
        -- Manual > AI: skip staff-confirmed rows
        AND (cp.presence_confirmed_by IS NULL
             OR cp.presence_confirmed_by IN ('shelterluv_lifecycle', 'system_backfill', 'clinic_tnr', 'attrition_sweep'))
        -- Skip already confirmed
        AND NOT (cp.presence_status = 'current'
                 AND cp.presence_confirmed_by IN ('shelterluv_lifecycle', 'clinic_tnr'));

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      IF v_rec.current_status = 'tnr_complete' THEN
        v_tnr_confirmed := v_tnr_confirmed + v_row_count;
      ELSE
        v_returns_confirmed := v_returns_confirmed + v_row_count;
      END IF;

    ELSE
      -- Departed cat: set presence_status = 'departed'

      SELECT COUNT(*) INTO v_skip_count
      FROM sot.cat_place cp
      WHERE cp.cat_id = v_rec.cat_id
        AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
        AND EXISTS (SELECT 1 FROM sot.places pl WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL)
        AND cp.presence_confirmed_by IS NOT NULL
        AND cp.presence_confirmed_by NOT IN ('shelterluv_lifecycle', 'system_backfill', 'clinic_tnr', 'attrition_sweep');

      v_staff_overrides_skipped := v_staff_overrides_skipped + COALESCE(v_skip_count, 0);

      SELECT COUNT(*) INTO v_already_count
      FROM sot.cat_place cp
      WHERE cp.cat_id = v_rec.cat_id
        AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
        AND EXISTS (SELECT 1 FROM sot.places pl WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL)
        AND cp.presence_status = 'departed'
        AND cp.presence_confirmed_by = 'shelterluv_lifecycle';

      v_already_departed := v_already_departed + COALESCE(v_already_count, 0);

      UPDATE sot.cat_place cp
      SET
        presence_status = 'departed',
        departure_reason = v_rec.mapped_departure_reason,
        departed_at = COALESCE(v_rec.last_event_at, NOW()),
        presence_confirmed_at = NOW(),
        presence_confirmed_by = 'shelterluv_lifecycle',
        updated_at = NOW()
      WHERE cp.cat_id = v_rec.cat_id
        AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
        AND EXISTS (SELECT 1 FROM sot.places pl WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL)
        -- Manual > AI: skip staff-confirmed rows
        AND (cp.presence_confirmed_by IS NULL
             OR cp.presence_confirmed_by IN ('shelterluv_lifecycle', 'system_backfill', 'clinic_tnr', 'attrition_sweep'))
        -- Skip already processed
        AND NOT (cp.presence_status = 'departed' AND cp.presence_confirmed_by = 'shelterluv_lifecycle');

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_departures_set := v_departures_set + v_row_count;
    END IF;
  END LOOP;

  RETURN QUERY SELECT
    v_cats_processed,
    v_departures_set,
    v_returns_confirmed,
    v_already_departed,
    v_staff_overrides_skipped,
    v_tnr_confirmed;
END;
$$;

COMMENT ON FUNCTION sot.update_cat_place_from_lifecycle_events IS
  'Propagates lifecycle terminal events into cat_place presence_status. '
  'Handles ShelterLuv departures (adopted, transferred, deceased, in_foster), '
  'ShelterLuv RTF (community_cat → current), AND ClinicHQ TNR (tnr_complete → current). '
  'Respects Manual > AI (skips staff-confirmed). MIG_3110.';

-- ============================================================================
-- 6. Create sot.confirm_cat_presence_from_appointment()
-- ============================================================================

\echo '6. Creating confirm_cat_presence_from_appointment()...'

CREATE OR REPLACE FUNCTION sot.confirm_cat_presence_from_appointment(
  p_cat_id UUID,
  p_place_id UUID,
  p_appointment_date DATE DEFAULT CURRENT_DATE
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_updated INT;
BEGIN
  -- Auto-confirm a cat as 'current' at a place when a clinic appointment
  -- occurs there. Acts as a sighting: if the cat was booked for this place,
  -- it's there.
  UPDATE sot.cat_place cp
  SET
    presence_status = 'current',
    last_observed_at = GREATEST(cp.last_observed_at, p_appointment_date::TIMESTAMPTZ),
    presence_confirmed_at = NOW(),
    presence_confirmed_by = 'clinic_tnr',
    -- Clear presumed_departed if re-sighted
    departure_reason = CASE
      WHEN cp.presence_status = 'presumed_departed' THEN NULL
      ELSE cp.departure_reason
    END,
    departed_at = CASE
      WHEN cp.presence_status = 'presumed_departed' THEN NULL
      ELSE cp.departed_at
    END,
    reactivation_reason = CASE
      WHEN cp.presence_status IN ('departed', 'presumed_departed')
        THEN 'clinic_appointment_' || p_appointment_date::TEXT
      ELSE cp.reactivation_reason
    END,
    updated_at = NOW()
  WHERE cp.cat_id = p_cat_id
    AND cp.place_id = p_place_id
    AND cp.relationship_type IN ('home', 'residence', 'colony_member')
    -- Manual > AI: skip staff-confirmed rows (unless they're also clinic_tnr)
    AND (cp.presence_confirmed_by IS NULL
         OR cp.presence_confirmed_by IN ('system_backfill', 'clinic_tnr', 'shelterluv_lifecycle', 'attrition_sweep'))
    -- Don't override explicit departures (adopted, transferred, etc.)
    -- But DO override presumed_departed (cat reappeared!)
    AND cp.presence_status != 'departed';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION sot.confirm_cat_presence_from_appointment IS
  'Auto-confirm cat as current at a place from a clinic appointment. '
  'Called from ingest pipeline when appointments are created. '
  'Respects Manual > AI, does not override explicit departures, '
  'but DOES reactivate presumed_departed cats (re-sighting). MIG_3110.';

-- ============================================================================
-- 7. Clinic TNR backfill → confirmed current
-- ============================================================================

\echo '7. Running clinic TNR → current backfill...'

DO $$
DECLARE
  v_count INT;
BEGIN
  -- For cats whose most recent lifecycle event is tnr_procedure (ClinicHQ-only cats),
  -- confirm them as current at their residential place.
  -- Only touches 'unknown' rows (departed cats from ShelterLuv already set by MIG_3091).
  UPDATE sot.cat_place cp
  SET
    presence_status = 'current',
    presence_confirmed_at = NOW(),
    presence_confirmed_by = 'clinic_tnr',
    updated_at = NOW()
  FROM sot.v_cat_current_status cs
  WHERE cs.cat_id = cp.cat_id
    AND cs.current_status = 'tnr_complete'
    AND cp.relationship_type IN ('home', 'residence', 'colony_member')
    AND cp.presence_status = 'unknown'
    -- Manual > AI
    AND (cp.presence_confirmed_by IS NULL
         OR cp.presence_confirmed_by IN ('system_backfill', 'attrition_sweep'))
    AND EXISTS (
      SELECT 1 FROM sot.places pl
      WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Clinic TNR backfill: % cat_place rows confirmed current', v_count;
END $$;

-- ============================================================================
-- 8. Deceased safety-net backfill
-- ============================================================================

\echo '8. Running deceased safety-net backfill...'

DO $$
DECLARE
  v_count INT;
BEGIN
  -- For cats with is_deceased = true but cat_place still shows as unknown/current,
  -- set to departed/deceased. This catches cases where mortality was recorded on
  -- sot.cats but never propagated to cat_place.
  UPDATE sot.cat_place cp
  SET
    presence_status = 'departed',
    departure_reason = 'deceased',
    departed_at = COALESCE(c.deceased_at, c.updated_at),
    presence_confirmed_at = NOW(),
    presence_confirmed_by = 'deceased_backfill',
    updated_at = NOW()
  FROM sot.cats c
  WHERE c.cat_id = cp.cat_id
    AND c.is_deceased = true
    AND c.merged_into_cat_id IS NULL
    AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
    AND cp.presence_status NOT IN ('departed')
    -- Manual > AI
    AND (cp.presence_confirmed_by IS NULL
         OR cp.presence_confirmed_by IN ('system_backfill', 'clinic_tnr', 'shelterluv_lifecycle', 'attrition_sweep'))
    AND EXISTS (
      SELECT 1 FROM sot.places pl
      WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Deceased safety-net: % cat_place rows set to departed/deceased', v_count;
END $$;

-- ============================================================================
-- 9. Re-run ShelterLuv lifecycle propagation
--    (overrides clinic TNR for cats that were later adopted/transferred)
-- ============================================================================

\echo '9. Re-running lifecycle propagation...'

DO $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM sot.update_cat_place_from_lifecycle_events();
  RAISE NOTICE 'Lifecycle re-run: cats_processed=%, departures=%, returns=%, tnr_confirmed=%, staff_skipped=%',
    v_result.cats_processed,
    v_result.departures_set,
    v_result.returns_confirmed,
    v_result.tnr_confirmed,
    v_result.staff_overrides_skipped;
END $$;

-- ============================================================================
-- 10. Presumed departed sweep (3yr+ stale unknowns)
-- ============================================================================

\echo '10. Running presumed_departed sweep...'

DO $$
DECLARE
  v_count INT;
BEGIN
  UPDATE sot.cat_place cp
  SET
    presence_status = 'presumed_departed',
    presence_confirmed_at = NOW(),
    presence_confirmed_by = 'attrition_sweep',
    updated_at = NOW()
  WHERE cp.presence_status = 'unknown'
    AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
    -- Must have SOME evidence date to measure staleness
    AND cp.last_observed_at IS NOT NULL
    AND cp.last_observed_at < CURRENT_DATE - INTERVAL '3 years'
    -- Only override automated statuses
    AND (cp.presence_confirmed_by IS NULL
         OR cp.presence_confirmed_by IN ('system_backfill', 'attrition_sweep'));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Presumed departed sweep: % cat_place rows (3yr+ stale unknowns)', v_count;
END $$;

-- ============================================================================
-- 11. Rebuild views/functions with presumed_departed filter
-- ============================================================================

\echo '11a. Rebuilding sot.get_altered_cat_count_at_place()...'

CREATE OR REPLACE FUNCTION sot.get_altered_cat_count_at_place(p_place_id UUID)
RETURNS INTEGER
LANGUAGE sql STABLE
AS $$
  SELECT COUNT(DISTINCT cp.cat_id)::INTEGER
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE cp.place_id = p_place_id
    AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at')
    AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
    AND EXISTS(
      SELECT 1 FROM ops.cat_procedures proc
      WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
    )
$$;

\echo '11b. Rebuilding trg_cat_place_kalman_update()...'

CREATE OR REPLACE FUNCTION sot.trg_cat_place_kalman_update()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_is_altered BOOLEAN;
  v_floor INTEGER;
BEGIN
  IF NEW.relationship_type NOT IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at') THEN
    RETURN NEW;
  END IF;

  -- Skip departed and presumed_departed cats
  IF NEW.presence_status IN ('departed', 'presumed_departed') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM ops.cat_procedures proc
    WHERE proc.cat_id = NEW.cat_id AND (proc.is_spay OR proc.is_neuter)
  ) INTO v_is_altered;

  IF NOT v_is_altered THEN
    RETURN NEW;
  END IF;

  v_floor := sot.get_altered_cat_count_at_place(NEW.place_id);

  PERFORM sot.update_population_estimate(
    NEW.place_id,
    v_floor,
    'clinic_records',
    CURRENT_DATE,
    'cat_place_trigger:' || NEW.cat_id::TEXT
  );

  RETURN NEW;
END;
$$;

\echo '11c. Rebuilding sot.get_attrition_weighted_floor()...'

CREATE OR REPLACE FUNCTION sot.get_attrition_weighted_floor(p_place_id UUID)
RETURNS TABLE(
  raw_floor       INTEGER,
  weighted_floor  NUMERIC,
  current_count   INTEGER,
  recent_count    INTEGER,
  stale_count     INTEGER,
  historical_count INTEGER
)
LANGUAGE sql STABLE
AS $$
  WITH config AS (
    SELECT
      COALESCE((SELECT value::NUMERIC FROM ops.app_config WHERE key = 'population.annual_attrition_rate'), 0.13) AS attrition_rate,
      COALESCE((SELECT value::INTEGER FROM ops.app_config WHERE key = 'population.freshness_current_days'), 90) AS current_days,
      COALESCE((SELECT value::INTEGER FROM ops.app_config WHERE key = 'population.freshness_recent_days'), 365) AS recent_days,
      COALESCE((SELECT value::INTEGER FROM ops.app_config WHERE key = 'population.freshness_stale_days'), 1095) AS stale_days
  ),
  cats_at_place AS (
    SELECT
      cp.cat_id,
      COALESCE(
        (SELECT MAX(a.appointment_date) FROM ops.appointments a
         WHERE a.cat_id = cp.cat_id
           AND COALESCE(a.inferred_place_id, a.place_id) = cp.place_id),
        cp.created_at::DATE
      ) AS last_evidence_date,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(
        (SELECT MAX(a.appointment_date) FROM ops.appointments a
         WHERE a.cat_id = cp.cat_id
           AND COALESCE(a.inferred_place_id, a.place_id) = cp.place_id),
        cp.created_at::DATE
      )::TIMESTAMP)) / (365.25 * 86400) AS years_elapsed
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.place_id = p_place_id
      AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'fed_at', 'trapped_at')
      AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
      AND EXISTS(
        SELECT 1 FROM ops.cat_procedures proc
        WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
      )
  )
  SELECT
    COUNT(*)::INTEGER AS raw_floor,
    ROUND(SUM(POWER(1.0 - cfg.attrition_rate, GREATEST(0, cap.years_elapsed))), 1) AS weighted_floor,
    COUNT(*) FILTER (WHERE (NOW()::DATE - cap.last_evidence_date) <= cfg.current_days)::INTEGER AS current_count,
    COUNT(*) FILTER (WHERE (NOW()::DATE - cap.last_evidence_date) > cfg.current_days
                       AND (NOW()::DATE - cap.last_evidence_date) <= cfg.recent_days)::INTEGER AS recent_count,
    COUNT(*) FILTER (WHERE (NOW()::DATE - cap.last_evidence_date) > cfg.recent_days
                       AND (NOW()::DATE - cap.last_evidence_date) <= cfg.stale_days)::INTEGER AS stale_count,
    COUNT(*) FILTER (WHERE (NOW()::DATE - cap.last_evidence_date) > cfg.stale_days)::INTEGER AS historical_count
  FROM cats_at_place cap
  CROSS JOIN config cfg
$$;

\echo '11d. Rebuilding sot.v_place_colony_status...'

DROP VIEW IF EXISTS sot.v_place_colony_status CASCADE;

CREATE OR REPLACE VIEW sot.v_place_colony_status AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  COALESCE(
    ROUND(pps.estimate)::INTEGER,
    COALESCE(pce.chapman_estimate::INTEGER, pce.total_count_observed),
    cc.total_cats
  ) AS colony_size_estimate,
  COALESCE(pce.estimate_method, 'unknown') AS estimation_method,
  CASE
    WHEN pps.place_id IS NOT NULL THEN
      CASE
        WHEN pps.variance <= 5 THEN 1.0
        WHEN pps.variance <= 20 THEN 0.7
        ELSE 0.4
      END
    ELSE COALESCE(1.0, NULL)
  END::NUMERIC AS estimate_confidence,
  COALESCE(pps.last_observation_date, pce.observed_date) AS estimated_at,
  COALESCE(cc.total_cats, 0) AS total_cats,
  COALESCE(cc.altered_cats, 0) AS verified_altered_count,
  GREATEST(0,
    COALESCE(
      ROUND(pps.estimate)::INTEGER,
      COALESCE(pce.chapman_estimate::INTEGER, pce.total_count_observed),
      cc.total_cats,
      0
    ) - COALESCE(cc.altered_cats, 0)
  ) AS estimated_work_remaining,
  CASE
    WHEN COALESCE(cc.total_cats, 0) > 0
    THEN ROUND((COALESCE(cc.altered_cats, 0)::NUMERIC / cc.total_cats) * 100, 1)
    ELSE 0
  END AS alteration_rate_pct,
  COALESCE(pce.has_override, FALSE) AS has_override,
  pce.override_note AS colony_override_note,
  COALESCE(req.active_count, 0) AS active_request_count,
  EXISTS(
    SELECT 1 FROM sot.place_contexts pc
    WHERE pc.place_id = p.place_id
      AND pc.context_type IN ('colony', 'colony_site', 'feeding_station')
      AND pc.valid_to IS NULL
  ) AS is_colony_site,
  CASE WHEN pps.place_id IS NOT NULL THEN
    GREATEST(COALESCE(pps.floor_count, 0), FLOOR(pps.estimate - 1.96 * SQRT(pps.variance)))::INTEGER
  END AS ci_lower,
  CASE WHEN pps.place_id IS NOT NULL THEN
    CEIL(pps.estimate + 1.96 * SQRT(pps.variance))::INTEGER
  END AS ci_upper,
  CASE
    WHEN pps.place_id IS NULL THEN NULL
    WHEN pps.variance <= 5 THEN 'high'
    WHEN pps.variance <= 20 THEN 'medium'
    ELSE 'low'
  END AS confidence_level,
  pps.observation_count AS kalman_observation_count,
  pps.variance AS kalman_variance
FROM sot.places p
LEFT JOIN sot.place_population_state pps ON pps.place_id = p.place_id
LEFT JOIN LATERAL (
  SELECT
    pce_inner.total_count_observed,
    pce_inner.chapman_estimate,
    pce_inner.estimate_method,
    pce_inner.observed_date,
    FALSE AS has_override,
    pce_inner.observer_notes AS override_note
  FROM sot.place_colony_estimates pce_inner
  WHERE pce_inner.place_id = p.place_id
  ORDER BY pce_inner.observed_date DESC NULLS LAST
  LIMIT 1
) pce ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COUNT(DISTINCT cp.cat_id) AS total_cats,
    COUNT(DISTINCT cp.cat_id) FILTER (
      WHERE EXISTS(
        SELECT 1 FROM ops.cat_procedures proc
        WHERE proc.cat_id = cp.cat_id AND (proc.is_spay OR proc.is_neuter)
      )
    ) AS altered_cats
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  WHERE cp.place_id = p.place_id
    AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
) cc ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS active_count
  FROM ops.requests r
  WHERE r.place_id = p.place_id
    AND r.status IN ('new', 'triaged', 'scheduled', 'in_progress')
) req ON TRUE
WHERE p.merged_into_place_id IS NULL;

\echo '11e. Rebuilding ops.v_map_atlas_pins...'

CREATE OR REPLACE VIEW ops.v_map_atlas_pins AS
SELECT p.place_id AS id,
   COALESCE(a.display_address, p.formatted_address, p.display_name) AS address,
   p.display_name,
   a.latitude AS lat,
   a.longitude AS lng,
   p.service_zone,
   p.parent_place_id,
   p.place_kind,
   p.unit_identifier,
   COALESCE(cc.cat_count, 0::bigint) AS cat_count,
   COALESCE(ppl.people, '[]'::jsonb) AS people,
   COALESCE(ppl.person_count, 0::bigint) AS person_count,
   COALESCE(ds.has_any_disease, false) AS disease_risk,
   p.disease_risk_notes,
   COALESCE(ds.disease_badges, '[]'::jsonb) AS disease_badges,
   COALESCE(ds.active_disease_count, 0::bigint) AS disease_count,
   COALESCE(p.watch_list, false) AS watch_list,
   p.watch_list_reason,
   COALESCE(gme.entry_count, 0::bigint) AS google_entry_count,
   COALESCE(gme.ai_summaries, '[]'::jsonb) AS google_summaries,
   COALESCE(req.request_count, 0::bigint) AS request_count,
   COALESCE(req.active_request_count, 0::bigint) AS active_request_count,
   COALESCE(intake.intake_count, 0::bigint) AS intake_count,
   COALESCE(tnr.total_cats_altered, 0::bigint) AS total_altered,
   tnr.latest_request_date AS last_alteration_at,
   CASE
       WHEN COALESCE(ds.active_disease_count, 0::bigint) > 0 THEN 'disease'::text
       WHEN COALESCE(p.watch_list, false) THEN 'watch_list'::text
       WHEN COALESCE(cc.cat_count, 0::bigint) > 0 THEN 'active'::text
       WHEN COALESCE(req.active_request_count, 0::bigint) > 0 OR COALESCE(intake.intake_count, 0::bigint) > 0 THEN 'active_requests'::text
       ELSE 'reference'::text
   END AS pin_style,
   CASE
       WHEN COALESCE(ds.active_disease_count, 0::bigint) > 0 THEN 'active'::text
       WHEN COALESCE(p.watch_list, false) THEN 'active'::text
       WHEN COALESCE(cc.cat_count, 0::bigint) > 0 THEN 'active'::text
       WHEN COALESCE(req.active_request_count, 0::bigint) > 0 OR COALESCE(intake.intake_count, 0::bigint) > 0 THEN 'active'::text
       WHEN active_roles.place_id IS NOT NULL THEN 'active'::text
       ELSE 'reference'::text
   END AS pin_tier,
   p.created_at,
   p.last_activity_at,
   COALESCE(req.needs_trapper_count, 0::bigint) AS needs_trapper_count
 FROM sot.places p
   LEFT JOIN sot.addresses a ON a.address_id = COALESCE(p.sot_address_id, p.address_id)
   LEFT JOIN ( SELECT cpr.place_id,
          count(DISTINCT cpr.cat_id) AS cat_count
         FROM sot.cat_place cpr
           JOIN sot.cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
         WHERE COALESCE(cpr.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
        GROUP BY cpr.place_id) cc ON cc.place_id = p.place_id
   LEFT JOIN ( SELECT ppr.place_id,
          count(DISTINCT per.person_id) AS person_count,
          jsonb_agg(DISTINCT jsonb_build_object('name', per.display_name, 'roles', COALESCE(( SELECT array_agg(DISTINCT pr.role) AS array_agg
                 FROM ops.person_roles pr
                WHERE pr.person_id = per.person_id AND pr.role_status = 'active'::text), ARRAY[]::text[]), 'is_staff', false)) FILTER (WHERE per.display_name IS NOT NULL) AS people
         FROM sot.person_place ppr
           JOIN sot.people per ON per.person_id = ppr.person_id
        WHERE per.merged_into_person_id IS NULL AND NOT sot.is_organization_name(per.display_name)
        GROUP BY ppr.place_id) ppl ON ppl.place_id = p.place_id
   LEFT JOIN ops.v_place_disease_summary ds ON ds.place_id = p.place_id
   LEFT JOIN ( SELECT COALESCE(google_map_entries.place_id, google_map_entries.linked_place_id) AS place_id,
          count(*) AS entry_count,
          jsonb_agg(jsonb_build_object('summary', COALESCE(google_map_entries.ai_summary, SUBSTRING(google_map_entries.original_content FROM 1 FOR 200)), 'meaning', google_map_entries.ai_meaning, 'date', google_map_entries.parsed_date::text) ORDER BY google_map_entries.imported_at DESC) FILTER (WHERE google_map_entries.ai_summary IS NOT NULL OR google_map_entries.original_content IS NOT NULL) AS ai_summaries
         FROM ops.google_map_entries
        WHERE google_map_entries.place_id IS NOT NULL OR google_map_entries.linked_place_id IS NOT NULL
        GROUP BY (COALESCE(google_map_entries.place_id, google_map_entries.linked_place_id))) gme ON gme.place_id = p.place_id
   LEFT JOIN ( SELECT requests.place_id,
          count(*) AS request_count,
          count(*) FILTER (WHERE requests.status = ANY (ARRAY['new'::text, 'triaged'::text, 'scheduled'::text, 'in_progress'::text])) AS active_request_count,
          count(*) FILTER (WHERE (requests.status = ANY (ARRAY['new'::text, 'triaged'::text, 'scheduled'::text, 'in_progress'::text])) AND (requests.assignment_status = 'pending'::text OR requests.assignment_status IS NULL)) AS needs_trapper_count
         FROM ops.requests
        WHERE requests.place_id IS NOT NULL
        GROUP BY requests.place_id) req ON req.place_id = p.place_id
   LEFT JOIN ( SELECT intake_submissions.place_id,
          count(DISTINCT intake_submissions.submission_id) AS intake_count
         FROM ops.intake_submissions
        WHERE intake_submissions.place_id IS NOT NULL
        GROUP BY intake_submissions.place_id) intake ON intake.place_id = p.place_id
   LEFT JOIN ( SELECT DISTINCT ppr.place_id
         FROM sot.person_place ppr
           JOIN ops.person_roles pr ON pr.person_id = ppr.person_id
        WHERE pr.role_status = 'active'::text AND (pr.role = ANY (ARRAY['volunteer'::text, 'trapper'::text, 'coordinator'::text, 'head_trapper'::text, 'ffsc_trapper'::text, 'community_trapper'::text, 'foster'::text]))) active_roles ON active_roles.place_id = p.place_id
   LEFT JOIN sot.v_place_alteration_history tnr ON tnr.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL AND a.latitude IS NOT NULL AND a.longitude IS NOT NULL AND (COALESCE(p.quality_tier, 'good'::text) <> ALL (ARRAY['garbage'::text, 'needs_review'::text]));

-- Rebuild dependent views
CREATE OR REPLACE VIEW ops.v_map_atlas_pins_with_gm AS
SELECT * FROM ops.v_map_atlas_pins
UNION ALL
SELECT * FROM ops.v_gm_reference_pins;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'trapper' AND viewname = 'v_map_atlas_pins') THEN
    EXECUTE 'CREATE OR REPLACE VIEW trapper.v_map_atlas_pins AS SELECT * FROM ops.v_map_atlas_pins';
  END IF;
END $$;

\echo '11f. Rebuilding sot.v_place_list...'

DROP VIEW IF EXISTS sot.v_place_list CASCADE;

CREATE OR REPLACE VIEW sot.v_place_list AS
SELECT
  p.place_id,
  COALESCE(p.display_name, split_part(p.formatted_address, ',', 1)) AS display_name,
  p.formatted_address,
  p.place_kind,
  a.city AS locality,
  a.postal_code,
  COALESCE((
    SELECT COUNT(DISTINCT cp.cat_id)
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE cp.place_id = p.place_id
      AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
  ), 0)::INT AS cat_count,
  COALESCE((
    SELECT COUNT(DISTINCT pp.person_id)
    FROM sot.person_place pp
    JOIN sot.people per ON per.person_id = pp.person_id AND per.merged_into_person_id IS NULL
    WHERE pp.place_id = p.place_id
      AND per.display_name IS NOT NULL
      AND (per.is_organization = FALSE OR per.is_organization IS NULL)
  ), 0)::INT AS person_count,
  EXISTS(
    SELECT 1 FROM sot.cat_place cp
    WHERE cp.place_id = p.place_id
      AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
  ) AS has_cat_activity,
  p.created_at
FROM sot.places p
LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id AND a.merged_into_address_id IS NULL
WHERE p.merged_into_place_id IS NULL;

\echo '11g. Rebuilding sot.v_person_list_v3...'

DROP VIEW IF EXISTS sot.v_person_list_v3 CASCADE;

CREATE OR REPLACE VIEW sot.v_person_list_v3 AS
SELECT
  p.person_id,
  COALESCE(p.display_name, TRIM(CONCAT(p.first_name, ' ', p.last_name))) AS display_name,
  CASE
    WHEN p.is_organization = true THEN 'organization'
    WHEN p.entity_type = 'organization' THEN 'organization'
    WHEN p.entity_type IS NOT NULL THEN p.entity_type
    ELSE 'person'
  END AS account_type,
  TRUE AS is_canonical,
  CASE
    WHEN p.data_quality = 'verified' THEN 'High'
    WHEN p.data_quality = 'good' THEN 'High'
    WHEN p.data_quality = 'needs_review' THEN 'Medium'
    WHEN p.data_quality = 'garbage' THEN 'Low'
    WHEN p.is_verified = true THEN 'High'
    WHEN p.primary_email IS NOT NULL AND p.primary_phone IS NOT NULL THEN 'High'
    WHEN p.primary_email IS NOT NULL OR p.primary_phone IS NOT NULL THEN 'Medium'
    ELSE 'Low'
  END AS surface_quality,
  CASE
    WHEN p.data_quality = 'verified' THEN 'Verified by staff'
    WHEN p.data_quality = 'good' THEN 'Good data quality'
    WHEN p.data_quality = 'needs_review' THEN 'Needs review'
    WHEN p.data_quality = 'garbage' THEN 'Poor data quality'
    WHEN p.is_verified = true THEN 'Verified record'
    WHEN p.primary_email IS NOT NULL AND p.primary_phone IS NOT NULL THEN 'Has email and phone'
    WHEN p.primary_email IS NOT NULL THEN 'Has email only'
    WHEN p.primary_phone IS NOT NULL THEN 'Has phone only'
    ELSE 'Missing contact info'
  END AS quality_reason,
  (p.primary_email IS NOT NULL) AS has_email,
  (p.primary_phone IS NOT NULL) AS has_phone,
  -- MIG_3110: Presence-aware cat count (exclude departed + presumed_departed)
  COALESCE((
    SELECT COUNT(*)
    FROM sot.person_cat pc
    JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
    WHERE pc.person_id = p.person_id
      AND NOT EXISTS(
        SELECT 1 FROM sot.cat_place cp
        JOIN sot.person_place pp ON pp.place_id = cp.place_id AND pp.person_id = p.person_id
        WHERE cp.cat_id = pc.cat_id AND cp.presence_status IN ('departed', 'presumed_departed')
        AND NOT EXISTS(
          SELECT 1 FROM sot.cat_place cp2
          JOIN sot.person_place pp2 ON pp2.place_id = cp2.place_id AND pp2.person_id = p.person_id
          WHERE cp2.cat_id = pc.cat_id AND COALESCE(cp2.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
        )
      )
  ), 0)::int AS cat_count,
  COALESCE((SELECT COUNT(*) FROM sot.person_place pp WHERE pp.person_id = p.person_id), 0)::int AS place_count,
  (SELECT STRING_AGG(COALESCE(c.name, c.display_name), ', ' ORDER BY pc.created_at DESC)
   FROM sot.person_cat pc
   JOIN sot.cats c ON c.cat_id = pc.cat_id AND c.merged_into_cat_id IS NULL
   WHERE pc.person_id = p.person_id
   LIMIT 3) AS cat_names,
  COALESCE(pl.formatted_address, pl.display_name) AS primary_place,
  p.created_at,
  CASE
    WHEN p.source_system IN ('clinichq', 'shelterluv') THEN 'clinic_verified'
    WHEN p.source_system = 'volunteerhub' THEN 'volunteer_system'
    WHEN p.source_system = 'atlas_ui' THEN 'staff_entered'
    WHEN p.source_system = 'web_intake' THEN 'web_submission'
    WHEN p.source_system = 'airtable' THEN 'legacy_import'
    WHEN p.source_system = 'petlink' THEN 'microchip_registry'
    ELSE COALESCE(p.source_system, 'unknown')
  END AS source_quality,
  p.first_name,
  p.last_name,
  p.primary_email,
  p.primary_phone,
  p.entity_type,
  p.is_organization,
  p.is_verified,
  p.data_quality,
  p.source_system,
  p.updated_at,
  pl.place_id AS primary_place_id,
  pl.display_name AS primary_place_name,
  pl.formatted_address AS primary_place_address,
  COALESCE((SELECT COUNT(*) FROM ops.requests r WHERE r.requester_person_id = p.person_id), 0)::int AS request_count,
  (SELECT pr.role FROM sot.person_roles pr WHERE pr.person_id = p.person_id ORDER BY pr.created_at DESC LIMIT 1) AS primary_role,
  (SELECT pr.trapper_type FROM sot.person_roles pr WHERE pr.person_id = p.person_id AND pr.trapper_type IS NOT NULL ORDER BY pr.created_at DESC LIMIT 1) AS trapper_type,
  p.do_not_contact
FROM sot.people p
LEFT JOIN sot.places pl ON pl.place_id = p.primary_place_id AND pl.merged_into_place_id IS NULL
WHERE p.merged_into_person_id IS NULL;

-- Recreate dependent view dropped by CASCADE
CREATE OR REPLACE VIEW ops.v_call_sheet_items_detail AS
SELECT
  csi.*,
  pl.display_name AS place_name,
  pl.formatted_address AS place_full_address,
  r.status AS request_status,
  r.summary AS request_summary,
  r.priority AS request_priority,
  per.display_name AS person_name,
  per.primary_phone,
  per.primary_email
FROM ops.call_sheet_items csi
LEFT JOIN sot.places pl ON pl.place_id = csi.place_id
LEFT JOIN ops.requests r ON r.request_id = csi.request_id
LEFT JOIN sot.v_person_list_v3 per ON per.person_id = csi.person_id;

\echo '11h. Rebuilding ops.v_colony_cat_paths...'

-- Must drop first: added presumed_departed column changes view shape
DROP VIEW IF EXISTS ops.v_colony_cat_paths;

CREATE OR REPLACE VIEW ops.v_colony_cat_paths AS
SELECT
  cp.place_id,
  p.formatted_address,
  p.display_name AS place_name,
  p.service_zone,
  COUNT(DISTINCT cp.cat_id) AS total_cats_ever,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
  ) AS current_cats,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE cp.presence_status = 'departed' AND cp.departure_reason = 'adopted'
  ) AS departed_adopted,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE cp.presence_status = 'departed' AND cp.departure_reason = 'relocated'
  ) AS departed_relocated,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE cp.presence_status = 'departed' AND cp.departure_reason = 'transferred'
  ) AS departed_transferred,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE cp.presence_status = 'departed' AND cp.departure_reason = 'deceased'
  ) AS departed_deceased,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE cp.presence_status = 'departed' AND cp.departure_reason = 'in_foster'
  ) AS in_foster,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE cp.presence_status = 'departed'
      AND COALESCE(cp.departure_reason, 'unknown') NOT IN ('adopted', 'relocated', 'transferred', 'deceased', 'in_foster')
  ) AS departed_other,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE cp.presence_status = 'presumed_departed'
  ) AS presumed_departed,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE COALESCE(cp.presence_status, 'unknown') = 'unknown'
  ) AS unknown_status
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
WHERE cp.relationship_type IN ('home', 'residence', 'colony_member')
GROUP BY cp.place_id, p.formatted_address, p.display_name, p.service_zone;

\echo '11i. Rebuilding sot.v_cat_place_presence...'

DROP VIEW IF EXISTS sot.v_cat_place_presence;

CREATE VIEW sot.v_cat_place_presence AS
SELECT
  cp.id AS cat_place_id,
  cp.cat_id,
  c.display_name AS cat_name,
  c.altered_status,
  cp.place_id,
  cp.relationship_type,
  cp.last_observed_at,
  cp.departed_at,
  COALESCE(cp.presence_status, 'unknown') AS explicit_status,
  CASE
    WHEN cp.presence_status IN ('current', 'departed', 'presumed_departed') THEN cp.presence_status
    WHEN cp.last_observed_at IS NOT NULL
         AND cp.last_observed_at >= CURRENT_DATE - INTERVAL '12 months' THEN 'current'
    WHEN cp.last_observed_at IS NOT NULL
         AND cp.last_observed_at >= CURRENT_DATE - INTERVAL '36 months' THEN 'uncertain'
    WHEN cp.last_observed_at IS NOT NULL THEN 'presumed_departed'
    ELSE 'unknown'
  END AS effective_status,
  CASE
    WHEN cp.presence_status IS NOT NULL AND cp.presence_status NOT IN ('unknown') THEN 'confirmed'
    WHEN cp.last_observed_at IS NOT NULL THEN 'inferred'
    ELSE 'unknown'
  END AS inferred_status,
  cp.presence_confirmed_at,
  cp.presence_confirmed_by,
  cp.departure_reason,
  cp.reactivation_reason,
  cp.last_observed_at IS NOT NULL AS has_observation,
  CASE
    WHEN cp.last_observed_at IS NOT NULL
    THEN EXTRACT(DAY FROM NOW() - cp.last_observed_at)::INT
  END AS days_since_observed,
  CASE
    WHEN c.altered_status IN ('spayed', 'neutered', 'altered') THEN c.verified_at
  END AS altered_date,
  c.altered_status IN ('spayed', 'neutered', 'altered') AS is_altered
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id
  AND c.merged_into_cat_id IS NULL
WHERE cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at');

COMMENT ON VIEW sot.v_cat_place_presence IS
  'Cat presence at places with inferred/confirmed status. '
  'MIG_3110: effective_status maps 36mo+ → presumed_departed (not departed).';

\echo '11j. Rebuilding sot.v_place_ecology_stats...'

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'sot' AND viewname = 'v_place_ecology_stats') THEN
    DROP VIEW IF EXISTS sot.v_place_ecology_stats CASCADE;

    CREATE OR REPLACE VIEW sot.v_place_ecology_stats AS
    WITH cat_counts AS (
      SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id)::INT AS a_known,
        COUNT(DISTINCT cp.cat_id) FILTER (
          WHERE cp.relationship_type IN ('home', 'residence', 'colony_member')
        )::INT AS a_known_current,
        COUNT(DISTINCT cp.cat_id) FILTER (
          WHERE cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
        )::INT AS a_known_effective,
        COUNT(DISTINCT cp.cat_id) FILTER (
          WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
            AND cp.relationship_type IN ('home', 'residence', 'colony_member')
        )::INT AS cats_needing_tnr,
        COUNT(DISTINCT cp.cat_id) FILTER (
          WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        )::INT AS altered_count
      FROM sot.cat_place cp
      JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
      WHERE COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
      GROUP BY cp.place_id
    ),
    eartip_data AS (
      SELECT
        so.place_id,
        SUM(so.eartipped_seen)::INT AS total_eartips_seen,
        SUM(so.cats_seen_total)::INT AS total_cats_seen,
        MAX(so.cats_seen_total)::INT AS n_recent_max,
        bool_or(so.eartipped_seen IS NOT NULL AND so.eartipped_seen > 0) AS has_eartip_data
      FROM ops.site_observations so
      WHERE so.place_id IS NOT NULL
        AND so.cats_seen_total IS NOT NULL
      GROUP BY so.place_id
    ),
    overrides AS (
      SELECT
        place_id,
        colony_size_estimate,
        colony_confidence
      FROM sot.places
      WHERE colony_size_estimate IS NOT NULL
        AND colony_confidence IS NOT NULL
        AND colony_confidence >= 0.9
    )
    SELECT
      COALESCE(cc.place_id, ed.place_id) AS place_id,
      COALESCE(cc.a_known, 0) AS a_known,
      COALESCE(cc.a_known_current, 0) AS a_known_current,
      COALESCE(cc.a_known_effective, 0) AS a_known_effective,
      COALESCE(cc.cats_needing_tnr, 0) AS cats_needing_tnr,
      COALESCE(ed.n_recent_max, 0) AS n_recent_max,
      CASE
        WHEN COALESCE(cc.a_known, 0) > 0 AND GREATEST(COALESCE(cc.a_known, 0), COALESCE(ed.n_recent_max, 0)) > 0
        THEN ROUND(cc.a_known::NUMERIC / GREATEST(cc.a_known, COALESCE(ed.n_recent_max, 0)) * 100, 1)
      END AS p_lower,
      CASE
        WHEN COALESCE(cc.a_known, 0) > 0 AND GREATEST(COALESCE(cc.a_known, 0), COALESCE(ed.n_recent_max, 0)) > 0
        THEN ROUND(cc.a_known::NUMERIC / GREATEST(cc.a_known, COALESCE(ed.n_recent_max, 0)) * 100, 1)
      END AS p_lower_pct,
      CASE
        WHEN ovr.place_id IS NOT NULL THEN 'manual_override'
        WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(ed.total_eartips_seen, 0) >= 7 THEN 'mark_resight'
        WHEN COALESCE(ed.n_recent_max, 0) > 0 THEN 'max_recent'
        WHEN COALESCE(cc.a_known, 0) > 0 THEN 'verified_only'
        ELSE 'no_data'
      END AS estimation_method,
      COALESCE(ed.has_eartip_data, FALSE) AS has_eartip_data,
      COALESCE(ed.total_eartips_seen, 0) AS total_eartips_seen,
      COALESCE(ed.total_cats_seen, 0) AS total_cats_seen,
      CASE
        WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(cc.altered_count, 0) > 0 AND COALESCE(ed.total_cats_seen, 0) > 0 AND COALESCE(ed.total_eartips_seen, 0) > 0
        THEN ROUND(((cc.altered_count + 1.0) * (ed.total_cats_seen + 1.0) / (ed.total_eartips_seen + 1.0)) - 1, 0)::INT
      END AS n_hat_chapman,
      CASE
        WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(cc.altered_count, 0) > 0 AND COALESCE(ed.total_cats_seen, 0) > 0 AND COALESCE(ed.total_eartips_seen, 0) > 0
        THEN ROUND(
          cc.altered_count::NUMERIC * 100.0 / (((cc.altered_count + 1.0) * (ed.total_cats_seen + 1.0) / (ed.total_eartips_seen + 1.0)) - 1),
          1
        )
      END AS p_hat_chapman_pct,
      COALESCE(
        ovr.colony_size_estimate,
        CASE
          WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(cc.altered_count, 0) > 0 AND COALESCE(ed.total_cats_seen, 0) > 0 AND COALESCE(ed.total_eartips_seen, 0) > 0
          THEN ROUND(((cc.altered_count + 1.0) * (ed.total_cats_seen + 1.0) / (ed.total_eartips_seen + 1.0)) - 1, 0)::INT
        END,
        GREATEST(COALESCE(cc.a_known, 0), COALESCE(ed.n_recent_max, 0))
      ) AS best_colony_estimate,
      GREATEST(0,
        COALESCE(
          ovr.colony_size_estimate,
          CASE
            WHEN COALESCE(ed.has_eartip_data, FALSE) AND COALESCE(cc.altered_count, 0) > 0 AND COALESCE(ed.total_cats_seen, 0) > 0 AND COALESCE(ed.total_eartips_seen, 0) > 0
            THEN ROUND(((cc.altered_count + 1.0) * (ed.total_cats_seen + 1.0) / (ed.total_eartips_seen + 1.0)) - 1, 0)::INT
          END,
          GREATEST(COALESCE(cc.a_known, 0), COALESCE(ed.n_recent_max, 0))
        ) - COALESCE(cc.a_known, 0)
      ) AS estimated_work_remaining
    FROM cat_counts cc
    FULL OUTER JOIN eartip_data ed ON ed.place_id = cc.place_id
    LEFT JOIN overrides ovr ON ovr.place_id = COALESCE(cc.place_id, ed.place_id);

    RAISE NOTICE 'MIG_3110: v_place_ecology_stats rebuilt with presumed_departed filter';
  ELSE
    RAISE NOTICE 'MIG_3110: v_place_ecology_stats does not exist, skipping';
  END IF;
END;
$$;

\echo '11k. Rebuilding sot.v_place_detail_v2...'

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_views WHERE schemaname = 'sot' AND viewname = 'v_place_detail_v2') THEN
    DROP VIEW IF EXISTS sot.v_place_detail_v2 CASCADE;

    CREATE OR REPLACE VIEW sot.v_place_detail_v2 AS
    WITH place_cats AS (
        SELECT
          cp.place_id,
          json_agg(
            json_build_object(
              'cat_id', c.cat_id,
              'cat_name', COALESCE(c.name, 'Unknown'),
              'relationship_type', cp.relationship_type,
              'confidence', cp.confidence,
              'presence_status', COALESCE(cp.presence_status, 'unknown'),
              'departure_reason', cp.departure_reason,
              'departed_at', cp.departed_at
            ) ORDER BY
              CASE COALESCE(cp.presence_status, 'unknown')
                WHEN 'current' THEN 0
                WHEN 'unknown' THEN 1
                WHEN 'presumed_departed' THEN 2
                WHEN 'departed' THEN 3
              END,
              c.name
          ) AS cats,
          COUNT(DISTINCT c.cat_id) FILTER (
            WHERE COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
          ) AS cat_count,
          COUNT(DISTINCT c.cat_id) AS total_cat_count
        FROM sot.cat_place cp
        JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
        GROUP BY cp.place_id
    ), place_people AS (
        SELECT
          pp.place_id,
          json_agg(
            json_build_object(
              'person_id', p.person_id,
              'person_name', p.display_name,
              'role', pp.relationship_type,
              'confidence', pp.confidence,
              'is_organization', COALESCE(p.is_organization, false)
            ) ORDER BY p.display_name
          ) AS people,
          COUNT(DISTINCT p.person_id) AS person_count
        FROM sot.person_place pp
        JOIN sot.people p ON p.person_id = pp.person_id AND p.merged_into_person_id IS NULL
        WHERE p.display_name IS NOT NULL
          AND (p.is_organization = false OR p.is_organization IS NULL)
        GROUP BY pp.place_id
    )
    SELECT
      p.place_id,
      COALESCE(p.display_name, split_part(p.formatted_address, ',', 1), p.formatted_address) AS display_name,
      p.display_name AS original_display_name,
      p.formatted_address,
      p.place_kind,
      p.is_address_backed,
      COALESCE(pc.cat_count, 0) > 0 AS has_cat_activity,
      CASE
        WHEN p.location IS NOT NULL THEN json_build_object('lat', ST_Y(p.location::geometry), 'lng', ST_X(p.location::geometry))
        ELSE NULL
      END AS coordinates,
      p.created_at::TEXT AS created_at,
      p.updated_at::TEXT AS updated_at,
      COALESCE(pc.cats, '[]'::json) AS cats,
      COALESCE(pp.people, '[]'::json) AS people,
      '[]'::json AS place_relationships,
      COALESCE(pc.cat_count, 0)::INTEGER AS cat_count,
      COALESCE(pp.person_count, 0)::INTEGER AS person_count
    FROM sot.places p
    LEFT JOIN place_cats pc ON pc.place_id = p.place_id
    LEFT JOIN place_people pp ON pp.place_id = p.place_id
    WHERE p.merged_into_place_id IS NULL;

    RAISE NOTICE 'MIG_3110: v_place_detail_v2 rebuilt with presumed_departed filter';
  ELSE
    RAISE NOTICE 'MIG_3110: v_place_detail_v2 does not exist, skipping';
  END IF;
END;
$$;

\echo '11l. Rebuilding ops.mv_beacon_place_metrics...'

DROP MATERIALIZED VIEW IF EXISTS ops.mv_beacon_place_metrics CASCADE;
DROP VIEW IF EXISTS ops.v_beacon_place_metrics CASCADE;

CREATE MATERIALIZED VIEW ops.mv_beacon_place_metrics AS
WITH place_cats AS (
    SELECT
        cp.place_id,
        COUNT(DISTINCT cp.cat_id)::int AS total_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
        )::int AS altered_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NOT NULL AND c.altered_status != 'unknown'
        )::int AS known_status_cats,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status IS NULL OR c.altered_status = 'unknown'
        )::int AS unknown_status_cats,
        CASE
            WHEN COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status IS NOT NULL AND c.altered_status != 'unknown'
            ) > 0
            THEN ROUND(
                COUNT(DISTINCT cp.cat_id) FILTER (
                    WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
                )::numeric * 100.0 /
                NULLIF(COUNT(DISTINCT cp.cat_id) FILTER (
                    WHERE c.altered_status IS NOT NULL AND c.altered_status != 'unknown'
                ), 0), 1
            )
        END AS alteration_rate_pct
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    WHERE COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
    GROUP BY cp.place_id
),
place_people AS (
    SELECT place_id, COUNT(DISTINCT person_id)::int AS total_people
    FROM sot.person_place
    GROUP BY place_id
),
place_requests AS (
    SELECT place_id,
        COUNT(*)::int AS total_requests,
        COUNT(*) FILTER (WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress'))::int AS active_requests
    FROM ops.requests
    GROUP BY place_id
),
place_appointments AS (
    SELECT place_id, COUNT(*)::int AS total_appointments, MAX(appointment_date) AS last_appointment_date
    FROM (
        SELECT place_id, appointment_id, appointment_date FROM ops.appointments WHERE place_id IS NOT NULL
        UNION
        SELECT inferred_place_id AS place_id, appointment_id, appointment_date FROM ops.appointments WHERE inferred_place_id IS NOT NULL
    ) combined
    GROUP BY place_id
),
latest_colony_estimates AS (
    SELECT
        COALESCE(pps.place_id, pce.place_id) AS place_id,
        COALESCE(ROUND(pps.estimate)::INTEGER, pce.total_count_observed) AS colony_estimate,
        CASE WHEN pps.place_id IS NOT NULL THEN 'kalman_filter'
             ELSE COALESCE(pce.estimate_method, 'unknown') END AS estimate_method
    FROM sot.place_population_state pps
    FULL OUTER JOIN (
        SELECT DISTINCT ON (place_id) place_id, total_count_observed, estimate_method
        FROM sot.place_colony_estimates
        ORDER BY place_id, observed_date DESC NULLS LAST, created_at DESC
    ) pce ON pce.place_id = pps.place_id
),
place_breeding AS (
    SELECT
        COALESCE(a.inferred_place_id, a.place_id) AS place_id,
        (COUNT(*) FILTER (WHERE (a.is_pregnant OR a.is_lactating)
            AND a.appointment_date >= CURRENT_DATE - INTERVAL '180 days') > 0) AS has_recent_breeding,
        MAX(a.appointment_date) FILTER (WHERE a.is_pregnant OR a.is_lactating) AS last_breeding_detected
    FROM ops.appointments a
    WHERE COALESCE(a.inferred_place_id, a.place_id) IS NOT NULL AND a.cat_id IS NOT NULL
    GROUP BY COALESCE(a.inferred_place_id, a.place_id)
),
colony_trends AS (
    SELECT place_id, trend AS colony_trend,
           CASE trend WHEN 'growing' THEN -1 WHEN 'shrinking' THEN 1 WHEN 'stable' THEN 0 ELSE 0 END AS colony_trend_score
    FROM (
        SELECT place_id,
            CASE WHEN est_count < 2 THEN 'insufficient_data'
                 WHEN latest_total > prev_total * 1.2 THEN 'growing'
                 WHEN latest_total < prev_total * 0.8 THEN 'shrinking'
                 ELSE 'stable' END AS trend
        FROM (
            SELECT place_id, COUNT(*) AS est_count,
                (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[1] AS latest_total,
                (ARRAY_AGG(total_count_observed ORDER BY observed_date DESC))[2] AS prev_total
            FROM sot.place_colony_estimates WHERE total_count_observed IS NOT NULL
            GROUP BY place_id
        ) sub
    ) trend_sub
),
immigration AS (
    SELECT cp.place_id,
        COUNT(DISTINCT cp.cat_id) FILTER (
            WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
              AND cp.created_at >= (CURRENT_DATE - INTERVAL '6 months')
              AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
        )::int AS new_intact_arrivals,
        CASE
            WHEN COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
                  AND cp.created_at >= (CURRENT_DATE - INTERVAL '6 months')
                  AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
            ) >= 5 THEN 'high'
            WHEN COUNT(DISTINCT cp.cat_id) FILTER (
                WHERE c.altered_status NOT IN ('spayed', 'neutered', 'altered')
                  AND cp.created_at >= (CURRENT_DATE - INTERVAL '6 months')
                  AND COALESCE(cp.presence_status, 'unknown') NOT IN ('departed', 'presumed_departed')
            ) >= 2 THEN 'moderate'
            ELSE 'low'
        END AS immigration_pressure
    FROM sot.cat_place cp
    JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
    GROUP BY cp.place_id
)
SELECT
    p.place_id, p.display_name, p.formatted_address, p.place_kind,
    ST_Y(p.location::geometry) AS latitude, ST_X(p.location::geometry) AS longitude,
    COALESCE(pc.total_cats, 0)::INTEGER AS total_cats,
    COALESCE(pc.altered_cats, 0)::INTEGER AS altered_cats,
    COALESCE(pc.known_status_cats, 0)::INTEGER AS known_status_cats,
    COALESCE(pc.unknown_status_cats, 0)::INTEGER AS unknown_status_cats,
    pc.alteration_rate_pct,
    COALESCE(pp.total_people, 0)::INTEGER AS total_people,
    COALESCE(pr.total_requests, 0)::INTEGER AS total_requests,
    COALESCE(pr.active_requests, 0)::INTEGER AS active_requests,
    COALESCE(pa.total_appointments, 0)::INTEGER AS total_appointments,
    pa.last_appointment_date,
    lce.colony_estimate, lce.estimate_method,
    GREATEST(p.updated_at, pa.last_appointment_date::timestamptz) AS last_activity_at,
    NULL::TEXT AS zone_code,
    COALESCE(pb.has_recent_breeding, FALSE) AS has_recent_breeding,
    pb.last_breeding_detected::DATE AS last_breeding_detected,
    COALESCE(ct.colony_trend, 'insufficient_data') AS colony_trend,
    COALESCE(ct.colony_trend_score, 0) AS colony_trend_score,
    COALESCE(im.new_intact_arrivals, 0) AS new_intact_arrivals,
    COALESCE(im.immigration_pressure, 'low') AS immigration_pressure
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
LEFT JOIN place_requests pr ON pr.place_id = p.place_id
LEFT JOIN place_appointments pa ON pa.place_id = p.place_id
LEFT JOIN latest_colony_estimates lce ON lce.place_id = p.place_id
LEFT JOIN place_breeding pb ON pb.place_id = p.place_id
LEFT JOIN colony_trends ct ON ct.place_id = p.place_id
LEFT JOIN immigration im ON im.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

CREATE UNIQUE INDEX idx_mv_beacon_place_metrics_place_id ON ops.mv_beacon_place_metrics(place_id);

CREATE OR REPLACE VIEW ops.v_beacon_place_metrics AS
SELECT * FROM ops.mv_beacon_place_metrics;

-- ============================================================================
-- 12. Recompute Kalman floor counts
-- ============================================================================

\echo '12. Recomputing Kalman floor counts...'

UPDATE sot.place_population_state pps
SET floor_count = sot.get_altered_cat_count_at_place(pps.place_id)
WHERE floor_count != sot.get_altered_cat_count_at_place(pps.place_id);

-- ============================================================================
-- 13. Verification
-- ============================================================================

\echo ''
\echo '13. Verification...'

DO $$
DECLARE
  v_null_count INT;
  v_current_count INT;
  v_departed_count INT;
  v_presumed_count INT;
  v_unknown_count INT;
  v_total INT;
BEGIN
  SELECT COUNT(*) INTO v_null_count FROM sot.cat_place WHERE presence_status IS NULL;
  SELECT COUNT(*) INTO v_current_count FROM sot.cat_place WHERE presence_status = 'current';
  SELECT COUNT(*) INTO v_departed_count FROM sot.cat_place WHERE presence_status = 'departed';
  SELECT COUNT(*) INTO v_presumed_count FROM sot.cat_place WHERE presence_status = 'presumed_departed';
  SELECT COUNT(*) INTO v_unknown_count FROM sot.cat_place WHERE presence_status = 'unknown';
  SELECT COUNT(*) INTO v_total FROM sot.cat_place;

  RAISE NOTICE '';
  RAISE NOTICE '=== Cat Presence Summary ===';
  RAISE NOTICE 'Total cat_place rows: %', v_total;
  RAISE NOTICE '  current:            % (%.1f%%)', v_current_count, (v_current_count::NUMERIC / NULLIF(v_total, 0) * 100);
  RAISE NOTICE '  unknown:            % (%.1f%%)', v_unknown_count, (v_unknown_count::NUMERIC / NULLIF(v_total, 0) * 100);
  RAISE NOTICE '  departed:           % (%.1f%%)', v_departed_count, (v_departed_count::NUMERIC / NULLIF(v_total, 0) * 100);
  RAISE NOTICE '  presumed_departed:  % (%.1f%%)', v_presumed_count, (v_presumed_count::NUMERIC / NULLIF(v_total, 0) * 100);
  RAISE NOTICE '  NULL:               % (should be 0)', v_null_count;
  RAISE NOTICE '';

  IF v_null_count > 0 THEN
    RAISE WARNING 'UNEXPECTED: % NULL presence_status rows remain!', v_null_count;
  END IF;

  -- Check for views/functions still using old != 'departed' filter
  RAISE NOTICE '';
  RAISE NOTICE '=== Views still using old filter (follow-up needed) ===';
  FOR v_null_count IN
    SELECT 1 FROM pg_views
    WHERE definition LIKE '%!= ''departed''%'
      AND definition NOT LIKE '%NOT IN%'
      AND schemaname IN ('sot', 'ops', 'trapper')
    LIMIT 1
  LOOP
    -- Just check if any exist, don't iterate — would need a different var
  END LOOP;
END $$;

-- Audit: find remaining views with old filter
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname || '.' || viewname AS view_name
    FROM pg_views
    WHERE definition LIKE '%!= ''departed''%'
      AND definition NOT LIKE '%NOT IN%presumed%'
      AND schemaname IN ('sot', 'ops', 'trapper')
  LOOP
    RAISE NOTICE 'TODO: % still uses old != departed filter', r.view_name;
  END LOOP;
END $$;

\echo ''
\echo 'MIG_3110 complete — cat presence gaps closed'
\echo ''
\echo '  Verify Cunda Bhikkhu / Tomki Rd:'
\echo '    SELECT c.name, cp.presence_status, cp.presence_confirmed_by, cp.departure_reason'
\echo '    FROM sot.cat_place cp JOIN sot.cats c ON c.cat_id = cp.cat_id'
\echo '    WHERE cp.place_id IN (SELECT place_id FROM sot.places WHERE formatted_address LIKE ''%Tomki%'');'
\echo ''
\echo '  Colony outcomes with presumed_departed:'
\echo '    SELECT * FROM ops.v_colony_cat_paths WHERE presumed_departed > 0 ORDER BY presumed_departed DESC LIMIT 10;'
\echo ''
\echo '  Helper function test:'
\echo '    SELECT sot.is_present(''current''), sot.is_present(''departed''), sot.is_present(''presumed_departed''), sot.is_present(NULL);'
\echo ''
