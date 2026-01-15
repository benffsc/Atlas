\echo '=== MIG_244: Link Journal Entries to Staff ==='
\echo 'Add proper foreign key references to staff table'

-- ============================================================
-- 1. Add staff_id columns to journal_entries
-- ============================================================

\echo ''
\echo 'Adding staff_id columns to journal_entries...'

ALTER TABLE trapper.journal_entries
ADD COLUMN IF NOT EXISTS created_by_staff_id UUID REFERENCES trapper.staff(staff_id),
ADD COLUMN IF NOT EXISTS updated_by_staff_id UUID REFERENCES trapper.staff(staff_id);

COMMENT ON COLUMN trapper.journal_entries.created_by_staff_id IS
'Staff member who created this entry (links to staff table)';

COMMENT ON COLUMN trapper.journal_entries.updated_by_staff_id IS
'Staff member who last updated this entry';

-- Create indexes for lookups
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by_staff
ON trapper.journal_entries(created_by_staff_id) WHERE created_by_staff_id IS NOT NULL;

-- ============================================================
-- 2. Link existing entries by name matching
-- ============================================================

\echo ''
\echo 'Linking existing entries to staff by name...'

-- Match created_by text to staff display_name
UPDATE trapper.journal_entries j
SET created_by_staff_id = s.staff_id
FROM trapper.staff s
WHERE j.created_by IS NOT NULL
  AND j.created_by_staff_id IS NULL
  AND (
    LOWER(TRIM(j.created_by)) = LOWER(s.display_name)
    OR LOWER(TRIM(j.created_by)) = LOWER(s.first_name)
    OR LOWER(TRIM(j.created_by)) = LOWER(s.first_name || ' ' || COALESCE(s.last_name, ''))
  );

-- Same for updated_by
UPDATE trapper.journal_entries j
SET updated_by_staff_id = s.staff_id
FROM trapper.staff s
WHERE j.updated_by IS NOT NULL
  AND j.updated_by_staff_id IS NULL
  AND (
    LOWER(TRIM(j.updated_by)) = LOWER(s.display_name)
    OR LOWER(TRIM(j.updated_by)) = LOWER(s.first_name)
    OR LOWER(TRIM(j.updated_by)) = LOWER(s.first_name || ' ' || COALESCE(s.last_name, ''))
  );

-- ============================================================
-- 3. Update entity_edits table too
-- ============================================================

\echo 'Adding staff_id to entity_edits...'

ALTER TABLE trapper.entity_edits
ADD COLUMN IF NOT EXISTS edited_by_staff_id UUID REFERENCES trapper.staff(staff_id);

COMMENT ON COLUMN trapper.entity_edits.edited_by_staff_id IS
'Staff member who made this edit';

-- Link existing edits
UPDATE trapper.entity_edits e
SET edited_by_staff_id = s.staff_id
FROM trapper.staff s
WHERE e.edited_by IS NOT NULL
  AND e.edited_by_staff_id IS NULL
  AND (
    LOWER(TRIM(e.edited_by)) = LOWER(s.display_name)
    OR LOWER(TRIM(e.edited_by)) = LOWER(s.first_name)
  );

-- ============================================================
-- 4. View for journal entries with staff info
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_journal_entries_with_staff AS
SELECT
  j.*,
  cs.display_name as created_by_staff_name,
  cs.role as created_by_staff_role,
  us.display_name as updated_by_staff_name,
  us.role as updated_by_staff_role
FROM trapper.journal_entries j
LEFT JOIN trapper.staff cs ON cs.staff_id = j.created_by_staff_id
LEFT JOIN trapper.staff us ON us.staff_id = j.updated_by_staff_id
WHERE j.is_archived = FALSE
ORDER BY j.created_at DESC;

COMMENT ON VIEW trapper.v_journal_entries_with_staff IS
'Journal entries with resolved staff names and roles';

-- ============================================================
-- 5. Summary
-- ============================================================

\echo ''
\echo 'Linking summary:'
SELECT
  'journal_entries' as table_name,
  COUNT(*) as total,
  COUNT(created_by_staff_id) as linked_created_by,
  COUNT(updated_by_staff_id) as linked_updated_by
FROM trapper.journal_entries
UNION ALL
SELECT
  'entity_edits',
  COUNT(*),
  COUNT(edited_by_staff_id),
  0
FROM trapper.entity_edits;

\echo ''
\echo 'MIG_244 complete!'
\echo ''
\echo 'Added to journal_entries:'
\echo '  - created_by_staff_id (FK to staff)'
\echo '  - updated_by_staff_id (FK to staff)'
\echo ''
\echo 'Added to entity_edits:'
\echo '  - edited_by_staff_id (FK to staff)'
\echo ''
\echo 'New view: v_journal_entries_with_staff'
\echo ''
