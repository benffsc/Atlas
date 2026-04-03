-- MIG_3039: Organization Ghost Cleanup (DATA_GAP_065)
--
-- PROBLEM: Organization-classified people (is_organization = TRUE) still appear
-- on map and in place detail views. MIG_2414/2822 reclassified them, but:
--   1. person_place and person_cat links were never cleaned up
--   2. Map/place queries don't filter is_organization
--   3. link_cats_to_places() doesn't filter orgs from person chain
--
-- EXAMPLE: "Aamco Repair Santa Rosa" appears at 1250 Cleveland Ave as a
-- linked person with 6 cats. Real residents (Eileen & Chris Dabbs) invisible.
--
-- FIX:
--   1. Update v_place_detail_v2 view to filter org people
--   2. Update link_cats_to_places() to exclude org people
--   3. Audit org ghosts and convert their links to direct cat→place
--   4. Create ops.extracted_note_entities table for notes extraction (DATA_GAP_066)
--
-- Created: 2026-04-02

\echo ''
\echo '=============================================='
\echo '  MIG_3039: Organization Ghost Cleanup'
\echo '  DATA_GAP_065 + DATA_GAP_066'
\echo '=============================================='
\echo ''

-- ============================================================================
-- STEP 0: AUDIT — What org ghosts have active links?
-- ============================================================================

\echo 'Step 0: Auditing organization-classified people with active links...'
\echo ''

SELECT
  p.display_name,
  p.person_id,
  COUNT(DISTINCT pp.place_id) AS place_links,
  COUNT(DISTINCT pc.cat_id) AS cat_links
FROM sot.people p
LEFT JOIN sot.person_place pp ON pp.person_id = p.person_id
LEFT JOIN sot.person_cat pc ON pc.person_id = p.person_id
WHERE p.is_organization = TRUE
  AND p.merged_into_person_id IS NULL
  AND (pp.id IS NOT NULL OR pc.id IS NOT NULL)
GROUP BY p.display_name, p.person_id
ORDER BY COUNT(DISTINCT pp.place_id) + COUNT(DISTINCT pc.cat_id) DESC;

-- ============================================================================
-- STEP 1: UPDATE VIEW — Filter orgs from v_place_detail_v2
-- ============================================================================

\echo ''
\echo 'Step 1: Updating v_place_detail_v2 to filter organization people...'

DROP VIEW IF EXISTS sot.v_place_detail_v2;

CREATE VIEW sot.v_place_detail_v2 AS
WITH place_cats AS (
  SELECT
    cp.place_id,
    json_agg(
      json_build_object(
        'cat_id', c.cat_id,
        'cat_name', COALESCE(c.name, 'Unknown'),
        'relationship_type', cp.relationship_type,
        'confidence', cp.confidence
      ) ORDER BY c.name
    ) AS cats,
    COUNT(DISTINCT c.cat_id) AS cat_count
  FROM sot.cat_place cp
  JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
  GROUP BY cp.place_id
),
place_people AS (
  SELECT
    pp.place_id,
    json_agg(
      json_build_object(
        'person_id', p.person_id,
        'person_name', p.display_name,
        'role', pp.relationship_type,
        'confidence', pp.confidence,
        'is_organization', COALESCE(p.is_organization, FALSE)
      ) ORDER BY p.display_name
    ) AS people,
    COUNT(DISTINCT p.person_id) AS person_count
  FROM sot.person_place pp
  JOIN sot.people p ON p.person_id = pp.person_id AND p.merged_into_person_id IS NULL
  WHERE p.display_name IS NOT NULL
    -- DATA_GAP_065: Filter out organization-classified people
    AND (p.is_organization = FALSE OR p.is_organization IS NULL)
  GROUP BY pp.place_id
)
SELECT
  p.place_id,
  COALESCE(p.display_name, split_part(p.formatted_address, ',', 1), p.formatted_address) AS display_name,
  p.display_name AS original_display_name,
  p.formatted_address,
  p.place_kind::text AS place_kind,
  p.is_address_backed,
  COALESCE(pc.cat_count, 0) > 0 AS has_cat_activity,
  CASE
    WHEN p.location IS NOT NULL THEN
      json_build_object('lat', ST_Y(p.location::geometry), 'lng', ST_X(p.location::geometry))
    ELSE NULL
  END AS coordinates,
  p.created_at::text AS created_at,
  p.updated_at::text AS updated_at,
  COALESCE(pc.cats, '[]'::json) AS cats,
  COALESCE(pp.people, '[]'::json) AS people,
  '[]'::json AS place_relationships,
  COALESCE(pc.cat_count, 0)::int AS cat_count,
  COALESCE(pp.person_count, 0)::int AS person_count
