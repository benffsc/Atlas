-- ============================================================================
-- MIG_913: Buddy Walker Rd Data Fix (DATA_GAP_008)
-- ============================================================================
-- Problem: Cat "Buddy" (981020053734908) appears at wrong locations:
--   - 1170 Walker Rd (correct)
--   - 1054 Walker Rd (wrong - erroneous data_fix link)
--   - 949 Chileno Valley Rd (wrong - via Spaletta)
--
-- Root Cause: Shared phone 7072178913 between two families:
--   - Samantha Spaletta (949 Chileno Valley) - record from 2018
--   - Samantha Tresch (1170 Walker Rd) - actual owner of Buddy
--
-- Identity resolution matched phone to existing Spaletta record instead of
-- creating/linking to Tresch. Additionally, Tresch record has no identifiers.
--
-- Solution:
--   1. Remove erroneous cat-place relationships
--   2. Update person-cat relationship to correct owner
--   3. Add phone to soft blacklist (prevent future mis-matches)
--   4. Add identifier to Samantha Tresch
--   5. Create person-place relationship for Tresch
-- ============================================================================

\echo '=== MIG_913: Buddy Walker Rd Data Fix (DATA_GAP_008) ==='
\echo ''

-- ============================================================================
-- Phase 0: Capture current state for audit
-- ============================================================================

\echo 'Phase 0: Capturing current state...'

-- Verify Buddy's current state
SELECT 'Current cat-place relationships for Buddy:' as info;
SELECT
    cpr.cat_place_id,
    c.display_name as cat_name,
    p.formatted_address,
    cpr.relationship_type,
    cpr.source_system,
    cpr.source_table
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
JOIN trapper.places p ON p.place_id = cpr.place_id
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE ci.id_value = '981020053734908';

SELECT 'Current person-cat relationships for Buddy:' as info;
SELECT
    pcr.relationship_id,
    c.display_name as cat_name,
    per.display_name as person_name,
    per.person_id,
    pcr.relationship_type,
    pcr.source_system
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
JOIN trapper.sot_people per ON per.person_id = pcr.person_id
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE ci.id_value = '981020053734908';

-- ============================================================================
-- Phase 1: Remove erroneous cat-place relationships
-- ============================================================================

\echo ''
\echo 'Phase 1: Removing erroneous cat-place relationships...'

-- Get Buddy's cat_id
WITH buddy AS (
    SELECT c.cat_id
    FROM trapper.sot_cats c
    JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
    WHERE ci.id_value = '981020053734908' AND ci.id_type = 'microchip'
    LIMIT 1
),
-- Get wrong place IDs (1054 Walker and 949 Chileno Valley)
wrong_places AS (
    SELECT place_id FROM trapper.places
    WHERE (formatted_address ILIKE '%1054 Walker%' OR formatted_address ILIKE '%949 Chileno Valley%')
    AND merged_into_place_id IS NULL
)
DELETE FROM trapper.cat_place_relationships cpr
USING buddy b, wrong_places wp
WHERE cpr.cat_id = b.cat_id
AND cpr.place_id = wp.place_id
RETURNING cpr.cat_place_id, cpr.place_id;

-- ============================================================================
-- Phase 2: Update person-cat relationship to correct owner
-- ============================================================================

\echo ''
\echo 'Phase 2: Updating person-cat relationship to correct owner...'

-- Update from Spaletta to Tresch
WITH buddy AS (
    SELECT c.cat_id
    FROM trapper.sot_cats c
    JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
    WHERE ci.id_value = '981020053734908' AND ci.id_type = 'microchip'
    LIMIT 1
),
spaletta AS (
    SELECT person_id FROM trapper.sot_people
    WHERE display_name ILIKE '%Samantha Spaletta%'
    AND merged_into_person_id IS NULL
    LIMIT 1
),
tresch AS (
    SELECT person_id FROM trapper.sot_people
    WHERE display_name ILIKE '%Samantha Tresch%'
    AND display_name NOT ILIKE '%1054%'  -- Exclude "Samantha Tresch 1054" duplicate
    AND merged_into_person_id IS NULL
    LIMIT 1
)
UPDATE trapper.person_cat_relationships pcr
SET
    person_id = tresch.person_id,
    updated_at = NOW()
FROM buddy b, spaletta s, tresch
WHERE pcr.cat_id = b.cat_id
AND pcr.person_id = s.person_id
RETURNING pcr.relationship_id, tresch.person_id as new_person_id;

-- ============================================================================
-- Phase 3: Update appointment person_id to correct owner
-- ============================================================================

\echo ''
\echo 'Phase 3: Updating appointment person_id to correct owner...'

WITH buddy AS (
    SELECT c.cat_id
    FROM trapper.sot_cats c
    JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id
    WHERE ci.id_value = '981020053734908' AND ci.id_type = 'microchip'
    LIMIT 1
),
spaletta AS (
    SELECT person_id FROM trapper.sot_people
    WHERE display_name ILIKE '%Samantha Spaletta%'
    AND merged_into_person_id IS NULL
    LIMIT 1
),
tresch AS (
    SELECT person_id FROM trapper.sot_people
    WHERE display_name ILIKE '%Samantha Tresch%'
    AND display_name NOT ILIKE '%1054%'
    AND merged_into_person_id IS NULL
    LIMIT 1
)
UPDATE trapper.sot_appointments a
SET
    person_id = tresch.person_id,
    updated_at = NOW()
