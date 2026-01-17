-- MIG_290__cat_mortality_events.sql
-- Cat Mortality Events for Beacon Population Modeling (P3)
--
-- Purpose:
--   Enable tracking of cat deaths for Vortex population survival modeling.
--   Beacon needs mortality data to calculate:
--   - Survival rates (adult vs kitten)
--   - Density-dependent mortality
--   - Population change: N(t+1) = N(t) + Births - Deaths + Immigration
--
-- Scientific Context (Boone et al. 2019):
--   - Adult survival rate: 60-80% annually
--   - Kitten survival: 25-50% (density-dependent)
--   - S_kitten = S_max - (S_max - S_min) × (N / K)
--
-- Data Sources:
--   - KML notes: 233 mortality mentions found in historical data
--   - Intake/request notes: Reported deaths
--   - Clinic records: Euthanasia
--   - Field observations: Trappers reporting deceased cats
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_290__cat_mortality_events.sql

\echo ''
\echo 'MIG_290: Cat Mortality Events for Beacon'
\echo '========================================='
\echo ''
\echo 'Creating mortality tracking infrastructure for survival rate modeling.'
\echo ''

-- ============================================================
-- 1. Create Death Cause Enum
-- ============================================================

\echo 'Creating death_cause enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'death_cause') THEN
        CREATE TYPE trapper.death_cause AS ENUM (
            'natural',        -- Old age, natural causes
            'vehicle',        -- Hit by car
            'predator',       -- Dog, coyote, etc.
            'disease',        -- Illness/disease
            'euthanasia',     -- Humane euthanasia (clinic)
            'injury',         -- Non-vehicle trauma
            'starvation',     -- Malnutrition
            'weather',        -- Exposure (heat/cold)
            'unknown',        -- Cause not determined
            'other'           -- Other specified cause
        );
    END IF;
END $$;

-- ============================================================
-- 2. Create Cat Mortality Events Table
-- ============================================================

\echo 'Creating cat_mortality_events table...'

