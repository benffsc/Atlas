-- MIG_140__journal_system.sql
-- Journal System: Editable entries with full edit history, attachments, and entity linking
-- Part of Atlas UI evolution - keeping clean from legacy Airtable data
--
-- Design Principles:
--   1. Journal entries are EDITABLE - but all changes are tracked in history
--   2. Edit history captures every change with before/after and who made it
--   3. Entries can be marked as irrelevant/archived but not hard deleted
--   4. Attachments use existing media_assets pattern
--   5. Polymorphic entity linking supports cats, people, places, requests
--
-- MANUAL APPLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_140__journal_system.sql

-- ============================================================
-- 1. Journal Entry Kind Enum
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_entry_kind') THEN
        CREATE TYPE trapper.journal_entry_kind AS ENUM (
            'note',           -- General narrative note
            'status_change',  -- Status/workflow transition
            'contact',        -- Contact attempt or communication
            'field_visit',    -- Site visit, trap check, etc.
            'medical',        -- Medical observation or procedure
            'trap_event',     -- Trap set, trap check, cat caught
            'intake',         -- Cat intake event
            'release',        -- Cat release/return event
            'system'          -- System-generated entry
        );
        RAISE NOTICE 'Created enum trapper.journal_entry_kind';
    ELSE
        RAISE NOTICE 'Enum trapper.journal_entry_kind already exists';
    END IF;
END $$;

-- ============================================================
-- 2. Journal Entries Table (Editable with History)
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'trapper' AND table_name = 'journal_entries') THEN
        CREATE TABLE trapper.journal_entries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

            -- Entry content
            entry_kind trapper.journal_entry_kind NOT NULL DEFAULT 'note',
            title TEXT NULL,                           -- Optional short title/summary
            body TEXT NOT NULL,                        -- Main content (markdown supported)

            -- Primary context: what is this entry primarily about?
            -- One of these should be set to provide context
            primary_request_id UUID NULL,              -- Links to sot_requests.request_id
            primary_cat_id UUID NULL,                  -- Links to sot_cats.cat_id
            primary_person_id UUID NULL,               -- Links to sot_people.person_id
            primary_place_id UUID NULL REFERENCES trapper.places(place_id) ON DELETE SET NULL,

            -- Event timing (when did the thing happen, not when was it recorded)
            occurred_at TIMESTAMPTZ NULL,              -- When the event actually occurred

            -- Status flags
            is_archived BOOLEAN DEFAULT FALSE,         -- Soft delete / marked as irrelevant
            is_pinned BOOLEAN DEFAULT FALSE,           -- Pin to top of timeline

            -- Metadata
            tags TEXT[] DEFAULT '{}',                  -- Searchable tags: ['urgent', 'kitten', 'transport']
            meta JSONB DEFAULT '{}'::jsonb,            -- Extensible metadata

            -- Audit fields
            created_by TEXT NULL,                      -- User who created this entry
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by TEXT NULL,                      -- User who last updated
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            edit_count INT DEFAULT 0                   -- Number of edits made
        );

        RAISE NOTICE 'Created table trapper.journal_entries';
    ELSE
        RAISE NOTICE 'Table trapper.journal_entries already exists';
    END IF;
END $$;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_journal_entries_request
    ON trapper.journal_entries(primary_request_id)
    WHERE primary_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_cat
    ON trapper.journal_entries(primary_cat_id)
    WHERE primary_cat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_person
    ON trapper.journal_entries(primary_person_id)
    WHERE primary_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_place
    ON trapper.journal_entries(primary_place_id)
    WHERE primary_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_created
    ON trapper.journal_entries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entries_kind
    ON trapper.journal_entries(entry_kind);

CREATE INDEX IF NOT EXISTS idx_journal_entries_tags
    ON trapper.journal_entries USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_journal_entries_active
    ON trapper.journal_entries(primary_request_id, created_at DESC)
    WHERE is_archived = FALSE;

COMMENT ON TABLE trapper.journal_entries IS 'Journal entries with full edit history. Editable, but changes are tracked.';

-- ============================================================
-- 3. Journal Entry History (Edit Audit Trail)
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'trapper' AND table_name = 'journal_entry_history') THEN
        CREATE TABLE trapper.journal_entry_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            journal_entry_id UUID NOT NULL,            -- No FK so history persists if entry deleted

            -- What changed
            edit_type TEXT NOT NULL,                   -- 'create', 'update', 'archive', 'restore'

            -- Snapshot of the entry at this point (before change for updates)
            entry_kind TEXT,
            title TEXT,
            body TEXT,
            occurred_at TIMESTAMPTZ,
            tags TEXT[],
            is_archived BOOLEAN,
            is_pinned BOOLEAN,

            -- Change metadata
            changed_fields TEXT[],                     -- Array of field names that changed
            change_reason TEXT NULL,                   -- Optional reason for the edit

            -- Audit
            changed_by TEXT NULL,
            changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX idx_journal_entry_history_entry
            ON trapper.journal_entry_history(journal_entry_id, changed_at DESC);

        RAISE NOTICE 'Created table trapper.journal_entry_history';
    ELSE
        RAISE NOTICE 'Table trapper.journal_entry_history already exists';
    END IF;
