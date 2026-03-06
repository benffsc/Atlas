-- MIG_2823: GM Entry Geo-Linking Pipeline V2
--
-- Rebuilds the Google Maps entry linking system natively for V2.
-- V1 functions (sot.link_google_entries_tiered, sot.link_google_entries_from_ai,
-- ops.manual_link_google_entry, ops.unlink_google_entry, ops.flag_multi_unit_candidates)
-- don't exist in V2. This migration provides composite-confidence linking.
--
-- New infrastructure:
--   1a. Columns: link_confidence, link_method, linked_at on source.google_map_entries
--   1b. Audit table: ops.gm_entry_link_audit
--   1c. Partial GiST index on unlinked entries (spatial)
--   1d. Trigram index on kml_name (name similarity)
--   1e. Composite scorer: ops.gm_link_confidence()
--   1f. Auto-linker: ops.link_gm_entries_by_proximity()
--   1g. Manual link: ops.manual_link_gm_entry()
--   1h. Manual unlink: ops.unlink_gm_entry()
--   1i. Trigger: place INSERT updates nearest_place_id
--   1j. Stats view: ops.v_gm_linking_stats
--   1k. Update ops.v_gm_reference_pins to query source.google_map_entries
--   1l. Initial batch run
--
-- Created: 2026-03-05

\echo ''
\echo '=============================================='
\echo '  MIG_2823: GM Entry Geo-Linking Pipeline V2'
\echo '=============================================='
\echo ''

-- Require pg_trgm for name similarity scoring
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 1a. Add linking metadata columns to source.google_map_entries
-- ============================================================================

\echo '1a. Adding link_confidence, link_method, linked_at columns...'

ALTER TABLE source.google_map_entries
  ADD COLUMN IF NOT EXISTS link_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS link_method TEXT,
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;

COMMENT ON COLUMN source.google_map_entries.link_confidence IS
  'Composite confidence score (0-1) for the link. 1.0 = manual.';
COMMENT ON COLUMN source.google_map_entries.link_method IS
  'How this entry was linked: auto_proximity, manual, legacy_v1.';
COMMENT ON COLUMN source.google_map_entries.linked_at IS
  'When the link was established.';

-- ============================================================================
-- 1b. Audit table: ops.gm_entry_link_audit
-- ============================================================================

\echo '1b. Creating ops.gm_entry_link_audit table...'

