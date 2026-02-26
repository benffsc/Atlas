-- MIG_2372: Create Business Keywords Reference Table
--
-- Curated list of business indicator keywords for name classification
-- Used to detect organization names that should not be created as people
--
-- See CLAUDE.md INV-43, DATA_GAP_033

-- ============================================================================
-- 1. Create business keywords table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ref.business_keywords (
    keyword TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN (
        'suffix',       -- LLC, Inc, Corp - very strong indicators
        'service',      -- Plumbing, Roofing - strong indicators
        'retail',       -- Store, Shop, Market
        'professional', -- Medical, Dental, Legal
        'trades',       -- Construction, Electric
        'food',         -- Restaurant, Cafe
        'real_estate',  -- Realty, Properties
        'automotive',   -- Auto, Tire, Glass
        'gas_station',  -- Chevron, Shell (brand names)
        'agriculture',  -- Ranch, Farm, Vineyard
        'nonprofit'     -- Foundation, Society
    )),
    weight NUMERIC(3,2) DEFAULT 1.0 CHECK (weight BETWEEN 0.1 AND 1.5),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_keywords_category
    ON ref.business_keywords (category);
CREATE INDEX IF NOT EXISTS idx_business_keywords_weight
    ON ref.business_keywords (weight DESC);

COMMENT ON TABLE ref.business_keywords IS
'Curated list of words that indicate a business/organization name.
Used by classify_owner_name() to detect pseudo-profiles.

Weight scale (affects classification confidence):
- 1.0: Strong indicator (standalone word = business)
- 0.7-0.9: Moderate indicator (needs context)
- 0.5-0.6: Weak indicator (ambiguous)

See CLAUDE.md INV-43, DATA_GAP_033.';

-- ============================================================================
-- 2. Seed business keywords
-- ============================================================================