END $$;

COMMENT ON TABLE trapper.journal_entry_history IS 'Full edit history for journal entries. Captures every change.';

-- ============================================================
-- 4. Trigger: Track Journal Entry Changes
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.track_journal_entry_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_changed_fields TEXT[] := ARRAY[]::TEXT[];
    v_edit_type TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_edit_type := 'create';
        -- Capture initial state
        INSERT INTO trapper.journal_entry_history (
            journal_entry_id, edit_type, entry_kind, title, body,
            occurred_at, tags, is_archived, is_pinned, changed_by, changed_at
        ) VALUES (
            NEW.id, v_edit_type, NEW.entry_kind::TEXT, NEW.title, NEW.body,
            NEW.occurred_at, NEW.tags, NEW.is_archived, NEW.is_pinned,
            NEW.created_by, NEW.created_at
        );
        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        -- Build list of changed fields using array_append
        IF OLD.title IS DISTINCT FROM NEW.title THEN v_changed_fields := array_append(v_changed_fields, 'title'); END IF;
        IF OLD.body IS DISTINCT FROM NEW.body THEN v_changed_fields := array_append(v_changed_fields, 'body'); END IF;
        IF OLD.entry_kind IS DISTINCT FROM NEW.entry_kind THEN v_changed_fields := array_append(v_changed_fields, 'entry_kind'); END IF;
        IF OLD.occurred_at IS DISTINCT FROM NEW.occurred_at THEN v_changed_fields := array_append(v_changed_fields, 'occurred_at'); END IF;
        IF OLD.tags IS DISTINCT FROM NEW.tags THEN v_changed_fields := array_append(v_changed_fields, 'tags'); END IF;
        IF OLD.is_archived IS DISTINCT FROM NEW.is_archived THEN v_changed_fields := array_append(v_changed_fields, 'is_archived'); END IF;
        IF OLD.is_pinned IS DISTINCT FROM NEW.is_pinned THEN v_changed_fields := array_append(v_changed_fields, 'is_pinned'); END IF;

        -- Determine edit type
        IF OLD.is_archived = FALSE AND NEW.is_archived = TRUE THEN
            v_edit_type := 'archive';
        ELSIF OLD.is_archived = TRUE AND NEW.is_archived = FALSE THEN
            v_edit_type := 'restore';
        ELSE
            v_edit_type := 'update';
        END IF;

        -- Only record if something actually changed
        IF array_length(v_changed_fields, 1) > 0 THEN
            -- Record the OLD state (what it was before this change)
            INSERT INTO trapper.journal_entry_history (
                journal_entry_id, edit_type, entry_kind, title, body,
                occurred_at, tags, is_archived, is_pinned,
                changed_fields, changed_by, changed_at
            ) VALUES (
                OLD.id, v_edit_type, OLD.entry_kind::TEXT, OLD.title, OLD.body,
                OLD.occurred_at, OLD.tags, OLD.is_archived, OLD.is_pinned,
                v_changed_fields, NEW.updated_by, NOW()
            );

            -- Increment edit count
            NEW.edit_count := COALESCE(OLD.edit_count, 0) + 1;
            NEW.updated_at := NOW();
        END IF;

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entry_history ON trapper.journal_entries;
DROP TRIGGER IF EXISTS trg_journal_entry_history_log ON trapper.journal_entries;
CREATE TRIGGER trg_journal_entry_history_log
    AFTER INSERT OR UPDATE ON trapper.journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION trapper.track_journal_entry_changes();

-- BEFORE UPDATE trigger to increment edit_count and update timestamps
CREATE OR REPLACE FUNCTION trapper.journal_entries_before_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.title IS DISTINCT FROM NEW.title
       OR OLD.body IS DISTINCT FROM NEW.body
       OR OLD.entry_kind IS DISTINCT FROM NEW.entry_kind
       OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
       OR OLD.tags IS DISTINCT FROM NEW.tags
       OR OLD.is_archived IS DISTINCT FROM NEW.is_archived
       OR OLD.is_pinned IS DISTINCT FROM NEW.is_pinned
    THEN
        NEW.edit_count := COALESCE(OLD.edit_count, 0) + 1;
        NEW.updated_at := NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_entries_before_update ON trapper.journal_entries;
CREATE TRIGGER trg_journal_entries_before_update
    BEFORE UPDATE ON trapper.journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION trapper.journal_entries_before_update();

