-- MIG_2953: Cat movement, media, and field sources views (FFS-587)
--
-- Three views used by cat detail API routes were in V1 but never ported:
--   sot.v_cat_movement_timeline   — /api/cats/[id]/movements
--   sot.v_cat_movement_patterns   — /api/cats/[id]/movements
--   sot.v_cat_media               — /api/cats/[id]/media
--   sot.v_cat_field_sources_summary — /api/cats/[id]

BEGIN;

-- ── View: v_cat_movement_timeline ───────────────────────────────────────

CREATE OR REPLACE VIEW sot.v_cat_movement_timeline AS
WITH events AS (
  SELECT
    me.event_id AS movement_id,
    me.cat_id,
    c.microchip,
    me.from_place_id,
    fp.display_name AS from_place_name,
    fp.formatted_address AS from_address,
    me.to_place_id,
    tp.display_name AS to_place_name,
    tp.formatted_address AS to_address,
    me.movement_date AS event_date,
    me.movement_type,
    me.source_system AS source_type,
    me.notes,
    me.created_at,
    LAG(me.movement_date) OVER (PARTITION BY me.cat_id ORDER BY me.movement_date) AS previous_event_date
  FROM sot.cat_movement_events me
  JOIN sot.cats c ON c.cat_id = me.cat_id AND c.merged_into_cat_id IS NULL
  LEFT JOIN sot.places fp ON fp.place_id = me.from_place_id
  LEFT JOIN sot.places tp ON tp.place_id = me.to_place_id
)
SELECT
  movement_id,
  cat_id,
  microchip,
  from_place_id,
  from_place_name,
  from_address,
  to_place_id,
  to_place_name,
  to_address,
  event_date,
  previous_event_date,
  CASE
    WHEN previous_event_date IS NOT NULL
    THEN (event_date - previous_event_date)::INT
  END AS days_since_previous,
  -- Distance: NULL for now (no PostGIS ST_Distance in schema)
  NULL::NUMERIC AS distance_meters,
  NULL::TEXT AS distance_category,
  movement_type,
  source_type,
  notes,
  created_at
FROM events;

COMMENT ON VIEW sot.v_cat_movement_timeline IS 'Cat movement events with lag/distance info (ported from V1)';

-- ── View: v_cat_movement_patterns ───────────────────────────────────────

CREATE OR REPLACE VIEW sot.v_cat_movement_patterns AS
SELECT
  c.cat_id,
  COALESCE(c.display_name, c.name) AS cat_name,
  c.microchip,
  COALESCE(mv.total_movements, 0)::INT AS total_movements,
  COALESCE(mv.unique_places, 0)::INT AS unique_places,
  mv.first_seen,
  mv.last_seen,
  CASE
    WHEN mv.first_seen IS NOT NULL AND mv.last_seen IS NOT NULL
    THEN (mv.last_seen - mv.first_seen)::INT
    ELSE 0
  END AS tracking_duration_days,
  mv.avg_days_between::NUMERIC AS avg_days_between_visits,
  NULL::NUMERIC AS avg_distance_meters,
  NULL::NUMERIC AS max_distance_meters,
  COALESCE(mv.return_visits, 0)::INT AS return_visits,
  COALESCE(mv.unique_places, 0)::INT AS new_locations,
  CASE
    WHEN COALESCE(mv.total_movements, 0) = 0 THEN 'stationary'
    WHEN COALESCE(mv.unique_places, 0) <= 2 THEN 'local'
    WHEN COALESCE(mv.unique_places, 0) <= 5 THEN 'moderate_range'
    ELSE 'wide_range'
  END AS movement_pattern,
  pp.place_id AS primary_place_id,
  pp.display_name AS primary_place_name,
  pp.formatted_address AS primary_address
FROM sot.cats c
LEFT JOIN LATERAL (
  SELECT
    agg.total_movements,
    agg.unique_places,
    agg.first_seen,
    agg.last_seen,
    gaps.avg_days_between,
    agg.return_visits
  FROM (
    SELECT
      COUNT(*)::INT AS total_movements,
      COUNT(DISTINCT COALESCE(me.to_place_id, me.from_place_id))::INT AS unique_places,
      MIN(me.movement_date) AS first_seen,
      MAX(me.movement_date) AS last_seen,
      COUNT(*) FILTER (
        WHERE me.to_place_id IN (
          SELECT me2.from_place_id FROM sot.cat_movement_events me2
          WHERE me2.cat_id = c.cat_id AND me2.from_place_id IS NOT NULL
        )
      )::INT AS return_visits
    FROM sot.cat_movement_events me
    WHERE me.cat_id = c.cat_id
  ) agg
  LEFT JOIN LATERAL (
    SELECT AVG(gap)::NUMERIC AS avg_days_between
    FROM (
      SELECT movement_date - LAG(movement_date) OVER (ORDER BY movement_date) AS gap
      FROM sot.cat_movement_events
      WHERE cat_id = c.cat_id
    ) g
    WHERE g.gap IS NOT NULL
  ) gaps ON TRUE
) mv ON TRUE
LEFT JOIN LATERAL (
  -- Primary place: most recent relationship
  SELECT p.place_id, p.display_name, p.formatted_address
  FROM sot.cat_place cp
  JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
  WHERE cp.cat_id = c.cat_id
    AND cp.relationship_type IN ('home', 'residence', 'colony_member')
  ORDER BY cp.updated_at DESC NULLS LAST
  LIMIT 1
) pp ON TRUE
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW sot.v_cat_movement_patterns IS 'Per-cat movement pattern summary (ported from V1)';

-- ── View: v_cat_media ───────────────────────────────────────────────────

CREATE OR REPLACE VIEW sot.v_cat_media AS
SELECT
  rm.media_id,
  rm.cat_id,
  rm.media_type::TEXT,
  rm.original_filename,
  rm.storage_path,
  rm.caption,
  rm.cat_description,
  COALESCE(rm.uploaded_by, 'unknown') AS uploaded_by,
  rm.uploaded_at,
  'direct' AS source_type,
  rm.request_id AS source_request_id
FROM ops.request_media rm
WHERE rm.cat_id IS NOT NULL
  AND NOT COALESCE(rm.is_archived, FALSE);

COMMENT ON VIEW sot.v_cat_media IS 'Cat photos from request media (ported from V1)';

-- ── View: v_cat_field_sources_summary ───────────────────────────────────

CREATE OR REPLACE VIEW sot.v_cat_field_sources_summary AS
SELECT
  fs.cat_id,
  fs.field_name,
  fs.field_value,
  fs.source_system,
  fs.source_table,
  fs.confidence,
  fs.priority,
  fs.observed_at,
  fs.created_at,
  ROW_NUMBER() OVER (
    PARTITION BY fs.cat_id, fs.field_name
    ORDER BY fs.priority DESC, fs.confidence DESC, fs.observed_at DESC NULLS LAST
  ) AS rank
FROM sot.cat_field_sources fs
JOIN sot.cats c ON c.cat_id = fs.cat_id AND c.merged_into_cat_id IS NULL;

COMMENT ON VIEW sot.v_cat_field_sources_summary IS 'Cat field provenance with priority ranking (ported from V1)';

COMMIT;