FROM sot.places p
LEFT JOIN place_cats pc ON pc.place_id = p.place_id
LEFT JOIN place_people pp ON pp.place_id = p.place_id
WHERE p.merged_into_place_id IS NULL;

\echo '   View updated — organizations excluded from people list'

-- ============================================================================
-- STEP 2: UPDATE link_cats_to_places() — Exclude org people
-- ============================================================================

\echo ''
\echo 'Step 2: Updating link_cats_to_places() to exclude org people...'

CREATE OR REPLACE FUNCTION sot.link_cats_to_places()
RETURNS TABLE(cats_linked_home INTEGER, cats_linked_appointment INTEGER, cats_skipped INTEGER, total_edges INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_cats_linked_home INTEGER := 0;
  v_cats_linked_appointment INTEGER := 0;
  v_cats_skipped INTEGER := 0;
  v_total_edges INTEGER := 0;
BEGIN
  -- =========================================================================
  -- MIG_2505 + MIG_3039: Link cats to places via VERIFIED person relationships.
  --
  -- Guards:
  -- 1. is_staff_verified = TRUE on person_place (MIG_2505)
  -- 2. is_organization = FALSE on person (MIG_3039 / DATA_GAP_065)
  -- 3. Excludes staff/trappers (INV-12)
  -- 4. Excludes blacklisted places
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
    FROM sot.person_cat pc
    JOIN sot.people p ON p.person_id = pc.person_id
    JOIN sot.person_place pp ON pp.person_id = pc.person_id
    JOIN sot.cats c ON c.cat_id = pc.cat_id
    JOIN sot.places pl ON pl.place_id = pp.place_id
    WHERE c.merged_into_cat_id IS NULL
      AND pl.merged_into_place_id IS NULL
      AND p.merged_into_person_id IS NULL
      -- CRITICAL: Only use staff-verified relationships
      AND pp.is_staff_verified = TRUE
      -- MIG_3039: Exclude organization-classified people (DATA_GAP_065)
      AND (p.is_organization = FALSE OR p.is_organization IS NULL)
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
  FROM sot.person_cat pc
  JOIN sot.people p ON p.person_id = pc.person_id
  JOIN sot.person_place pp ON pp.person_id = pc.person_id
  JOIN sot.cats c ON c.cat_id = pc.cat_id
  WHERE c.merged_into_cat_id IS NULL
    AND p.merged_into_person_id IS NULL
    AND (pp.is_staff_verified = FALSE OR p.is_organization = TRUE)
    AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = pc.cat_id);

  -- Log skipped cats for review
  IF v_cats_skipped > 0 THEN
    INSERT INTO ops.entity_linking_skipped (
      entity_type, entity_id, skip_reason, context, created_at
    )
    SELECT DISTINCT
      'cat',
      pc.cat_id,
      CASE
        WHEN p.is_organization = TRUE THEN 'org_person_in_chain'
        ELSE 'person_place_not_verified'
      END,
      jsonb_build_object(
        'person_id', pc.person_id,
        'place_id', pp.place_id,
        'relationship_type', pp.relationship_type,
        'is_organization', p.is_organization,
        'note', 'MIG_3039: Filtered org people + unverified relationships'
      ),
      NOW()
    FROM sot.person_cat pc
    JOIN sot.people p ON p.person_id = pc.person_id
    JOIN sot.person_place pp ON pp.person_id = pc.person_id
    JOIN sot.cats c ON c.cat_id = pc.cat_id
    WHERE c.merged_into_cat_id IS NULL
      AND p.merged_into_person_id IS NULL
      AND (pp.is_staff_verified = FALSE OR p.is_organization = TRUE)
      AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = pc.cat_id)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT COUNT(*) INTO v_total_edges FROM sot.cat_place;
  v_cats_linked_appointment := 0; -- Not handled by this function

  RETURN QUERY SELECT v_cats_linked_home, v_cats_linked_appointment, v_cats_skipped, v_total_edges;
