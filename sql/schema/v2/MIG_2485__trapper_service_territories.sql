-- MIG_2485: Trapper Service Territories & Home Rescues
--
-- PURPOSE: Create rich contextual data about community trappers:
-- 1. Home-based rescues (like "Cat Rescue of Cloverdale" at Katie Moore's home)
-- 2. Trapper service territories (places they regularly work)
-- 3. Colony caretaker relationships (long-term stewards of locations)
--
-- USE CASES:
-- - Katie Moore runs "Cat Rescue of Cloverdale" at 103 Rosewood Dr
-- - Stephanie Freele regularly traps at Bucher Dairy (5285 Westside Rd)
-- - Toni Price caretakes the Silveira Ranch colony
--
-- INTEGRATION:
-- - Attribution can consider trapper's service territories
-- - Map can show trapper coverage areas
-- - Tippy can answer "Who handles TNR in Cloverdale?"
--
-- Created: 2026-02-23

\echo ''
\echo '=============================================='
\echo '  MIG_2485: Trapper Service Territories'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. TRAPPER/RESCUE PROFILE TABLE
-- ============================================================================

\echo '1. Creating sot.trapper_profiles...'

CREATE TABLE IF NOT EXISTS sot.trapper_profiles (
  person_id UUID PRIMARY KEY REFERENCES sot.people(person_id),

  -- Classification
  trapper_type TEXT CHECK (trapper_type IN (
    'ffsc_volunteer',      -- Trained FFSC volunteer trapper
    'ffsc_staff',          -- FFSC staff coordinator
    'community_trapper',   -- Independent community helper
    'rescue_operator',     -- Runs a home-based rescue
    'colony_caretaker'     -- Long-term colony steward
  )),

  -- Rescue info (if applicable)
  rescue_name TEXT,                           -- e.g., "Cat Rescue of Cloverdale"
  rescue_place_id UUID REFERENCES sot.places(place_id),  -- Where rescue operates
  rescue_is_registered BOOLEAN DEFAULT FALSE, -- Is it a registered 501c3?

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  certified_date DATE,                        -- When they completed training

  -- Notes
  notes TEXT,

  -- Audit
  source_system TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sot.trapper_profiles IS
'Extended profile for trappers, community helpers, and rescue operators.
Captures trapper type, rescue affiliation, and certification status.';

-- ============================================================================
-- 2. TRAPPER SERVICE PLACES (Where they regularly work)
-- ============================================================================

\echo '2. Creating sot.trapper_service_places...'

CREATE TABLE IF NOT EXISTS sot.trapper_service_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES sot.people(person_id),
  place_id UUID NOT NULL REFERENCES sot.places(place_id),

  -- Relationship type
  service_type TEXT NOT NULL CHECK (service_type IN (
    'primary_territory',   -- Main area they work
    'regular',             -- Frequent helper
    'occasional',          -- Sometimes helps here
    'historical',          -- Used to work here
    'home_rescue'          -- Their home-based rescue location
  )),

  -- Context
  role TEXT,               -- 'colony_caretaker', 'property_liaison', 'neighbor_helper'
  start_date DATE,
  end_date DATE,           -- NULL = ongoing
  notes TEXT,

  -- Audit
  source_system TEXT,
  evidence_type TEXT DEFAULT 'staff_verified',
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(person_id, place_id)
);

CREATE INDEX idx_trapper_service_places_person ON sot.trapper_service_places(person_id);
CREATE INDEX idx_trapper_service_places_place ON sot.trapper_service_places(place_id);
CREATE INDEX idx_trapper_service_places_active ON sot.trapper_service_places(person_id)
  WHERE end_date IS NULL;

COMMENT ON TABLE sot.trapper_service_places IS
'Links trappers to places they regularly service. Used for:
- Attribution: Consider trapper territories when linking cats
- Coverage: Map trapper service areas
- Assignment: Suggest trappers for new requests based on proximity/history';

-- ============================================================================
-- 3. SEED KNOWN DATA
-- ============================================================================

\echo '3. Seeding known trapper data...'

-- Create Katie Moore's rescue place if it doesn't exist
DO $$
DECLARE
  v_katie_person_id UUID;
  v_rescue_place_id UUID;
BEGIN
  -- Find Katie Moore (the community trapper one)
  SELECT person_id INTO v_katie_person_id
  FROM sot.people
  WHERE (display_name ILIKE '%Katie Moore%' OR first_name || ' ' || last_name ILIKE '%Katie Moore%')
    AND source_system = 'clinichq'
  LIMIT 1;

  IF v_katie_person_id IS NOT NULL THEN
    -- Create or find the rescue place
    SELECT place_id INTO v_rescue_place_id
    FROM sot.places
    WHERE formatted_address ILIKE '%103 Rosewood%Cloverdale%'
    LIMIT 1;

    IF v_rescue_place_id IS NULL THEN
      INSERT INTO sot.places (display_name, formatted_address, source_system)
      VALUES ('Cat Rescue of Cloverdale', '103 Rosewood Dr, Cloverdale, CA 95425', 'atlas_ui')
      RETURNING place_id INTO v_rescue_place_id;
      RAISE NOTICE 'Created place for Cat Rescue of Cloverdale';
    END IF;

    -- Create trapper profile
    INSERT INTO sot.trapper_profiles (
      person_id, trapper_type, rescue_name, rescue_place_id,
      is_active, notes, source_system
    ) VALUES (
      v_katie_person_id,
      'rescue_operator',
      'Cat Rescue of Cloverdale',
      v_rescue_place_id,
      TRUE,
      'Home-based rescue operation. Katie brings in cats from various community locations.',
      'atlas_ui'
    ) ON CONFLICT (person_id) DO UPDATE SET
      rescue_name = EXCLUDED.rescue_name,
      rescue_place_id = EXCLUDED.rescue_place_id,
      updated_at = NOW();

    -- Create service place link
    INSERT INTO sot.trapper_service_places (
      person_id, place_id, service_type, role, notes, source_system
    ) VALUES (
      v_katie_person_id,
      v_rescue_place_id,
      'home_rescue',
      'rescue_operator',
      'Primary rescue location - 103 Rosewood Dr, Cloverdale',
      'atlas_ui'
    ) ON CONFLICT (person_id, place_id) DO NOTHING;

    RAISE NOTICE 'Configured Katie Moore as rescue operator';
  ELSE
    RAISE NOTICE 'Katie Moore not found - skipping';
  END IF;
END $$;

-- Add Stephanie Freele's known service places
DO $$
DECLARE
  v_person_id UUID;
  v_bucher_place_id UUID;
BEGIN
  -- Find Stephanie (Stefanie) Freele
  SELECT person_id INTO v_person_id
  FROM sot.people
  WHERE display_name ILIKE '%Freele%' OR (first_name || ' ' || last_name) ILIKE '%Freele%'
  LIMIT 1;

  IF v_person_id IS NOT NULL THEN
    -- Find Bucher Dairy place
    SELECT place_id INTO v_bucher_place_id
    FROM sot.places
    WHERE formatted_address ILIKE '%5285 Westside%Healdsburg%'
    LIMIT 1;

    IF v_bucher_place_id IS NOT NULL THEN
      INSERT INTO sot.trapper_profiles (
        person_id, trapper_type, is_active, notes, source_system
      ) VALUES (
        v_person_id,
        'community_trapper',
        TRUE,
        'Long-time community trapper. Known service areas include Bucher Dairy.',
        'atlas_ui'
      ) ON CONFLICT (person_id) DO UPDATE SET
        notes = EXCLUDED.notes,
        updated_at = NOW();

      INSERT INTO sot.trapper_service_places (
        person_id, place_id, service_type, role, notes, source_system
      ) VALUES (
        v_person_id,
        v_bucher_place_id,
        'primary_territory',
        'colony_caretaker',
        'Long-term caretaker at Bucher Dairy - 5285 Westside Rd',
        'atlas_ui'
      ) ON CONFLICT (person_id, place_id) DO NOTHING;

      RAISE NOTICE 'Configured Stephanie Freele with Bucher Dairy territory';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 4. VIEW: Trapper Coverage Summary
-- ============================================================================

\echo '4. Creating trapper coverage view...'

CREATE OR REPLACE VIEW sot.v_trapper_coverage AS
SELECT
  tp.person_id,
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as trapper_name,
  tp.trapper_type,
  tp.rescue_name,
  tp.is_active,
  -- Service places
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
      'place_id', tsp.place_id,
      'address', pl.formatted_address,
      'service_type', tsp.service_type,
      'role', tsp.role
    ))
    FROM sot.trapper_service_places tsp
    JOIN sot.places pl ON pl.place_id = tsp.place_id
    WHERE tsp.person_id = tp.person_id AND tsp.end_date IS NULL
    ), '[]'::jsonb
  ) as service_places,
  -- Request count
  (SELECT COUNT(*) FROM ops.request_trapper_assignments rta
   WHERE rta.trapper_person_id = tp.person_id) as total_assignments,
  -- Active request count
  (SELECT COUNT(*) FROM ops.request_trapper_assignments rta
   JOIN ops.requests r ON r.request_id = rta.request_id
   WHERE rta.trapper_person_id = tp.person_id
     AND r.status NOT IN ('completed', 'cancelled')
     AND rta.status = 'active') as active_assignments
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW sot.v_trapper_coverage IS
'Trapper profiles with their service territories and assignment counts.
Use for coverage analysis and trapper assignment suggestions.';

