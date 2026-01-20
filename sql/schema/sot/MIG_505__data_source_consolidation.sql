-- MIG_505: Data Source Consolidation
--
-- Problem:
--   Inconsistency between CLAUDE.md documentation and actual enum values:
--   - CLAUDE.md says: 'airtable', 'clinichq', 'web_intake'
--   - Enum has: 'web_app', 'airtable', 'clinichq', 'petlink', etc.
--   - Tests show mismatched source_system values
--
-- Solution:
--   1. Add missing enum values for consistency
--   2. Create data quality monitoring views
--   3. Document canonical source_system usage
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_505__data_source_consolidation.sql

\echo ''
\echo '=============================================='
\echo 'MIG_505: Data Source Consolidation'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Add missing data_source enum values
-- ============================================================

\echo '1. Adding missing data_source enum values...'

-- Add 'web_intake' for CLAUDE.md compliance
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumtypid = 'trapper.data_source'::regtype
        AND enumlabel = 'web_intake'
    ) THEN
        ALTER TYPE trapper.data_source ADD VALUE 'web_intake';
        RAISE NOTICE 'Added ''web_intake'' to trapper.data_source enum';
    ELSE
        RAISE NOTICE 'Value ''web_intake'' already exists in enum';
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Could not add web_intake: %', SQLERRM;
END $$;

-- Add 'volunteerhub' for VolunteerHub imports
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumtypid = 'trapper.data_source'::regtype
        AND enumlabel = 'volunteerhub'
    ) THEN
        ALTER TYPE trapper.data_source ADD VALUE 'volunteerhub';
        RAISE NOTICE 'Added ''volunteerhub'' to trapper.data_source enum';
    ELSE
        RAISE NOTICE 'Value ''volunteerhub'' already exists in enum';
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Could not add volunteerhub: %', SQLERRM;
END $$;

-- Add 'shelterluv' for ShelterLuv imports
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumtypid = 'trapper.data_source'::regtype
        AND enumlabel = 'shelterluv'
    ) THEN
        ALTER TYPE trapper.data_source ADD VALUE 'shelterluv';
        RAISE NOTICE 'Added ''shelterluv'' to trapper.data_source enum';
    ELSE
        RAISE NOTICE 'Value ''shelterluv'' already exists in enum';
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Could not add shelterluv: %', SQLERRM;
END $$;

-- ============================================================
-- 2. Create data quality monitoring views
-- ============================================================

\echo '2. Creating data quality monitoring views...'

-- View: Data source distribution across entities
CREATE OR REPLACE VIEW trapper.v_data_source_distribution AS
SELECT
    'requests' AS entity_type,
    data_source::TEXT AS source,
    COUNT(*) AS count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.sot_requests
GROUP BY data_source

UNION ALL

SELECT
    'people' AS entity_type,
    data_source::TEXT AS source,
    COUNT(*) AS count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
GROUP BY data_source

UNION ALL

SELECT
    'cats' AS entity_type,
    data_source::TEXT AS source,
    COUNT(*) AS count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM trapper.sot_cats
GROUP BY data_source

ORDER BY entity_type, count DESC;

COMMENT ON VIEW trapper.v_data_source_distribution IS
'Shows distribution of data_source values across all entity types.
Use to verify source tracking consistency.';

-- View: Entity quality summary
CREATE OR REPLACE VIEW trapper.v_entity_quality_summary AS
SELECT
    -- People quality
    (SELECT COUNT(*) FROM trapper.sot_people WHERE merged_into_person_id IS NULL) AS total_people,
    (SELECT COUNT(*) FROM trapper.sot_people
     WHERE merged_into_person_id IS NULL
       AND trapper.is_valid_person_name(display_name)) AS people_with_valid_names,
    (SELECT COUNT(*) FROM trapper.person_identifiers WHERE id_type = 'email') AS email_identifiers,
    (SELECT COUNT(*) FROM trapper.person_identifiers WHERE id_type = 'phone') AS phone_identifiers,

    -- Places quality
    (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL) AS total_places,
    (SELECT COUNT(*) FROM trapper.places
     WHERE merged_into_place_id IS NULL
       AND location IS NOT NULL) AS geocoded_places,
    (SELECT COUNT(*) FROM trapper.places
     WHERE merged_into_place_id IS NULL
       AND formatted_address IS NOT NULL) AS places_with_addresses,

    -- Cats quality
    (SELECT COUNT(*) FROM trapper.sot_cats) AS total_cats,
    (SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_identifiers WHERE id_type = 'microchip') AS cats_with_microchip,

    -- Requests quality
    (SELECT COUNT(*) FROM trapper.sot_requests) AS total_requests,
    (SELECT COUNT(*) FROM trapper.sot_requests WHERE resolved_at IS NOT NULL) AS requests_with_resolved_at,
    (SELECT COUNT(*) FROM trapper.sot_requests
     WHERE status IN ('completed', 'cancelled', 'partial')
       AND resolved_at IS NULL) AS terminal_without_resolved_at;

COMMENT ON VIEW trapper.v_entity_quality_summary IS
'Summary of data quality metrics across all entity types';

-- ============================================================
-- 3. Document valid source_system values
-- ============================================================

\echo '3. Creating source_system reference documentation...'

COMMENT ON TYPE trapper.data_source IS
'Canonical data source values for entity provenance tracking.

VALID VALUES (per CLAUDE.md):
  - airtable: All Airtable data (historical and ongoing sync)
  - clinichq: All ClinicHQ appointment and visit data
  - web_intake: Web intake form submissions (preferred over web_app)
  - web_app: Web app actions (use for non-intake actions)
  - petlink: PetLink microchip data
  - volunteerhub: VolunteerHub volunteer data
  - shelterluv: ShelterLuv shelter management data
  - legacy_import: Historical imports before Atlas
  - file_upload: Manual file uploads
  - app: Legacy value, prefer web_app

USAGE:
  Always use these exact values - not variants like airtable_sync or airtable_staff.
  The source_system column on sot_requests, sot_people, sot_cats should use these values.';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'MIG_505 Complete!'
\echo '=============================================='
\echo ''
\echo 'Enum values added (if not already present):'
\echo '  - web_intake'
\echo '  - volunteerhub'
\echo '  - shelterluv'
\echo ''
\echo 'Views created:'
\echo '  - v_data_source_distribution: Source tracking across entities'
\echo '  - v_entity_quality_summary: Overall data quality metrics'
\echo ''
\echo 'CANONICAL SOURCE VALUES (per CLAUDE.md):'
\echo '  airtable, clinichq, web_intake, web_app, petlink, volunteerhub, shelterluv'
\echo ''

-- Show current distribution
SELECT * FROM trapper.v_data_source_distribution;

-- Show quality summary
SELECT * FROM trapper.v_entity_quality_summary;

-- Record migration
SELECT trapper.record_migration(505, 'MIG_505__data_source_consolidation');