-- ============================================================
-- 5. Journal Entity Links (Polymorphic Mentions)
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'trapper' AND table_name = 'journal_entity_links') THEN
        CREATE TABLE trapper.journal_entity_links (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            journal_entry_id UUID NOT NULL REFERENCES trapper.journal_entries(id) ON DELETE CASCADE,

            -- Polymorphic entity reference
            entity_type TEXT NOT NULL CHECK (entity_type IN ('request', 'cat', 'person', 'place')),
            entity_id UUID NOT NULL,

            -- Link context
            link_role TEXT NOT NULL DEFAULT 'mentioned',  -- 'mentioned', 'involved', 'subject', 'witness', etc.
            notes TEXT NULL,                               -- Optional context about the link

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        RAISE NOTICE 'Created table trapper.journal_entity_links';
    ELSE
        RAISE NOTICE 'Table trapper.journal_entity_links already exists';
    END IF;
END $$;

-- Unique constraint: one entry can only link to an entity once per role
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entity_links
    ON trapper.journal_entity_links(journal_entry_id, entity_type, entity_id, link_role);

-- Index for finding all journal entries about an entity
CREATE INDEX IF NOT EXISTS idx_journal_entity_links_entity
    ON trapper.journal_entity_links(entity_type, entity_id);

-- Index for finding all entities in a journal entry
CREATE INDEX IF NOT EXISTS idx_journal_entity_links_entry
    ON trapper.journal_entity_links(journal_entry_id);

COMMENT ON TABLE trapper.journal_entity_links IS 'Polymorphic links between journal entries and entities (cats, people, places, requests).';

-- ============================================================
-- 6. Journal Attachments (Links to Media Assets)
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'trapper' AND table_name = 'journal_attachments') THEN
        CREATE TABLE trapper.journal_attachments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            journal_entry_id UUID NOT NULL REFERENCES trapper.journal_entries(id) ON DELETE CASCADE,
            media_asset_id UUID NULL,  -- References media_assets when that table exists

            -- Direct storage (for simple cases without media_assets table)
            storage_path TEXT NULL,                    -- e.g., 'journal/abc123/photo1.jpg'
            storage_bucket TEXT NULL,                  -- e.g., 'media-private'
            original_filename TEXT NULL,
            mime_type TEXT NULL,
            byte_size BIGINT NULL,

            -- Attachment context
            role TEXT DEFAULT 'attachment',            -- 'photo', 'document', 'signature', 'proof'
            caption TEXT NULL,                         -- Optional caption/description
            display_order INT DEFAULT 0,               -- For ordering multiple attachments

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        RAISE NOTICE 'Created table trapper.journal_attachments';
    ELSE
        RAISE NOTICE 'Table trapper.journal_attachments already exists';
    END IF;
END $$;

-- Unique constraint: one media asset per entry per role (if using media_asset_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_attachments_asset
    ON trapper.journal_attachments(journal_entry_id, media_asset_id, role)
    WHERE media_asset_id IS NOT NULL;

-- Index for finding attachments by entry
CREATE INDEX IF NOT EXISTS idx_journal_attachments_entry
    ON trapper.journal_attachments(journal_entry_id);

COMMENT ON TABLE trapper.journal_attachments IS 'Links journal entries to media assets (photos, documents). Supports both media_assets FK and direct storage paths.';

-- ============================================================
-- 7. Journal Entry View (with entity counts and edit info)
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_journal_entries AS
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

    -- Primary context
    je.primary_request_id,
    je.primary_cat_id,
    je.primary_person_id,
    je.primary_place_id,

    -- Resolve primary names
    req.summary AS request_summary,
    cat.display_name AS cat_name,
    p.display_name AS person_name,
    pl.display_name AS place_name,

    -- Counts
    (SELECT COUNT(*) FROM trapper.journal_entity_links jel WHERE jel.journal_entry_id = je.id) AS linked_entity_count,
    (SELECT COUNT(*) FROM trapper.journal_attachments ja WHERE ja.journal_entry_id = je.id) AS attachment_count

FROM trapper.journal_entries je
LEFT JOIN trapper.sot_requests req ON req.request_id = je.primary_request_id
LEFT JOIN trapper.sot_cats cat ON cat.cat_id = je.primary_cat_id
LEFT JOIN trapper.sot_people p ON p.person_id = je.primary_person_id
LEFT JOIN trapper.places pl ON pl.place_id = je.primary_place_id;

COMMENT ON VIEW trapper.v_journal_entries IS 'Journal entries with resolved entity names, counts, and edit info.';

-- ============================================================
-- 8. View: Journal Timeline for a Request
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_request_journal AS
SELECT
    je.id AS entry_id,
    je.entry_kind,
    je.title,
    je.body,
    COALESCE(je.occurred_at, je.created_at) AS event_time,
    je.created_at,
    je.created_by,
    je.updated_at,
    je.updated_by,
    je.edit_count,
    je.tags,
    je.is_archived,
    je.is_pinned,
    je.primary_request_id AS request_id,

    -- Edit indicator
    CASE WHEN je.edit_count > 0 THEN TRUE ELSE FALSE END AS was_edited,

    -- Attachment count
    (SELECT COUNT(*) FROM trapper.journal_attachments ja WHERE ja.journal_entry_id = je.id) AS attachment_count,

    -- Linked entities as JSON array
    (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'entity_type', jel.entity_type,
            'entity_id', jel.entity_id,
            'link_role', jel.link_role
        )), '[]'::jsonb)
        FROM trapper.journal_entity_links jel
        WHERE jel.journal_entry_id = je.id
    ) AS linked_entities

