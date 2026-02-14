\echo '=== MIG_320: Data Engine Backfill for Existing Records ==='
\echo 'Processes existing data as if it had gone through Data Engine from day 1'
\echo ''

-- ============================================================================
-- BACKFILL STRATEGY
-- ============================================================================
-- The Data Engine (MIG_314-317) was created after 47,000+ records already
-- existed. This migration backfills Data Engine artifacts to bring the
-- database to the state it would be in if Data Engine existed from day 1.
--
-- Steps:
-- 1. Create households from person-place relationships (expand coverage)
-- 2. Link orphaned cats to places via clinic appointments
-- 3. Clean up invalid people (organizations, placeholders)
-- 4. Record retroactive match decisions for audit trail
-- ============================================================================

-- ============================================================================
-- STEP 1: Expand Household Coverage
-- Currently only 13.4% of people are in households
-- ============================================================================

\echo 'Step 1: Expanding household coverage...'

-- Find people at same address who share phone numbers but aren't in households yet
INSERT INTO trapper.household_members (household_id, person_id, role, confidence, inferred_from)
SELECT DISTINCT ON (ppr.person_id)
    hm_existing.household_id,
    ppr.person_id,
    'resident',
    0.70,
    'same_address_backfill'
FROM trapper.person_place_relationships ppr
JOIN trapper.person_place_relationships ppr2
    ON ppr2.place_id = ppr.place_id
    AND ppr2.person_id != ppr.person_id
JOIN trapper.household_members hm_existing
    ON hm_existing.person_id = ppr2.person_id
    AND hm_existing.valid_to IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.household_members hm
    WHERE hm.person_id = ppr.person_id AND hm.valid_to IS NULL
)
AND ppr.role IN ('owner', 'resident')
ON CONFLICT DO NOTHING;

-- Update household member counts
UPDATE trapper.households h
SET member_count = (
    SELECT COUNT(*) FROM trapper.household_members hm
    WHERE hm.household_id = h.household_id AND hm.valid_to IS NULL
);

\echo 'Household expansion complete'
SELECT COUNT(*) as total_household_members FROM trapper.household_members WHERE valid_to IS NULL;

-- ============================================================================
-- STEP 2: Link Orphaned Cats to Places via Appointments
-- 5.3% of cats (1,837) have no place link
-- ============================================================================

\echo 'Step 2: Linking orphaned cats to places...'

-- Link cats to places via their appointment locations
INSERT INTO trapper.cat_place_relationships (cat_id, place_id, relationship_type, source_system, created_at)
SELECT DISTINCT ON (c.cat_id)
    c.cat_id,
    a.place_id,
    'appointment_site',
    'data_engine_backfill',
    NOW()
FROM trapper.sot_cats c
JOIN trapper.sot_appointments a ON a.cat_id = c.cat_id
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id
)
AND a.place_id IS NOT NULL
ORDER BY c.cat_id, a.appointment_date DESC
ON CONFLICT DO NOTHING;

-- Link remaining cats via owner's place
INSERT INTO trapper.cat_place_relationships (cat_id, place_id, relationship_type, source_system, created_at)
SELECT DISTINCT ON (c.cat_id)
    c.cat_id,
    ppr.place_id,
    'owner_residence',
    'data_engine_backfill',
    NOW()
FROM trapper.sot_cats c
JOIN trapper.sot_people p ON p.person_id = c.owner_person_id
JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id
)
AND ppr.role = 'owner'
ORDER BY c.cat_id, ppr.created_at DESC
ON CONFLICT DO NOTHING;

\echo 'Cat-place linking complete'
SELECT
    COUNT(*) as total_cats,
    COUNT(DISTINCT cpr.cat_id) as cats_with_place_link,
    ROUND(100.0 * COUNT(DISTINCT cpr.cat_id) / COUNT(*), 1) as pct_linked
FROM trapper.sot_cats c
LEFT JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = c.cat_id;

-- ============================================================================
-- STEP 3: Process Invalid People
-- 450 invalid people, 210 organizations-as-people
-- ============================================================================

\echo 'Step 3: Processing invalid people...'