CREATE TABLE IF NOT EXISTS trapper.cat_mortality_events (
    mortality_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The cat
    cat_id UUID REFERENCES trapper.sot_cats(cat_id) ON DELETE CASCADE,

    -- Death details
    death_date DATE,
    death_date_precision TEXT DEFAULT 'estimated'
        CHECK (death_date_precision IN ('exact', 'week', 'month', 'season', 'year', 'estimated')),
    death_year INT,
    death_month INT CHECK (death_month BETWEEN 1 AND 12),

    -- Cause and circumstances
    death_cause trapper.death_cause DEFAULT 'unknown',
    death_cause_notes TEXT,  -- Details about cause

    -- Age at death (for survival rate calculations)
    death_age_months INT,  -- Approximate age at death
    death_age_category TEXT CHECK (death_age_category IN ('kitten', 'juvenile', 'adult', 'senior', 'unknown')),

    -- Location
    place_id UUID REFERENCES trapper.places(place_id) ON DELETE SET NULL,

    -- Reporter
    reported_by TEXT,
    reported_date DATE DEFAULT CURRENT_DATE,

    -- Provenance
    source_system TEXT DEFAULT 'atlas_ui',
    source_record_id TEXT,
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

CREATE INDEX IF NOT EXISTS idx_mortality_events_cat
    ON trapper.cat_mortality_events(cat_id);

CREATE INDEX IF NOT EXISTS idx_mortality_events_place
    ON trapper.cat_mortality_events(place_id) WHERE place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mortality_events_date
    ON trapper.cat_mortality_events(death_date) WHERE death_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mortality_events_cause
    ON trapper.cat_mortality_events(death_cause);

CREATE INDEX IF NOT EXISTS idx_mortality_events_age_category
    ON trapper.cat_mortality_events(death_age_category) WHERE death_age_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mortality_events_year_month
    ON trapper.cat_mortality_events(death_year, death_month) WHERE death_year IS NOT NULL;

-- ============================================================
-- 4. Add Age Category Helper Function
-- ============================================================

\echo 'Creating helper functions...'

CREATE OR REPLACE FUNCTION trapper.get_age_category(p_age_months INT)
RETURNS TEXT AS $$
BEGIN
    IF p_age_months IS NULL THEN
        RETURN 'unknown';
    ELSIF p_age_months < 6 THEN
        RETURN 'kitten';     -- Under 6 months
    ELSIF p_age_months < 12 THEN
        RETURN 'juvenile';   -- 6-12 months
    ELSIF p_age_months < 84 THEN
        RETURN 'adult';      -- 1-7 years
    ELSE
        RETURN 'senior';     -- 7+ years
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.get_age_category IS
'Categorizes cat age for survival rate analysis.
Categories align with Vortex model age classes.';

-- ============================================================
-- 5. Create Mortality Registration Function
-- ============================================================

\echo 'Creating register_mortality_event function...'

CREATE OR REPLACE FUNCTION trapper.register_mortality_event(
    p_cat_id UUID,
    p_death_date DATE DEFAULT NULL,
    p_death_date_precision TEXT DEFAULT 'estimated',
    p_death_cause trapper.death_cause DEFAULT 'unknown',
    p_death_cause_notes TEXT DEFAULT NULL,
    p_death_age_months INT DEFAULT NULL,
    p_place_id UUID DEFAULT NULL,
    p_reported_by TEXT DEFAULT NULL,
    p_source_system TEXT DEFAULT 'atlas_ui',
    p_source_record_id TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    message TEXT,
    mortality_event_id UUID
) AS $$
DECLARE
    v_mortality_event_id UUID;
    v_death_year INT;
    v_death_month INT;
    v_age_category TEXT;
    v_cat_name TEXT;
BEGIN
    -- Validate cat exists
    SELECT display_name INTO v_cat_name
    FROM trapper.sot_cats
    WHERE cat_id = p_cat_id;

    IF v_cat_name IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Cat not found: ' || p_cat_id::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- Check if mortality event already exists for this cat
    IF EXISTS (SELECT 1 FROM trapper.cat_mortality_events WHERE cat_id = p_cat_id) THEN
        RETURN QUERY SELECT FALSE, 'Mortality event already exists for this cat: ' || v_cat_name, NULL::UUID;
        RETURN;
    END IF;

    -- Calculate derived fields
    IF p_death_date IS NOT NULL THEN
        v_death_year := EXTRACT(YEAR FROM p_death_date);
        v_death_month := EXTRACT(MONTH FROM p_death_date);
    END IF;

    v_age_category := trapper.get_age_category(p_death_age_months);

    -- Insert mortality event
    INSERT INTO trapper.cat_mortality_events (
        cat_id,
        death_date,
        death_date_precision,
        death_year,
        death_month,
        death_cause,
        death_cause_notes,
        death_age_months,
        death_age_category,
        place_id,
        reported_by,
        source_system,
        source_record_id,
        notes
    ) VALUES (
        p_cat_id,
        p_death_date,
        p_death_date_precision,
        v_death_year,
        v_death_month,
        p_death_cause,
        p_death_cause_notes,
        p_death_age_months,
        v_age_category,
        p_place_id,
        p_reported_by,
        p_source_system,
        p_source_record_id,
        p_notes
    )
    RETURNING mortality_event_id INTO v_mortality_event_id;

    -- Mark cat as deceased in sot_cats if column exists
    UPDATE trapper.sot_cats
    SET
        is_deceased = TRUE,
        deceased_date = COALESCE(p_death_date, CURRENT_DATE),
        updated_at = NOW()
    WHERE cat_id = p_cat_id
      AND (is_deceased IS NULL OR is_deceased = FALSE);

    RETURN QUERY SELECT TRUE, 'Mortality event registered for: ' || v_cat_name, v_mortality_event_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.register_mortality_event IS
'Registers a mortality event for a cat and optionally marks cat as deceased.
Used for survival rate calculations in Beacon population modeling.';

-- ============================================================
-- 6. Add is_deceased Column to sot_cats (if not exists)
-- ============================================================

\echo 'Adding is_deceased column to sot_cats if needed...'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'sot_cats'
        AND column_name = 'is_deceased'
    ) THEN
        ALTER TABLE trapper.sot_cats ADD COLUMN is_deceased BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN trapper.sot_cats.is_deceased IS 'Cat is known to be deceased';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'sot_cats'
        AND column_name = 'deceased_date'
    ) THEN
        ALTER TABLE trapper.sot_cats ADD COLUMN deceased_date DATE;
        COMMENT ON COLUMN trapper.sot_cats.deceased_date IS 'Date of death (if known)';
    END IF;
END $$;

-- ============================================================
-- 7. Create Mortality Statistics Views
-- ============================================================

\echo 'Creating mortality statistics views...'

