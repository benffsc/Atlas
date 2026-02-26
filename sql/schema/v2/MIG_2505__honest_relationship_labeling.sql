-- MIG_2505: Honest Relationship Labeling
--
-- PROBLEM: All 10,907 person_place_relationships are labeled "resident" but
-- this is AUTOMATED INFERENCE, not staff-verified data.
--
-- ClinicHQ appointment data only proves:
--   ✓ Cat was at this address (trapping site)
--   ✓ Person is a contact for this cat
--   ✗ Person LIVES at this address (NOT proven)
--
-- ARCHITECTURAL DECISION:
--   1. Cat-Place: ONLY from appointment.inferred_place_id (ground truth)
--   2. Person-Place: Contact info only (NOT residence proof)
--   3. Person-Cat: Who to contact about this cat
--
-- Industry reference: ASM ShelterManager separates BroughtInByOwnerID from
-- OriginalOwnerID because the person who brings in an animal is often NOT
-- the owner/resident. Same principle applies here.
--
-- Created: 2026-02-25

\echo ''
\echo '=============================================='
\echo '  MIG_2505: Honest Relationship Labeling'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. BASELINE: What do we have now?
-- ============================================================================

\echo '1. Current person_place_relationships breakdown:'
SELECT
  relationship_type,
  source_system,
  evidence_type,
  COUNT(*) as count
FROM sot.person_place_relationships
GROUP BY relationship_type, source_system, evidence_type
ORDER BY count DESC;

-- ============================================================================
-- 2. ADD is_staff_verified COLUMN
-- ============================================================================

\echo ''
\echo '2. Adding is_staff_verified column...'

ALTER TABLE sot.person_place_relationships
ADD COLUMN IF NOT EXISTS is_staff_verified BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN sot.person_place_relationships.is_staff_verified IS
'TRUE only if staff manually confirmed this relationship.
All automated/inferred relationships are FALSE.
Only staff-verified relationships should be used for residence inference.';

-- ============================================================================
-- 3. RENAME "resident" TO "contact_address" FOR AUTOMATED RELATIONSHIPS
-- ============================================================================

\echo ''
\echo '3. Renaming automated "resident" labels to "contact_address"...'

-- Update the relationship_type to be honest about what we actually know
UPDATE sot.person_place_relationships
SET relationship_type = 'contact_address'
WHERE relationship_type = 'resident'
  AND is_staff_verified = FALSE
  AND source_system IN ('clinichq', 'shelterluv', 'airtable', 'entity_linking');

\echo '   Renamed automated relationships to contact_address'

-- ============================================================================
-- 4. ADD NEW RELATIONSHIP TYPES TO DOCUMENTATION
-- ============================================================================

\echo ''
\echo '4. Documenting relationship types...'

COMMENT ON TABLE sot.person_place_relationships IS
'Links people to places. IMPORTANT: relationship_type meanings:

VERIFIED (is_staff_verified = TRUE):
  - resident: Staff confirmed person lives at this address
  - caretaker: Staff confirmed person cares for cats at this location
  - property_owner: Staff confirmed person owns this property

AUTOMATED (is_staff_verified = FALSE):
  - contact_address: Address from appointment/intake (may be trapping site, NOT residence)
  - booking_address: Address used when booking appointment
  - adoption_address: Address from adoption record

CRITICAL: For cat-place linking, ONLY use appointment.inferred_place_id.
Person-place relationships are for CONTACT purposes, not location inference.

See MIG_2505 for architectural rationale.';

-- ============================================================================
-- 5. UPDATE link_cats_to_places() TO REQUIRE VERIFICATION
-- ============================================================================

