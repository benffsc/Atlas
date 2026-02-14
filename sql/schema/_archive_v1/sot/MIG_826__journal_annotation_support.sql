-- ============================================================================
-- MIG_826: Journal Annotation Support
-- ============================================================================
-- Extends the journal system to support non-canonical entities like map
-- annotations (reference pins, colony sightings, hazards, etc.).
--
-- Staff can now attach journal notes to annotations, enabling field notes
-- on lightweight map objects without requiring them to be full places.
--
-- Changes:
--   1. Add primary_annotation_id FK to journal_entries
--   2. Expand journal_entity_links CHECK to include 'annotation'
--   3. Update v_journal_entries view to include annotation label
-- ============================================================================

\echo '=== MIG_826: Journal Annotation Support ==='

-- 1. Add primary_annotation_id column to journal_entries
ALTER TABLE trapper.journal_entries
ADD COLUMN IF NOT EXISTS primary_annotation_id UUID
    REFERENCES trapper.map_annotations(annotation_id) ON DELETE SET NULL;

COMMENT ON COLUMN trapper.journal_entries.primary_annotation_id IS
  'Links journal entry to a map annotation (reference pin, colony sighting, etc.)';

-- 2. Create partial index for annotation lookups
CREATE INDEX IF NOT EXISTS idx_journal_entries_annotation
    ON trapper.journal_entries(primary_annotation_id)
    WHERE primary_annotation_id IS NOT NULL;

-- 3. Expand journal_entity_links CHECK constraint to include 'annotation'
ALTER TABLE trapper.journal_entity_links
DROP CONSTRAINT IF EXISTS journal_entity_links_entity_type_check;

ALTER TABLE trapper.journal_entity_links
ADD CONSTRAINT journal_entity_links_entity_type_check
CHECK (entity_type IN ('request', 'cat', 'person', 'place', 'annotation'));

-- 4. Recreate v_journal_entries view with annotation support
-- Must DROP first because column order changed (no dependent views)
DROP VIEW IF EXISTS trapper.v_journal_entries;
CREATE VIEW trapper.v_journal_entries AS
SELECT
    je.id AS entry_id,
    je.entry_kind,
    je.title,
    je.body,
    je.occurred_at,
    je.created_at,
    je.created_by,
    je.updated_at,
    je.updated_by,
    je.edit_count,
    je.tags,
    je.is_archived,
    je.is_pinned,
    je.primary_request_id,
    je.primary_cat_id,
    je.primary_person_id,
    je.primary_place_id,
    je.primary_annotation_id,
    r.summary AS request_summary,
    c.display_name AS cat_name,
    p.display_name AS person_name,
    pl.display_name AS place_name,
    ma.label AS annotation_label,
    (SELECT COUNT(*) FROM trapper.journal_entity_links jel WHERE jel.journal_entry_id = je.id) AS linked_entity_count,
    (SELECT COUNT(*) FROM trapper.journal_attachments ja WHERE ja.journal_entry_id = je.id) AS attachment_count
FROM trapper.journal_entries je
LEFT JOIN trapper.sot_requests r ON r.request_id = je.primary_request_id
LEFT JOIN trapper.sot_cats c ON c.cat_id = je.primary_cat_id
LEFT JOIN trapper.sot_people p ON p.person_id = je.primary_person_id
LEFT JOIN trapper.places pl ON pl.place_id = je.primary_place_id
LEFT JOIN trapper.map_annotations ma ON ma.annotation_id = je.primary_annotation_id;

\echo 'View v_journal_entries updated with annotation support.'

-- Verify
\echo 'Annotation column added:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'journal_entries'
  AND column_name = 'primary_annotation_id';

\echo 'Updated entity_type constraint:'
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'trapper.journal_entity_links'::regclass
  AND conname = 'journal_entity_links_entity_type_check';

\echo '=== MIG_826 Complete ==='