-- Overall survival rates by age category
CREATE OR REPLACE VIEW trapper.v_mortality_by_age AS
SELECT
    death_age_category,
    COUNT(*) AS deaths_recorded,
    COUNT(*) FILTER (WHERE death_cause = 'vehicle') AS vehicle_deaths,
    COUNT(*) FILTER (WHERE death_cause = 'predator') AS predator_deaths,
    COUNT(*) FILTER (WHERE death_cause = 'disease') AS disease_deaths,
    COUNT(*) FILTER (WHERE death_cause = 'euthanasia') AS euthanasia,
    COUNT(*) FILTER (WHERE death_cause = 'natural') AS natural_deaths,
    COUNT(*) FILTER (WHERE death_cause = 'unknown') AS unknown_cause,
    AVG(death_age_months)::NUMERIC(5,1) AS avg_age_months
FROM trapper.cat_mortality_events
WHERE death_age_category IS NOT NULL
GROUP BY death_age_category
ORDER BY
    CASE death_age_category
        WHEN 'kitten' THEN 1
        WHEN 'juvenile' THEN 2
        WHEN 'adult' THEN 3
        WHEN 'senior' THEN 4
        ELSE 5
    END;

COMMENT ON VIEW trapper.v_mortality_by_age IS
'Mortality statistics by age category for Beacon survival rate analysis.
Kitten (0-6mo) vs Adult (1-7yr) survival is key for Vortex model.';

-- Seasonal mortality patterns
CREATE OR REPLACE VIEW trapper.v_seasonal_mortality AS
SELECT
    death_year,
    death_month,
    CASE
        WHEN death_month IN (3, 4, 5) THEN 'spring'
        WHEN death_month IN (6, 7, 8) THEN 'summer'
        WHEN death_month IN (9, 10, 11) THEN 'fall'
        ELSE 'winter'
    END AS season,
    COUNT(*) AS deaths,
    COUNT(*) FILTER (WHERE death_age_category = 'kitten') AS kitten_deaths,
    COUNT(*) FILTER (WHERE death_age_category IN ('adult', 'senior')) AS adult_deaths,
    COUNT(*) FILTER (WHERE death_cause = 'vehicle') AS vehicle_deaths,
    COUNT(*) FILTER (WHERE death_cause = 'predator') AS predator_deaths
FROM trapper.cat_mortality_events
WHERE death_year IS NOT NULL
GROUP BY death_year, death_month
ORDER BY death_year DESC, death_month;

COMMENT ON VIEW trapper.v_seasonal_mortality IS
'Monthly mortality statistics for seasonal pattern analysis.
Helps identify high-risk periods (e.g., kitten season mortality).';

-- Per-place mortality for colony analysis
CREATE OR REPLACE VIEW trapper.v_place_mortality_stats AS
SELECT
    me.place_id,
    p.display_name AS place_name,
    COUNT(*) AS deaths_recorded,
    COUNT(*) FILTER (WHERE me.death_age_category = 'kitten') AS kitten_deaths,
    COUNT(*) FILTER (WHERE me.death_age_category IN ('adult', 'senior')) AS adult_deaths,
    MIN(me.death_date) AS first_death_recorded,
    MAX(me.death_date) AS last_death_recorded,
    -- Deaths in last 12 months
    COUNT(*) FILTER (
        WHERE me.death_date >= CURRENT_DATE - INTERVAL '12 months'
    ) AS deaths_last_12mo,
    -- Most common cause at this location
    MODE() WITHIN GROUP (ORDER BY me.death_cause) AS most_common_cause
FROM trapper.cat_mortality_events me
LEFT JOIN trapper.places p ON p.place_id = me.place_id
WHERE me.place_id IS NOT NULL
GROUP BY me.place_id, p.display_name;

COMMENT ON VIEW trapper.v_place_mortality_stats IS
'Per-place mortality statistics for colony survival analysis.
High mortality locations may indicate environmental hazards.';

-- ============================================================
-- 8. Create Beacon Survival Rate Calculator
-- ============================================================

\echo 'Creating survival rate calculator...'