CREATE TABLE IF NOT EXISTS ops.gm_entry_link_audit (
  audit_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id    UUID NOT NULL,
  action      TEXT NOT NULL CHECK (action IN (
    'auto_linked', 'manual_linked', 'unlinked',
    'flagged_multi_unit', 'nearest_updated', 'spot_check'
  )),
  place_id    UUID,
  confidence  NUMERIC(4,3),
  link_method TEXT,
  distance_m  DOUBLE PRECISION,
  name_sim    DOUBLE PRECISION,
  details     JSONB,
  performed_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gm_audit_entry ON ops.gm_entry_link_audit (entry_id);
CREATE INDEX IF NOT EXISTS idx_gm_audit_place ON ops.gm_entry_link_audit (place_id);
CREATE INDEX IF NOT EXISTS idx_gm_audit_created ON ops.gm_entry_link_audit (created_at DESC);

COMMENT ON TABLE ops.gm_entry_link_audit IS
  'Audit trail for all GM entry linking/unlinking operations.';

-- ============================================================================
-- 1c. Partial GiST index on unlinked entries (spatial queries)
-- ============================================================================

\echo '1c. Creating spatial index on unlinked entries...'

CREATE INDEX IF NOT EXISTS idx_source_gme_unlinked_geog
  ON source.google_map_entries
  USING GIST (geography(ST_SetSRID(ST_MakePoint(lng, lat), 4326)))
  WHERE linked_place_id IS NULL AND place_id IS NULL AND lat IS NOT NULL;

-- ============================================================================
-- 1d. Trigram index on kml_name for name similarity
-- ============================================================================

\echo '1d. Creating trigram index on kml_name...'

CREATE INDEX IF NOT EXISTS idx_source_gme_kml_name_trgm
  ON source.google_map_entries
  USING GIN (LOWER(kml_name) gin_trgm_ops)
  WHERE kml_name IS NOT NULL;

-- ============================================================================
-- 1e. Composite scorer: ops.gm_link_confidence()
-- ============================================================================

\echo '1e. Creating ops.gm_link_confidence() function...'

CREATE OR REPLACE FUNCTION ops.gm_link_confidence(
  p_distance_m      DOUBLE PRECISION,
  p_kml_name        TEXT,
  p_place_address   TEXT,
  p_place_display   TEXT,
  p_place_kind      TEXT,
  p_ai_confidence   DOUBLE PRECISION DEFAULT NULL,
  p_ai_meaning      TEXT DEFAULT NULL
)
RETURNS NUMERIC(4,3) AS $$
DECLARE
  v_dist_score  NUMERIC;
  v_name_score  NUMERIC;
  v_kind_score  NUMERIC;
  v_ai_score    NUMERIC;
  v_composite   NUMERIC;
  v_name_sim    NUMERIC;
BEGIN
  -- Distance component (weight 0.40)
  -- Piecewise linear interpolation
  v_dist_score := CASE
    WHEN p_distance_m <= 5   THEN 1.0
    WHEN p_distance_m <= 10  THEN 0.95
    WHEN p_distance_m <= 15  THEN 0.85
    WHEN p_distance_m <= 25  THEN 0.70
    WHEN p_distance_m <= 50  THEN 0.50
    WHEN p_distance_m <= 100 THEN 0.30
    WHEN p_distance_m <= 200 THEN 0.15
    WHEN p_distance_m <= 500 THEN 0.05
    ELSE 0.0
  END;

  -- Name similarity component (weight 0.30)
  -- Compare kml_name against both formatted_address and display_name
  IF p_kml_name IS NOT NULL AND LENGTH(TRIM(p_kml_name)) > 0 THEN
    v_name_sim := GREATEST(
      COALESCE(similarity(LOWER(p_kml_name), LOWER(COALESCE(p_place_address, ''))), 0),
      COALESCE(similarity(LOWER(p_kml_name), LOWER(COALESCE(p_place_display, ''))), 0)
    );
    v_name_score := v_name_sim;
  ELSE
    -- No name to compare — neutral (don't penalize, don't boost)
    v_name_score := 0.5;
  END IF;

  -- Place kind component (weight 0.15)
  v_kind_score := CASE
    WHEN p_place_kind IN ('residential', 'outdoor', 'colony') THEN 0.90
    WHEN p_place_kind IN ('business', 'commercial') THEN 0.80
    WHEN p_place_kind IN ('apartment', 'multi_unit') THEN 0.0  -- Never auto-link apartments
    WHEN p_place_kind IS NULL THEN 0.70  -- Unknown kind, slight penalty
    ELSE 0.60
  END;

  -- AI signal component (weight 0.15)
  IF p_ai_confidence IS NOT NULL AND p_ai_confidence >= 0.7 THEN
    IF p_ai_meaning = 'same_place' THEN
      v_ai_score := 1.0;
    ELSIF p_ai_meaning IN ('colony_site', 'active_colony', 'caretaker_contact') THEN
      v_ai_score := 0.80;
    ELSE
      v_ai_score := 0.50;
    END IF;
  ELSIF p_ai_confidence IS NOT NULL THEN
    v_ai_score := 0.50;  -- Low confidence AI
  ELSE
    v_ai_score := 0.50;  -- No AI data — neutral
  END IF;

  -- Weighted composite
  v_composite := (v_dist_score * 0.40)
               + (v_name_score * 0.30)
               + (v_kind_score * 0.15)
               + (v_ai_score   * 0.15);

  RETURN ROUND(v_composite, 3);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION ops.gm_link_confidence IS
  'Composite confidence score for linking a GM entry to a place.
   Weights: distance(0.40) + name_similarity(0.30) + place_kind(0.15) + ai_signal(0.15).
   Returns 0-1. >= 0.85 = auto-link, 0.65-0.84 = spot-check, < 0.65 = skip.';

-- ============================================================================
-- 1f. Auto-linker: ops.link_gm_entries_by_proximity()
-- ============================================================================

\echo '1f. Creating ops.link_gm_entries_by_proximity() function...'

CREATE OR REPLACE FUNCTION ops.link_gm_entries_by_proximity(
  p_limit   INT DEFAULT 5000,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  auto_linked       INT,
  spot_check_logged INT,
  multi_unit_flagged INT,
  nearest_updated   INT
) AS $$
DECLARE
  v_auto_linked       INT := 0;
  v_spot_check_logged INT := 0;
  v_multi_unit_flagged INT := 0;
  v_nearest_updated   INT := 0;
  v_rec RECORD;
  v_confidence NUMERIC(4,3);
  v_distance_m DOUBLE PRECISION;
  v_name_sim DOUBLE PRECISION;
  v_is_multi BOOLEAN;
BEGIN
  -- ---------------------------------------------------------------
  -- Phase 1: Update nearest_place_id for entries missing or stale
  -- ---------------------------------------------------------------
  IF p_dry_run THEN
    -- Dry run: just count how many would be updated
    SELECT COUNT(*)::INT INTO v_nearest_updated
    FROM source.google_map_entries e
    CROSS JOIN LATERAL (
      SELECT place_id, location
      FROM sot.places p
      WHERE p.merged_into_place_id IS NULL
        AND p.location IS NOT NULL
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
          p.location::geography,
          500
        )
      ORDER BY ST_Distance(
        ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
        p.location::geography
      )
      LIMIT 1
    ) p
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.lat IS NOT NULL
      AND (e.nearest_place_id IS NULL OR e.nearest_place_id != p.place_id);
  ELSE
    -- Real run: update and count
    WITH candidates AS (
      SELECT DISTINCT ON (e.entry_id)
        e.entry_id,
        p.place_id,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
          p.location::geography
        ) AS distance_m
      FROM source.google_map_entries e
      CROSS JOIN LATERAL (
        SELECT place_id, location
        FROM sot.places p
        WHERE p.merged_into_place_id IS NULL
          AND p.location IS NOT NULL
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
            p.location::geography,
            500
          )
        ORDER BY ST_Distance(
          ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
          p.location::geography
        )
        LIMIT 1
      ) p
      WHERE e.linked_place_id IS NULL
        AND e.place_id IS NULL
        AND e.lat IS NOT NULL
        AND (e.nearest_place_id IS NULL OR e.nearest_place_id != p.place_id)
      LIMIT p_limit
    ),
    updated AS (
      UPDATE source.google_map_entries e
      SET
        nearest_place_id = c.place_id,
        nearest_place_distance_m = c.distance_m,
        updated_at = NOW()
      FROM candidates c
      WHERE e.entry_id = c.entry_id
      RETURNING e.entry_id
    )
    SELECT COUNT(*)::INT INTO v_nearest_updated FROM updated;
  END IF;

  -- ---------------------------------------------------------------
  -- Phase 2: Score & link unlinked entries with a nearest_place
  -- ---------------------------------------------------------------
  FOR v_rec IN
    SELECT
      e.entry_id,
      e.kml_name,
      e.nearest_place_id,
      e.nearest_place_distance_m,
      e.ai_confidence,
      e.ai_meaning,
      p.formatted_address,
      p.display_name AS place_display_name,
      p.place_kind
    FROM source.google_map_entries e
    JOIN sot.places p ON p.place_id = e.nearest_place_id
      AND p.merged_into_place_id IS NULL
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.nearest_place_id IS NOT NULL
      AND e.lat IS NOT NULL
      AND e.nearest_place_distance_m <= 500
    ORDER BY e.nearest_place_distance_m ASC
    LIMIT p_limit
  LOOP
    -- Check multi-unit
    v_is_multi := sot.is_multi_unit_place(v_rec.nearest_place_id);

    IF v_is_multi THEN
      -- Flag as multi-unit, never auto-link
      IF NOT p_dry_run THEN
        UPDATE source.google_map_entries
        SET requires_unit_selection = TRUE, updated_at = NOW()
        WHERE entry_id = v_rec.entry_id;

        INSERT INTO ops.gm_entry_link_audit
          (entry_id, action, place_id, distance_m, performed_by)
        VALUES
          (v_rec.entry_id, 'flagged_multi_unit', v_rec.nearest_place_id,
           v_rec.nearest_place_distance_m, 'cron_v2');
      END IF;
      v_multi_unit_flagged := v_multi_unit_flagged + 1;
      CONTINUE;
    END IF;

    -- Compute composite confidence
    v_distance_m := v_rec.nearest_place_distance_m;
    v_confidence := ops.gm_link_confidence(
      v_distance_m,
      v_rec.kml_name,
      v_rec.formatted_address,
      v_rec.place_display_name,
      v_rec.place_kind,
      v_rec.ai_confidence,
      v_rec.ai_meaning
    );

    -- Name similarity for audit
    IF v_rec.kml_name IS NOT NULL AND LENGTH(TRIM(v_rec.kml_name)) > 0 THEN
      v_name_sim := GREATEST(
        COALESCE(similarity(LOWER(v_rec.kml_name), LOWER(COALESCE(v_rec.formatted_address, ''))), 0),
        COALESCE(similarity(LOWER(v_rec.kml_name), LOWER(COALESCE(v_rec.place_display_name, ''))), 0)
      );
    ELSE
      v_name_sim := NULL;
    END IF;

    IF v_confidence >= 0.85 THEN
      -- Auto-link
      IF NOT p_dry_run THEN
        UPDATE source.google_map_entries
        SET
          linked_place_id = v_rec.nearest_place_id,
          link_confidence = v_confidence,
          link_method = 'auto_proximity',
          linked_at = NOW(),
          match_status = 'matched',
          matched_at = NOW(),
          match_distance_m = v_distance_m,
          updated_at = NOW()
        WHERE entry_id = v_rec.entry_id;

        INSERT INTO ops.gm_entry_link_audit
          (entry_id, action, place_id, confidence, link_method, distance_m, name_sim, performed_by)
        VALUES
          (v_rec.entry_id, 'auto_linked', v_rec.nearest_place_id, v_confidence,
           'auto_proximity', v_distance_m, v_name_sim, 'cron_v2');
      END IF;
      v_auto_linked := v_auto_linked + 1;

    ELSIF v_confidence >= 0.65 THEN
      -- Log for spot-check (do NOT link)
      IF NOT p_dry_run THEN
        INSERT INTO ops.gm_entry_link_audit
          (entry_id, action, place_id, confidence, link_method, distance_m, name_sim,
           details, performed_by)
        VALUES
          (v_rec.entry_id, 'spot_check', v_rec.nearest_place_id, v_confidence,
           'auto_proximity', v_distance_m, v_name_sim,
           jsonb_build_object(
             'kml_name', v_rec.kml_name,
             'place_address', v_rec.formatted_address,
             'place_kind', v_rec.place_kind
           ),
           'cron_v2');
      END IF;
      v_spot_check_logged := v_spot_check_logged + 1;
    END IF;
    -- < 0.65: skip silently
  END LOOP;

  RETURN QUERY SELECT v_auto_linked, v_spot_check_logged, v_multi_unit_flagged, v_nearest_updated;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.link_gm_entries_by_proximity IS
  'V2 composite-confidence GM entry linker.
   Phase 1: Update nearest_place_id for unlinked entries (500m radius).
   Phase 2: Score with ops.gm_link_confidence() and auto-link >= 0.85.
   Multi-unit places are flagged, never auto-linked.
   Spot-check entries (0.65-0.84) are audit-logged but NOT linked.';

