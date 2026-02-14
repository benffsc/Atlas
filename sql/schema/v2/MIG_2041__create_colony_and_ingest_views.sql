-- MIG_2041: Create colony stats and ingest status views
-- Date: 2026-02-13
-- Issue: Colony pages and ingest dashboard need these views

-- Colony stats view
CREATE OR REPLACE VIEW ops.v_colony_stats AS
SELECT
  col.colony_id,
  col.name,
  col.description,
  col.colony_status,
  col.colony_type,
  col.estimated_population,
  col.estimated_altered,
  col.last_count_date,
  col.count_method,
  col.is_verified,
  col.needs_attention,
  col.attention_reason,
  col.watch_list,
  col.watch_list_reason,
  col.service_zone,
  col.source_system,
  col.created_at,
  col.updated_at,
  -- Primary caretaker
  col.primary_caretaker_id,
  COALESCE(pc.display_name, pc.first_name || ' ' || pc.last_name) AS primary_caretaker_name,
  -- Stats
  (SELECT COUNT(*) FROM sot.colony_cats cc WHERE cc.colony_id = col.colony_id AND cc.membership_status = 'active')::int AS active_cat_count,
  (SELECT COUNT(*) FROM sot.colony_cats cc WHERE cc.colony_id = col.colony_id)::int AS total_cat_count,
  (SELECT COUNT(*) FROM sot.colony_places cp WHERE cp.colony_id = col.colony_id AND cp.is_active = TRUE)::int AS active_place_count,
  -- Primary place
  (SELECT pp.place_id FROM sot.colony_places pp WHERE pp.colony_id = col.colony_id AND pp.is_primary = TRUE LIMIT 1) AS primary_place_id,
  (SELECT ppl.display_name FROM sot.colony_places pp JOIN sot.places ppl ON ppl.place_id = pp.place_id WHERE pp.colony_id = col.colony_id AND pp.is_primary = TRUE LIMIT 1) AS primary_place_name,
  (SELECT ppl.formatted_address FROM sot.colony_places pp JOIN sot.places ppl ON ppl.place_id = pp.place_id WHERE pp.colony_id = col.colony_id AND pp.is_primary = TRUE LIMIT 1) AS primary_place_address,
  -- Alteration rate
  CASE WHEN col.estimated_population > 0 THEN
    ROUND(100.0 * COALESCE(col.estimated_altered, 0) / col.estimated_population, 1)
  ELSE NULL END AS alteration_rate_pct
FROM sot.colonies col
LEFT JOIN sot.people pc ON pc.person_id = col.primary_caretaker_id AND pc.merged_into_person_id IS NULL
WHERE col.merged_into_colony_id IS NULL;

-- Colony linked cats view
CREATE OR REPLACE VIEW ops.v_colony_linked_cats AS
SELECT
  cc.colony_id,
  cc.cat_id,
  c.name AS cat_name,
  c.microchip,
  c.sex,
  c.altered_status,
  c.primary_color,
  c.breed,
  c.ear_tip,
  c.is_deceased,
  cc.membership_status,
  cc.joined_date,
  cc.left_date,
  cc.left_reason,
  cc.evidence_type,
  cc.confidence,
  cc.created_at
FROM sot.colony_cats cc
JOIN sot.cats c ON c.cat_id = cc.cat_id AND c.merged_into_cat_id IS NULL;

-- ClinicHQ batch status view
CREATE OR REPLACE VIEW ops.v_clinichq_batch_status AS
SELECT
  ir.run_id AS batch_id,
  ir.source_system,
  ir.source_table,
  ir.run_type,
  ir.status,
  ir.records_fetched AS total_records,
  ir.records_created + ir.records_updated AS processed_records,
  ir.records_errored AS failed_records,
  ir.started_at,
  ir.completed_at,
  ir.duration_ms,
  CASE WHEN ir.records_fetched > 0 THEN
    ROUND(100.0 * (ir.records_created + ir.records_updated) / ir.records_fetched, 1)
  ELSE 0 END AS progress_pct,
  ir.metadata
FROM ops.ingest_runs ir
WHERE ir.source_system = 'clinichq'
ORDER BY ir.started_at DESC;

-- Processing dashboard view
CREATE OR REPLACE VIEW ops.v_processing_dashboard AS
SELECT
  sr.source_system,
  COUNT(*) FILTER (WHERE sr.is_processed = FALSE AND sr.processing_error IS NULL) AS queued,
  0 AS processing,
  COUNT(*) FILTER (WHERE sr.is_processed = TRUE) AS completed,
  COUNT(*) FILTER (WHERE sr.processing_error IS NOT NULL) AS failed,
  COUNT(*) AS total,
  MAX(sr.created_at) AS last_queued_at,
  MAX(sr.updated_at) FILTER (WHERE sr.is_processed = TRUE) AS last_processed_at
FROM ops.staged_records sr
GROUP BY sr.source_system;

-- Geocoding stats view
CREATE OR REPLACE VIEW ops.v_geocoding_stats AS
SELECT
  (SELECT COUNT(*) FROM sot.places WHERE location IS NOT NULL AND merged_into_place_id IS NULL)::int AS geocoded,
  (SELECT COUNT(*) FROM sot.places WHERE location IS NULL AND merged_into_place_id IS NULL)::int AS pending,
  (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL)::int AS total,
  ROUND(100.0 * (SELECT COUNT(*) FROM sot.places WHERE location IS NOT NULL AND merged_into_place_id IS NULL) /
    NULLIF((SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL), 0), 1) AS geocoded_pct;

-- Reverse geocoding stats view (same structure for compatibility)
CREATE OR REPLACE VIEW ops.v_reverse_geocoding_stats AS
SELECT
  (SELECT COUNT(*) FROM sot.places WHERE formatted_address IS NOT NULL AND merged_into_place_id IS NULL)::int AS reverse_geocoded,
  (SELECT COUNT(*) FROM sot.places WHERE formatted_address IS NULL AND merged_into_place_id IS NULL)::int AS pending,
  (SELECT COUNT(*) FROM sot.places WHERE merged_into_place_id IS NULL)::int AS total;
