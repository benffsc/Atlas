-- MIG_2314: Archive orphan/junk people records from V1 migration
--
-- ROOT CAUSE ANALYSIS:
-- ====================
-- On Feb 13, 2026, MIG_2071 migrated V1 data to V2 via direct copy.
-- The V1 system had created person records without proper validation:
-- - Names without email/phone (no identity resolution possible)
-- - Organization names stored as people (SCAS, schools, hotels, farms)
-- - SCAS case numbers as person names (A412554 SCAS)
-- - Duplicate records for same name (55x Henry Dalley, 38x Samantha Tresch)
--
-- EXTENT OF PROBLEM:
-- ==================
-- - 635 person records with NO identifiers (email/phone)
-- - 158 are clearly organizations (schools, hotels, parks, farms)
-- - 476 look like person names but have multiple copies
-- - 0 have cat relationships
-- - 0 have appointment links
-- - 0 have request links
-- - 625 have person_place relationships (weak signal from addresses)
--
-- WHY CURRENT V2 SAFEGUARDS WORK:
-- ================================
-- The V2 ingest route uses should_be_person() and find_or_create_person()
-- which require email OR phone for identity resolution. New duplicates
-- cannot be created post-migration (verified: 0 duplicates after Feb 13 12:00).
--
-- SOLUTION:
-- =========
-- Archive these records to ops.archived_people rather than delete.
-- This preserves:
-- - Audit trail
-- - Ability to recover if needed
-- - Historical context
--
-- INVARIANTS:
-- ===========
-- - INV-1: No Data Disappears (archived, not deleted)
-- - INV-5: Identity By Identifier Only (records without identifiers cannot be matched)
-- - INV-30: Legacy Data Cleanup (documented pattern from CLAUDE.md)

BEGIN;

-- ============================================================================
-- STEP 1: Create archive tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.archived_people (
  -- Original columns
  person_id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  entity_type TEXT,
  is_organization BOOLEAN DEFAULT FALSE,
  source_system TEXT,
  source_record_id TEXT,
  original_created_at TIMESTAMPTZ,
  original_updated_at TIMESTAMPTZ,
  -- Archive metadata
  archive_reason TEXT NOT NULL,
  archive_category TEXT NOT NULL,  -- 'organization', 'garbage', 'orphan_duplicate'
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by TEXT DEFAULT 'MIG_2314'
);

CREATE TABLE IF NOT EXISTS ops.archived_person_place (
  -- Original columns
  person_id UUID NOT NULL,
  place_id UUID NOT NULL,
  relationship_type TEXT,
  evidence_type TEXT,
  confidence NUMERIC,
  is_primary BOOLEAN,
  source_system TEXT,
  source_table TEXT,
  original_created_at TIMESTAMPTZ,
  -- Archive metadata
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (person_id, place_id)
);

CREATE INDEX IF NOT EXISTS idx_archived_people_category
  ON ops.archived_people(archive_category);
CREATE INDEX IF NOT EXISTS idx_archived_people_name
  ON ops.archived_people(display_name);

-- ============================================================================
-- STEP 2: Identify and categorize records to archive
-- ============================================================================

-- Create temp table with all records to archive and their categories
CREATE TEMP TABLE people_to_archive AS
SELECT
  p.person_id,
  p.display_name,
  p.first_name,
  p.last_name,
  p.entity_type,
  p.is_organization,
  p.source_system,
  p.source_record_id,
  p.created_at as original_created_at,
  p.updated_at as original_updated_at,
  CASE
    -- Organization/business name patterns
    WHEN p.display_name ~* '(school|hotel|park|church|nursery|farm|ranch|garden|SCAS|shelter|clinic|hospital|stop|store|market|motel|inn|center|academy|LLC|Inc|apartment|memorial|community|county|eggs|beach|trail)'
    THEN 'organization'
    -- SCAS case numbers
    WHEN p.display_name ~* '^A[0-9]{6}' OR p.display_name ~* 'SCAS.*#?A?[0-9]+'
    THEN 'organization'
    -- Placeholder/garbage names
    WHEN p.display_name ~* '^(placeholder|unknown|test|null|n/a|none|scas placeholder)$'
    THEN 'garbage'
    -- Everything else with no identifiers is an orphan duplicate
    ELSE 'orphan_duplicate'
  END as archive_category,
  CASE
    WHEN p.display_name ~* '(school|hotel|park|church|nursery|farm|ranch|garden|SCAS|shelter|clinic|hospital|stop|store|market|motel|inn|center|academy|LLC|Inc|apartment|memorial|community|county|eggs|beach|trail)'
    THEN 'Organization/business name stored as person'
    WHEN p.display_name ~* '^A[0-9]{6}' OR p.display_name ~* 'SCAS.*#?A?[0-9]+'
    THEN 'SCAS case number stored as person'
    WHEN p.display_name ~* '^(placeholder|unknown|test|null|n/a|none|scas placeholder)$'
    THEN 'Garbage/placeholder name'
    ELSE 'Orphan record: no identifiers, no cats, no appointments'
  END as archive_reason
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  -- Must have no identifiers
  AND NOT EXISTS (SELECT 1 FROM sot.person_identifiers pi WHERE pi.person_id = p.person_id)
  -- Must have no cat relationships
  AND NOT EXISTS (SELECT 1 FROM sot.person_cat pc WHERE pc.person_id = p.person_id)
  -- Must have no appointments (person_id)
  AND NOT EXISTS (SELECT 1 FROM ops.appointments a WHERE a.person_id = p.person_id)
  -- Must have no requests
  AND NOT EXISTS (SELECT 1 FROM ops.requests r WHERE r.requester_person_id = p.person_id)
  -- Must not be a merge target (other records merged into it)
  AND NOT EXISTS (SELECT 1 FROM sot.people p2 WHERE p2.merged_into_person_id = p.person_id);
  -- Note: resolved_person_id FK will be nullified before delete