-- ============================================================================
-- 1g. Manual link: ops.manual_link_gm_entry()
-- ============================================================================

\echo '1g. Creating ops.manual_link_gm_entry() function...'

CREATE OR REPLACE FUNCTION ops.manual_link_gm_entry(
  p_entry_id  UUID,
  p_place_id  UUID,
  p_linked_by TEXT DEFAULT 'web_app'
)
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
DECLARE
  v_entry RECORD;
  v_place RECORD;
  v_distance_m DOUBLE PRECISION;
BEGIN
  -- Validate entry exists
  SELECT entry_id, lat, lng, linked_place_id
  INTO v_entry
  FROM source.google_map_entries
  WHERE entry_id = p_entry_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Entry not found: ' || p_entry_id::TEXT;
    RETURN;
  END IF;

  IF v_entry.linked_place_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Entry is already linked to place ' || v_entry.linked_place_id::TEXT;
    RETURN;
  END IF;

  -- Validate place exists and is not merged
  SELECT place_id, location, merged_into_place_id
  INTO v_place
  FROM sot.places
  WHERE place_id = p_place_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Place not found: ' || p_place_id::TEXT;
    RETURN;
  END IF;

  IF v_place.merged_into_place_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'Place has been merged into ' || v_place.merged_into_place_id::TEXT;
    RETURN;
  END IF;

  -- Compute distance for audit
  IF v_entry.lat IS NOT NULL AND v_place.location IS NOT NULL THEN
    v_distance_m := ST_Distance(
      ST_SetSRID(ST_MakePoint(v_entry.lng, v_entry.lat), 4326)::geography,
      v_place.location::geography
    );
  END IF;

  -- Link it
  UPDATE source.google_map_entries
  SET
    linked_place_id = p_place_id,
    link_confidence = 1.0,
    link_method = 'manual',
    linked_at = NOW(),
    match_status = 'manually_linked',
    matched_at = NOW(),
    match_distance_m = v_distance_m,
    nearest_place_id = p_place_id,
    nearest_place_distance_m = v_distance_m,
    requires_unit_selection = FALSE,
    reviewed_by = p_linked_by,
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE entry_id = p_entry_id;

  -- Audit
  INSERT INTO ops.gm_entry_link_audit
    (entry_id, action, place_id, confidence, link_method, distance_m, performed_by)
  VALUES
    (p_entry_id, 'manual_linked', p_place_id, 1.0, 'manual', v_distance_m, p_linked_by);

  RETURN QUERY SELECT TRUE, 'Linked entry to place ' || p_place_id::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.manual_link_gm_entry IS
  'Manually link a GM entry to a place. Sets confidence=1.0, creates audit record.';