INSERT INTO ref.business_keywords (keyword, category, weight, notes) VALUES
    -- =========================================================================
    -- BUSINESS SUFFIXES (very strong indicators - always organization)
    -- =========================================================================
    ('llc', 'suffix', 1.0, 'Limited Liability Company'),
    ('inc', 'suffix', 1.0, 'Incorporated'),
    ('corp', 'suffix', 1.0, 'Corporation'),
    ('corporation', 'suffix', 1.0, 'Full form'),
    ('co', 'suffix', 0.8, 'Company - sometimes part of names'),
    ('ltd', 'suffix', 1.0, 'Limited'),
    ('llp', 'suffix', 1.0, 'Limited Liability Partnership'),
    ('dba', 'suffix', 1.0, 'Doing Business As'),
    ('pllc', 'suffix', 1.0, 'Professional LLC'),

    -- =========================================================================
    -- SERVICE INDUSTRY (strong indicators)
    -- =========================================================================
    ('plumbing', 'service', 1.0, NULL),
    ('roofing', 'service', 1.0, NULL),
    ('landscaping', 'service', 1.0, NULL),
    ('construction', 'service', 1.0, NULL),
    ('painting', 'service', 0.9, 'Also an art form'),
    ('cleaning', 'service', 0.9, NULL),
    ('moving', 'service', 0.9, NULL),
    ('storage', 'service', 0.9, NULL),
    ('heating', 'service', 1.0, NULL),
    ('cooling', 'service', 1.0, NULL),
    ('hvac', 'service', 1.0, 'Heating/Ventilation/AC'),
    ('electric', 'trades', 1.0, NULL),
    ('electrical', 'trades', 1.0, NULL),
    ('fencing', 'service', 0.9, NULL),
    ('paving', 'service', 1.0, NULL),
    ('masonry', 'service', 1.0, NULL),
    ('concrete', 'service', 1.0, NULL),
    ('drywall', 'service', 1.0, NULL),
    ('insulation', 'service', 1.0, NULL),
    ('siding', 'service', 1.0, NULL),
    ('gutters', 'service', 1.0, NULL),
    ('pest', 'service', 0.9, 'Pest control'),
    ('locksmith', 'service', 1.0, NULL),
    ('towing', 'service', 1.0, NULL),
    ('welding', 'service', 1.0, NULL),
    ('machining', 'service', 1.0, NULL),
    ('printing', 'service', 0.9, NULL),
    ('signs', 'service', 0.9, NULL),
    ('graphics', 'service', 0.9, NULL),
    ('repair', 'service', 0.8, 'Common word'),
    ('repairs', 'service', 0.8, NULL),
    ('service', 'service', 0.6, 'Very common word - low weight'),
    ('services', 'service', 0.6, NULL),
    ('surgery', 'professional', 1.0, 'Tree surgery, etc.'),
    ('tree', 'service', 0.7, 'Tree service, tree surgery'),
    ('lawn', 'service', 0.8, 'Lawn care'),
    ('garden', 'service', 0.7, 'Garden service - also a name'),
    ('hauling', 'service', 1.0, NULL),
    ('demolition', 'service', 1.0, NULL),
    ('excavation', 'service', 1.0, NULL),

    -- =========================================================================
    -- RETAIL
    -- =========================================================================
    ('store', 'retail', 0.9, NULL),
    ('shop', 'retail', 0.8, 'Also in "coffee shop" names'),
    ('market', 'retail', 0.8, 'Also in place names'),
    ('carpets', 'retail', 1.0, NULL),
    ('carpet', 'retail', 0.9, NULL),
    ('flooring', 'retail', 1.0, NULL),
    ('windows', 'retail', 0.8, NULL),
    ('doors', 'retail', 0.8, NULL),
    ('tile', 'retail', 0.9, NULL),
    ('supply', 'retail', 0.9, NULL),
    ('supplies', 'retail', 0.9, NULL),
    ('warehouse', 'retail', 1.0, NULL),
    ('outlet', 'retail', 0.9, NULL),
    ('depot', 'retail', 0.9, NULL),

    -- =========================================================================
    -- PROFESSIONAL SERVICES
    -- =========================================================================
    ('dental', 'professional', 1.0, NULL),
    ('medical', 'professional', 1.0, NULL),
    ('legal', 'professional', 1.0, NULL),
    ('accounting', 'professional', 1.0, NULL),
    ('insurance', 'professional', 0.9, NULL),
    ('consulting', 'professional', 0.9, NULL),
    ('attorneys', 'professional', 1.0, NULL),
    ('lawyers', 'professional', 1.0, NULL),
    ('realty', 'real_estate', 1.0, NULL),
    ('properties', 'real_estate', 0.9, NULL),
    ('apartments', 'real_estate', 1.0, NULL),
    ('rentals', 'real_estate', 0.9, NULL),
    ('mortgage', 'real_estate', 1.0, NULL),

    -- =========================================================================
    -- FOOD SERVICE
    -- =========================================================================
    ('restaurant', 'food', 1.0, NULL),
    ('cafe', 'food', 0.9, NULL),
    ('diner', 'food', 1.0, NULL),
    ('bakery', 'food', 1.0, NULL),
    ('pizza', 'food', 0.9, NULL),
    ('grill', 'food', 0.8, 'Also a last name'),
    ('bar', 'food', 0.7, 'Also a last name'),
    ('tavern', 'food', 0.9, NULL),
    ('brewery', 'food', 1.0, NULL),
    ('winery', 'food', 1.0, NULL),
    ('distillery', 'food', 1.0, NULL),
    ('catering', 'food', 1.0, NULL),

    -- =========================================================================
    -- AUTOMOTIVE
    -- =========================================================================
    ('auto', 'automotive', 0.9, NULL),
    ('automotive', 'automotive', 1.0, NULL),
    ('tire', 'automotive', 1.0, NULL),
    ('tires', 'automotive', 1.0, NULL),
    ('glass', 'automotive', 0.8, 'Auto glass'),
    ('body', 'automotive', 0.6, 'Body shop'),
    ('collision', 'automotive', 1.0, NULL),
    ('transmission', 'automotive', 1.0, NULL),
    ('muffler', 'automotive', 1.0, NULL),
    ('brake', 'automotive', 0.9, NULL),
    ('brakes', 'automotive', 0.9, NULL),

    -- =========================================================================
    -- GAS STATIONS (brand names)
    -- =========================================================================
    ('chevron', 'gas_station', 1.0, 'Gas station brand'),
    ('shell', 'gas_station', 1.0, 'Gas station brand'),
    ('arco', 'gas_station', 1.0, 'Gas station brand'),
    ('texaco', 'gas_station', 1.0, 'Gas station brand'),
    ('exxon', 'gas_station', 1.0, 'Gas station brand'),
    ('mobil', 'gas_station', 1.0, 'Gas station brand'),
    ('valero', 'gas_station', 1.0, 'Gas station brand'),
    ('76', 'gas_station', 0.9, 'Union 76'),
    ('am/pm', 'gas_station', 1.0, 'ARCO AM/PM'),
    ('quickstop', 'gas_station', 1.0, NULL),

    -- =========================================================================
    -- AGRICULTURE / RURAL (FFSC-specific)
    -- =========================================================================
    ('ranch', 'agriculture', 1.0, 'Trapping site'),
    ('farm', 'agriculture', 1.0, 'Trapping site'),
    ('vineyard', 'agriculture', 1.0, 'Trapping site'),
    ('orchard', 'agriculture', 1.0, 'Trapping site'),
    ('dairy', 'agriculture', 1.0, NULL),
    ('poultry', 'agriculture', 1.0, 'Petaluma Poultry'),
    ('livestock', 'agriculture', 1.0, 'Livestock Auction'),
    ('auction', 'agriculture', 0.9, 'Livestock Auction'),

    -- =========================================================================
    -- NONPROFIT / ORGANIZATIONS
    -- =========================================================================
    ('foundation', 'nonprofit', 1.0, NULL),
    ('association', 'nonprofit', 1.0, NULL),
    ('society', 'nonprofit', 1.0, NULL),
    ('center', 'nonprofit', 0.8, 'Community center, etc.'),
    ('rescue', 'nonprofit', 1.0, 'Animal rescue'),
    ('shelter', 'nonprofit', 1.0, 'Animal shelter'),
    ('humane', 'nonprofit', 1.0, 'Humane Society'),
    ('spca', 'nonprofit', 1.0, 'SPCA'),
    ('animal', 'nonprofit', 0.8, 'Animal services'),
    ('pet', 'nonprofit', 0.7, 'Pet rescue'),
    ('feline', 'nonprofit', 1.0, 'Forgotten Felines'),
    ('felines', 'nonprofit', 1.0, 'Forgotten Felines'),
    ('ferals', 'nonprofit', 1.0, 'Marin Ferals'),

    -- =========================================================================
    -- RETAIL CHAINS (known to appear in FFSC data)
    -- =========================================================================
    ('safeway', 'retail', 1.0, 'Grocery chain'),
    ('costco', 'retail', 1.0, 'Warehouse club'),
    ('walmart', 'retail', 1.0, 'Retail chain'),
    ('target', 'retail', 0.8, 'Also a common word'),
    ('lowes', 'retail', 1.0, 'Home improvement'),
    ('homedepot', 'retail', 1.0, 'Home Depot')

