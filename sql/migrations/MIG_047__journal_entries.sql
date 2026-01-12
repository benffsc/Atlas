-- MIG_047__journal_entries.sql
-- Trackable, attributable notes/journal entries system
--
-- Purpose:
--   Replace single "Internal Notes" field with proper journal entries that are:
--   - Traceable: who wrote it, when
--   - Linkable: to cats, people, places, appointments
--   - Searchable: full-text search
--   - Categorized: by entry type
--
-- Legacy notes from Airtable will be imported with entry_type='legacy_note'
-- and attributed to the import process.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_047__journal_entries.sql

\echo '============================================'
\echo 'MIG_047: Journal Entries System'
\echo '============================================'

-- ============================================
-- PART 1: Entry Type Enum
-- ============================================
\echo ''
\echo 'Creating journal_entry_type enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_entry_type') THEN
        CREATE TYPE trapper.journal_entry_type AS ENUM (
            'note',              -- General observation/note
            'update',            -- Status update
            'contact_attempt',   -- Called/texted/emailed
            'site_visit',        -- Visited location
            'medical',           -- Medical observation
            'behavioral',        -- Behavioral observation
            'follow_up',         -- Follow-up needed
            'resolution',        -- Issue resolved
            'legacy_note'        -- Imported from Airtable "Internal Notes"
        );
    END IF;
END$$;

-- ============================================
-- PART 2: Journal Entries Table
-- ============================================
\echo ''
\echo 'Creating journal_entries table...'