-- ============================================================================
-- 5. FUNCTION: Find trappers for a place
-- ============================================================================

\echo '5. Creating sot.find_trappers_for_place()...'

CREATE OR REPLACE FUNCTION sot.find_trappers_for_place(p_place_id UUID)
RETURNS TABLE (
  person_id UUID,
  trapper_name TEXT,
  trapper_type TEXT,
  service_type TEXT,
  role TEXT,
  match_reason TEXT
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN QUERY
  -- Direct service place match
  SELECT
    tsp.person_id,
    COALESCE(p.display_name, p.first_name || ' ' || p.last_name)::TEXT,
    tp.trapper_type,
    tsp.service_type,
    tsp.role,
    'direct_service_place'::TEXT as match_reason
  FROM sot.trapper_service_places tsp
  JOIN sot.people p ON p.person_id = tsp.person_id
  JOIN sot.trapper_profiles tp ON tp.person_id = tsp.person_id
  WHERE tsp.place_id = p_place_id
    AND tsp.end_date IS NULL
    AND tp.is_active = TRUE
    AND p.merged_into_person_id IS NULL

  UNION ALL

  -- Previous assignments at this place
  SELECT DISTINCT
    rta.trapper_person_id,
    COALESCE(p.display_name, p.first_name || ' ' || p.last_name)::TEXT,
    COALESCE(tp.trapper_type, 'unknown')::TEXT,
    'historical'::TEXT,
    NULL::TEXT,
    'previous_assignment'::TEXT
  FROM ops.request_trapper_assignments rta
  JOIN ops.requests r ON r.request_id = rta.request_id
  JOIN sot.people p ON p.person_id = rta.trapper_person_id
  LEFT JOIN sot.trapper_profiles tp ON tp.person_id = rta.trapper_person_id
  WHERE r.place_id = p_place_id
    AND p.merged_into_person_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM sot.trapper_service_places tsp2
      WHERE tsp2.person_id = rta.trapper_person_id AND tsp2.place_id = p_place_id
    )

  ORDER BY
    CASE match_reason
      WHEN 'direct_service_place' THEN 1
      WHEN 'previous_assignment' THEN 2
    END,
    CASE service_type
      WHEN 'primary_territory' THEN 1
      WHEN 'home_rescue' THEN 2
      WHEN 'regular' THEN 3
      WHEN 'occasional' THEN 4
      ELSE 5
    END;
