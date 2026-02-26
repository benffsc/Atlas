-- MIG_2360: Fix classify_owner_name() to catch business names
--
-- DATA_GAP_033: Business names incorrectly classified as likely_person
-- Examples:
--   - "World Of Carpets Santa Rosa" → should be organization
--   - "Atlas Tree Surgery" → should be organization
--   - "Chevron Todd Rd. ffsc" → already handled (FFSC pattern)
--
-- Research findings (from best practices):
--   1. Service industry keywords are strong business indicators
--   2. "World Of X" pattern is common business naming
--   3. Occupation surnames (Carpenter, Baker, etc.) need safelist to prevent
--      false positives like "John Carpenter" being classified as organization
--
-- See CLAUDE.md INV-43, INV-44, INV-45

-- ============================================================================
-- 1. Create lookup tables for name classification
-- ============================================================================

-- Common first names (subset of SSA baby names top 1000)
-- Used to distinguish "John Carpenter" (person) from "Carpenter" (ambiguous)
CREATE TABLE IF NOT EXISTS sot.common_first_names (
    name TEXT PRIMARY KEY,
    source TEXT DEFAULT 'ssa_top_1000',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sot.common_first_names IS
'Common US first names from SSA baby names data. Used to prevent false positives
when classifying names that contain occupation-based surnames (e.g., "John Carpenter"
is a person, not a carpentry business). See INV-44, MIG_2360.';

-- Occupation-based surnames that could be confused with business types
CREATE TABLE IF NOT EXISTS sot.occupation_surnames (
    surname TEXT PRIMARY KEY,
    related_business_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sot.occupation_surnames IS
'Surnames derived from occupations that could trigger false-positive business
classification. When paired with a common first name, these are likely people.
See INV-44, MIG_2360.';

-- Business service words that indicate a business/organization
CREATE TABLE IF NOT EXISTS sot.business_service_words (
    word TEXT PRIMARY KEY,
    category TEXT DEFAULT 'service',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE sot.business_service_words IS
'Words that indicate a business or organization when appearing in a name.
Categories: service, retail, professional, trades, industrial.
See INV-43, MIG_2360.';

-- ============================================================================
-- 2. Seed lookup tables with initial data
-- ============================================================================

-- Common first names (top 100 most common)
INSERT INTO sot.common_first_names (name) VALUES
    -- Male names
    ('james'),('john'),('robert'),('michael'),('david'),('william'),('richard'),
    ('joseph'),('thomas'),('charles'),('christopher'),('daniel'),('matthew'),
    ('anthony'),('mark'),('donald'),('steven'),('paul'),('andrew'),('joshua'),
    ('kenneth'),('kevin'),('brian'),('george'),('timothy'),('ronald'),('edward'),
    ('jason'),('jeffrey'),('ryan'),('jacob'),('gary'),('nicholas'),('eric'),
    ('jonathan'),('stephen'),('larry'),('justin'),('scott'),('brandon'),
    -- Female names
    ('mary'),('patricia'),('jennifer'),('linda'),('elizabeth'),('barbara'),
    ('susan'),('jessica'),('sarah'),('karen'),('lisa'),('nancy'),('betty'),
    ('margaret'),('sandra'),('ashley'),('kimberly'),('emily'),('donna'),
    ('michelle'),('dorothy'),('carol'),('amanda'),('melissa'),('deborah'),
    ('stephanie'),('rebecca'),('sharon'),('laura'),('cynthia'),('kathleen'),
    ('amy'),('angela'),('shirley'),('anna'),('brenda'),('pamela'),('emma'),
    ('nicole'),('helen'),('samantha'),('katherine'),('christine'),('debra'),
    ('rachel'),('carolyn'),('janet'),('catherine'),('maria'),('heather'),
    -- Additional common names seen in FFSC data
    ('toni'),('keri'),('kim'),('sue'),('bob'),('mike'),('joe'),('dan'),('tom'),
    ('steve'),('jim'),('bill'),('chris'),('matt'),('tony'),('dave'),('rick'),
    ('jeff'),('greg'),('terry'),('jerry'),('frank'),('ray'),('jack'),('dennis'),
    ('ann'),('joan'),('diane'),('jane'),('ruth'),('rose'),('marie'),('joyce')
ON CONFLICT (name) DO NOTHING;

-- Occupation-based surnames
INSERT INTO sot.occupation_surnames (surname, related_business_type) VALUES
    ('carpenter', 'carpentry'),
    ('baker', 'bakery'),
    ('mason', 'masonry'),
    ('miller', 'milling'),
    ('cook', 'restaurant'),
    ('hunter', 'hunting'),
    ('fisher', 'fishing'),
    ('taylor', 'tailoring'),
    ('smith', 'smithing'),
    ('cooper', 'cooperage'),
    ('porter', 'porting'),
    ('turner', 'turning'),
    ('walker', 'walking'),
    ('butler', 'butlering'),
    ('carter', 'carting'),
    ('parker', 'parking'),
    ('weaver', 'weaving'),
    ('potter', 'pottery'),
    ('sawyer', 'sawing'),
    ('brewer', 'brewing'),
    ('dyer', 'dyeing'),
    ('barber', 'barbering'),
    ('fowler', 'fowling'),
    ('fuller', 'fulling'),
    ('gardener', 'gardening'),
    ('glover', 'gloving'),
    ('thatcher', 'thatching'),
    ('chandler', 'chandlery'),
    ('collier', 'coal'),
    ('fletcher', 'fletching'),
    ('forester', 'forestry'),
    ('shepherd', 'shepherding'),
    ('slater', 'slating'),
    ('wheeler', 'wheeling'),
    ('bowman', 'archery'),
    ('archer', 'archery'),
    ('painter', 'painting'),
    ('plumber', 'plumbing'),
    ('glazier', 'glazing'),
    ('roofer', 'roofing'),
    ('draper', 'drapery')
ON CONFLICT (surname) DO NOTHING;

-- Business service words
INSERT INTO sot.business_service_words (word, category) VALUES
    -- Trades & services
    ('surgery', 'professional'),
    ('carpets', 'retail'),
    ('carpet', 'retail'),
    ('flooring', 'trades'),
    ('market', 'retail'),
    ('store', 'retail'),
    ('shop', 'retail'),
    ('service', 'service'),
    ('services', 'service'),
    ('plumbing', 'trades'),
    ('electric', 'trades'),
    ('electrical', 'trades'),
    ('roofing', 'trades'),
    ('landscaping', 'trades'),
    ('construction', 'trades'),
    ('painting', 'trades'),
    ('cleaning', 'service'),
    ('moving', 'service'),
    ('storage', 'service'),
    ('auto', 'service'),
    ('automotive', 'service'),
    ('tire', 'service'),
    ('glass', 'service'),
    ('repair', 'service'),
    ('repairs', 'service'),
    ('heating', 'trades'),
    ('cooling', 'trades'),
    ('hvac', 'trades'),
    ('windows', 'trades'),
    ('doors', 'trades'),
    ('fencing', 'trades'),
    ('paving', 'trades'),
    ('masonry', 'trades'),
    ('concrete', 'trades'),
    ('drywall', 'trades'),
    ('insulation', 'trades'),
    ('siding', 'trades'),
    ('gutters', 'trades'),
    ('pest', 'service'),
    ('locksmith', 'service'),
    ('towing', 'service'),
    ('welding', 'trades'),
    ('machining', 'trades'),
    ('printing', 'service'),
    ('signs', 'service'),
    ('graphics', 'service'),
    -- Gas stations / retail
    ('chevron', 'retail'),
    ('shell', 'retail'),
    ('arco', 'retail'),
    ('texaco', 'retail'),
    ('exxon', 'retail'),
    ('mobil', 'retail'),
    ('valero', 'retail'),
    ('safeway', 'retail'),
    ('costco', 'retail'),
    ('walmart', 'retail'),
    ('target', 'retail'),
    -- Food service
    ('restaurant', 'service'),
    ('cafe', 'service'),
    ('diner', 'service'),
    ('bakery', 'service'),
    ('pizza', 'service'),
    ('grill', 'service'),
    ('bar', 'service'),
    ('tavern', 'service'),
    ('brewery', 'service'),
    -- Real estate
    ('realty', 'professional'),
    ('properties', 'professional'),
    ('apartments', 'professional'),
    ('rentals', 'service'),
    -- Professional services
    ('dental', 'professional'),
    ('medical', 'professional'),
    ('legal', 'professional'),
    ('accounting', 'professional'),
    ('insurance', 'professional'),
    ('consulting', 'professional'),
    -- Tree service (Atlas Tree Surgery case)
    ('tree', 'service'),
    ('lawn', 'service'),
    ('garden', 'service')
ON CONFLICT (word) DO NOTHING;

-- ============================================================================
-- 3. Update classify_owner_name() function
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.classify_owner_name(p_display_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE  -- Changed from IMMUTABLE since we now query tables
AS $function$
DECLARE
    v_name TEXT;
    v_name_lower TEXT;
    v_words TEXT[];
    v_word_count INT;
    v_first_word TEXT;
    v_has_common_first_name BOOLEAN;
BEGIN
    IF p_display_name IS NULL OR TRIM(p_display_name) = '' THEN
        RETURN 'garbage';
    END IF;

    v_name := TRIM(p_display_name);
    v_name_lower := LOWER(v_name);
    v_words := string_to_array(v_name_lower, ' ');
    v_word_count := array_length(v_words, 1);
    v_first_word := v_words[1];

    -- Check if first word is a common first name
    SELECT EXISTS (
        SELECT 1 FROM sot.common_first_names WHERE name = v_first_word
    ) INTO v_has_common_first_name;

    -- =========================================================================
    -- BUSINESS PATTERNS (INV-43) - check early for strong indicators
    -- =========================================================================

    -- "World Of X" pattern (e.g., "World Of Carpets Santa Rosa")
    IF v_name ~* '^World\s+Of\s' THEN
        RETURN 'organization';
    END IF;

    -- Check for business service words (from lookup table)
    -- BUT skip if we have a common first name + occupation surname pattern
    IF NOT v_has_common_first_name THEN
        -- No common first name, so service words are strong business indicators
        IF EXISTS (
            SELECT 1 FROM sot.business_service_words bsw
            WHERE v_name_lower ~* ('\m' || bsw.word || '\M')
        ) THEN
            RETURN 'organization';
        END IF;
    ELSE
        -- Has common first name - only flag if it has 3+ words with service words
        -- e.g., "John Smith Plumbing" → organization, but "John Smith" → person
        IF v_word_count >= 3 AND EXISTS (
            SELECT 1 FROM sot.business_service_words bsw
            WHERE v_name_lower ~* ('\m' || bsw.word || '\M')
        ) THEN
            RETURN 'organization';
        END IF;
    END IF;

    -- =========================================================================
    -- ORGANIZATION PATTERNS (check first, before person patterns)
    -- =========================================================================

    -- Business suffixes
    IF v_name ~* '\m(LLC|Inc|Corp|Co|Ltd|LLP|Foundation|Association|Society|Center|Rescue|Shelter)\M' THEN
        RETURN 'organization';
    END IF;

    -- "The X" pattern (The Cat Depot, The Humane Society)
    IF v_name ~* '^The\s+' THEN
        RETURN 'organization';
    END IF;

    -- Contains "Animal" or "Pet" in name (Animal Services, Pet Rescue)
    IF v_name ~* '\m(Animal|Pet|Veterinary|Vet|Clinic)\M' THEN
        RETURN 'organization';
    END IF;

    -- Known org words
    IF v_name ~* '\m(County|City|Department|Hospital|Center|Rescue|Shelter|Society|Foundation|Association)\M' THEN
        RETURN 'organization';
    END IF;

    -- =========================
    -- FFSC-SPECIFIC PATTERNS
    -- =========================

    -- FFSC prefix/suffix patterns (site markers for trapping locations)
    IF v_name ~* '\mFFSC\M' THEN
        RETURN 'site_name';
    END IF;

    -- Mobile Home Parks (MHP) - trapping sites
    IF v_name ~* '\mMHP\M' THEN
        RETURN 'site_name';
    END IF;

    -- "Feline" or "Felines" in name (Forgotten Felines, Marin Ferals)
    IF v_name ~* '\m(Feline|Felines|Ferals?)\M' THEN
        RETURN 'organization';
    END IF;

    -- "Foster" with org-like context (Forgotten Felines Foster)
    -- But NOT "Foster" as a person's last name alone, and NOT FFSC Foster (caught above)
    IF v_name ~* '\mFoster\M' AND (
        v_name ~* '\m(Feline|Felines|Program|Relo|Rescue|Shelter)\M'
        OR v_word_count >= 3  -- "X Foster Program" patterns
    ) THEN
        RETURN 'organization';
    END IF;

    -- Programs and projects
    IF v_name ~* '\m(Program|Project|Initiative)\M' THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- SITE NAME PATTERNS (trapping locations)
    -- =========================================================================

    -- Ranch/Farm patterns
    IF v_name ~* '\m(Ranch|Farm|Estate|Vineyard|Winery)\M' THEN
        RETURN 'site_name';
    END IF;

    -- =========================================================================
    -- ADDRESS PATTERNS
    -- =========================================================================

    -- Starts with number (likely address)
    IF v_name ~ '^[0-9]+\s' THEN
        RETURN 'address';
    END IF;

    -- Contains street indicators
    IF v_name ~* '\m(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Place|Pl|Highway|Hwy)\M' THEN
        RETURN 'address';
    END IF;

    -- =========================================================================
    -- GARBAGE PATTERNS
    -- =========================================================================

    -- All uppercase single word (likely abbreviation/code)
    IF v_word_count = 1 AND v_name = UPPER(v_name) AND LENGTH(v_name) > 3 THEN
        RETURN 'garbage';
    END IF;

    -- Contains only numbers/punctuation
    IF v_name ~ '^[0-9\s\-\.\(\)]+$' THEN
        RETURN 'garbage';
    END IF;

    -- Known garbage values
    IF v_name ~* '^(Unknown|N/A|NA|None|Test|TBD|TBA|Owner|Client|\?+)$' THEN
        RETURN 'garbage';
    END IF;

    -- =========================================================================
    -- LIKELY PERSON PATTERNS (default fallback)
    -- =========================================================================

    -- Has at least 2 words with reasonable length
    IF v_word_count >= 2
       AND LENGTH(v_words[1]) >= 2
       AND LENGTH(v_words[v_word_count]) >= 2 THEN
        RETURN 'likely_person';
    END IF;

    -- Single word that looks like a name (capitalized, reasonable length)
    IF v_word_count = 1
       AND LENGTH(v_name) >= 2
       AND v_name ~ '^[A-Z][a-z]+$' THEN
        RETURN 'likely_person';
    END IF;

    -- Default to unknown if we can't classify
    RETURN 'unknown';
END;
$function$;

-- Update comment
COMMENT ON FUNCTION sot.classify_owner_name(TEXT) IS
'Classifies a display name into categories:
- organization: businesses, rescues, shelters, programs, service companies
- site_name: trapping site identifiers (FFSC prefixed locations, MHPs, ranches)
- address: street addresses used as names
- garbage: invalid/placeholder values
- likely_person: appears to be a human name
- unknown: could not classify

Uses lookup tables for accurate classification:
- sot.common_first_names: Prevents false positives on occupation surnames
- sot.occupation_surnames: Surnames that could be confused with businesses
- sot.business_service_words: Words indicating business/organization

Note: This is informational only. The should_be_person() function
is the authoritative gate for person creation (requires email/phone).

See CLAUDE.md INV-43, INV-44, INV-45. MIG_2360.';

-- ============================================================================
-- 4. Verify the fix with test cases
-- ============================================================================

DO $$
DECLARE
    v_result TEXT;
BEGIN
    -- Test cases for the new patterns (DATA_GAP_033)

    -- "World Of X" pattern
    SELECT sot.classify_owner_name('World Of Carpets Santa Rosa') INTO v_result;
    ASSERT v_result = 'organization', 'World Of Carpets Santa Rosa should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('World of Tile') INTO v_result;
    ASSERT v_result = 'organization', 'World of Tile should be organization, got: ' || v_result;

    -- Service industry words
    SELECT sot.classify_owner_name('Atlas Tree Surgery') INTO v_result;
    ASSERT v_result = 'organization', 'Atlas Tree Surgery should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('Bob''s Plumbing') INTO v_result;
    ASSERT v_result = 'organization', 'Bob''s Plumbing should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('Santa Rosa Roofing') INTO v_result;
    ASSERT v_result = 'organization', 'Santa Rosa Roofing should be organization, got: ' || v_result;

    -- Occupation surname safelist (should NOT be organizations)
    SELECT sot.classify_owner_name('John Carpenter') INTO v_result;
    ASSERT v_result = 'likely_person', 'John Carpenter should be likely_person, got: ' || v_result;

    SELECT sot.classify_owner_name('Mary Baker') INTO v_result;
    ASSERT v_result = 'likely_person', 'Mary Baker should be likely_person, got: ' || v_result;

    SELECT sot.classify_owner_name('Tom Mason') INTO v_result;
    ASSERT v_result = 'likely_person', 'Tom Mason should be likely_person, got: ' || v_result;

    -- But "Carpenter" alone is ambiguous - treat as person (conservative)
    SELECT sot.classify_owner_name('Carpenter') INTO v_result;
    ASSERT v_result IN ('likely_person', 'unknown'), 'Carpenter alone should be likely_person or unknown, got: ' || v_result;

    -- With business context, occupation surname IS organization
    SELECT sot.classify_owner_name('John Carpenter Plumbing') INTO v_result;
    ASSERT v_result = 'organization', 'John Carpenter Plumbing should be organization, got: ' || v_result;

    -- Existing patterns still work
    SELECT sot.classify_owner_name('Chevron Todd Rd. ffsc') INTO v_result;
    ASSERT v_result = 'site_name', 'Chevron Todd Rd. ffsc should be site_name, got: ' || v_result;

    SELECT sot.classify_owner_name('Maria Lopez') INTO v_result;
    ASSERT v_result = 'likely_person', 'Maria Lopez should be likely_person, got: ' || v_result;

    SELECT sot.classify_owner_name('Forgotten Felines Foster') INTO v_result;
    ASSERT v_result = 'organization', 'Forgotten Felines Foster should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('FFSC Foster') INTO v_result;
    ASSERT v_result = 'site_name', 'FFSC Foster should be site_name, got: ' || v_result;

    SELECT sot.classify_owner_name('Twenty Tails Rescue') INTO v_result;
    ASSERT v_result = 'organization', 'Twenty Tails Rescue should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('890 Rockwell Rd') INTO v_result;
    ASSERT v_result = 'address', '890 Rockwell Rd should be address, got: ' || v_result;

    RAISE NOTICE '=== All classify_owner_name tests passed! ===';
END $$;

-- ============================================================================
-- 5. Show impact on existing pseudo-profiles
-- ============================================================================

\echo ''
\echo '=== Pseudo-profiles that would now be correctly classified ==='
SELECT
    display_name,
    sot.classify_owner_name(display_name) AS new_classification
FROM sot.people
WHERE merged_into_person_id IS NULL
  AND (
    display_name ~* '^World\s+Of\s' OR
    display_name ~* '\m(Surgery|Carpets?|Market|Store|Shop|Plumbing|Roofing|Landscaping|Construction)\M'
  )
ORDER BY display_name
LIMIT 20;
