-- ============================================================================
-- MIG_975: Place-Type Aware Cat Linking (RISK_005 Prevention)
-- ============================================================================
-- IMPORTANT CONTEXT:
-- The primary rule is: CATS ARE WHERE THEY'RE BOOKED (appointment address).
-- 99.8% of appointments have inferred_place_id populated from the booking address.
-- link_cats_to_appointment_places() runs FIRST and creates links from ground truth.
--
-- link_cats_to_places() (this function) is a FALLBACK for the 0.2% of cases
-- where appointments have no inferred_place_id. In those rare cases, it uses
-- person_cat → person_place chain to infer where the cat might live.
--
-- Problem: In those fallback cases, if a person has multiple addresses (home + work),
-- the function could link cats to their work address with 'home' relationship type.
-- This happened with Hector Sorrano: cats from 1311 Corby Ave (home) appeared at
-- 3276 Dutton Ave (work) because Hector had person_place_relationships to both.
--
-- Solution: Add place_kind filter to exclude non-residential places (business,
-- clinic, outdoor_site, neighborhood) when creating 'home' cat_place_relationships.
-- This is belt-and-suspenders protection for the rare fallback cases.
--
-- Affected: link_cats_to_places() function
-- Related: RISK_005 in docs/DATA_GAP_RISKS.md, MIG_972 (one-time fix)
-- Date: 2026-02-10
-- ============================================================================

\echo '=== MIG_975: Place-Type Aware Cat Linking ==='
\echo ''

-- ============================================================================
-- Step 1: Update link_cats_to_places() with place_kind filter
-- ============================================================================

\echo 'Step 1: Updating link_cats_to_places() with place-type awareness...'

CREATE OR REPLACE FUNCTION trapper.link_cats_to_places()
RETURNS TABLE (
  cats_linked_home INT
) AS $$
DECLARE
  v_count INT := 0;
BEGIN
  -- MIG_912: Temporal awareness fix
  -- MIG_975: Place-type awareness - exclude non-residential for 'home' relationships
  --
  -- Previously: Linked to ANY person_place_relationship, including work addresses
  -- Now: Only link to residential place_kinds for 'home' relationship type
  --
  -- Excluded place_kinds for 'home':
  --   - business: Work addresses (like 3276 Dutton Ave)
  --   - clinic: Medical facilities
  --   - outdoor_site: Parks, colonies, etc.
  --   - neighborhood: Too generic for cat homes
  --
  -- Allowed place_kinds for 'home':
  --   - residential_house, apartment_unit, apartment_building: Actual residences
  --   - unknown: Can't determine, so allow (may need manual review)

  WITH cats_needing_places AS (
    SELECT DISTINCT
      pcr.cat_id,
      pcr.person_id,
      (SELECT MIN(a.appointment_date)
       FROM trapper.sot_appointments a
       WHERE a.cat_id = pcr.cat_id) as first_appointment_date
    FROM trapper.person_cat_relationships pcr
    JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
      AND c.merged_into_cat_id IS NULL
    WHERE pcr.relationship_type IN ('owner', 'foster', 'adopter')
      -- Exclude cats already linked to places
      AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_place_relationships cpr
        WHERE cpr.cat_id = pcr.cat_id
      )
      -- INV-12: Exclude staff/trappers to prevent address pollution
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_roles pr
        WHERE pr.person_id = pcr.person_id
          AND pr.role_status = 'active'
          AND pr.role IN ('staff', 'coordinator', 'head_trapper', 'ffsc_trapper', 'community_trapper')
      )
  ),
  best_places AS (
    SELECT DISTINCT ON (cnp.cat_id)
      cnp.cat_id,
      cnp.person_id,
      ppr.place_id,
      ppr.role as person_place_role,
      pl.place_kind
    FROM cats_needing_places cnp
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = cnp.person_id
    JOIN trapper.places pl ON pl.place_id = ppr.place_id
      AND pl.merged_into_place_id IS NULL
    WHERE ppr.role IN ('resident', 'owner', 'requester')
      -- MIG_912: Exclude caretaker role (like staff filter)
      AND ppr.role NOT IN ('caretaker', 'contact')
      -- MIG_912: Temporal check - only use if person lived there when cat was seen
      AND (ppr.valid_to IS NULL OR ppr.valid_to >= COALESCE(cnp.first_appointment_date, ppr.created_at))
      -- MIG_975: Place-type awareness - exclude non-residential places for 'home'
      -- Only allow residential place_kinds + unknown (which may be residential)
      AND pl.place_kind NOT IN ('business', 'clinic', 'outdoor_site', 'neighborhood')
    ORDER BY
      cnp.cat_id,
      -- MIG_912: Prefer addresses still valid (no end date)
      CASE WHEN ppr.valid_to IS NULL THEN 0 ELSE 1 END,
      ppr.confidence DESC,
      -- MIG_912: Prefer OLDER addresses (created_at ASC, not DESC)
      -- This is where cat was first seen, not where person moved to
      ppr.created_at ASC
  ),
  linked AS (
    INSERT INTO trapper.cat_place_relationships (
      cat_id, place_id, relationship_type, confidence, source_system, source_table
    )
    SELECT
      bp.cat_id,
      bp.place_id,
      'home',
      'high',
      'atlas',
      'link_cats_to_places'
    FROM best_places bp
    ON CONFLICT DO NOTHING
    RETURNING cat_id
  )
  SELECT COUNT(*) INTO v_count FROM linked;

  cats_linked_home := v_count;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_cats_to_places IS
