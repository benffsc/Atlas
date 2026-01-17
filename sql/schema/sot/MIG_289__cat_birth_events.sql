-- MIG_289__cat_birth_events.sql
-- Cat Birth Events for Beacon Population Modeling (P2)
--
-- Purpose:
--   Enable tracking of kitten births for Vortex population growth modeling.
--   Beacon needs birth data to calculate:
--   - Births = F_intact × litters_per_year × kittens_per_litter × survival
--   - Mother-kitten relationships for litter tracking
--   - Seasonal breeding patterns
--
-- Scientific Context (Boone et al. 2019):
--   - Females can produce 1.6-2.0 litters/year
--   - Average litter size: 3-5 kittens
--   - Female maturity: 6 months
--   - Kitten survival: 25-50% (density-dependent)
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_289__cat_birth_events.sql

\echo ''
\echo 'MIG_289: Cat Birth Events for Beacon'
\echo '====================================='
\echo ''
\echo 'Creating birth tracking infrastructure for population modeling.'
\echo ''

-- ============================================================
-- 1. Create Birth Date Precision Enum
-- ============================================================

\echo 'Creating birth_date_precision enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'birth_date_precision') THEN
        CREATE TYPE trapper.birth_date_precision AS ENUM (
            'exact',      -- Known exact date
            'week',       -- Within a week
            'month',      -- Within a month
            'season',     -- Within a season (spring, summer, etc.)
            'year',       -- Only year known
            'estimated'   -- Estimated from age at intake
        );
    END IF;
END $$;

-- ============================================================
-- 2. Create Cat Birth Events Table
-- ============================================================

\echo 'Creating cat_birth_events table...'

CREATE TABLE IF NOT EXISTS trapper.cat_birth_events (
    birth_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Litter grouping (siblings share litter_id)
    litter_id UUID DEFAULT gen_random_uuid(),

    -- The kitten
    cat_id UUID REFERENCES trapper.sot_cats(cat_id) ON DELETE CASCADE,

    -- The mother (if known)
    mother_cat_id UUID REFERENCES trapper.sot_cats(cat_id) ON DELETE SET NULL,

    -- Birth details
    birth_date DATE,
    birth_date_precision trapper.birth_date_precision DEFAULT 'estimated',
    birth_year INT,  -- Always populated even when date unknown
    birth_month INT CHECK (birth_month BETWEEN 1 AND 12),
    birth_season TEXT CHECK (birth_season IN ('spring', 'summer', 'fall', 'winter')),

    -- Location
    place_id UUID REFERENCES trapper.places(place_id) ON DELETE SET NULL,

    -- Litter statistics (for the whole litter, not just this kitten)
    kitten_count_in_litter INT CHECK (kitten_count_in_litter > 0),
    survived_to_weaning BOOLEAN,  -- Did this kitten survive to weaning (~8 weeks)?
    litter_survived_count INT,     -- How many in litter survived to weaning?

    -- Provenance
    source_system TEXT DEFAULT 'atlas_ui',
    source_record_id TEXT,
    reported_by TEXT,
    notes TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent duplicate entries for same cat
    UNIQUE (cat_id)
);

-- ============================================================
-- 3. Add Indexes
-- ============================================================

\echo 'Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_birth_events_mother
    ON trapper.cat_birth_events(mother_cat_id) WHERE mother_cat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_birth_events_litter
    ON trapper.cat_birth_events(litter_id);

CREATE INDEX IF NOT EXISTS idx_birth_events_place
    ON trapper.cat_birth_events(place_id) WHERE place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_birth_events_date
    ON trapper.cat_birth_events(birth_date) WHERE birth_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_birth_events_year_month
    ON trapper.cat_birth_events(birth_year, birth_month) WHERE birth_year IS NOT NULL;

-- ============================================================
-- 4. Add Birth Year Helper Function
-- ============================================================

\echo 'Creating helper functions...'

CREATE OR REPLACE FUNCTION trapper.estimate_birth_year_from_age(
    p_age_months INT,
    p_observation_date DATE DEFAULT CURRENT_DATE
)
RETURNS INT AS $$
BEGIN
    IF p_age_months IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN EXTRACT(YEAR FROM (p_observation_date - (p_age_months * 30 || ' days')::INTERVAL));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.estimate_birth_year_from_age IS
'Estimates birth year from age in months and observation date.
Used to populate birth_year for cats entering clinic.';

-- ============================================================
-- 5. Create Birth Event Registration Function
-- ============================================================

\echo 'Creating register_birth_event function...'