-- ============================================================================
-- STEP 3: Archive person_place relationships
-- ============================================================================

INSERT INTO ops.archived_person_place (
  person_id,
  place_id,
  relationship_type,
  evidence_type,
  confidence,
  is_primary,
  source_system,
  source_table,
  original_created_at
)
SELECT
  pp.person_id,
  pp.place_id,
  pp.relationship_type,
  pp.evidence_type,
  pp.confidence,
  pp.is_primary,
  pp.source_system,
  pp.source_table,
  pp.created_at
FROM sot.person_place pp
WHERE EXISTS (SELECT 1 FROM people_to_archive pta WHERE pta.person_id = pp.person_id)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- STEP 4: Archive people records
-- ============================================================================

INSERT INTO ops.archived_people (
  person_id,
  display_name,
  first_name,
  last_name,
  entity_type,
  is_organization,
  source_system,
  source_record_id,
  original_created_at,
  original_updated_at,
  archive_reason,
  archive_category
)
SELECT
  person_id,
  display_name,
  first_name,
  last_name,
  entity_type,
  is_organization,
  source_system,
  source_record_id,
  original_created_at,
  original_updated_at,
  archive_reason,
  archive_category
FROM people_to_archive
ON CONFLICT (person_id) DO NOTHING;

-- ============================================================================
-- STEP 5: Nullify FK references before delete
-- ============================================================================

-- Nullify resolved_person_id on appointments that reference orphan people
-- (These are weak references - the appointment still has person_id for main owner)
UPDATE ops.appointments a
SET resolved_person_id = NULL
WHERE EXISTS (SELECT 1 FROM people_to_archive pta WHERE pta.person_id = a.resolved_person_id);

-- ============================================================================
-- STEP 6: Delete from sot tables (person_place first, then people)
-- ============================================================================

DELETE FROM sot.person_place pp
WHERE EXISTS (SELECT 1 FROM people_to_archive pta WHERE pta.person_id = pp.person_id);

DELETE FROM sot.people p
WHERE EXISTS (SELECT 1 FROM people_to_archive pta WHERE pta.person_id = p.person_id);

-- ============================================================================
-- STEP 7: Also clean up the merged Mike's Truck Garden records
-- (from MIG_2313 - they're still in sot.people as merged)
-- ============================================================================

-- Archive the merged records too
INSERT INTO ops.archived_people (
  person_id,
  display_name,
  first_name,
  last_name,
  entity_type,
  is_organization,
  source_system,
  source_record_id,
  original_created_at,
  original_updated_at,
  archive_reason,
  archive_category
)
SELECT
  person_id,
  display_name,
  first_name,
  last_name,
  entity_type,
  is_organization,
  source_system,
  source_record_id,
  created_at,
  updated_at,
  'Duplicate merged into canonical record',
  'orphan_duplicate'
FROM sot.people
WHERE merged_into_person_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sot.person_identifiers pi WHERE pi.person_id = sot.people.person_id)
ON CONFLICT (person_id) DO NOTHING;

-- Nullify resolved_person_id references for merged records too
UPDATE ops.appointments a
SET resolved_person_id = NULL
WHERE EXISTS (
  SELECT 1 FROM sot.people p
  WHERE p.person_id = a.resolved_person_id
    AND p.merged_into_person_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sot.person_identifiers pi WHERE pi.person_id = p.person_id)
);

-- Delete merged records that are now archived
DELETE FROM sot.people
WHERE merged_into_person_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sot.person_identifiers pi WHERE pi.person_id = sot.people.person_id)
  AND EXISTS (SELECT 1 FROM ops.archived_people ap WHERE ap.person_id = sot.people.person_id);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_archived_count INT;
  v_archived_places INT;
  v_remaining_no_id INT;
  v_org_count INT;
  v_garbage_count INT;
  v_orphan_count INT;
BEGIN
  SELECT COUNT(*) INTO v_archived_count FROM ops.archived_people;
  SELECT COUNT(*) INTO v_archived_places FROM ops.archived_person_place;

  SELECT COUNT(*) INTO v_remaining_no_id
  FROM sot.people p
  WHERE p.merged_into_person_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM sot.person_identifiers pi WHERE pi.person_id = p.person_id);

  SELECT COUNT(*) INTO v_org_count FROM ops.archived_people WHERE archive_category = 'organization';
  SELECT COUNT(*) INTO v_garbage_count FROM ops.archived_people WHERE archive_category = 'garbage';
  SELECT COUNT(*) INTO v_orphan_count FROM ops.archived_people WHERE archive_category = 'orphan_duplicate';

  RAISE NOTICE '=== MIG_2314: Archive Summary ===';
  RAISE NOTICE 'Total people archived: %', v_archived_count;
  RAISE NOTICE '  - Organizations: %', v_org_count;
  RAISE NOTICE '  - Garbage: %', v_garbage_count;
  RAISE NOTICE '  - Orphan duplicates: %', v_orphan_count;
  RAISE NOTICE 'Person-place links archived: %', v_archived_places;
  RAISE NOTICE 'Remaining people without identifiers: %', v_remaining_no_id;

  -- Verify no critical data was lost
  IF v_remaining_no_id > 0 THEN
    RAISE WARNING 'Some no-identifier records remain - these may have cat/appointment links';
  END IF;
END;
$$;

-- Show final counts
SELECT
  'sot.people' as table_name,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE merged_into_person_id IS NULL) as active_count
FROM sot.people
UNION ALL
SELECT
  'ops.archived_people' as table_name,
  COUNT(*) as total_count,
  COUNT(*) as active_count
FROM ops.archived_people;

COMMIT;