FROM trapper.journal_entries je
WHERE je.primary_request_id IS NOT NULL
ORDER BY je.is_pinned DESC, COALESCE(je.occurred_at, je.created_at) DESC;

COMMENT ON VIEW trapper.v_request_journal IS 'Journal timeline for requests with linked entities. Pinned entries first.';

-- ============================================================
-- 9. View: Journal Edit History
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_journal_edit_history AS
SELECT
    jeh.id AS history_id,
    jeh.journal_entry_id,
    jeh.edit_type,
    jeh.changed_fields,
    jeh.change_reason,
    jeh.changed_by,
    jeh.changed_at,

    -- Snapshot data
    jeh.title AS previous_title,
    jeh.body AS previous_body,
    jeh.entry_kind AS previous_kind,
    jeh.occurred_at AS previous_occurred_at,

    -- Current entry info for context
    je.title AS current_title,
    je.body AS current_body

FROM trapper.journal_entry_history jeh
LEFT JOIN trapper.journal_entries je ON je.id = jeh.journal_entry_id
ORDER BY jeh.changed_at DESC;

COMMENT ON VIEW trapper.v_journal_edit_history IS 'Full edit history timeline with before/after context.';

-- ============================================================
-- 10. Helper Function: Add Journal Entry
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.add_journal_entry(
    p_entry_kind TEXT,
    p_body TEXT,
    p_created_by TEXT DEFAULT NULL,
    p_title TEXT DEFAULT NULL,
    p_occurred_at TIMESTAMPTZ DEFAULT NULL,
    p_request_id UUID DEFAULT NULL,
    p_cat_id UUID DEFAULT NULL,
    p_person_id UUID DEFAULT NULL,
    p_place_id UUID DEFAULT NULL,
    p_tags TEXT[] DEFAULT '{}',
    p_meta JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
    v_entry_id UUID;
BEGIN
    INSERT INTO trapper.journal_entries (
        entry_kind, body, created_by, title, occurred_at,
        primary_request_id, primary_cat_id, primary_person_id, primary_place_id,
        tags, meta
    ) VALUES (
        p_entry_kind::trapper.journal_entry_kind, p_body, p_created_by, p_title, p_occurred_at,
        p_request_id, p_cat_id, p_person_id, p_place_id,
        p_tags, p_meta
    )
    RETURNING id INTO v_entry_id;

    RETURN v_entry_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.add_journal_entry IS 'Helper function to add a new journal entry.';

-- ============================================================
-- 11. Helper Function: Archive/Restore Entry
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.archive_journal_entry(
    p_entry_id UUID,
    p_archived_by TEXT,
    p_reason TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE trapper.journal_entries
    SET is_archived = TRUE,
        updated_by = p_archived_by,
        meta = meta || jsonb_build_object('archive_reason', p_reason)
    WHERE id = p_entry_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trapper.restore_journal_entry(
    p_entry_id UUID,
    p_restored_by TEXT
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE trapper.journal_entries
    SET is_archived = FALSE,
        updated_by = p_restored_by,
        meta = meta - 'archive_reason'
    WHERE id = p_entry_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.archive_journal_entry IS 'Soft-delete a journal entry with reason.';
COMMENT ON FUNCTION trapper.restore_journal_entry IS 'Restore an archived journal entry.';

-- ============================================================
-- Verification
-- ============================================================

DO $$
DECLARE
    v_table_count INT;
BEGIN
    SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
    WHERE table_schema = 'trapper'
      AND table_name IN ('journal_entries', 'journal_entity_links', 'journal_attachments', 'journal_entry_history');

    RAISE NOTICE 'MIG_140: Created % journal tables', v_table_count;
END $$;

-- Show what we created
SELECT 'MIG_140 Complete' AS status,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='trapper' AND table_name LIKE 'journal%') AS journal_tables,
       (SELECT COUNT(*) FROM information_schema.views WHERE table_schema='trapper' AND (table_name LIKE 'v_journal%' OR table_name LIKE 'v_request_journal%')) AS journal_views;