-- ============================================================================
-- 1h. Manual unlink: ops.unlink_gm_entry()
-- ============================================================================

\echo '1h. Creating ops.unlink_gm_entry() function...'

CREATE OR REPLACE FUNCTION ops.unlink_gm_entry(
  p_entry_id   UUID,
  p_unlinked_by TEXT DEFAULT 'web_app'
)
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
DECLARE
  v_entry RECORD;
BEGIN
  -- Validate entry exists and is linked
  SELECT entry_id, linked_place_id
  INTO v_entry
  FROM source.google_map_entries
  WHERE entry_id = p_entry_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Entry not found: ' || p_entry_id::TEXT;
    RETURN;
  END IF;

  IF v_entry.linked_place_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Entry is not linked to any place';
    RETURN;
  END IF;

  -- Audit before clearing
  INSERT INTO ops.gm_entry_link_audit
    (entry_id, action, place_id, performed_by, details)
  VALUES
    (p_entry_id, 'unlinked', v_entry.linked_place_id, p_unlinked_by,
     jsonb_build_object('previous_place_id', v_entry.linked_place_id));

  -- Clear linking columns
  UPDATE source.google_map_entries
  SET
    linked_place_id = NULL,
    link_confidence = NULL,
    link_method = NULL,
    linked_at = NULL,
    match_status = 'unmatched',
    matched_at = NULL,
    match_distance_m = NULL,
    requires_unit_selection = FALSE,
    reviewed_by = p_unlinked_by,
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE entry_id = p_entry_id;

  RETURN QUERY SELECT TRUE, 'Unlinked entry from place ' || v_entry.linked_place_id::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.unlink_gm_entry IS
  'Unlink a GM entry from its place. Clears all linking columns, creates audit record.';

