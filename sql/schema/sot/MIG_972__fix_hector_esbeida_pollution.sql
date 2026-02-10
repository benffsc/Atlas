-- MIG_972: Fix Hector Sorrano / Esbeida Campos Work Address Pollution
--
-- Problem: Cats from 1311 Corby Ave (Hector + Esbeida's home) incorrectly
-- appear at 3276 Dutton Ave (Hector's work) due to entity linking propagation.
--
-- Root Cause:
-- 1. Some ClinicHQ bookings used Esbeida's email + Hector's phone (household)
-- 2. Data Engine matched to Hector via phone
-- 3. Hector has person_place_relationships to BOTH Corby (home) AND Dutton (work)
-- 4. link_cats_to_places() propagated cats to Dutton through person-place chain
--
-- Fix: Delete cat_place_relationships at Dutton that came from person-based
-- linking (source_system = 'atlas'), keeping the legitimate appointment-based
-- records (source_system = 'clinichq').
--
-- Related: RISK_005 in DATA_GAP_RISKS.md
-- Date: 2026-02-10

-- Step 1: Show pre-fix state
SELECT
    'PRE-FIX' as state,
    c.display_name as cat,
    cpr.relationship_type,
    cpr.source_system,
    cpr.created_at::date
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
WHERE cpr.place_id = '9013a291-d376-4ff5-a970-4e1929796d7f'  -- 3276 Dutton Ave
ORDER BY cpr.source_system, c.display_name;

-- Step 2: Delete polluted records
-- Keep clinichq-sourced records (appointment-based = ground truth)
-- Delete atlas-sourced 'home' relationships (person-based propagation = pollution)
DELETE FROM trapper.cat_place_relationships
WHERE place_id = '9013a291-d376-4ff5-a970-4e1929796d7f'  -- 3276 Dutton Ave
  AND source_system = 'atlas'
  AND relationship_type = 'home';

-- Step 3: Show post-fix state
SELECT
    'POST-FIX' as state,
    c.display_name as cat,
    cpr.relationship_type,
    cpr.source_system,
    cpr.created_at::date
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
WHERE cpr.place_id = '9013a291-d376-4ff5-a970-4e1929796d7f'  -- 3276 Dutton Ave
ORDER BY cpr.source_system, c.display_name;

-- Context: Show person-place relationships at both addresses
SELECT
    'CONTEXT: Person-place relationships' as info,
    p.display_name as person,
    ppr.role,
    pl.formatted_address
FROM trapper.person_place_relationships ppr
JOIN trapper.sot_people p ON p.person_id = ppr.person_id
JOIN trapper.places pl ON pl.place_id = ppr.place_id
WHERE ppr.place_id IN (
    '9013a291-d376-4ff5-a970-4e1929796d7f',  -- 3276 Dutton Ave
    '9563bcb0-ce92-4c29-bfa8-eb35582967f0'   -- 1311 Corby Ave
)
ORDER BY pl.formatted_address, p.display_name;

-- NOTE: Hector's person-cat relationships are NOT modified.
-- The phone linkage is technically correct (his phone was on those bookings).
-- The issue was entity linking propagating to his WORK address.
--
-- FUTURE FIX: link_cats_to_places() should not propagate 'home'
-- relationships to places typed as commercial/work.
