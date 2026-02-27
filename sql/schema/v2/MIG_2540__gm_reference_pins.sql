-- MIG_2540: Add Unlinked Google Maps Entries as Reference Pins
--
-- Problem: 942 Google Maps entries are not linked to any Atlas place.
-- These historical notes contain valuable TNR information but are only
-- visible when users toggle the "All Google Pins" layer (disabled by default).
--
-- Solution: Create a UNION view that combines atlas_pins with unlinked GM entries
-- as reference-tier pins. This ensures staff see all historical data by default.
--
-- Created: 2026-02-27

\echo ''
\echo '=============================================='
\echo '  MIG_2540: GM Reference Pins'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Pre-check: Current counts
-- ============================================================================

\echo '1. Pre-check: Current counts...'

SELECT
  'atlas_pins' as source,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE pin_tier = 'reference') as reference_tier
FROM ops.v_map_atlas_pins
UNION ALL
SELECT
  'unlinked_gm' as source,
  COUNT(*) as total,
  COUNT(*) as reference_tier
FROM ops.google_map_entries
WHERE linked_place_id IS NULL AND lat IS NOT NULL;

-- ============================================================================
-- 2. Create reference pin view for unlinked GM entries
-- ============================================================================

\echo ''
\echo '2. Creating v_gm_reference_pins view...'

CREATE OR REPLACE VIEW ops.v_gm_reference_pins AS
SELECT
  gme.entry_id::TEXT AS id,
  gme.kml_name AS address,
  gme.kml_name AS display_name,
  gme.lat,
  gme.lng,
  NULL::TEXT AS service_zone,
  NULL::UUID AS parent_place_id,
  'google_maps_historical'::TEXT AS place_kind,
  NULL::TEXT AS unit_identifier,
  COALESCE(gme.parsed_cat_count, 0)::INT AS cat_count,
  '[]'::JSONB AS people,
  0::INT AS person_count,
  -- Disease detection from AI classification
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
  0::INT AS disease_count,
  CASE WHEN gme.ai_meaning = 'watch_list' THEN TRUE ELSE FALSE END AS watch_list,
  1::INT AS google_entry_count,
  jsonb_build_array(jsonb_build_object(
    'summary', COALESCE(gme.ai_summary, LEFT(gme.original_content, 200)),
    'meaning', gme.ai_meaning,
    'date', gme.parsed_date::TEXT
  )) AS google_summaries,
  0::INT AS request_count,
  0::INT AS active_request_count,
  0::INT AS needs_trapper_count,
  0::INT AS intake_count,
  0::INT AS total_altered,
  NULL::TIMESTAMPTZ AS last_alteration_at,
  -- Pin style based on AI classification
  CASE
    WHEN gme.ai_meaning IN ('disease_risk', 'felv_colony', 'fiv_colony') THEN 'disease'
    WHEN gme.ai_meaning = 'watch_list' THEN 'watch_list'
    WHEN gme.ai_meaning = 'active_colony' THEN 'active'
    ELSE 'has_history'
  END AS pin_style,
  'reference'::TEXT AS pin_tier,
  gme.imported_at AS created_at,
  gme.imported_at AS last_activity_at
FROM ops.google_map_entries gme
WHERE gme.linked_place_id IS NULL
  AND gme.lat IS NOT NULL
  AND gme.lng IS NOT NULL;

COMMENT ON VIEW ops.v_gm_reference_pins IS
'Unlinked Google Maps entries formatted as reference pins for the atlas map.
These are historical TNR notes that have not been linked to a formal Atlas place.
Pin style is based on AI classification. All entries are reference tier.';

-- ============================================================================
-- 3. Create combined atlas pins view
-- ============================================================================

\echo ''
\echo '3. Creating v_map_atlas_pins_with_gm view...'

CREATE OR REPLACE VIEW ops.v_map_atlas_pins_with_gm AS
SELECT * FROM ops.v_map_atlas_pins
UNION ALL
SELECT * FROM ops.v_gm_reference_pins;

COMMENT ON VIEW ops.v_map_atlas_pins_with_gm IS
'Combined view of atlas_pins (places) and unlinked GM entries (reference pins).
Use this view for the atlas map to show all historical data.';

-- ============================================================================
-- 4. Post-check: New counts
-- ============================================================================

\echo ''
\echo '4. Post-check: New counts...'

SELECT
  pin_tier,
  COUNT(*) as count
FROM ops.v_map_atlas_pins_with_gm
GROUP BY pin_tier
ORDER BY pin_tier;

\echo ''
\echo '=============================================='
\echo '  MIG_2540 Complete'
\echo '=============================================='
\echo ''
\echo 'Created views:'
\echo '  - ops.v_gm_reference_pins: Unlinked GM entries as reference pins'
\echo '  - ops.v_map_atlas_pins_with_gm: Combined atlas + GM reference pins'
\echo ''
\echo 'NEXT: Update beacon/map-data API to use v_map_atlas_pins_with_gm'
\echo ''