END;
$$;

COMMENT ON FUNCTION sot.link_cats_to_places IS
'MIG_2505 + MIG_3039: Links cats to places via VERIFIED person relationships.

Guards:
1. is_staff_verified = TRUE on person_place (MIG_2505)
2. is_organization = FALSE on person (MIG_3039 / DATA_GAP_065)
3. Excludes staff/trappers (INV-12)
4. Excludes blacklisted places

Skipped cats are logged to ops.entity_linking_skipped.';

\echo '   link_cats_to_places() updated with org exclusion'

-- ============================================================================
-- STEP 3: CONVERT ORG GHOST LINKS — person_cat + person_place → direct cat_place
-- ============================================================================

\echo ''
\echo 'Step 3: Converting org ghost links to direct cat→place links...'

-- First, expand the CHECK constraint to allow 'booked_under_org'
ALTER TABLE sot.person_place
  DROP CONSTRAINT IF EXISTS person_place_relationship_type_check;

ALTER TABLE sot.person_place
  ADD CONSTRAINT person_place_relationship_type_check
  CHECK (relationship_type IN (
    'resident', 'property_owner', 'landlord', 'property_manager',
    'colony_caretaker', 'colony_supervisor', 'feeder',
    'transporter', 'referrer', 'neighbor', 'site_contact',
    'works_at', 'volunteers_at', 'contact_address',
    'owner', 'manager', 'caretaker', 'requester', 'trapper_at',
    'booked_under_org'
  ));

-- Expand cat_place CHECK constraints to allow new values
ALTER TABLE sot.cat_place DROP CONSTRAINT IF EXISTS cat_place_evidence_type_check;
ALTER TABLE sot.cat_place ADD CONSTRAINT cat_place_evidence_type_check
  CHECK (evidence_type IN ('manual', 'inferred', 'imported', 'appointment', 'owner_address',
    'person_relationship', 'cross_system_match', 'org_ghost_cleanup', 'verified_person_relationship'));

ALTER TABLE sot.cat_place DROP CONSTRAINT IF EXISTS cat_place_relationship_type_check;
ALTER TABLE sot.cat_place ADD CONSTRAINT cat_place_relationship_type_check
  CHECK (relationship_type IN ('home', 'residence', 'colony_member', 'seen_at',
    'appointment_site', 'trapped_at', 'relocated_to', 'associated'));

-- For each org person: if they have both person_cat and person_place links,
-- create direct cat_place links to preserve the data without the ghost intermediary.
WITH org_cat_place AS (
  SELECT DISTINCT
    pcat.cat_id,
    pp.place_id,
    'associated'::text AS relationship_type,
    'org_ghost_cleanup'::text AS evidence_type,
    'entity_linking'::text AS source_system,
    0.5::numeric AS confidence
  FROM sot.people p
  JOIN sot.person_cat pcat ON pcat.person_id = p.person_id
  JOIN sot.person_place pp ON pp.person_id = p.person_id
  JOIN sot.cats c ON c.cat_id = pcat.cat_id AND c.merged_into_cat_id IS NULL
  JOIN sot.places pl ON pl.place_id = pp.place_id AND pl.merged_into_place_id IS NULL
  WHERE p.is_organization = TRUE
    AND p.merged_into_person_id IS NULL
    -- Only create if no existing cat_place link for this pair
    AND NOT EXISTS (
      SELECT 1 FROM sot.cat_place cp
      WHERE cp.cat_id = pcat.cat_id AND cp.place_id = pp.place_id
    )
),
inserted AS (
  INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, evidence_type, source_system, confidence)
  SELECT cat_id, place_id, relationship_type, evidence_type, source_system, confidence
  FROM org_cat_place
  ON CONFLICT DO NOTHING
  RETURNING cat_id
)
SELECT COUNT(*) AS direct_links_created FROM inserted;

