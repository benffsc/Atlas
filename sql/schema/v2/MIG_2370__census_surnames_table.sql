-- MIG_2370: Create Census Surnames Reference Table
--
-- US Census Bureau 2010 surnames dataset with 162,253 surnames
-- Used for:
--   1. Validating last names (is this a real surname?)
--   2. TF-IDF frequency weighting (common vs rare names)
--   3. Preventing false-positive business classification for occupation surnames
--
-- Source: https://www2.census.gov/topics/genealogy/2010surnames/names.zip
-- License: CC0 (Public Domain) - no restrictions
--
-- See CLAUDE.md INV-44, INV-45, DATA_GAP_033

-- ============================================================================
-- 1. Create ref schema for reference data
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ref;

COMMENT ON SCHEMA ref IS
'Reference data from official sources (US Census, SSA, etc.).
These tables contain static lookup data for name validation and classification.
See ATLAS_DATA_REMEDIATION_PLAN.md Phase 6.';

-- ============================================================================
-- 2. Create Census surnames table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref.census_surnames (
    name TEXT PRIMARY KEY,
    rank INTEGER,                     -- National rank by frequency (1 = most common)
    count INTEGER,                    -- Number of occurrences nationally
    prop100k NUMERIC(10,2),           -- Proportion per 100,000 population
    cum_prop100k NUMERIC(10,2),       -- Cumulative proportion per 100,000
    pct_white NUMERIC(5,2),           -- Percent Non-Hispanic White
    pct_black NUMERIC(5,2),           -- Percent Non-Hispanic Black
    pct_api NUMERIC(5,2),             -- Percent Asian/Pacific Islander
    pct_aian NUMERIC(5,2),            -- Percent American Indian/Alaska Native
    pct_2prace NUMERIC(5,2),          -- Percent Two or More Races
    pct_hispanic NUMERIC(5,2),        -- Percent Hispanic or Latino
    census_year INTEGER DEFAULT 2010,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_census_surnames_lower
    ON ref.census_surnames (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_census_surnames_rank
    ON ref.census_surnames (rank);
CREATE INDEX IF NOT EXISTS idx_census_surnames_count
    ON ref.census_surnames (count DESC);

COMMENT ON TABLE ref.census_surnames IS
'US Census Bureau 2010 surnames dataset. Contains 162,253 surnames
that occurred 100+ times in the 2010 Census.

Columns:
- name: Surname in UPPERCASE
- rank: National rank (1 = SMITH, 2 = JOHNSON, etc.)
- count: Number of people with this surname
- prop100k: Frequency per 100,000 people
- pct_*: Demographic breakdowns by race/ethnicity

Data loaded via: scripts/reference-data/load_census_surnames.sh
Source: https://www2.census.gov/topics/genealogy/2010surnames/names.zip
License: CC0 (Public Domain)

See CLAUDE.md INV-44, INV-45.';

-- ============================================================================
-- 3. Create occupation surnames view
-- ============================================================================

CREATE OR REPLACE VIEW ref.occupation_surnames AS
SELECT name, rank, count
FROM ref.census_surnames
WHERE LOWER(name) IN (
    -- Occupations that became common surnames
    'carpenter', 'baker', 'mason', 'miller', 'cook', 'hunter', 'fisher',
    'taylor', 'smith', 'cooper', 'porter', 'turner', 'walker', 'butler',
    'carter', 'parker', 'weaver', 'potter', 'sawyer', 'brewer', 'dyer',
    'barber', 'fowler', 'fuller', 'gardener', 'glover', 'thatcher',
    'chandler', 'collier', 'fletcher', 'forester', 'shepherd', 'slater',
    'wheeler', 'bowman', 'archer', 'painter', 'plumber', 'glazier',
    'roofer', 'draper', 'farmer', 'marshall', 'tanner', 'hooper',
    'skinner', 'currier', 'dyer', 'nailor', 'cutler', 'saddler',
    'wainwright', 'cartwright', 'wheelwright'
);

COMMENT ON VIEW ref.occupation_surnames IS
'Surnames derived from occupations that could trigger false-positive
business classification. When these appear with a common first name
(e.g., "John Carpenter"), they should be classified as likely_person,
not organization. See CLAUDE.md INV-44.';

-- ============================================================================
-- 4. Helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION ref.is_census_surname(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM ref.census_surnames
        WHERE LOWER(name) = LOWER(TRIM(p_name))
    );
$$;

COMMENT ON FUNCTION ref.is_census_surname(TEXT) IS
'Returns TRUE if the given name is in the US Census surname list.
Uses case-insensitive matching.';

CREATE OR REPLACE FUNCTION ref.get_surname_rank(p_name TEXT)
RETURNS INTEGER
LANGUAGE sql STABLE AS $$
    SELECT rank FROM ref.census_surnames
    WHERE LOWER(name) = LOWER(TRIM(p_name));
$$;

COMMENT ON FUNCTION ref.get_surname_rank(TEXT) IS
'Returns the national rank of a surname (1 = most common).
Returns NULL if surname not found.';

CREATE OR REPLACE FUNCTION ref.is_occupation_surname(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM ref.occupation_surnames
        WHERE LOWER(name) = LOWER(TRIM(p_name))
    );
$$;

COMMENT ON FUNCTION ref.is_occupation_surname(TEXT) IS
'Returns TRUE if the surname is an occupation-derived name
(Carpenter, Baker, etc.) that needs safelist protection.
See CLAUDE.md INV-44.';

-- ============================================================================
-- 5. TF-IDF frequency weight function
-- ============================================================================

CREATE OR REPLACE FUNCTION ref.get_surname_frequency_weight(p_name TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_freq BIGINT;
    v_total BIGINT;
    v_idf NUMERIC;
BEGIN
    -- Get surname frequency
    SELECT count INTO v_freq
    FROM ref.census_surnames
    WHERE LOWER(name) = LOWER(TRIM(p_name));

    IF v_freq IS NULL THEN
        -- Unknown surname = rare = high weight (1.5)
        RETURN 1.5;
    END IF;

    -- Get total population (approximate from top surnames)
    -- Using 300 million as US population estimate
    v_total := 300000000;

    -- IDF calculation normalized to 0.5-1.5 range
    -- log(total/freq) / log(total) gives 0-1 range
    -- Scale to 0.5-1.5: rare names get bonus, common names get penalty
    v_idf := LN(v_total::NUMERIC / v_freq) / LN(v_total::NUMERIC);

    RETURN GREATEST(0.5, LEAST(1.5, 0.5 + v_idf));
END;
$$;

COMMENT ON FUNCTION ref.get_surname_frequency_weight(TEXT) IS
'Returns a TF-IDF style weight based on surname rarity.
- Very common names (Smith, Johnson): 0.5-0.7
- Average names: 0.8-1.0
- Rare names: 1.2-1.5
Used in identity resolution to reduce false positives on common names.
See ATLAS_DATA_REMEDIATION_PLAN.md section 6.6.';

-- ============================================================================
-- 6. Verification
-- ============================================================================

DO $$
BEGIN
    -- Verify table exists
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'ref' AND table_name = 'census_surnames'
    ), 'ref.census_surnames table should exist';

    -- Verify functions exist
    ASSERT EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_schema = 'ref' AND routine_name = 'is_census_surname'
    ), 'ref.is_census_surname function should exist';

    RAISE NOTICE '=== MIG_2370 complete. Run load_census_surnames.sh to populate data. ===';
END $$;
