-- MIG_3091: Cat Path Presence from ShelterLuv Lifecycle Events (FFS-1280)
--
-- Problem: 86.6% of bridged cats (1,808 with both ClinicHQ + ShelterLuv IDs)
-- have LEFT their origin colony (adopted, transferred, deceased, fostered)
-- but sot.cat_place still shows them as present. Colony counts on the Beacon
-- map are massively inflated (e.g., 5999 Roblar Rd shows 16 cats but 0 remain).
--
-- Solution: Propagate ShelterLuv lifecycle terminal events into cat_place
-- presence_status/departure_reason automatically.
--
-- Dependencies: MIG_2952 (cat_place presence columns), MIG_2878 (v_cat_current_status)

\echo ''
\echo '=============================================='
\echo '  MIG_3091: Cat Path Presence from Lifecycle'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1a. Add departed_at column to sot.cat_place
-- ============================================================================

\echo '1a. Adding departed_at column...'

ALTER TABLE sot.cat_place
  ADD COLUMN IF NOT EXISTS departed_at TIMESTAMPTZ;

COMMENT ON COLUMN sot.cat_place.departed_at IS
  'When the cat left this place. Distinct from last_observed_at (when seen) and presence_confirmed_at (when status was set). MIG_3091.';

-- ============================================================================
-- 1b. Create sot.update_cat_place_from_lifecycle_events()
-- ============================================================================

\echo '1b. Creating lifecycle → presence propagation function...'

CREATE OR REPLACE FUNCTION sot.update_cat_place_from_lifecycle_events()
RETURNS TABLE(
  cats_processed INT,
  departures_set INT,
  returns_confirmed INT,
  already_departed INT,
  staff_overrides_skipped INT
)
LANGUAGE plpgsql AS $$
DECLARE
  v_cats_processed INT := 0;
  v_departures_set INT := 0;
  v_returns_confirmed INT := 0;
  v_already_departed INT := 0;
  v_staff_overrides_skipped INT := 0;
  v_row_count INT;
  v_skip_count INT;
  v_already_count INT;
  v_rec RECORD;
BEGIN
  -- Process each cat that has a terminal lifecycle event
  -- v_cat_current_status already filters merged_into_cat_id IS NULL
  FOR v_rec IN
    SELECT
      cs.cat_id,
      cs.current_status,
      cs.last_event_subtype,
      cs.last_event_at,
      -- Map current_status to departure_reason
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
      -- RTF cats should be marked current, not departed
      (cs.current_status = 'community_cat') AS is_rtf
    FROM sot.v_cat_current_status cs
    WHERE cs.current_status IN (
      'adopted', 'transferred', 'deceased', 'in_foster', 'community_cat'
    )
  LOOP
    v_cats_processed := v_cats_processed + 1;

    IF v_rec.is_rtf THEN
      -- RTF: Confirm as current, clear any departure info
      UPDATE sot.cat_place cp
      SET
        presence_status = 'current',
        departure_reason = NULL,
        departed_at = NULL,
        presence_confirmed_at = NOW(),
        presence_confirmed_by = 'shelterluv_lifecycle',
        updated_at = NOW()
      WHERE cp.cat_id = v_rec.cat_id
        AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
        -- Only update non-merged places
        AND EXISTS (SELECT 1 FROM sot.places pl WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL)
        -- Manual > AI: skip staff-confirmed rows
        AND (cp.presence_confirmed_by IS NULL
             OR cp.presence_confirmed_by IN ('shelterluv_lifecycle', 'system_backfill'))
        -- Only update if not already current from lifecycle
        AND NOT (cp.presence_status = 'current' AND cp.presence_confirmed_by = 'shelterluv_lifecycle');

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_returns_confirmed := v_returns_confirmed + v_row_count;

    ELSE
      -- Departed cat: set presence_status = 'departed'

      -- Count staff overrides we'll skip
      SELECT COUNT(*) INTO v_skip_count
      FROM sot.cat_place cp
      WHERE cp.cat_id = v_rec.cat_id
        AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
        AND EXISTS (SELECT 1 FROM sot.places pl WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL)
        AND cp.presence_confirmed_by IS NOT NULL
        AND cp.presence_confirmed_by NOT IN ('shelterluv_lifecycle', 'system_backfill');

      v_staff_overrides_skipped := v_staff_overrides_skipped + COALESCE(v_skip_count, 0);

      -- Count already-departed rows we'll skip
      SELECT COUNT(*) INTO v_already_count
      FROM sot.cat_place cp
      WHERE cp.cat_id = v_rec.cat_id
        AND cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at')
        AND EXISTS (SELECT 1 FROM sot.places pl WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL)
        AND cp.presence_status = 'departed'
        AND cp.presence_confirmed_by = 'shelterluv_lifecycle';

      v_already_departed := v_already_departed + COALESCE(v_already_count, 0);

      -- Perform the update
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
        -- Only update non-merged places
        AND EXISTS (SELECT 1 FROM sot.places pl WHERE pl.place_id = cp.place_id AND pl.merged_into_place_id IS NULL)
        -- Manual > AI: skip staff-confirmed rows
        AND (cp.presence_confirmed_by IS NULL
             OR cp.presence_confirmed_by IN ('shelterluv_lifecycle', 'system_backfill'))
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
    v_staff_overrides_skipped;
END;
$$;

COMMENT ON FUNCTION sot.update_cat_place_from_lifecycle_events IS
  'Propagates ShelterLuv lifecycle terminal events (adoption, transfer, death, foster, RTF) '
  'into cat_place presence_status. Respects Manual > AI (skips staff-confirmed). '
  'Called by entity linking cron (Step 7). MIG_3091.';

-- ============================================================================
-- 1c. Update ops.update_cat_presence() — add p_departed_at parameter
-- ============================================================================