-- Mark existing person_place links from orgs with a clear relationship type
UPDATE sot.person_place pp
SET relationship_type = 'booked_under_org'
FROM sot.people p
WHERE pp.person_id = p.person_id
  AND p.is_organization = TRUE
  AND p.merged_into_person_id IS NULL
  AND pp.relationship_type != 'booked_under_org';

\echo '   Org ghost links converted to direct cat→place + person_place marked as booked_under_org'

-- ============================================================================
-- STEP 4: CREATE extracted_note_entities TABLE (DATA_GAP_066)
-- ============================================================================

\echo ''
\echo 'Step 4: Creating ops.extracted_note_entities table...'

CREATE TABLE IF NOT EXISTS ops.extracted_note_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_account_id UUID NOT NULL REFERENCES ops.clinic_accounts(account_id),

  -- Extraction metadata
  extraction_model TEXT NOT NULL,          -- e.g. 'claude-sonnet-4-5-20250514'
  extraction_batch_id TEXT,                -- Claude Batch API batch ID
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Extracted structured data
  extracted_people JSONB DEFAULT '[]',     -- [{name, role, confidence}]
  extracted_relationships JSONB DEFAULT '[]', -- [{person_name, relation_to, relation_type}]
  extracted_colony_info JSONB,             -- {estimated_size, feeding_schedule, management_notes}
  extracted_flags JSONB DEFAULT '[]',      -- operational flags

  -- Staff review
  staff_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  staff_approved BOOLEAN,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  -- Tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extracted_note_entities_account
  ON ops.extracted_note_entities(clinic_account_id);

CREATE INDEX IF NOT EXISTS idx_extracted_note_entities_pending_review
  ON ops.extracted_note_entities(staff_reviewed)
  WHERE staff_reviewed = FALSE;

COMMENT ON TABLE ops.extracted_note_entities IS
'DATA_GAP_066: Structured entities extracted from clinic account notes via LLM.
Contains people, relationships, colony info, and flags extracted from
ops.clinic_accounts.quick_notes and long_notes fields.
Staff must review and approve before entities are created in sot tables.';

\echo '   ops.extracted_note_entities table created'

-- ============================================================================
-- STEP 5: VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo '5a. Org people remaining in v_place_detail_v2 people column:'
SELECT COUNT(*) AS org_people_in_view
FROM sot.v_place_detail_v2 v,
     json_array_elements(v.people) AS elem
WHERE (elem->>'is_organization')::boolean = TRUE;

\echo ''
\echo '5b. Org person_place links (should be marked booked_under_org):'
SELECT pp.relationship_type, COUNT(*) AS count
FROM sot.person_place pp
JOIN sot.people p ON p.person_id = pp.person_id
WHERE p.is_organization = TRUE
  AND p.merged_into_person_id IS NULL
GROUP BY pp.relationship_type;

\echo ''
\echo '5c. Direct cat_place links created from org ghosts:'
SELECT COUNT(*) AS org_cleanup_links
FROM sot.cat_place
WHERE evidence_type = 'org_ghost_cleanup';

\echo ''
\echo '5d. Notes extraction table ready:'
SELECT COUNT(*) AS table_exists
FROM information_schema.tables
WHERE table_schema = 'ops'
  AND table_name = 'extracted_note_entities';

\echo ''
\echo '=============================================='
\echo '  MIG_3039 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  1. v_place_detail_v2: Org people filtered from people column'
\echo '  2. link_cats_to_places(): Org people excluded from person chain'
\echo '  3. Org ghost person_cat+person_place → direct cat_place links'
\echo '  4. ops.extracted_note_entities table created for DATA_GAP_066'
\echo ''
\echo 'Verify: Visit 1250 Cleveland Ave — "Aamco Repair" should NOT appear'
\echo ''