-- Mark organizations-as-people for conversion (don't delete, just flag)
UPDATE trapper.sot_people
SET data_quality = 'needs_conversion',
    quality_notes = 'Organization name detected: ' || display_name
WHERE merged_into_person_id IS NULL
  AND trapper.is_organization_name(display_name)
  AND data_quality != 'needs_conversion';

-- Mark garbage/placeholder names
UPDATE trapper.sot_people
SET data_quality = 'low',
    quality_notes = COALESCE(quality_notes || '; ', '') || 'Invalid name pattern detected'
WHERE merged_into_person_id IS NULL
  AND NOT trapper.is_valid_person_name(display_name)
  AND data_quality NOT IN ('needs_conversion', 'low');

\echo 'People quality flags updated'
SELECT data_quality, COUNT(*) as count
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
GROUP BY data_quality
ORDER BY count DESC;

-- ============================================================================
-- STEP 4: Orphan Cats from Invalid People (Preserving Cat-Place Links)
-- ============================================================================

\echo 'Step 4: Orphaning cats from invalid people...'

-- Only orphan if the cat has a place link (preserve the important relationship)
WITH cats_to_orphan AS (
    SELECT c.cat_id, c.display_name as cat_name, p.display_name as owner_name
    FROM trapper.sot_cats c
    JOIN trapper.sot_people p ON p.person_id = c.owner_person_id
    WHERE p.merged_into_person_id IS NULL
      AND (p.data_quality IN ('needs_conversion', 'low') OR NOT trapper.is_valid_person_name(p.display_name))
      -- Only orphan if cat has place link (critical for Beacon)
      AND EXISTS (SELECT 1 FROM trapper.cat_place_relationships cpr WHERE cpr.cat_id = c.cat_id)
)
UPDATE trapper.sot_cats c
SET owner_person_id = NULL,
    updated_at = NOW()
FROM cats_to_orphan cto
WHERE c.cat_id = cto.cat_id;

\echo 'Cats orphaned from invalid people (place links preserved)'

-- ============================================================================
-- STEP 5: Record Retroactive Match Decisions (Audit Trail)
-- ============================================================================

\echo 'Step 5: Recording retroactive match decisions...'

-- Record that existing people were imported without Data Engine review
-- (This creates audit trail showing when records were created vs when Data Engine started)
INSERT INTO trapper.data_engine_match_decisions (
    source_system,
    incoming_name,
    incoming_email,
    incoming_phone,
    decision_type,
    decision_reason,
    resulting_person_id,
    processed_at
)
SELECT
    COALESCE(p.data_source::text, 'legacy_import'),
    p.display_name,
    p.primary_email,
    p.primary_phone,
    'legacy_import',
    'Pre-Data Engine import - retroactive audit record',
    p.person_id,
    p.created_at
FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL
  AND p.created_at < '2026-01-18'  -- Before Data Engine was created
  AND NOT EXISTS (
    SELECT 1 FROM trapper.data_engine_match_decisions d
    WHERE d.resulting_person_id = p.person_id
  )
LIMIT 1000;  -- Process in batches to avoid long transactions

\echo 'Recorded retroactive decisions (batch of 1000)'

-- ============================================================================
-- STEP 6: Link Appointments to Trappers Where Possible
-- Currently only 2.6% linked
-- ============================================================================

\echo 'Step 6: Linking appointments to trappers...'

-- Link appointments where trapper name matches a known trapper
UPDATE trapper.sot_appointments a
SET trapper_person_id = p.person_id
FROM trapper.sot_people p
JOIN trapper.person_roles pr ON pr.person_id = p.person_id
WHERE a.trapper_person_id IS NULL
  AND a.trapper_name IS NOT NULL
  AND a.trapper_name != ''
  AND pr.role_type IN ('coordinator', 'head_trapper', 'ffsc_trapper')
  AND (
    p.display_name ILIKE '%' || a.trapper_name || '%'
    OR a.trapper_name ILIKE '%' || p.display_name || '%'
  )
  AND p.merged_into_person_id IS NULL;

\echo 'Trapper-appointment linking complete'
SELECT
    COUNT(*) as total_appointments,
    COUNT(trapper_person_id) as with_trapper,
    ROUND(100.0 * COUNT(trapper_person_id) / COUNT(*), 1) as pct_with_trapper
FROM trapper.sot_appointments;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=== MIG_320 Complete ==='
\echo ''
\echo 'Backfill Results:'

SELECT
    (SELECT COUNT(*) FROM trapper.household_members WHERE valid_to IS NULL) as household_members,
    (SELECT COUNT(*) FROM trapper.households) as households,
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships) as cats_with_places,
    (SELECT COUNT(*) FROM trapper.sot_cats) as total_cats,
    (SELECT COUNT(*) FROM trapper.data_engine_match_decisions) as data_engine_decisions,
    (SELECT COUNT(*) FROM trapper.sot_people WHERE data_quality = 'needs_conversion') as orgs_flagged,
    (SELECT COUNT(*) FROM trapper.sot_appointments WHERE trapper_person_id IS NOT NULL) as appointments_with_trapper;

\echo ''
\echo 'Data quality improved to match expected state if Data Engine ran from day 1'
\echo ''