CREATE OR REPLACE FUNCTION trapper.calculate_survival_rates(
    p_year INT DEFAULT NULL,
    p_place_id UUID DEFAULT NULL
)
RETURNS TABLE (
    age_category TEXT,
    total_at_risk INT,
    deaths_recorded INT,
    survival_rate_pct NUMERIC(5,2),
    mortality_rate_pct NUMERIC(5,2),
    avg_lifespan_months NUMERIC(5,1)
) AS $$
BEGIN
    -- This is a simplified calculation based on recorded deaths
    -- Full implementation would require cohort tracking
    RETURN QUERY
    WITH deaths AS (
        SELECT
            death_age_category,
            COUNT(*) AS death_count,
            AVG(death_age_months) AS avg_age
        FROM trapper.cat_mortality_events
        WHERE (p_year IS NULL OR death_year = p_year)
          AND (p_place_id IS NULL OR place_id = p_place_id)
        GROUP BY death_age_category
    ),
    at_risk AS (
        -- Estimate cats at risk based on clinic data
        -- Kittens: cats seen at clinic < 6 months old
        -- Adults: cats seen at clinic >= 12 months old
        SELECT
            CASE
                WHEN age_at_visit_months < 6 THEN 'kitten'
                WHEN age_at_visit_months < 12 THEN 'juvenile'
                WHEN age_at_visit_months < 84 THEN 'adult'
                ELSE 'senior'
            END AS age_cat,
            COUNT(DISTINCT cat_id) AS cats_seen
        FROM (
            SELECT
                a.cat_id,
                EXTRACT(YEAR FROM AGE(a.appointment_date, c.birth_date::DATE)) * 12 +
                EXTRACT(MONTH FROM AGE(a.appointment_date, c.birth_date::DATE)) AS age_at_visit_months
            FROM trapper.sot_appointments a
            JOIN trapper.sot_cats c ON c.cat_id = a.cat_id
            WHERE c.birth_date IS NOT NULL
              AND (p_year IS NULL OR EXTRACT(YEAR FROM a.appointment_date) = p_year)
        ) age_data
        WHERE age_at_visit_months IS NOT NULL
        GROUP BY 1
    )
    SELECT
        COALESCE(d.death_age_category, ar.age_cat) AS age_category,
        COALESCE(ar.cats_seen, 0)::INT AS total_at_risk,
        COALESCE(d.death_count, 0)::INT AS deaths_recorded,
        CASE
            WHEN ar.cats_seen > 0 THEN
                ROUND(((ar.cats_seen - COALESCE(d.death_count, 0))::NUMERIC / ar.cats_seen) * 100, 2)
            ELSE NULL
        END AS survival_rate_pct,
        CASE
            WHEN ar.cats_seen > 0 THEN
                ROUND((COALESCE(d.death_count, 0)::NUMERIC / ar.cats_seen) * 100, 2)
            ELSE NULL
        END AS mortality_rate_pct,
        d.avg_age::NUMERIC(5,1) AS avg_lifespan_months
    FROM deaths d
    FULL OUTER JOIN at_risk ar ON d.death_age_category = ar.age_cat
    WHERE COALESCE(d.death_age_category, ar.age_cat) IS NOT NULL
    ORDER BY
        CASE COALESCE(d.death_age_category, ar.age_cat)
            WHEN 'kitten' THEN 1
            WHEN 'juvenile' THEN 2
            WHEN 'adult' THEN 3
            WHEN 'senior' THEN 4
            ELSE 5
        END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.calculate_survival_rates IS
'Calculates survival rates by age category for Beacon.
Returns rates that can be compared to Vortex model defaults:
- Kitten survival: 25-50% (density dependent)
- Adult survival: 60-80% annually';

-- ============================================================
-- 9. Add Comments
-- ============================================================

COMMENT ON TABLE trapper.cat_mortality_events IS
'Tracks cat deaths for Beacon survival rate modeling.

Beacon Equation Context:
  N(t+1) = N(t) + Births - Deaths + Immigration - Emigration
  S_kitten = S_max - (S_max - S_min) × (N/K)

Key fields:
- death_cause: Categorized cause for analysis
- death_age_months/category: Age at death for survival curves
- place_id: Location for site-specific mortality patterns

Vortex Model Defaults (Boone 2019):
- Kitten survival (low density): 50%
- Kitten survival (high density): 25%
- Adult survival: 70% annually

Data Sources:
- KML notes: 233 mortality mentions
- Clinic euthanasia records
- Field observations (trappers)
- Intake/request reports';

-- ============================================================
-- 10. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Table created:'
SELECT
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'cat_mortality_events' AND table_schema = 'trapper') AS columns
FROM information_schema.tables
WHERE table_name = 'cat_mortality_events' AND table_schema = 'trapper';

\echo ''
\echo 'Indexes created:'
SELECT indexname FROM pg_indexes
WHERE tablename = 'cat_mortality_events' AND schemaname = 'trapper';

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
AND table_name IN ('v_mortality_by_age', 'v_seasonal_mortality', 'v_place_mortality_stats');

\echo ''
\echo 'sot_cats deceased columns:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper'
AND table_name = 'sot_cats'
AND column_name IN ('is_deceased', 'deceased_date');

\echo ''
SELECT 'MIG_290 Complete - Cat Mortality Events Ready for Beacon P3' AS status;