ON CONFLICT (keyword) DO UPDATE SET
    category = EXCLUDED.category,
    weight = EXCLUDED.weight,
    notes = EXCLUDED.notes;

-- ============================================================================
-- 3. Helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION ref.get_business_score(p_name TEXT)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(bk.weight), 0)
    FROM ref.business_keywords bk
    WHERE LOWER(p_name) ~ ('\m' || bk.keyword || '\M');
$$;

COMMENT ON FUNCTION ref.get_business_score(TEXT) IS
'Returns the sum of business keyword weights found in the name.
Higher score = more likely to be a business.
Score >= 1.5: Very likely business
Score 0.8-1.5: Likely business (check context)
Score < 0.8: Probably not a business';

CREATE OR REPLACE FUNCTION ref.get_business_keywords_found(p_name TEXT)
RETURNS TEXT[]
LANGUAGE sql STABLE AS $$
    SELECT ARRAY_AGG(bk.keyword ORDER BY bk.weight DESC)
    FROM ref.business_keywords bk
    WHERE LOWER(p_name) ~ ('\m' || bk.keyword || '\M');
$$;

COMMENT ON FUNCTION ref.get_business_keywords_found(TEXT) IS
'Returns array of business keywords found in the name.
Useful for debugging classification decisions.';

CREATE OR REPLACE FUNCTION ref.is_business_name(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT ref.get_business_score(p_name) >= 0.8;
$$;

COMMENT ON FUNCTION ref.is_business_name(TEXT) IS
'Quick check if a name contains business keywords.
Returns TRUE if business score >= 0.8.';

-- ============================================================================
-- 4. Verification
-- ============================================================================

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM ref.business_keywords;

    ASSERT v_count >= 100, 'Should have at least 100 business keywords, got: ' || v_count;

    -- Test some known business names
    ASSERT ref.get_business_score('Atlas Tree Surgery') >= 1.0,
        'Atlas Tree Surgery should have high business score';
    ASSERT ref.get_business_score('World Of Carpets') >= 1.0,
        'World Of Carpets should have high business score';
    ASSERT ref.get_business_score('Petaluma Poultry') >= 1.0,
        'Petaluma Poultry should have high business score';

    -- Test some person names (should have low scores)
    ASSERT ref.get_business_score('John Smith') < 0.5,
        'John Smith should have low business score';
    ASSERT ref.get_business_score('Maria Lopez') < 0.5,
        'Maria Lopez should have low business score';

    RAISE NOTICE '=== MIG_2372 complete. Loaded % business keywords. ===', v_count;
END $$;