-- ============================================================================
-- 1i. Trigger: new place INSERT updates nearest_place_id for nearby entries
-- ============================================================================

\echo '1i. Creating trigger for place inserts...'

CREATE OR REPLACE FUNCTION ops.trg_fn_place_insert_update_gm_nearest()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire if the new place has coordinates
  IF NEW.location IS NOT NULL AND NEW.merged_into_place_id IS NULL THEN
    -- Update nearest_place_id for unlinked GM entries within 500m
    -- where new place is closer than current nearest
    UPDATE source.google_map_entries e
    SET
      nearest_place_id = NEW.place_id,
      nearest_place_distance_m = ST_Distance(
        ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
        NEW.location::geography
      ),
      updated_at = NOW()
    WHERE e.linked_place_id IS NULL
      AND e.place_id IS NULL
      AND e.lat IS NOT NULL
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
        NEW.location::geography,
        500
      )
      AND (
        e.nearest_place_id IS NULL
        OR ST_Distance(
          ST_SetSRID(ST_MakePoint(e.lng, e.lat), 4326)::geography,
          NEW.location::geography
        ) < e.nearest_place_distance_m
      );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present (idempotent)
DROP TRIGGER IF EXISTS trg_place_insert_update_gm_nearest ON sot.places;

CREATE TRIGGER trg_place_insert_update_gm_nearest
  AFTER INSERT ON sot.places
  FOR EACH ROW
  EXECUTE FUNCTION ops.trg_fn_place_insert_update_gm_nearest();