END;
$$;

COMMENT ON FUNCTION sot.find_trappers_for_place IS
'Find trappers who service or have worked at a given place.
Returns direct service matches first, then historical assignments.';

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Trapper profiles:'
SELECT person_id, trapper_type, rescue_name
FROM sot.trapper_profiles
ORDER BY created_at DESC
LIMIT 5;

\echo ''
\echo 'Service places:'
SELECT
  p.display_name as trapper,
  pl.formatted_address as service_place,
  tsp.service_type,
  tsp.role
FROM sot.trapper_service_places tsp
JOIN sot.people p ON p.person_id = tsp.person_id
JOIN sot.places pl ON pl.place_id = tsp.place_id
ORDER BY tsp.created_at DESC
LIMIT 5;

\echo ''
\echo '=============================================='
\echo '  MIG_2485 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - sot.trapper_profiles: Extended trapper/rescue info'
\echo '  - sot.trapper_service_places: Trapper territories'
\echo '  - sot.v_trapper_coverage: Coverage summary view'
\echo '  - sot.find_trappers_for_place(): Find trappers for a location'
\echo ''
\echo 'Next steps:'
\echo '  1. Import VolunteerHub trapper addresses'
\echo '  2. Import Airtable trapper list addresses'
\echo '  3. Staff can add service territories via Atlas UI'
\echo ''