CREATE OR REPLACE FUNCTION trapper.register_birth_event(
    p_cat_id UUID,
    p_mother_cat_id UUID DEFAULT NULL,
    p_birth_date DATE DEFAULT NULL,
    p_birth_date_precision trapper.birth_date_precision DEFAULT 'estimated',
    p_place_id UUID DEFAULT NULL,
    p_kitten_count INT DEFAULT NULL,
    p_survived_to_weaning BOOLEAN DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_source_record_id TEXT DEFAULT NULL,
    p_reported_by TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_litter_id UUID DEFAULT NULL  -- Pass existing litter_id to group siblings
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    birth_event_id UUID,
    litter_id UUID
) AS $$
DECLARE
    v_birth_event_id UUID;
    v_litter_id UUID;
    v_birth_year INT;
    v_birth_month INT;
    v_birth_season TEXT;
BEGIN
    -- Validate cat exists
    IF NOT EXISTS (SELECT 1 FROM trapper.sot_cats WHERE cat_id = p_cat_id) THEN
        RETURN QUERY SELECT FALSE, 'Cat not found: ' || p_cat_id::TEXT, NULL::UUID, NULL::UUID;
        RETURN;
    END IF;

    -- Check if birth event already exists for this cat
    IF EXISTS (SELECT 1 FROM trapper.cat_birth_events WHERE cat_id = p_cat_id) THEN
        RETURN QUERY SELECT FALSE, 'Birth event already exists for this cat', NULL::UUID, NULL::UUID;
        RETURN;
    END IF;

    -- Use provided litter_id or generate new one
    v_litter_id := COALESCE(p_litter_id, gen_random_uuid());

    -- Calculate birth year/month/season from date if provided
    IF p_birth_date IS NOT NULL THEN
        v_birth_year := EXTRACT(YEAR FROM p_birth_date);
        v_birth_month := EXTRACT(MONTH FROM p_birth_date);
        v_birth_season := CASE
            WHEN v_birth_month IN (3, 4, 5) THEN 'spring'
            WHEN v_birth_month IN (6, 7, 8) THEN 'summer'
            WHEN v_birth_month IN (9, 10, 11) THEN 'fall'
            ELSE 'winter'
        END;
    ELSE
        -- Try to get birth_year from cat record
        SELECT birth_year INTO v_birth_year
        FROM trapper.sot_cats
        WHERE cat_id = p_cat_id;
    END IF;

    -- Insert birth event
    INSERT INTO trapper.cat_birth_events (
        cat_id,
        litter_id,
        mother_cat_id,
        birth_date,
        birth_date_precision,
        birth_year,
        birth_month,
        birth_season,
        place_id,
        kitten_count_in_litter,
        survived_to_weaning,
        source_system,
        source_record_id,
        reported_by,
        notes
    ) VALUES (
        p_cat_id,
        v_litter_id,
        p_mother_cat_id,
        p_birth_date,
        p_birth_date_precision,
        v_birth_year,
        v_birth_month,
        v_birth_season,
        p_place_id,
        p_kitten_count,
        p_survived_to_weaning,
        p_source_system,
        p_source_record_id,
        p_reported_by,
        p_notes
    )
    RETURNING birth_event_id INTO v_birth_event_id;

    RETURN QUERY SELECT TRUE, 'Birth event registered', v_birth_event_id, v_litter_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.register_birth_event IS
'Registers a birth event for a kitten. Use litter_id parameter to group siblings.
Returns the birth_event_id and litter_id for linking siblings.';

-- ============================================================
-- 6. Create Litter View
-- ============================================================

\echo 'Creating litter view...'

CREATE OR REPLACE VIEW trapper.v_litter_summary AS
SELECT
    be.litter_id,
    be.mother_cat_id,
    mc.display_name AS mother_name,
    (SELECT ci.id_value FROM trapper.cat_identifiers ci
     WHERE ci.cat_id = mc.cat_id AND ci.id_type = 'microchip' LIMIT 1) AS mother_microchip,
    be.place_id,
    p.display_name AS place_name,
    MIN(be.birth_date) AS birth_date,
    MAX(be.birth_date_precision::TEXT) AS birth_date_precision,
    MIN(be.birth_year) AS birth_year,
    MIN(be.birth_season) AS birth_season,
    COUNT(*) AS kittens_tracked,
    MAX(be.kitten_count_in_litter) AS reported_litter_size,
    COUNT(*) FILTER (WHERE be.survived_to_weaning = TRUE) AS survived_to_weaning,
    COUNT(*) FILTER (WHERE be.survived_to_weaning = FALSE) AS died_before_weaning,
    COUNT(*) FILTER (WHERE be.survived_to_weaning IS NULL) AS survival_unknown,
    ARRAY_AGG(DISTINCT c.display_name ORDER BY c.display_name) AS kitten_names,
    ARRAY_AGG(DISTINCT be.cat_id) AS kitten_cat_ids