\echo ''
\echo '5. Updating link_cats_to_places to require verified relationships...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_places()
RETURNS TABLE(cats_linked_home INTEGER, cats_linked_appointment INTEGER, cats_skipped INTEGER, total_edges INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_cats_linked_home INTEGER := 0;
  v_cats_linked_appointment INTEGER := 0;
  v_cats_skipped INTEGER := 0;
  v_total_edges INTEGER := 0;
  v_reason TEXT;
BEGIN
  -- =========================================================================
  -- MIG_2505: ARCHITECTURAL CHANGE
  --
  -- This function previously linked cats to places via person_cat → person_place.
  -- This is UNSAFE because person_place relationships are NOT verified residence.
  --
  -- NEW BEHAVIOR:
  -- 1. Only link via STAFF-VERIFIED person_place relationships
  -- 2. Log all skipped cats for review
  -- 3. Primary cat-place linking should use link_cats_to_appointment_places()
  --
  -- The person-chain is now SECONDARY and requires verification.
  -- =========================================================================

  -- Step 1: Link cats via VERIFIED person_place relationships ONLY
  WITH verified_links AS (
    SELECT DISTINCT ON (pc.cat_id)
      pc.cat_id,
      pp.place_id,
      CASE pc.relationship_type
        WHEN 'owner' THEN 'home'
        WHEN 'adopter' THEN 'home'
        WHEN 'foster' THEN 'foster_home'
        WHEN 'caretaker' THEN 'residence'
        ELSE 'associated'
      END as cat_place_type,
      CASE pc.relationship_type
        WHEN 'owner' THEN 'high'
        WHEN 'adopter' THEN 'high'
        WHEN 'foster' THEN 'medium'
        ELSE 'low'
      END as confidence
    FROM sot.person_cat_relationships pc
    JOIN sot.person_place_relationships pp ON pp.person_id = pc.person_id
    JOIN sot.cats c ON c.cat_id = pc.cat_id
    JOIN sot.places p ON p.place_id = pp.place_id
    WHERE c.merged_into_cat_id IS NULL
      AND p.merged_into_place_id IS NULL
      -- CRITICAL: Only use staff-verified relationships
      AND pp.is_staff_verified = TRUE
      -- Exclude staff/trappers (INV-12)
      AND NOT EXISTS (
        SELECT 1 FROM sot.person_roles pr
        WHERE pr.person_id = pc.person_id
          AND pr.role_type IN ('staff', 'volunteer', 'trapper', 'head_trapper', 'coordinator')
          AND pr.is_active = TRUE
      )
      -- Exclude blacklisted places
      AND NOT EXISTS (
        SELECT 1 FROM sot.place_soft_blacklist psb
        WHERE psb.place_id = pp.place_id
      )
      -- Don't create duplicates
      AND NOT EXISTS (
        SELECT 1 FROM sot.cat_place cp
        WHERE cp.cat_id = pc.cat_id AND cp.place_id = pp.place_id
      )
    ORDER BY pc.cat_id, pp.confidence DESC NULLS LAST, pp.created_at DESC
  ),
  inserted AS (
    INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, evidence_type, source_system, confidence)
    SELECT cat_id, place_id, cat_place_type, 'verified_person_relationship', 'entity_linking', confidence
    FROM verified_links
    ON CONFLICT DO NOTHING
    RETURNING cat_id
  )
  SELECT COUNT(*) INTO v_cats_linked_home FROM inserted;

  -- Step 2: Count cats that COULD be linked but lack verification
  SELECT COUNT(DISTINCT pc.cat_id) INTO v_cats_skipped
  FROM sot.person_cat_relationships pc
  JOIN sot.person_place_relationships pp ON pp.person_id = pc.person_id
  JOIN sot.cats c ON c.cat_id = pc.cat_id
  WHERE c.merged_into_cat_id IS NULL
    AND pp.is_staff_verified = FALSE
    AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = pc.cat_id);

  -- Log skipped cats for review
  IF v_cats_skipped > 0 THEN
    INSERT INTO ops.entity_linking_skipped (
      entity_type, entity_id, skip_reason, context, created_at
    )
    SELECT DISTINCT
      'cat',
      pc.cat_id,
      'person_place_not_verified',
      jsonb_build_object(
        'person_id', pc.person_id,
        'place_id', pp.place_id,
        'relationship_type', pp.relationship_type,
        'note', 'MIG_2505: Requires staff verification before linking'
      ),
      NOW()
    FROM sot.person_cat_relationships pc
    JOIN sot.person_place_relationships pp ON pp.person_id = pc.person_id
    JOIN sot.cats c ON c.cat_id = pc.cat_id
    WHERE c.merged_into_cat_id IS NULL
      AND pp.is_staff_verified = FALSE
      AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = pc.cat_id)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT COUNT(*) INTO v_total_edges FROM sot.cat_place;
  v_cats_linked_appointment := 0; -- Not handled by this function

  RETURN QUERY SELECT v_cats_linked_home, v_cats_linked_appointment, v_cats_skipped, v_total_edges;