COMMENT ON FUNCTION ops.trg_fn_place_insert_update_gm_nearest IS
  'After a new place is inserted, update nearest_place_id for nearby unlinked GM entries.
   Lightweight: only updates nearest_place_id, does NOT auto-link (that is the cron job).';

-- ============================================================================
-- 1j. Stats view: ops.v_gm_linking_stats
-- ============================================================================

\echo '1j. Creating ops.v_gm_linking_stats view...'

CREATE OR REPLACE VIEW ops.v_gm_linking_stats AS
SELECT
  COUNT(*) FILTER (
    WHERE linked_place_id IS NOT NULL OR place_id IS NOT NULL
  )::INT AS linked,
  COUNT(*) FILTER (
    WHERE linked_place_id IS NULL AND place_id IS NULL
      AND requires_unit_selection = TRUE
  )::INT AS needs_unit_selection,
  COUNT(*) FILTER (
    WHERE linked_place_id IS NULL AND place_id IS NULL
      AND COALESCE(requires_unit_selection, FALSE) = FALSE
  )::INT AS unlinked,
  COUNT(*)::INT AS total
FROM source.google_map_entries
WHERE lat IS NOT NULL;

COMMENT ON VIEW ops.v_gm_linking_stats IS
  'Current GM entry linking statistics: linked, needs_unit_selection, unlinked, total.';

-- ============================================================================
-- 1k. Update ops.v_gm_reference_pins to query source.google_map_entries
-- ============================================================================

\echo '1k. Updating ops.v_gm_reference_pins to use source.google_map_entries...'

-- Must drop dependent view first, then the target, to avoid "cannot drop columns" error
DROP VIEW IF EXISTS ops.v_map_atlas_pins_with_gm;
DROP VIEW IF EXISTS ops.v_gm_reference_pins;

