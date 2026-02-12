-- MIG_1012: V2 Architecture - Field-Level Provenance Tables
-- Phase 1.5, Part 5: Track source and confidence for every field (Lesson #13)
--
-- Implements Lesson #13: Field-Level Provenance
-- Problem: Multi-source conflicts silently overwrote data
-- Solution: Track source and confidence for every field via *_field_sources tables
--
-- Creates:
-- 1. sot.cat_field_sources - Provenance for cat fields
-- 2. sot.person_field_sources - Provenance for person fields
-- 3. sot.place_field_sources - Provenance for place fields
-- 4. Helper functions for recording field sources

\echo ''
\echo '=============================================='
\echo '  MIG_1012: V2 Field-Level Provenance'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CAT FIELD SOURCES
-- ============================================================================

\echo '1. Creating sot.cat_field_sources...'

CREATE TABLE IF NOT EXISTS sot.cat_field_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id) ON DELETE CASCADE,

    -- Field identification
    field_name TEXT NOT NULL,  -- 'name', 'microchip', 'sex', 'breed', etc.
    field_value TEXT,          -- Current value (denormalized for quick lookup)

    -- Source info
    source_system TEXT NOT NULL,  -- 'clinichq', 'shelterluv', 'petlink', etc.
    source_record_id TEXT,
    source_table TEXT,
    source_row_id UUID,

    -- Confidence & priority
    confidence NUMERIC(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    priority INTEGER DEFAULT 50,  -- Higher = preferred (ClinicHQ=100, ShelterLuv=80, PetLink=60, Airtable=40)

    -- Timestamps
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- When this value was observed
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One source per field per source_system per cat
    UNIQUE (cat_id, field_name, source_system)
);

