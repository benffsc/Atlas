-- MIG_3033: Entity Quality Scores (Gold/Silver/Bronze)
--
-- Universal quality badge system for cats, people, places.
-- Based on industry best practice — data completeness tiers.
--
-- Gold = highest confidence (multi-source, verified identifiers)
-- Silver = good (single strong identifier)
-- Bronze = minimum viable (exists but weak data)
--
-- Created: 2026-03-31

\echo ''
\echo '=============================================='
\echo '  MIG_3033: Entity Quality Scores'
\echo '=============================================='
\echo ''

-- ============================================================================
-- Cat Quality View
-- ============================================================================

\echo 'Creating cat quality view...'

CREATE OR REPLACE VIEW ops.v_cat_quality AS
SELECT
  c.cat_id,
  c.name,
  c.source_system,
  -- Quality tier
  CASE
    -- Gold: has microchip AND confirmed by multiple sources
    WHEN EXISTS (
      SELECT 1 FROM sot.cat_identifiers ci
      WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    ) AND (
      -- Multi-source: has identifiers from 2+ source systems
      (SELECT COUNT(DISTINCT ci.source_system)
       FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id) >= 2
      OR
      -- Or: has place link + appointment
      (EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id)
       AND EXISTS (SELECT 1 FROM ops.appointments a
                   JOIN sot.cat_identifiers ci ON ci.id_value = a.animal_id::text
                     AND ci.id_type = 'clinichq_animal_id'
                   WHERE ci.cat_id = c.cat_id))
    )
    THEN 'gold'

    -- Silver: has clinichq_animal_id OR microchip (single source)
    WHEN EXISTS (
      SELECT 1 FROM sot.cat_identifiers ci
      WHERE ci.cat_id = c.cat_id
        AND ci.id_type IN ('microchip', 'clinichq_animal_id', 'shelterluv_animal_id')
    )
    THEN 'silver'

    -- Bronze: exists but name-only or minimal data
    ELSE 'bronze'
  END as quality_tier,

  -- Component scores
  EXISTS (SELECT 1 FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip') as has_microchip,
  EXISTS (SELECT 1 FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'clinichq_animal_id') as has_clinichq_id,
  EXISTS (SELECT 1 FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id AND ci.id_type = 'shelterluv_animal_id') as has_shelterluv_id,
  EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id) as has_place,
  (SELECT COUNT(DISTINCT ci.source_system) FROM sot.cat_identifiers ci WHERE ci.cat_id = c.cat_id) as source_count

FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL;

COMMENT ON VIEW ops.v_cat_quality IS
'Cat quality tiers: gold (microchip + multi-source), silver (any system ID), bronze (name-only)';

-- ============================================================================
-- Person Quality View
-- ============================================================================

\echo 'Creating person quality view...'

CREATE OR REPLACE VIEW ops.v_person_quality AS
SELECT
  p.person_id,
  p.display_name,
  p.source_system,
  CASE
    -- Gold: multi-source email or phone (confirmed by 2+ systems)
    WHEN EXISTS (
      SELECT 1 FROM sot.person_identifiers pi
      WHERE pi.person_id = p.person_id
        AND pi.confidence >= 0.5
        AND array_length(pi.source_systems, 1) >= 2
    )
    THEN 'gold'

    -- Silver: has at least one high-confidence identifier
    WHEN EXISTS (
      SELECT 1 FROM sot.person_identifiers pi
      WHERE pi.person_id = p.person_id
        AND pi.confidence >= 0.5
    )
    THEN 'silver'

    -- Bronze: exists but no reliable identifiers
    ELSE 'bronze'
  END as quality_tier,

  -- Component scores
  EXISTS (
    SELECT 1 FROM sot.person_identifiers pi
    WHERE pi.person_id = p.person_id AND pi.id_type = 'email' AND pi.confidence >= 0.5
  ) as has_email,
  EXISTS (
    SELECT 1 FROM sot.person_identifiers pi
    WHERE pi.person_id = p.person_id AND pi.id_type = 'phone' AND pi.confidence >= 0.5
  ) as has_phone,
  (
    SELECT MAX(array_length(pi.source_systems, 1))
    FROM sot.person_identifiers pi
    WHERE pi.person_id = p.person_id AND pi.confidence >= 0.5
  ) as max_source_count,
  EXISTS (SELECT 1 FROM sot.person_place pp WHERE pp.person_id = p.person_id) as has_place

