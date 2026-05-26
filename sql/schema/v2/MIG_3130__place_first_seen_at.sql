-- MIG_3130: Add first_seen_at to place alteration history
--
-- Adds MIN(appointment_date) as first_seen_at to support cumulative
-- "as-of" map timeline. Safe approach: save dependent view defs,
-- drop chain, recreate with new column, rebuild dependents.

BEGIN;

-- Save the dependent view definitions
DO $$
DECLARE
  v_atlas_pins_def text;
  v_atlas_pins_gm_def text;
BEGIN
  SELECT pg_get_viewdef('ops.v_map_atlas_pins'::regclass, true) INTO v_atlas_pins_def;
  SELECT pg_get_viewdef('ops.v_map_atlas_pins_with_gm'::regclass, true) INTO v_atlas_pins_gm_def;

  -- Drop chain (outermost first)
  DROP VIEW IF EXISTS ops.v_map_atlas_pins_with_gm;
  DROP VIEW IF EXISTS ops.v_map_atlas_pins;
  DROP VIEW IF EXISTS sot.v_place_alteration_history;

  -- Recreate base view with first_seen_at
  CREATE VIEW sot.v_place_alteration_history AS
  SELECT
    cpr.place_id,
    COUNT(DISTINCT cpr.cat_id) AS total_cats_altered,
    MIN(a.appointment_date) AS first_seen_at,
    MAX(a.appointment_date) AS latest_request_date
  FROM sot.cat_place cpr
  JOIN sot.cats c ON c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL
  LEFT JOIN ops.appointments a ON a.cat_id = cpr.cat_id
  WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
  GROUP BY cpr.place_id;

  -- Rebuild dependent views from saved definitions
  EXECUTE 'CREATE VIEW ops.v_map_atlas_pins AS ' || v_atlas_pins_def;
  EXECUTE 'CREATE VIEW ops.v_map_atlas_pins_with_gm AS ' || v_atlas_pins_gm_def;
END $$;

COMMIT;