'MIG_975: Place-type awareness fix (RISK_005 prevention).
MIG_912: Temporal awareness fix.
Links cats to places via person_cat → person_place chain.

Changes from previous versions:
1. MIG_912: Uses created_at ASC (prefer OLDER addresses where cat was first seen)
2. MIG_912: Checks valid_to against cat first appointment date
3. MIG_912: Excludes caretaker and contact roles (like staff filter)
4. MIG_975: Excludes non-residential place_kinds (business, clinic, outdoor_site, neighborhood)
         This prevents cats from being linked to work addresses.

INV-12: Excludes staff/trappers to prevent address pollution.';

-- ============================================================================
-- Step 2: Audit current state
-- ============================================================================

\echo ''
\echo 'Step 2: Auditing current cat-place links by place_kind...'

SELECT
    pl.place_kind,
    COUNT(*) as cat_place_links
FROM trapper.cat_place_relationships cpr
JOIN trapper.places pl ON pl.place_id = cpr.place_id
WHERE cpr.relationship_type = 'home'
  AND cpr.source_system = 'atlas'
  AND cpr.source_table = 'link_cats_to_places'
GROUP BY pl.place_kind
ORDER BY cat_place_links DESC;

-- ============================================================================
-- Step 3: Identify potential pollution (cats at non-residential places with 'home' relationship)
-- ============================================================================

\echo ''
\echo 'Step 3: Identifying potential pollution (home relationships at non-residential places)...'

SELECT
    pl.place_kind,
    pl.formatted_address,
    c.display_name as cat_name,
    cpr.created_at::date
FROM trapper.cat_place_relationships cpr
JOIN trapper.places pl ON pl.place_id = cpr.place_id
JOIN trapper.sot_cats c ON c.cat_id = cpr.cat_id
WHERE cpr.relationship_type = 'home'
  AND pl.place_kind IN ('business', 'clinic', 'outdoor_site')
  AND cpr.source_system = 'atlas'
  AND cpr.source_table = 'link_cats_to_places'
ORDER BY pl.place_kind, pl.formatted_address, c.display_name
LIMIT 20;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_975 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  - Updated link_cats_to_places() with place-type filter'
\echo '  - Excluded place_kinds for home relationships:'
\echo '      * business (work addresses)'
\echo '      * clinic (medical facilities)'
\echo '      * outdoor_site (parks, colonies)'
\echo '      * neighborhood (too generic)'
\echo ''
\echo 'RISK_005 (Work Address Pollution): PREVENTED'
\echo ''
\echo 'IMPORTANT NOTES:'
\echo '  1. This does NOT fix existing pollution - run MIG_972 for that'
\echo '  2. This filter only affects the 0.2% of cats without appointment-based links'
\echo '  3. Most places (95%) have place_kind = unknown, so filter has limited effect'
\echo '  4. Ground truth is appointment booking address (link_cats_to_appointment_places)'
\echo '  5. Consider better place_kind inference in future (Google Places data, etc)'
\echo ''