FROM sot.people p
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW ops.v_person_quality IS
'Person quality tiers: gold (multi-source identifier), silver (single-source identifier), bronze (no identifiers)';

-- ============================================================================
-- Place Quality View
-- ============================================================================

\echo 'Creating place quality view...'

CREATE OR REPLACE VIEW ops.v_place_quality AS
SELECT
  pl.place_id,
  pl.formatted_address,
  pl.place_kind,
  CASE
    -- Gold: geocoded + has verified cats + has sot_address_id
    WHEN pl.latitude IS NOT NULL
      AND pl.sot_address_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = pl.place_id)
    THEN 'gold'

    -- Silver: geocoded (has lat/lng)
    WHEN pl.latitude IS NOT NULL
    THEN 'silver'

    -- Bronze: un-geocoded
    ELSE 'bronze'
  END as quality_tier,

  -- Component scores
  pl.latitude IS NOT NULL as is_geocoded,
  pl.sot_address_id IS NOT NULL as has_address_id,
  EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.place_id = pl.place_id) as has_cats,
  (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = pl.place_id)::int as cat_count,
  EXISTS (SELECT 1 FROM sot.person_place pp WHERE pp.place_id = pl.place_id) as has_people

FROM sot.places pl
WHERE pl.merged_into_place_id IS NULL;

COMMENT ON VIEW ops.v_place_quality IS
'Place quality tiers: gold (geocoded + cats + address), silver (geocoded), bronze (un-geocoded)';

-- ============================================================================
-- Summary View (for dashboards & Beacon)
-- ============================================================================

\echo 'Creating entity quality summary view...'

CREATE OR REPLACE VIEW ops.v_entity_quality_summary AS
SELECT
  'cats' as entity_type,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE quality_tier = 'gold') as gold,
  COUNT(*) FILTER (WHERE quality_tier = 'silver') as silver,
  COUNT(*) FILTER (WHERE quality_tier = 'bronze') as bronze,
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier = 'gold') / NULLIF(COUNT(*), 0), 1) as gold_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier = 'silver') / NULLIF(COUNT(*), 0), 1) as silver_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier = 'bronze') / NULLIF(COUNT(*), 0), 1) as bronze_pct
FROM ops.v_cat_quality

UNION ALL

SELECT
  'people',
  COUNT(*),
  COUNT(*) FILTER (WHERE quality_tier = 'gold'),
  COUNT(*) FILTER (WHERE quality_tier = 'silver'),
  COUNT(*) FILTER (WHERE quality_tier = 'bronze'),
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier = 'gold') / NULLIF(COUNT(*), 0), 1),
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier = 'silver') / NULLIF(COUNT(*), 0), 1),
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier = 'bronze') / NULLIF(COUNT(*), 0), 1)
FROM ops.v_person_quality

UNION ALL

SELECT
  'places',
  COUNT(*),
  COUNT(*) FILTER (WHERE quality_tier = 'gold'),
  COUNT(*) FILTER (WHERE quality_tier = 'silver'),
  COUNT(*) FILTER (WHERE quality_tier = 'bronze'),
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier = 'gold') / NULLIF(COUNT(*), 0), 1),
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier = 'silver') / NULLIF(COUNT(*), 0), 1),
  ROUND(100.0 * COUNT(*) FILTER (WHERE quality_tier = 'bronze') / NULLIF(COUNT(*), 0), 1)
FROM ops.v_place_quality;

COMMENT ON VIEW ops.v_entity_quality_summary IS
'Aggregated entity quality scores across cats, people, places. For Beacon dashboards and grant reporting.';

-- ============================================================================
-- Verification
-- ============================================================================

\echo ''
\echo 'Entity quality distribution:'

SELECT * FROM ops.v_entity_quality_summary;

\echo ''
\echo 'MIG_3033 complete — Entity quality score views created'
\echo ''
