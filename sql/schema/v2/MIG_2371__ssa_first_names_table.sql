-- MIG_2371: Create SSA Baby Names Reference Table
--
-- Social Security Administration baby names dataset (1880-2024)
-- ~100,364 unique first names with frequency and gender data
-- Used for:
--   1. Validating first names (is this a real first name?)
--   2. Distinguishing "John Carpenter" (person) from "Carpenter" (ambiguous)
--   3. Gender inference for names (optional)
--
-- Source: https://www.ssa.gov/oact/babynames/names.zip
-- License: CC0 (Public Domain) - no restrictions
-- Updates: Released annually around Mother's Day
--
-- See CLAUDE.md INV-44, INV-45, DATA_GAP_033

-- ============================================================================
-- 1. Create aggregated first names table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref.first_names (
    name TEXT PRIMARY KEY,
    total_count BIGINT NOT NULL,           -- Sum across all years
    peak_year INTEGER,                      -- Year with highest count
    peak_count INTEGER,                     -- Count in peak year
    first_year INTEGER,                     -- First year name appeared
    last_year INTEGER,                      -- Most recent year with name
    male_count BIGINT DEFAULT 0,            -- Total male registrations
    female_count BIGINT DEFAULT 0,          -- Total female registrations
    is_primarily_male BOOLEAN,              -- >70% male usage
    is_primarily_female BOOLEAN,            -- >70% female usage
    is_unisex BOOLEAN,                      -- 30-70% either gender
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_first_names_lower
    ON ref.first_names (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_first_names_count
    ON ref.first_names (total_count DESC);
CREATE INDEX IF NOT EXISTS idx_first_names_male
    ON ref.first_names (is_primarily_male) WHERE is_primarily_male = TRUE;
CREATE INDEX IF NOT EXISTS idx_first_names_female
    ON ref.first_names (is_primarily_female) WHERE is_primarily_female = TRUE;

COMMENT ON TABLE ref.first_names IS
'SSA Baby Names aggregated from 1880-2024. Contains ~100,364 unique names.

Columns:
- name: First name as registered
- total_count: Sum of all registrations across all years
- peak_year/peak_count: When the name was most popular
- first_year/last_year: Range of years name was registered
- male_count/female_count: Breakdown by gender
- is_primarily_*: Gender classification flags

Note: Only names with 5+ occurrences per year are included (SSA privacy rule).

Data loaded via: scripts/reference-data/load_ssa_names.sh
Source: https://www.ssa.gov/oact/babynames/names.zip
License: CC0 (Public Domain)

See CLAUDE.md INV-44, INV-45.';

-- ============================================================================
-- 2. Create raw yearly data table (optional, for detailed analysis)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref.ssa_names_by_year (
    name TEXT NOT NULL,
    sex CHAR(1) NOT NULL CHECK (sex IN ('M', 'F')),
    year INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (name, sex, year)
);

CREATE INDEX IF NOT EXISTS idx_ssa_names_year
    ON ref.ssa_names_by_year (year);
CREATE INDEX IF NOT EXISTS idx_ssa_names_sex_year
    ON ref.ssa_names_by_year (sex, year);

COMMENT ON TABLE ref.ssa_names_by_year IS
'Raw SSA baby names data by year. Contains one row per name/sex/year combination.
Used for: temporal analysis, popularity trends, decade-specific validation.
Optional table - load only if detailed analysis needed.

Source: Individual yobYYYY.txt files from SSA download.';

-- ============================================================================
-- 3. Helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION ref.is_common_first_name(
    p_name TEXT,
    p_min_count INT DEFAULT 1000
)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM ref.first_names
        WHERE LOWER(name) = LOWER(TRIM(p_name))
        AND total_count >= p_min_count
    );
$$;

COMMENT ON FUNCTION ref.is_common_first_name(TEXT, INT) IS
'Returns TRUE if the name is a common first name in SSA data.
Default threshold: 1000+ total registrations across all years.
Adjust threshold based on use case:
- 1000: Common names (catches most real names)
- 10000: Very common names only
- 100: Include unusual but real names';

CREATE OR REPLACE FUNCTION ref.get_first_name_popularity(p_name TEXT)
RETURNS TABLE(
    total_count BIGINT,
    peak_year INTEGER,
    peak_count INTEGER,
    is_primarily_male BOOLEAN,
    is_primarily_female BOOLEAN,
    is_unisex BOOLEAN
)
LANGUAGE sql STABLE AS $$
    SELECT total_count, peak_year, peak_count,
           is_primarily_male, is_primarily_female, is_unisex
    FROM ref.first_names
    WHERE LOWER(name) = LOWER(TRIM(p_name));
$$;

COMMENT ON FUNCTION ref.get_first_name_popularity(TEXT) IS
'Returns popularity data for a first name including gender classification.
Returns NULL row if name not found.';

CREATE OR REPLACE FUNCTION ref.is_male_name(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(is_primarily_male, FALSE)
    FROM ref.first_names
    WHERE LOWER(name) = LOWER(TRIM(p_name));
$$;

CREATE OR REPLACE FUNCTION ref.is_female_name(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(is_primarily_female, FALSE)
    FROM ref.first_names
    WHERE LOWER(name) = LOWER(TRIM(p_name));
$$;

CREATE OR REPLACE FUNCTION ref.is_unisex_name(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(is_unisex, FALSE)
    FROM ref.first_names
    WHERE LOWER(name) = LOWER(TRIM(p_name));
$$;

-- ============================================================================
-- 4. Aggregation function (called after loading raw data)
-- ============================================================================

CREATE OR REPLACE FUNCTION ref.aggregate_ssa_names()
RETURNS TABLE(names_processed INT, names_inserted INT)
LANGUAGE plpgsql AS $$
DECLARE
    v_processed INT;
    v_inserted INT;
BEGIN
    -- Aggregate from raw yearly data
    INSERT INTO ref.first_names (
        name, total_count, peak_year, peak_count,
        first_year, last_year, male_count, female_count,
        is_primarily_male, is_primarily_female, is_unisex
    )
    SELECT
        name,
        SUM(count) as total_count,
        (ARRAY_AGG(year ORDER BY count DESC))[1] as peak_year,
        MAX(count) as peak_count,
        MIN(year) as first_year,
        MAX(year) as last_year,
        SUM(CASE WHEN sex = 'M' THEN count ELSE 0 END) as male_count,
        SUM(CASE WHEN sex = 'F' THEN count ELSE 0 END) as female_count,
        SUM(CASE WHEN sex = 'M' THEN count ELSE 0 END)::FLOAT /
            NULLIF(SUM(count), 0) > 0.7 as is_primarily_male,
        SUM(CASE WHEN sex = 'F' THEN count ELSE 0 END)::FLOAT /
            NULLIF(SUM(count), 0) > 0.7 as is_primarily_female,
        SUM(CASE WHEN sex = 'M' THEN count ELSE 0 END)::FLOAT /
            NULLIF(SUM(count), 0) BETWEEN 0.3 AND 0.7 as is_unisex
    FROM ref.ssa_names_by_year
    GROUP BY name
    ON CONFLICT (name) DO UPDATE SET
        total_count = EXCLUDED.total_count,
        peak_year = EXCLUDED.peak_year,
        peak_count = EXCLUDED.peak_count,
        last_year = EXCLUDED.last_year,
        male_count = EXCLUDED.male_count,
        female_count = EXCLUDED.female_count,
        is_primarily_male = EXCLUDED.is_primarily_male,
        is_primarily_female = EXCLUDED.is_primarily_female,
        is_unisex = EXCLUDED.is_unisex;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    SELECT COUNT(DISTINCT name) INTO v_processed FROM ref.ssa_names_by_year;

    RETURN QUERY SELECT v_processed, v_inserted;
END;
$$;

COMMENT ON FUNCTION ref.aggregate_ssa_names() IS
'Aggregates raw SSA names by year into the summary first_names table.
Call after loading data via load_ssa_names.sh.
Safe to call multiple times (uses UPSERT).';

-- ============================================================================
-- 5. Common nicknames mapping (optional enhancement)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref.name_nicknames (
    formal_name TEXT NOT NULL,
    nickname TEXT NOT NULL,
    PRIMARY KEY (formal_name, nickname)
);

-- Seed common nicknames
INSERT INTO ref.name_nicknames (formal_name, nickname) VALUES
    ('William', 'Bill'), ('William', 'Will'), ('William', 'Billy'), ('William', 'Willy'),
    ('Robert', 'Bob'), ('Robert', 'Rob'), ('Robert', 'Bobby'), ('Robert', 'Robbie'),
    ('Richard', 'Rick'), ('Richard', 'Dick'), ('Richard', 'Rich'), ('Richard', 'Ricky'),
    ('James', 'Jim'), ('James', 'Jimmy'), ('James', 'Jamie'),
    ('Michael', 'Mike'), ('Michael', 'Mikey'), ('Michael', 'Mick'),
    ('Thomas', 'Tom'), ('Thomas', 'Tommy'),
    ('Joseph', 'Joe'), ('Joseph', 'Joey'),
    ('Edward', 'Ed'), ('Edward', 'Eddie'), ('Edward', 'Ted'), ('Edward', 'Teddy'),
    ('Charles', 'Charlie'), ('Charles', 'Chuck'), ('Charles', 'Chas'),
    ('David', 'Dave'), ('David', 'Davey'),
    ('Daniel', 'Dan'), ('Daniel', 'Danny'),
    ('Matthew', 'Matt'), ('Matthew', 'Matty'),
    ('Anthony', 'Tony'),
    ('Christopher', 'Chris'), ('Christopher', 'Topher'),
    ('Nicholas', 'Nick'), ('Nicholas', 'Nicky'),
    ('Steven', 'Steve'), ('Stephen', 'Steve'),
    ('Elizabeth', 'Liz'), ('Elizabeth', 'Beth'), ('Elizabeth', 'Betty'), ('Elizabeth', 'Lizzy'),
    ('Jennifer', 'Jen'), ('Jennifer', 'Jenny'),
    ('Katherine', 'Kate'), ('Katherine', 'Katie'), ('Katherine', 'Kathy'),
    ('Catherine', 'Kate'), ('Catherine', 'Cathy'),
    ('Margaret', 'Maggie'), ('Margaret', 'Meg'), ('Margaret', 'Peggy'),
    ('Patricia', 'Pat'), ('Patricia', 'Patty'), ('Patricia', 'Trish'),
    ('Rebecca', 'Becky'), ('Rebecca', 'Becca'),
    ('Samantha', 'Sam'), ('Samantha', 'Sammy'),
    ('Alexandra', 'Alex'), ('Alexandra', 'Lexi'),
    ('Victoria', 'Vicky'), ('Victoria', 'Tori'),
    ('Christina', 'Chris'), ('Christina', 'Tina'),
    ('Kimberly', 'Kim'), ('Kimberly', 'Kimmy'),
    ('Stephanie', 'Steph'), ('Stephanie', 'Stephie'),
    ('Jessica', 'Jess'), ('Jessica', 'Jessie'),
    ('Deborah', 'Deb'), ('Deborah', 'Debbie'),
    ('Dorothy', 'Dot'), ('Dorothy', 'Dotty')
ON CONFLICT (formal_name, nickname) DO NOTHING;

COMMENT ON TABLE ref.name_nicknames IS
'Mapping of formal names to common nicknames.
Used for fuzzy name matching in identity resolution.
Example: "William Smith" could match "Bill Smith".';

-- ============================================================================
-- 6. Verification
-- ============================================================================

DO $$
BEGIN
    -- Verify tables exist
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'ref' AND table_name = 'first_names'
    ), 'ref.first_names table should exist';

    -- Verify functions exist
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_schema = 'ref' AND routine_name = 'is_common_first_name'
    ), 'ref.is_common_first_name function should exist';

    RAISE NOTICE '=== MIG_2371 complete. Run load_ssa_names.sh to populate data. ===';
END $$;