\echo '1c. Updating ops.update_cat_presence() with departed_at support...'

-- Drop old 5-arg signature before creating 6-arg version
DROP FUNCTION IF EXISTS ops.update_cat_presence(UUID, UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION ops.update_cat_presence(
  p_cat_id UUID,
  p_place_id UUID,
  p_presence_status TEXT,
  p_departure_reason TEXT DEFAULT NULL,
  p_confirmed_by TEXT DEFAULT 'staff',
  p_departed_at TIMESTAMPTZ DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE sot.cat_place
  SET
    presence_status = p_presence_status,
    departure_reason = CASE
      WHEN p_presence_status = 'departed' THEN COALESCE(p_departure_reason, 'unknown')
      ELSE NULL
    END,
    departed_at = CASE
      WHEN p_presence_status = 'departed' THEN COALESCE(p_departed_at, NOW())
      WHEN p_presence_status = 'current' THEN NULL
      ELSE departed_at
    END,
    reactivation_reason = CASE
      WHEN p_presence_status = 'current'
           AND presence_status = 'departed' THEN 'staff_reactivated'
      ELSE reactivation_reason
    END,
    presence_confirmed_at = NOW(),
    presence_confirmed_by = p_confirmed_by,
    updated_at = NOW()
  WHERE cat_id = p_cat_id
    AND place_id = p_place_id
    AND relationship_type IN ('home', 'residence', 'colony_member', 'seen_at');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

COMMENT ON FUNCTION ops.update_cat_presence IS
  'Update cat presence status at a place. MIG_3091: added p_departed_at parameter.';

-- ============================================================================
-- 1d. Update sot.v_cat_place_presence view — add departed_at
-- ============================================================================

\echo '1d. Updating v_cat_place_presence view with departed_at...'

-- Must drop and recreate (can't add columns to existing view with CREATE OR REPLACE)
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
  -- Effective status: inferred from observation recency if explicit is unknown
  CASE
    WHEN cp.presence_status IN ('current', 'departed') THEN cp.presence_status
    WHEN cp.last_observed_at IS NOT NULL
         AND cp.last_observed_at >= CURRENT_DATE - INTERVAL '12 months' THEN 'current'
    WHEN cp.last_observed_at IS NOT NULL
         AND cp.last_observed_at >= CURRENT_DATE - INTERVAL '36 months' THEN 'uncertain'
    WHEN cp.last_observed_at IS NOT NULL THEN 'departed'
    ELSE 'unknown'
  END AS effective_status,
  -- Inferred status label
  CASE
    WHEN cp.presence_status IS NOT NULL AND cp.presence_status != 'unknown' THEN 'confirmed'
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
  -- Alteration info
  CASE
    WHEN c.altered_status IN ('spayed', 'neutered', 'altered') THEN c.verified_at
  END AS altered_date,
  c.altered_status IN ('spayed', 'neutered', 'altered') AS is_altered
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id
  AND c.merged_into_cat_id IS NULL
WHERE cp.relationship_type IN ('home', 'residence', 'colony_member', 'seen_at');

COMMENT ON VIEW sot.v_cat_place_presence IS
  'Cat presence at places with inferred/confirmed status. MIG_3091: added departed_at.';

-- ============================================================================
-- 1e. Create ops.v_colony_cat_paths aggregation view
-- ============================================================================

\echo '1e. Creating colony cat paths aggregation view...'

CREATE OR REPLACE VIEW ops.v_colony_cat_paths AS
SELECT
  cp.place_id,
  p.formatted_address,
  p.display_name AS place_name,
  p.service_zone,
  COUNT(DISTINCT cp.cat_id) AS total_cats_ever,
  COUNT(DISTINCT cp.cat_id) FILTER (
    WHERE COALESCE(cp.presence_status, 'unknown') NOT IN ('departed')
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
    WHERE COALESCE(cp.presence_status, 'unknown') = 'unknown'
  ) AS unknown_status
FROM sot.cat_place cp
JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
WHERE cp.relationship_type IN ('home', 'residence', 'colony_member')
GROUP BY cp.place_id, p.formatted_address, p.display_name, p.service_zone;

COMMENT ON VIEW ops.v_colony_cat_paths IS
  'Per-place breakdown of cat outcomes: current, adopted, relocated, transferred, deceased, fostered, unknown. MIG_3091.';

-- ============================================================================
-- 1f. Backfill — run lifecycle → presence propagation
-- ============================================================================

\echo '1f. Running backfill...'

DO $$
DECLARE
  v_result RECORD;
BEGIN
  SELECT * INTO v_result FROM sot.update_cat_place_from_lifecycle_events();
  RAISE NOTICE 'Backfill results: cats_processed=%, departures_set=%, returns_confirmed=%, already_departed=%, staff_overrides_skipped=%',
    v_result.cats_processed,
    v_result.departures_set,
    v_result.returns_confirmed,
    v_result.already_departed,
    v_result.staff_overrides_skipped;
END $$;

\echo ''
\echo '✓ MIG_3091 complete — cat path presence from lifecycle events'
\echo ''
\echo '  Verify Cunda Bhikkhu / Tomki Rd:'
\echo '    SELECT c.name, cp.presence_status, cp.departure_reason, cp.departed_at'
\echo '    FROM sot.cat_place cp JOIN sot.cats c ON c.cat_id = cp.cat_id'
\echo '    WHERE cp.place_id IN (SELECT place_id FROM sot.places WHERE formatted_address LIKE ''%Tomki%'');'
\echo ''
\echo '  Colony outcomes:'
\echo '    SELECT * FROM ops.v_colony_cat_paths ORDER BY total_cats_ever DESC LIMIT 10;'
\echo ''
