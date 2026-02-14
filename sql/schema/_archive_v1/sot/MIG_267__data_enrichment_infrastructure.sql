-- MIG_267: Data Enrichment Infrastructure
-- ========================================
--
-- Prepares infrastructure for parsing qualitative data sources:
-- 1. Add new source_types to colony_source_confidence (required before parsers run)
-- 2. Add 'monitoring' hold reason (for nearly-complete sites)
-- 3. Add 'web_app' to data_source enum (for Atlas UI observations)
--
-- Related TODO items:
-- - Create Internal Notes Parser Script
-- - Create Appointment Notes Parser
-- - Create Intake Situation Parser
-- - Import MyMaps Colony History (KML)

\echo '=== MIG_267: Data Enrichment Infrastructure ==='

-- ============================================
-- PART 1: Add new source_types to colony_source_confidence
-- ============================================
--
-- These confidence values are used by v_place_ecology_stats to weight estimates.
-- Lower confidence = less impact on final estimate.

\echo 'Adding new source_types to colony_source_confidence...'

INSERT INTO trapper.colony_source_confidence (source_type, base_confidence, description, is_firsthand_boost)
VALUES
  -- Parsed from existing notes/text fields
  ('internal_notes_parse', 0.40, 'Extracted from request notes via regex parsing', 0.00),
  ('appointment_notes_parse', 0.35, 'Extracted from appointment internal notes', 0.00),
  ('intake_situation_parse', 0.45, 'Extracted from intake situation description', 0.00),

  -- Historical data imports
  ('legacy_mymaps', 0.50, 'Historical MyMaps/KML data 2001-2019', 0.00),

  -- Atlas UI direct entry
  ('atlas_observation', 0.75, 'Direct observation logged via Atlas UI', 0.05)
ON CONFLICT (source_type) DO UPDATE SET
  base_confidence = EXCLUDED.base_confidence,
  description = EXCLUDED.description;

\echo 'Current source_types in colony_source_confidence:'
SELECT source_type, base_confidence, description
FROM trapper.colony_source_confidence
ORDER BY base_confidence DESC;

-- ============================================
-- PART 2: Add 'monitoring' hold reason
-- ============================================
--
-- For sites that are substantially complete (e.g., 65/68 cats fixed)
-- and only need periodic checks rather than active trapping.

\echo 'Adding monitoring hold reason...'

DO $$
BEGIN
    -- Check if value already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumtypid = 'trapper.hold_reason'::regtype
        AND enumlabel = 'monitoring'
    ) THEN
        ALTER TYPE trapper.hold_reason ADD VALUE 'monitoring';
        RAISE NOTICE 'Added ''monitoring'' to trapper.hold_reason enum';
    ELSE
        RAISE NOTICE 'Value ''monitoring'' already exists in enum';
    END IF;
END
$$;

COMMENT ON TYPE trapper.hold_reason IS
'Reasons for putting a request on hold:
- weather: Unsafe trapping conditions
- callback_pending: Waiting for client response
- access_issue: Property access problems
- resource_constraint: Moving resources to higher priority sites
- client_unavailable: Client not responding
- monitoring: Site substantially complete, periodic checks only';

-- ============================================
-- PART 3: Add 'web_app' to data_source enum
-- ============================================
--
-- Used for observations and edits made directly in Atlas UI.
-- Distinct from 'app' which is legacy.

\echo 'Adding web_app to data_source enum...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumtypid = 'trapper.data_source'::regtype
        AND enumlabel = 'web_app'
    ) THEN
        ALTER TYPE trapper.data_source ADD VALUE 'web_app';
        RAISE NOTICE 'Added ''web_app'' to trapper.data_source enum';
    ELSE
        RAISE NOTICE 'Value ''web_app'' already exists in enum';
    END IF;
END
$$;

\echo 'Current data_source enum values:'
SELECT enum_range(NULL::trapper.data_source);

-- ============================================
-- PART 4: Fix duplicate colony estimate prevention
-- ============================================
--
-- Issue: Some places have duplicate estimates from intake triggers.
-- Solution: Add unique constraint on (place_id, source_type, observation_date, source_record_id)
-- with COALESCE for NULLs.

\echo 'Adding duplicate prevention index...'

-- Create unique index to prevent duplicates
-- Using COALESCE to handle NULL observation_date and source_record_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_colony_estimates_no_dupes
ON trapper.place_colony_estimates (
    place_id,
    source_type,
    COALESCE(observation_date, '1900-01-01'::DATE),
    COALESCE(source_record_id, 'no_source_id')
)
WHERE source_system IS NOT NULL;

\echo 'Duplicate prevention index created.'

-- ============================================
-- PART 5: Add index for efficient parsing lookups
-- ============================================
--
-- Parser scripts will need to look up existing estimates to avoid re-parsing.

CREATE INDEX IF NOT EXISTS idx_colony_estimates_source_lookup
ON trapper.place_colony_estimates (source_type, source_system, source_record_id)
WHERE source_record_id IS NOT NULL;

-- ============================================
-- VERIFICATION
-- ============================================

\echo ''
\echo '=== MIG_267 Complete ==='
\echo ''
\echo 'New source_types available for parsers:'
SELECT source_type, base_confidence
FROM trapper.colony_source_confidence
WHERE source_type IN ('internal_notes_parse', 'appointment_notes_parse',
                      'intake_situation_parse', 'legacy_mymaps', 'atlas_observation');

\echo ''
\echo 'Ready for:'
\echo '  - scripts/ingest/parse_request_notes_estimates.mjs (internal_notes_parse)'
\echo '  - scripts/ingest/parse_appointment_notes.mjs (appointment_notes_parse)'
\echo '  - scripts/ingest/parse_intake_situation.mjs (intake_situation_parse)'
\echo '  - scripts/ingest/mymaps_kml_import.mjs (legacy_mymaps)'
\echo '  - /api/places/[id]/observations (atlas_observation)'