FROM buddy b, spaletta s, tresch
WHERE a.cat_id = b.cat_id
AND a.person_id = s.person_id
RETURNING a.appointment_id, a.appointment_number, tresch.person_id as new_person_id;

-- ============================================================================
-- Phase 4: Add phone to soft blacklist
-- ============================================================================

\echo ''
\echo 'Phase 4: Adding phone 7072178913 to soft blacklist...'

INSERT INTO trapper.data_engine_soft_blacklist (
    identifier_norm,
    identifier_type,
    reason,
    distinct_name_count,
    sample_names,
    require_name_similarity,
    require_address_match,
    auto_detected
) VALUES (
    '7072178913',
    'phone',
    'Shared between Spaletta (Chileno Valley) and Tresch (Walker Rd) families - DATA_GAP_008',
    2,
    ARRAY['Samantha Spaletta', 'Samantha Tresch'],
    0.70,
    FALSE,
    FALSE
) ON CONFLICT (identifier_norm, identifier_type) DO UPDATE SET
    reason = EXCLUDED.reason,
    distinct_name_count = EXCLUDED.distinct_name_count,
    sample_names = EXCLUDED.sample_names,
    last_evaluated_at = NOW()
RETURNING identifier_norm, reason;

-- ============================================================================
-- Phase 5: Add identifier to Samantha Tresch
-- ============================================================================

\echo ''
\echo 'Phase 5: Adding phone identifier to Samantha Tresch...'

WITH tresch AS (
    SELECT person_id FROM trapper.sot_people
    WHERE display_name ILIKE '%Samantha Tresch%'
    AND display_name NOT ILIKE '%1054%'
    AND merged_into_person_id IS NULL
    LIMIT 1
)
INSERT INTO trapper.person_identifiers (
    person_id,
    id_type,
    id_value_norm,
    id_value_raw,
    source_system,
    source_table
)
SELECT
    tresch.person_id,
    'phone',
    '7072178913',
    '707-217-8913',
    'atlas_ui',
    'mig_913_data_gap_008'
FROM tresch
ON CONFLICT (person_id, id_type, id_value_norm) DO NOTHING
RETURNING person_id, id_type, id_value_norm;

-- ============================================================================
-- Phase 6: Create person-place relationship for Tresch at 1170 Walker
-- ============================================================================

\echo ''
\echo 'Phase 6: Creating person-place relationship for Tresch at 1170 Walker Rd...'

WITH tresch AS (
    SELECT person_id FROM trapper.sot_people
    WHERE display_name ILIKE '%Samantha Tresch%'
    AND display_name NOT ILIKE '%1054%'
    AND merged_into_person_id IS NULL
    LIMIT 1
),
walker_1170 AS (
    SELECT place_id FROM trapper.places
    WHERE formatted_address ILIKE '%1170 Walker%'
    AND merged_into_place_id IS NULL
    LIMIT 1
)
INSERT INTO trapper.person_place_relationships (
    person_id,
    place_id,
    role,
    confidence,
    source_system,
    source_table
)
SELECT
    tresch.person_id,
    walker_1170.place_id,
    'resident',
    0.9,
    'atlas_ui',
    'mig_913_data_gap_008'
FROM tresch, walker_1170
ON CONFLICT DO NOTHING
RETURNING person_id, place_id, role;

-- ============================================================================
-- Phase 7: Verify final state
-- ============================================================================

\echo ''
\echo 'Phase 7: Verifying final state...'

SELECT 'Final cat-place relationships for Buddy:' as info;
SELECT
    c.display_name as cat_name,
    p.formatted_address,
    cpr.relationship_type,
    cpr.source_system
FROM trapper.cat_place_relationships cpr
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
JOIN trapper.places p ON p.place_id = cpr.place_id
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE ci.id_value = '981020053734908';

SELECT 'Final person-cat relationships for Buddy:' as info;
SELECT
    c.display_name as cat_name,
    per.display_name as person_name,
    pcr.relationship_type
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
JOIN trapper.sot_people per ON per.person_id = pcr.person_id
JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
WHERE ci.id_value = '981020053734908';

SELECT 'Soft blacklist entry:' as info;
SELECT identifier_norm, identifier_type, reason, sample_names
FROM trapper.data_engine_soft_blacklist
WHERE identifier_norm = '7072178913';

SELECT 'Tresch identifiers:' as info;
SELECT p.display_name, pi.id_type, pi.id_value_norm
FROM trapper.person_identifiers pi
JOIN trapper.sot_people p ON p.person_id = pi.person_id
WHERE p.display_name ILIKE '%Samantha Tresch%'
AND p.display_name NOT ILIKE '%1054%';

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_913 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Removed cat-place links to 1054 Walker Rd and 949 Chileno Valley'
\echo '  2. Updated person-cat relationship: Spaletta -> Tresch'
\echo '  3. Updated appointment person_id: Spaletta -> Tresch'
\echo '  4. Added phone 7072178913 to soft blacklist'
\echo '  5. Added phone identifier to Samantha Tresch'
\echo '  6. Created person-place relationship: Tresch -> 1170 Walker Rd'
\echo ''
\echo 'DATA_GAP_008: Buddy Walker Rd - RESOLVED'
\echo ''
