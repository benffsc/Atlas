\echo ''
\echo '=============================================='
\echo 'MIG_557: External Person Links Infrastructure'
\echo '=============================================='
\echo ''
\echo 'Creates authoritative mapping between external source'
\echo 'record IDs (Airtable, ClinicHQ, etc.) and Atlas person_ids.'
\echo ''
\echo 'This allows manual override of identity resolution when'
\echo 'email/phone matching fails or produces wrong results.'
\echo ''

BEGIN;

-- ============================================================================
-- PART 1: Create external_person_links table
-- ============================================================================

\echo 'Creating external_person_links table...'

CREATE TABLE IF NOT EXISTS trapper.external_person_links (
  link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- External source identification
  source_system TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_record_id TEXT NOT NULL,

  -- The canonical Atlas person this links to
  person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

  -- Link type determines authority level
  link_type TEXT NOT NULL DEFAULT 'auto' CHECK (link_type IN (
    'auto',           -- Created by sync script via identity matching
    'manual',         -- Staff manually linked via admin UI
    'override',       -- Staff override of incorrect auto-link
    'migration'       -- Created by data migration
  )),

  -- Audit trail
  linked_by TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft delete for relinking
  unlinked_at TIMESTAMPTZ,
  unlinked_by TEXT,

  -- Notes for manual links
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one active link per source record
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_person_links_unique_active
  ON trapper.external_person_links(source_system, source_table, source_record_id)
  WHERE unlinked_at IS NULL;

-- Fast lookup by person
CREATE INDEX IF NOT EXISTS idx_external_person_links_person
  ON trapper.external_person_links(person_id)
  WHERE unlinked_at IS NULL;

-- Fast lookup by source
CREATE INDEX IF NOT EXISTS idx_external_person_links_source
  ON trapper.external_person_links(source_system, source_record_id)
  WHERE unlinked_at IS NULL;

COMMENT ON TABLE trapper.external_person_links IS
'Authoritative mapping between external source record IDs and Atlas person_ids.
Allows manual override when identity resolution fails or produces wrong matches.
Manual/override links take priority over auto links in sync scripts.';

COMMENT ON COLUMN trapper.external_person_links.link_type IS
'auto = created by sync via identity matching (can be overridden)
manual = staff linked via admin UI (authoritative)
override = staff corrected wrong auto-link (authoritative)
migration = created by data migration script';

-- ============================================================================
-- PART 2: Function to get person from external link
-- ============================================================================

\echo 'Creating get_person_from_external_link function...'

CREATE OR REPLACE FUNCTION trapper.get_person_from_external_link(
  p_source_system TEXT,
  p_source_table TEXT,
  p_source_record_id TEXT
) RETURNS UUID AS $$
  SELECT person_id
  FROM trapper.external_person_links
  WHERE source_system = p_source_system
    AND source_table = p_source_table
    AND source_record_id = p_source_record_id
    AND unlinked_at IS NULL
  ORDER BY
    -- Prefer authoritative links
    CASE link_type
      WHEN 'override' THEN 1
      WHEN 'manual' THEN 2
      WHEN 'migration' THEN 3
      WHEN 'auto' THEN 4
    END
  LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.get_person_from_external_link IS
'Fast lookup of person_id from external source record.
Returns most authoritative link if multiple exist.';

-- ============================================================================
-- PART 3: Function to check if authoritative link exists
-- ============================================================================

\echo 'Creating has_authoritative_external_link function...'

CREATE OR REPLACE FUNCTION trapper.has_authoritative_external_link(
  p_source_system TEXT,
  p_source_table TEXT,
  p_source_record_id TEXT
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM trapper.external_person_links
    WHERE source_system = p_source_system
      AND source_table = p_source_table
      AND source_record_id = p_source_record_id
      AND unlinked_at IS NULL
      AND link_type IN ('manual', 'override', 'migration')
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION trapper.has_authoritative_external_link IS
'Checks if an authoritative (manual/override/migration) link exists.
Used to skip identity resolution when authoritative link already exists.';

-- ============================================================================
-- PART 4: Function to create or update external link
-- ============================================================================

\echo 'Creating link_external_record_to_person function...'

CREATE OR REPLACE FUNCTION trapper.link_external_record_to_person(
  p_source_system TEXT,
  p_source_table TEXT,
  p_source_record_id TEXT,
  p_person_id UUID,
  p_link_type TEXT DEFAULT 'auto',
  p_linked_by TEXT DEFAULT 'system',
  p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_existing RECORD;
  v_link_id UUID;
BEGIN
  -- Validate link type
  IF p_link_type NOT IN ('auto', 'manual', 'override', 'migration') THEN
    RAISE EXCEPTION 'Invalid link_type: %. Must be auto, manual, override, or migration', p_link_type;
  END IF;

  -- Check for existing active link
  SELECT * INTO v_existing
  FROM trapper.external_person_links
  WHERE source_system = p_source_system
    AND source_table = p_source_table
    AND source_record_id = p_source_record_id
    AND unlinked_at IS NULL;

  IF v_existing IS NOT NULL THEN
    -- Same person? Just return existing link
    IF v_existing.person_id = p_person_id THEN
      -- Update link type if upgrading to more authoritative
      IF (p_link_type IN ('manual', 'override') AND v_existing.link_type = 'auto') THEN
        UPDATE trapper.external_person_links
        SET link_type = p_link_type,
            linked_by = p_linked_by,
            linked_at = NOW(),
            notes = COALESCE(p_notes, notes),
            updated_at = NOW()
        WHERE link_id = v_existing.link_id;
      END IF;
      RETURN v_existing.link_id;
    END IF;

    -- Different person - soft delete old link, create new
    UPDATE trapper.external_person_links
    SET unlinked_at = NOW(),
        unlinked_by = p_linked_by,
        notes = COALESCE(notes, '') || E'\nReplaced: linked to ' || p_person_id || ' by ' || p_linked_by,
        updated_at = NOW()
    WHERE link_id = v_existing.link_id;

    -- Log the change
    INSERT INTO trapper.data_changes (
      entity_type, entity_id, change_type,
      old_value, new_value, changed_by, change_reason
    ) VALUES (
      'external_person_link',
      v_existing.link_id,
      'relink',
      jsonb_build_object('person_id', v_existing.person_id, 'link_type', v_existing.link_type),
      jsonb_build_object('person_id', p_person_id, 'link_type', p_link_type),
      p_linked_by,
      p_notes
    );
  END IF;

  -- Create new link
  INSERT INTO trapper.external_person_links (
    source_system, source_table, source_record_id,
    person_id, link_type, linked_by, notes
  ) VALUES (
    p_source_system, p_source_table, p_source_record_id,
    p_person_id, p_link_type, p_linked_by, p_notes
  ) RETURNING link_id INTO v_link_id;

  RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_external_record_to_person IS
'Create or update an external person link. Idempotent - returns existing link if same person.
If linking to different person, soft-deletes old link and creates new one with audit trail.';

-- ============================================================================
-- PART 5: Function to unlink (for corrections)
-- ============================================================================

\echo 'Creating unlink_external_record function...'

CREATE OR REPLACE FUNCTION trapper.unlink_external_record(
  p_source_system TEXT,
  p_source_table TEXT,
  p_source_record_id TEXT,
  p_unlinked_by TEXT DEFAULT 'system',
  p_reason TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_affected INT;
BEGIN
  UPDATE trapper.external_person_links
  SET unlinked_at = NOW(),
      unlinked_by = p_unlinked_by,
      notes = COALESCE(notes, '') || E'\nUnlinked: ' || COALESCE(p_reason, 'no reason given'),
      updated_at = NOW()
  WHERE source_system = p_source_system
    AND source_table = p_source_table
    AND source_record_id = p_source_record_id
    AND unlinked_at IS NULL;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected > 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 6: View for active external links
-- ============================================================================

\echo 'Creating v_external_person_links view...'

CREATE OR REPLACE VIEW trapper.v_external_person_links AS
SELECT
  epl.link_id,
  epl.source_system,
  epl.source_table,
  epl.source_record_id,
  epl.person_id,
  p.display_name as person_name,
  epl.link_type,
  epl.linked_by,
  epl.linked_at,
  epl.notes
FROM trapper.external_person_links epl
JOIN trapper.sot_people p ON p.person_id = epl.person_id
WHERE epl.unlinked_at IS NULL
  AND p.merged_into_person_id IS NULL
ORDER BY epl.linked_at DESC;

COMMENT ON VIEW trapper.v_external_person_links IS
'Active external person links with person names. Excludes merged people.';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo 'Verifying table and functions created...'

SELECT
  'external_person_links' as object,
  'table' as type,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_name = 'external_person_links'
  ) as exists;

SELECT
  proname as function_name,
  'function' as type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'trapper'
  AND p.proname IN (
    'get_person_from_external_link',
    'has_authoritative_external_link',
    'link_external_record_to_person',
    'unlink_external_record'
  );

\echo ''
\echo '=============================================='
\echo 'MIG_557 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - trapper.external_person_links table'
\echo '  - get_person_from_external_link() - fast lookup'
\echo '  - has_authoritative_external_link() - check for manual/override'
\echo '  - link_external_record_to_person() - create/update links'
\echo '  - unlink_external_record() - soft delete links'
\echo '  - v_external_person_links view'
\echo ''