CREATE TABLE IF NOT EXISTS trapper.journal_entries (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Content
    content TEXT NOT NULL,
    entry_type trapper.journal_entry_type NOT NULL DEFAULT 'note',

    -- Entity links (at least one should be set)
    cat_id UUID REFERENCES trapper.sot_cats(cat_id),
    person_id UUID REFERENCES trapper.sot_people(person_id),
    place_id UUID REFERENCES trapper.places(place_id),
    appointment_id UUID REFERENCES trapper.sot_appointments(appointment_id),

    -- Attribution
    created_by TEXT NOT NULL,              -- Username or 'system:airtable_import'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT,

    -- Optional: when the observation occurred (vs when it was recorded)
    observed_at TIMESTAMPTZ,

    -- Soft delete
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    deleted_by TEXT,

    -- Source tracking for imports
    source_system TEXT,                    -- 'airtable', 'clinichq', 'app'
    source_field TEXT,                     -- 'Internal Notes', 'Client Notes', etc.
    source_record_id TEXT,

    -- Ensure at least one entity link
    CONSTRAINT journal_entries_has_link CHECK (
        cat_id IS NOT NULL OR
        person_id IS NOT NULL OR
        place_id IS NOT NULL OR
        appointment_id IS NOT NULL
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_journal_entries_cat
    ON trapper.journal_entries (cat_id, created_at DESC) WHERE cat_id IS NOT NULL AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_journal_entries_person
    ON trapper.journal_entries (person_id, created_at DESC) WHERE person_id IS NOT NULL AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_journal_entries_place
    ON trapper.journal_entries (place_id, created_at DESC) WHERE place_id IS NOT NULL AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_journal_entries_appointment
    ON trapper.journal_entries (appointment_id, created_at DESC) WHERE appointment_id IS NOT NULL AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_journal_entries_type
    ON trapper.journal_entries (entry_type) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_by
    ON trapper.journal_entries (created_by, created_at DESC) WHERE NOT is_deleted;

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_journal_entries_content_search
    ON trapper.journal_entries USING gin(to_tsvector('english', content)) WHERE NOT is_deleted;

COMMENT ON TABLE trapper.journal_entries IS
'Trackable, attributable journal entries for cats, people, places, and appointments.
Replaces single "Internal Notes" field with proper audit trail.
Legacy notes imported with entry_type=legacy_note and source_system=airtable.';

-- ============================================
-- PART 3: Views for Entity Journal Entries
-- ============================================
\echo ''
\echo 'Creating journal entry views...'

-- Cat journal entries
CREATE OR REPLACE VIEW trapper.v_cat_journal AS
SELECT
    e.entry_id,
    e.cat_id,
    e.content,
    e.entry_type::TEXT AS entry_type,
    e.created_by,
    e.created_at,
    e.observed_at,
    e.source_system,
    -- Also show linked entities
    e.person_id,
    p.display_name AS person_name,
    e.place_id,
    pl.display_name AS place_name
FROM trapper.journal_entries e
LEFT JOIN trapper.sot_people p ON p.person_id = e.person_id
LEFT JOIN trapper.places pl ON pl.place_id = e.place_id
WHERE e.cat_id IS NOT NULL
  AND NOT e.is_deleted
ORDER BY COALESCE(e.observed_at, e.created_at) DESC;

COMMENT ON VIEW trapper.v_cat_journal IS
'Journal entries for cats with related entity names.';

-- Person journal entries
CREATE OR REPLACE VIEW trapper.v_person_journal AS
SELECT
    e.entry_id,
    e.person_id,
    e.content,
    e.entry_type::TEXT AS entry_type,
    e.created_by,
    e.created_at,
    e.observed_at,
    e.source_system,
    -- Also show linked entities
    e.cat_id,
    c.display_name AS cat_name,
    e.place_id,
    pl.display_name AS place_name
FROM trapper.journal_entries e
LEFT JOIN trapper.sot_cats c ON c.cat_id = e.cat_id
LEFT JOIN trapper.places pl ON pl.place_id = e.place_id
WHERE e.person_id IS NOT NULL
  AND NOT e.is_deleted
ORDER BY COALESCE(e.observed_at, e.created_at) DESC;

COMMENT ON VIEW trapper.v_person_journal IS
'Journal entries for people with related entity names.';

-- Place journal entries
CREATE OR REPLACE VIEW trapper.v_place_journal AS
SELECT
    e.entry_id,
    e.place_id,
    e.content,
    e.entry_type::TEXT AS entry_type,
    e.created_by,
    e.created_at,
    e.observed_at,
    e.source_system,
    -- Also show linked entities
    e.cat_id,
    c.display_name AS cat_name,
    e.person_id,
    p.display_name AS person_name
FROM trapper.journal_entries e
LEFT JOIN trapper.sot_cats c ON c.cat_id = e.cat_id
LEFT JOIN trapper.sot_people p ON p.person_id = e.person_id
WHERE e.place_id IS NOT NULL
  AND NOT e.is_deleted
ORDER BY COALESCE(e.observed_at, e.created_at) DESC;

COMMENT ON VIEW trapper.v_place_journal IS
'Journal entries for places with related entity names.';

-- ============================================
-- PART 4: Helper Function to Add Entry
-- ============================================
\echo ''
\echo 'Creating add_journal_entry function...'

CREATE OR REPLACE FUNCTION trapper.add_journal_entry(
    p_content TEXT,
    p_created_by TEXT,
    p_entry_type trapper.journal_entry_type DEFAULT 'note',
    p_cat_id UUID DEFAULT NULL,
    p_person_id UUID DEFAULT NULL,
    p_place_id UUID DEFAULT NULL,
    p_appointment_id UUID DEFAULT NULL,
    p_observed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_entry_id UUID;
BEGIN
    INSERT INTO trapper.journal_entries (
        content,
        entry_type,
        cat_id,
        person_id,
        place_id,
        appointment_id,
        created_by,
        observed_at,
        source_system
    ) VALUES (
        p_content,
        p_entry_type,
        p_cat_id,
        p_person_id,
        p_place_id,
        p_appointment_id,
        p_created_by,
        p_observed_at,
        'app'
    )
    RETURNING entry_id INTO v_entry_id;

    RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.add_journal_entry IS
'Convenience function to add a journal entry with proper validation.';

-- ============================================
-- PART 5: Import Legacy Notes Function
-- ============================================
\echo ''
\echo 'Creating import_legacy_notes function...'

-- This function will be used to import existing "Internal Notes" from Airtable
-- It should be called during data migration
CREATE OR REPLACE FUNCTION trapper.import_legacy_cat_notes()
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
BEGIN
    -- Import notes from sot_cats.notes field (if it exists and is not empty)
    INSERT INTO trapper.journal_entries (
        content,
        entry_type,
        cat_id,
        created_by,
        created_at,
        source_system,
        source_field
    )
    SELECT
        c.notes,
        'legacy_note'::trapper.journal_entry_type,
        c.cat_id,
        'system:legacy_import',
        c.created_at,
        'airtable',
        'Internal Notes'
    FROM trapper.sot_cats c
    WHERE c.notes IS NOT NULL
      AND TRIM(c.notes) <> ''
      AND NOT EXISTS (
          SELECT 1 FROM trapper.journal_entries je
          WHERE je.cat_id = c.cat_id
            AND je.entry_type = 'legacy_note'
            AND je.source_field = 'Internal Notes'
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.import_legacy_cat_notes IS
'Imports existing Internal Notes from sot_cats.notes into journal_entries.
Idempotent: skips cats that already have imported legacy notes.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_047 Complete'
\echo '============================================'

\echo ''
\echo 'New tables:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'trapper'
AND table_name = 'journal_entries';

\echo ''
\echo 'Entry types:'
SELECT unnest(enum_range(NULL::trapper.journal_entry_type)) AS entry_type;

\echo ''
\echo 'To add a journal entry:'
\echo '  SELECT trapper.add_journal_entry('
\echo '    ''Cat was friendly today'','
\echo '    ''user@example.com'','
\echo '    ''note'','
\echo '    ''cat-uuid-here'''
\echo '  );'
\echo ''
\echo 'To import legacy notes from sot_cats:'
\echo '  SELECT trapper.import_legacy_cat_notes();'
\echo ''
