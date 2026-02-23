-- MIG_2487: Add Contract Status to Trapper Profiles
--
-- Distinguishes between:
-- - Tier 2: Community trappers WITH signed contracts (limited to specific areas)
-- - Tier 3: Informal/legacy trappers WITHOUT formal contracts (historical)
--
-- This is important because:
-- - Contract trappers have defined service territories and limitations
-- - Informal trappers are remnants of old processes and may need cleanup
--
-- Created: 2026-02-23

\echo ''
\echo '=============================================='
\echo '  MIG_2487: Trapper Contract Status'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ADD CONTRACT STATUS COLUMNS
-- ============================================================================

\echo '1. Adding contract status columns to sot.trapper_profiles...'

ALTER TABLE sot.trapper_profiles
ADD COLUMN IF NOT EXISTS has_signed_contract BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS contract_signed_date DATE,
ADD COLUMN IF NOT EXISTS contract_areas TEXT[], -- Specific areas they're limited to
ADD COLUMN IF NOT EXISTS is_legacy_informal BOOLEAN DEFAULT FALSE; -- True for Tier 3 trappers

COMMENT ON COLUMN sot.trapper_profiles.has_signed_contract IS
'TRUE for Tier 2 community trappers who signed a contract limiting them to specific areas';

COMMENT ON COLUMN sot.trapper_profiles.contract_signed_date IS
'When the trapper signed their contract (if applicable)';

COMMENT ON COLUMN sot.trapper_profiles.contract_areas IS
'Array of area names/descriptions the contract trapper is limited to';

COMMENT ON COLUMN sot.trapper_profiles.is_legacy_informal IS
'TRUE for Tier 3 trappers - remnants of old informal processes without formal contracts';

-- ============================================================================
-- 2. UPDATE TRAPPER TYPE CHECK CONSTRAINT
-- ============================================================================

\echo '2. Verifying trapper_type constraint...'

-- Ensure the check constraint includes all valid types
DO $$
BEGIN
  -- Drop existing constraint if it exists
  ALTER TABLE sot.trapper_profiles DROP CONSTRAINT IF EXISTS trapper_profiles_trapper_type_check;

  -- Add updated constraint
  ALTER TABLE sot.trapper_profiles ADD CONSTRAINT trapper_profiles_trapper_type_check
    CHECK (trapper_type IN (
      -- Tier 1: FFSC (represent FFSC)
      'ffsc_staff',          -- Staff coordinators
      'ffsc_volunteer',      -- Trained FFSC volunteer trappers (head trappers, etc.)

      -- Tier 2 & 3: Community (do NOT represent FFSC)
      'community_trapper',   -- Community trappers (check has_signed_contract to distinguish Tier 2 vs 3)

      -- Special roles
      'rescue_operator',     -- Runs a home-based rescue
      'colony_caretaker'     -- Long-term colony steward
    ));

  RAISE NOTICE 'Trapper type constraint updated';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not update constraint: %', SQLERRM;
END $$;

-- ============================================================================
-- 3. CREATE VIEW FOR TRAPPER TIERS
-- ============================================================================

\echo '3. Creating sot.v_trapper_tiers view...'

CREATE OR REPLACE VIEW sot.v_trapper_tiers AS
SELECT
  tp.person_id,
  COALESCE(p.display_name, p.first_name || ' ' || p.last_name) as trapper_name,
  tp.trapper_type,
  tp.rescue_name,
  tp.is_active,
  -- Determine tier
  CASE
    WHEN tp.trapper_type IN ('ffsc_staff', 'ffsc_volunteer') THEN 'Tier 1: FFSC'
    WHEN tp.trapper_type = 'community_trapper' AND tp.has_signed_contract = TRUE THEN 'Tier 2: Contract Community'
    WHEN tp.trapper_type = 'community_trapper' AND tp.is_legacy_informal = TRUE THEN 'Tier 3: Informal/Legacy'
    WHEN tp.trapper_type = 'community_trapper' THEN 'Tier 2/3: Community (unclassified)'
    WHEN tp.trapper_type = 'rescue_operator' THEN 'Special: Rescue Operator'
    WHEN tp.trapper_type = 'colony_caretaker' THEN 'Special: Colony Caretaker'
    ELSE 'Unknown'
  END as tier,
  tp.has_signed_contract,
  tp.contract_signed_date,
  tp.contract_areas,
  tp.is_legacy_informal,
  -- Service places count
  (SELECT COUNT(*) FROM sot.trapper_service_places tsp WHERE tsp.person_id = tp.person_id) as service_place_count,
  -- Request assignment count
  (SELECT COUNT(*) FROM ops.request_trapper_assignments rta WHERE rta.trapper_person_id = tp.person_id) as request_count
FROM sot.trapper_profiles tp
JOIN sot.people p ON p.person_id = tp.person_id
WHERE p.merged_into_person_id IS NULL;

COMMENT ON VIEW sot.v_trapper_tiers IS
'Trappers categorized by their tier (FFSC, Contract Community, Informal/Legacy).
Use this to understand trapper relationships and authority levels.';

-- ============================================================================
-- 4. SEED KNOWN INFORMAL TRAPPERS
-- ============================================================================

\echo '4. Marking known informal/legacy trappers...'

-- Mark Toni Price as legacy informal (per user guidance)
UPDATE sot.trapper_profiles tp
SET is_legacy_informal = TRUE,
    has_signed_contract = FALSE
FROM sot.people p
WHERE tp.person_id = p.person_id
  AND (p.display_name ILIKE '%Toni Price%'
       OR (p.first_name ILIKE 'Toni' AND p.last_name ILIKE 'Price'));

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Trappers by tier:'
SELECT
  tier,
  COUNT(*) as count,
  string_agg(trapper_name, ', ' ORDER BY trapper_name) FILTER (WHERE tier LIKE '%Informal%') as informal_trappers
FROM sot.v_trapper_tiers
GROUP BY tier
ORDER BY tier;

\echo ''
\echo '=============================================='
\echo '  MIG_2487 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Added columns to sot.trapper_profiles:'
\echo '  - has_signed_contract: TRUE for Tier 2 contract community trappers'
\echo '  - contract_signed_date: When contract was signed'
\echo '  - contract_areas: Array of areas they are limited to'
\echo '  - is_legacy_informal: TRUE for Tier 3 informal/legacy trappers'
\echo ''
\echo 'Created view: sot.v_trapper_tiers for easy tier categorization'
\echo ''