-- Column types and order MUST match ops.v_map_atlas_pins for UNION ALL
CREATE VIEW ops.v_gm_reference_pins AS
SELECT
  gme.entry_id AS id,
  gme.kml_name AS address,
  gme.kml_name AS display_name,
  gme.lat,
  gme.lng,
  NULL::TEXT AS service_zone,
  NULL::UUID AS parent_place_id,
  'google_maps_historical'::TEXT AS place_kind,
  NULL::TEXT AS unit_identifier,
  COALESCE(gme.parsed_cat_count, 0)::BIGINT AS cat_count,
  '[]'::JSONB AS people,
  0::BIGINT AS person_count,
  CASE
    WHEN gme.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony') THEN TRUE
    ELSE FALSE
  END AS disease_risk,
  CASE
    WHEN gme.ai_meaning = 'felv_colony' THEN 'FeLV detected in AI summary'
    WHEN gme.ai_meaning = 'fiv_colony' THEN 'FIV detected in AI summary'
    WHEN gme.ai_meaning = 'disease_risk' THEN 'Disease risk noted in AI summary'
    ELSE NULL
  END AS disease_risk_notes,
  '[]'::JSONB AS disease_badges,
  0::BIGINT AS disease_count,
  CASE WHEN gme.ai_meaning = 'watch_list' THEN TRUE ELSE FALSE END AS watch_list,
  NULL::TEXT AS watch_list_reason,
  1::BIGINT AS google_entry_count,
  jsonb_build_array(jsonb_build_object(
    'summary', COALESCE(gme.ai_summary, LEFT(gme.original_content, 200)),
    'meaning', gme.ai_meaning,
    'date', gme.parsed_date::TEXT
  )) AS google_summaries,
  0::BIGINT AS request_count,
  0::BIGINT AS active_request_count,
  0::BIGINT AS intake_count,
  0::BIGINT AS total_altered,
  NULL::DATE AS last_alteration_at,
  CASE
    WHEN gme.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony') THEN 'disease'
    WHEN gme.ai_meaning = 'watch_list' THEN 'watch_list'
    WHEN gme.ai_meaning = 'active_colony' THEN 'active'
    ELSE 'has_history'
  END AS pin_style,
  'reference'::TEXT AS pin_tier,
  gme.imported_at AS created_at,
  gme.imported_at AS last_activity_at,
  0::BIGINT AS needs_trapper_count
FROM source.google_map_entries gme
WHERE gme.linked_place_id IS NULL
  AND gme.lat IS NOT NULL
  AND gme.lng IS NOT NULL;

COMMENT ON VIEW ops.v_gm_reference_pins IS
  'Unlinked Google Maps entries formatted as reference pins for the atlas map.
These are historical TNR notes that have not been linked to a formal Atlas place.
Pin style is based on AI classification. All entries are reference tier.
V2: Now reads from source.google_map_entries (was ops.google_map_entries).';

-- Re-create the combined view that depends on v_gm_reference_pins
CREATE OR REPLACE VIEW ops.v_map_atlas_pins_with_gm AS
SELECT * FROM ops.v_map_atlas_pins
UNION ALL
SELECT * FROM ops.v_gm_reference_pins;

COMMENT ON VIEW ops.v_map_atlas_pins_with_gm IS
  'Combined view of atlas_pins (places) and unlinked GM entries (reference pins).';

-- ============================================================================
-- 1l. Initial batch run
-- ============================================================================

\echo '1l. Running initial batch linking...'
\echo ''

SELECT * FROM ops.link_gm_entries_by_proximity(5000, false);

\echo ''
\echo 'Current stats:'
SELECT * FROM ops.v_gm_linking_stats;

\echo ''
\echo '=============================================='
\echo '  MIG_2823 Complete'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - Columns: source.google_map_entries.{link_confidence, link_method, linked_at}'
\echo '  - Table: ops.gm_entry_link_audit'
\echo '  - Index: idx_source_gme_unlinked_geog (spatial, partial)'
\echo '  - Index: idx_source_gme_kml_name_trgm (trigram)'
\echo '  - Function: ops.gm_link_confidence() — composite scorer'
\echo '  - Function: ops.link_gm_entries_by_proximity() — auto-linker'
\echo '  - Function: ops.manual_link_gm_entry() — manual link'
\echo '  - Function: ops.unlink_gm_entry() — manual unlink'
\echo '  - Trigger: trg_place_insert_update_gm_nearest — on sot.places INSERT'
\echo '  - View: ops.v_gm_linking_stats — linking statistics'
\echo '  - Updated: ops.v_gm_reference_pins → source.google_map_entries'
\echo '  - Updated: ops.v_map_atlas_pins_with_gm (re-created for dependency)'
\echo ''