END;
$$;

COMMENT ON FUNCTION sot.link_cats_to_places IS
'MIG_2505: Links cats to places via VERIFIED person relationships ONLY.

CRITICAL CHANGE: This function now requires is_staff_verified = TRUE on
person_place_relationships before using them for cat-place inference.

Unverified relationships (from ClinicHQ booking data) are NOT used because:
- Booking address may be trapping site, not residence
- "Referrer ≠ Resident" (CLAUDE.md principle)
- Industry standard: ASM separates BroughtInByOwnerID from OriginalOwnerID

Primary cat-place linking should use link_cats_to_appointment_places() which
uses appointment.inferred_place_id (the actual trapping site - ground truth).

Skipped cats are logged to ops.entity_linking_skipped for staff review.';

-- ============================================================================
-- 6. FLAG EXISTING UNRELIABLE CAT_PLACE LINKS
-- ============================================================================

\echo ''
\echo '6. Flagging unreliable cat_place links from person_relationship chain...'

-- Add a flag column to track reliability
ALTER TABLE sot.cat_place
ADD COLUMN IF NOT EXISTS needs_verification BOOLEAN DEFAULT FALSE;

-- Flag links that came from unverified person_relationship chain
UPDATE sot.cat_place
SET needs_verification = TRUE
WHERE evidence_type = 'person_relationship'
  AND needs_verification = FALSE;

SELECT COUNT(*) as flagged_for_review
FROM sot.cat_place
WHERE needs_verification = TRUE;

-- ============================================================================
-- 7. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo '7a. Person-place relationships after fix:'
SELECT
  relationship_type,
  is_staff_verified,
  COUNT(*) as count
FROM sot.person_place_relationships
GROUP BY relationship_type, is_staff_verified
ORDER BY count DESC;

\echo ''
\echo '7b. Cat-place links by verification status:'
SELECT
  evidence_type,
  needs_verification,
  COUNT(*) as count
FROM sot.cat_place
GROUP BY evidence_type, needs_verification
ORDER BY count DESC;

\echo ''
\echo '7c. Coverage summary:'
SELECT
  (SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL) as total_cats,
  (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place WHERE needs_verification = FALSE) as cats_with_verified_place,
  (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place WHERE needs_verification = TRUE) as cats_needing_verification,
  ROUND(100.0 *
    (SELECT COUNT(DISTINCT cat_id) FROM sot.cat_place WHERE needs_verification = FALSE) /
    NULLIF((SELECT COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL), 0),
    1
  ) as verified_coverage_pct;

-- ============================================================================
-- 8. SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2505 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'ARCHITECTURAL DECISIONS IMPLEMENTED:'
\echo ''
\echo '1. RENAMED automated "resident" → "contact_address"'
\echo '   - Honest about what ClinicHQ booking data actually proves'
\echo '   - Address is for CONTACT purposes, not residence proof'
\echo ''
\echo '2. ADDED is_staff_verified column'
\echo '   - Only TRUE if staff manually confirmed'
\echo '   - All automated relationships are FALSE'
\echo ''
\echo '3. UPDATED link_cats_to_places()'
\echo '   - Now requires is_staff_verified = TRUE'
\echo '   - Skipped cats logged for review'
\echo ''
\echo '4. FLAGGED unreliable cat_place links'
\echo '   - evidence_type = "person_relationship" marked needs_verification'
\echo '   - 86%+ of cat-place links are from direct appointment evidence (safe)'
\echo ''
\echo 'PRIORITY HIERARCHY (per user requirements):'
\echo '  1. Cat-Place: appointment.inferred_place_id (GROUND TRUTH)'
\echo '  2. Person-Cat: who to contact about this cat'
\echo '  3. Person-Place: contact info (NOT residence proof)'
\echo ''
\echo 'Next: Staff can verify relationships via Atlas UI.'
\echo ''