CREATE INDEX IF NOT EXISTS idx_cat_field_sources_cat ON sot.cat_field_sources(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_field_sources_field ON sot.cat_field_sources(field_name);
CREATE INDEX IF NOT EXISTS idx_cat_field_sources_source ON sot.cat_field_sources(source_system);

COMMENT ON TABLE sot.cat_field_sources IS
'V2 SOT: Field-level provenance for cats (Lesson #13).
Tracks which source provided each field value and with what confidence.
Survivorship priority: ClinicHQ (100) > ShelterLuv (80) > PetLink (60) > Airtable (40) > Legacy (20)';

-- ============================================================================
-- 2. PERSON FIELD SOURCES
-- ============================================================================

\echo ''
\echo '2. Creating sot.person_field_sources...'

CREATE TABLE IF NOT EXISTS sot.person_field_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES sot.people(person_id) ON DELETE CASCADE,

    -- Field identification
    field_name TEXT NOT NULL,  -- 'display_name', 'first_name', 'last_name', 'primary_email', etc.
    field_value TEXT,

    -- Source info
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    source_table TEXT,
    source_row_id UUID,

    -- Confidence & priority
    confidence NUMERIC(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    priority INTEGER DEFAULT 50,

    -- Timestamps
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (person_id, field_name, source_system)
);

CREATE INDEX IF NOT EXISTS idx_person_field_sources_person ON sot.person_field_sources(person_id);
CREATE INDEX IF NOT EXISTS idx_person_field_sources_field ON sot.person_field_sources(field_name);
CREATE INDEX IF NOT EXISTS idx_person_field_sources_source ON sot.person_field_sources(source_system);

COMMENT ON TABLE sot.person_field_sources IS
'V2 SOT: Field-level provenance for people (Lesson #13).
Tracks which source provided each person field value.';

-- ============================================================================
-- 3. PLACE FIELD SOURCES
-- ============================================================================

\echo ''
\echo '3. Creating sot.place_field_sources...'

CREATE TABLE IF NOT EXISTS sot.place_field_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID NOT NULL REFERENCES sot.places(place_id) ON DELETE CASCADE,

    -- Field identification
    field_name TEXT NOT NULL,  -- 'display_name', 'formatted_address', 'place_kind', etc.
    field_value TEXT,

    -- Source info
    source_system TEXT NOT NULL,
    source_record_id TEXT,
    source_table TEXT,
    source_row_id UUID,

    -- Confidence & priority
    confidence NUMERIC(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    priority INTEGER DEFAULT 50,

    -- Timestamps
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (place_id, field_name, source_system)
);

CREATE INDEX IF NOT EXISTS idx_place_field_sources_place ON sot.place_field_sources(place_id);
CREATE INDEX IF NOT EXISTS idx_place_field_sources_field ON sot.place_field_sources(field_name);
CREATE INDEX IF NOT EXISTS idx_place_field_sources_source ON sot.place_field_sources(source_system);

COMMENT ON TABLE sot.place_field_sources IS
'V2 SOT: Field-level provenance for places (Lesson #13).
Tracks which source provided each place field value.';

-- ============================================================================
-- 4. SOURCE PRIORITY LOOKUP
-- ============================================================================

\echo ''
\echo '4. Creating source priority lookup...'

CREATE TABLE IF NOT EXISTS atlas.source_priorities (
    source_system TEXT PRIMARY KEY,
    priority INTEGER NOT NULL,
    display_name TEXT,
    description TEXT
);

INSERT INTO atlas.source_priorities (source_system, priority, display_name, description) VALUES
    ('atlas_ui', 100, 'Atlas UI', 'Manual entry via Atlas web interface'),
    ('clinichq', 95, 'ClinicHQ', 'FFSC clinic management system'),
    ('shelterluv', 80, 'ShelterLuv', 'Animal shelter management'),
    ('volunteerhub', 75, 'VolunteerHub', 'Volunteer management system'),
    ('petlink', 60, 'PetLink', 'Microchip registry (note: fabricated emails)'),
    ('airtable', 40, 'Airtable', 'Legacy data from Airtable'),
    ('web_intake', 70, 'Web Intake', 'Public intake form submissions'),
    ('google_maps', 50, 'Google Maps', 'Google Maps location data'),
    ('v1_migration', 20, 'V1 Migration', 'Data migrated from V1 system'),
    ('system', 10, 'System', 'System-generated data')
ON CONFLICT (source_system) DO UPDATE SET
    priority = EXCLUDED.priority,
    display_name = EXCLUDED.display_name;

COMMENT ON TABLE atlas.source_priorities IS
'Lookup table for source system priorities. Higher = more trusted.
Used by survivorship logic to determine which source wins for a field.';

-- ============================================================================
-- 5. HELPER FUNCTION: Record Cat Field Sources
-- ============================================================================

\echo ''
\echo '5. Creating sot.record_cat_field_source()...'

CREATE OR REPLACE FUNCTION sot.record_cat_field_source(
    p_cat_id UUID,
    p_field_name TEXT,
    p_field_value TEXT,
    p_source_system TEXT,
    p_source_record_id TEXT DEFAULT NULL,
    p_confidence NUMERIC DEFAULT 1.0
)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
    v_id UUID;
    v_priority INTEGER;
BEGIN
    -- Get priority for source system
    SELECT priority INTO v_priority
    FROM atlas.source_priorities
    WHERE source_system = p_source_system;

    IF v_priority IS NULL THEN
        v_priority := 50;  -- Default priority
    END IF;

    INSERT INTO sot.cat_field_sources (
        cat_id,
        field_name,
        field_value,
        source_system,
        source_record_id,
        confidence,
        priority,
        observed_at
    ) VALUES (
        p_cat_id,
        p_field_name,
        p_field_value,
        p_source_system,
        p_source_record_id,
        p_confidence,
        v_priority,
        NOW()
    )
    ON CONFLICT (cat_id, field_name, source_system) DO UPDATE SET
        field_value = EXCLUDED.field_value,
        confidence = EXCLUDED.confidence,
        observed_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION sot.record_cat_field_source IS
'Records a field source for a cat. Use this in ingest pipelines to track provenance.
Automatically looks up source priority from atlas.source_priorities.';

-- ============================================================================
-- 6. HELPER FUNCTION: Record Cat Field Sources (Batch)
-- ============================================================================

\echo ''
\echo '6. Creating sot.record_cat_field_sources_batch()...'

CREATE OR REPLACE FUNCTION sot.record_cat_field_sources_batch(
    p_cat_id UUID,
    p_source_system TEXT,
    p_source_record_id TEXT,
    p_fields JSONB  -- {"field_name": "field_value", ...}
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
    v_field RECORD;
    v_count INTEGER := 0;
    v_priority INTEGER;
BEGIN
    -- Get priority for source system
    SELECT priority INTO v_priority
    FROM atlas.source_priorities
    WHERE source_system = p_source_system;

    IF v_priority IS NULL THEN
        v_priority := 50;
    END IF;

    FOR v_field IN SELECT * FROM jsonb_each_text(p_fields)
    LOOP
        INSERT INTO sot.cat_field_sources (
            cat_id,
            field_name,
            field_value,
            source_system,
            source_record_id,
            priority,
            observed_at
        ) VALUES (
            p_cat_id,
            v_field.key,
            v_field.value,
            p_source_system,
            p_source_record_id,
            v_priority,
            NOW()
        )
        ON CONFLICT (cat_id, field_name, source_system) DO UPDATE SET
            field_value = EXCLUDED.field_value,
            observed_at = NOW();

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION sot.record_cat_field_sources_batch IS
'Records multiple field sources for a cat in a single call.
Usage: SELECT sot.record_cat_field_sources_batch(cat_id, ''clinichq'', ''12345'',
       ''{"name": "Whiskers", "sex": "male", "breed": "DSH"}''::JSONB)';

-- ============================================================================
-- 7. VIEW: Best Value for Cat Fields
-- ============================================================================

\echo ''
\echo '7. Creating sot.v_cat_field_best_values...'

CREATE OR REPLACE VIEW sot.v_cat_field_best_values AS
WITH ranked AS (
    SELECT
        cat_id,
        field_name,
        field_value,
        source_system,
        confidence,
        priority,
        observed_at,
        ROW_NUMBER() OVER (
            PARTITION BY cat_id, field_name
            ORDER BY priority DESC, confidence DESC, observed_at DESC
        ) AS rn
    FROM sot.cat_field_sources
    WHERE field_value IS NOT NULL AND field_value != ''
)
SELECT
    cat_id,
    field_name,
    field_value AS best_value,
    source_system AS best_source,
    confidence,
    priority,
    observed_at
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW sot.v_cat_field_best_values IS
'Shows the "winning" value for each cat field based on source priority and confidence.
Use this to implement survivorship logic: highest priority source wins.';

-- ============================================================================
-- 8. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Field source tables created:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'sot'
  AND table_name LIKE '%_field_sources';

\echo ''
\echo 'Source priorities:'
SELECT source_system, priority, display_name
FROM atlas.source_priorities
ORDER BY priority DESC;

\echo ''
\echo '=============================================='
\echo '  MIG_1012 Complete'
\echo '=============================================='
\echo 'Created:'
\echo '  - sot.cat_field_sources table'
\echo '  - sot.person_field_sources table'
\echo '  - sot.place_field_sources table'
\echo '  - atlas.source_priorities lookup'
\echo '  - sot.record_cat_field_source() function'
\echo '  - sot.record_cat_field_sources_batch() function'
\echo '  - sot.v_cat_field_best_values view'
\echo ''
\echo 'Lesson #13 Implemented: Field-Level Provenance'
\echo 'Survivorship Priority: atlas_ui > clinichq > shelterluv > petlink > airtable > legacy'
\echo ''