FROM trapper.cat_birth_events be
LEFT JOIN trapper.sot_cats mc ON mc.cat_id = be.mother_cat_id
LEFT JOIN trapper.sot_cats c ON c.cat_id = be.cat_id
LEFT JOIN trapper.places p ON p.place_id = be.place_id
GROUP BY
    be.litter_id,
    be.mother_cat_id,
    mc.display_name,
    mc.cat_id,
    be.place_id,
    p.display_name;

COMMENT ON VIEW trapper.v_litter_summary IS
'Aggregates birth events by litter for Beacon reproduction analysis.
Shows mother info, location, litter size, and survival rates.';

-- ============================================================
-- 7. Create Seasonal Breeding View
-- ============================================================

\echo 'Creating seasonal breeding view...'

CREATE OR REPLACE VIEW trapper.v_seasonal_births AS
SELECT
    birth_year,
    birth_month,
    birth_season,
    COUNT(*) AS births_tracked,
    COUNT(DISTINCT litter_id) AS litters_tracked,
    AVG(kitten_count_in_litter)::NUMERIC(3,1) AS avg_litter_size,
    COUNT(*) FILTER (WHERE survived_to_weaning = TRUE) AS survived,
    COUNT(*) FILTER (WHERE survived_to_weaning = FALSE) AS died,
    ROUND(
        COUNT(*) FILTER (WHERE survived_to_weaning = TRUE) * 100.0 /
        NULLIF(COUNT(*) FILTER (WHERE survived_to_weaning IS NOT NULL), 0),
        1
    ) AS survival_rate_pct
FROM trapper.cat_birth_events
WHERE birth_year IS NOT NULL
GROUP BY birth_year, birth_month, birth_season
ORDER BY birth_year DESC, birth_month;

COMMENT ON VIEW trapper.v_seasonal_births IS
'Monthly/seasonal birth statistics for Beacon breeding pattern analysis.
Aligns with Vortex model breeding season parameters (Feb-Nov for California).';

-- ============================================================
-- 8. Create Place Reproduction Stats View
-- ============================================================

\echo 'Creating place reproduction stats view...'

CREATE OR REPLACE VIEW trapper.v_place_reproduction_stats AS
SELECT
    be.place_id,
    p.display_name AS place_name,
    COUNT(DISTINCT be.cat_id) AS kittens_born,
    COUNT(DISTINCT be.litter_id) AS litters_born,
    COUNT(DISTINCT be.mother_cat_id) FILTER (WHERE be.mother_cat_id IS NOT NULL) AS known_mothers,
    MIN(be.birth_date) AS first_birth_recorded,
    MAX(be.birth_date) AS last_birth_recorded,
    AVG(be.kitten_count_in_litter)::NUMERIC(3,1) AS avg_litter_size,
    ROUND(
        COUNT(*) FILTER (WHERE be.survived_to_weaning = TRUE) * 100.0 /
        NULLIF(COUNT(*) FILTER (WHERE be.survived_to_weaning IS NOT NULL), 0),
        1
    ) AS survival_rate_pct,
    -- Recent activity (last 12 months)
    COUNT(*) FILTER (
        WHERE be.birth_date >= CURRENT_DATE - INTERVAL '12 months'
    ) AS births_last_12mo
FROM trapper.cat_birth_events be
LEFT JOIN trapper.places p ON p.place_id = be.place_id
WHERE be.place_id IS NOT NULL
GROUP BY be.place_id, p.display_name;

COMMENT ON VIEW trapper.v_place_reproduction_stats IS
'Per-place birth statistics for Beacon colony growth analysis.
Shows breeding activity to identify sites with active reproduction.';

-- ============================================================
-- 9. Add Comments
-- ============================================================

COMMENT ON TABLE trapper.cat_birth_events IS
'Tracks kitten births for Beacon population modeling.

Beacon Equation Context:
  Births = F_intact × litters_per_year × kittens_per_litter × survival

Key fields:
- litter_id: Groups siblings for litter analysis
- mother_cat_id: Links to dam for breeding female tracking
- birth_date/precision: When born (with confidence level)
- place_id: Where born (for colony reproduction rates)
- survived_to_weaning: Critical for survival rate calculation

Source Priorities:
1. Clinic intake (kitten flag + age estimate)
2. Field observations (trappers reporting litters)
3. Intake form reports (requester-reported kittens)

Scientific basis: Boone et al. 2019 (Vortex model)';

-- ============================================================
-- 10. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Table created:'
SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'cat_birth_events' AND table_schema = 'trapper') AS columns
FROM information_schema.tables
WHERE table_name = 'cat_birth_events' AND table_schema = 'trapper';

\echo ''
\echo 'Indexes created:'
SELECT indexname FROM pg_indexes
WHERE tablename = 'cat_birth_events' AND schemaname = 'trapper';

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
AND table_name IN ('v_litter_summary', 'v_seasonal_births', 'v_place_reproduction_stats');

\echo ''
SELECT 'MIG_289 Complete - Cat Birth Events Ready for Beacon P2' AS status;
