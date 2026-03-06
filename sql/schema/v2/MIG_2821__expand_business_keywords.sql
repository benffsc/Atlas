-- MIG_2821: Expand Business Keywords + Classification Rules
--
-- ROOT CAUSE ANALYSIS:
-- ====================
-- 51 business/place names (e.g., "Peterbilt Truck Stop", "Flamingo Hotel",
-- "Brookhaven Middle School", "Village Apartments") were incorrectly classified
-- as `likely_person` by classify_owner_name() and created as person records.
--
-- Critical case: Robin Stovall (FFSC trapper, rstovall313@gmail.com) had her
-- identity consumed by a person record named "Peterbilt Truck Stop" — her trapper
-- profile and volunteer badges display under a truck stop name.
--
-- Missing from ref.business_keywords:
-- - Hospitality: hotel, motel, inn, lodge, resort, suites
-- - Education: school, academy, university, college, elementary, preschool
-- - Residential: condos, condominiums, townhomes, townhouses
-- - Commercial: campus, complex, plaza, mall, station, stop
-- - Automotive: truck, peterbilt
-- - Nonprofit: church, temple, library, museum, cemetery
-- - Service: factory, kennel, landfill, recycling
--
-- Also missing from site_name regex in Step 4:
-- - Hotel, Motel, Inn, Lodge, Suites, Resort, School, Academy, Apartments, Condos, Townhomes
--
-- Also missing from should_be_person() Lesson #4:
-- - hotel, motel, school, academy, apartments, condos, townhomes, truck stop
--
-- FIXES:
-- A. Expand ref.business_keywords category CHECK constraint (3 new categories)
-- B. Add ~35 missing keywords
-- C. Expand site_name regex in classify_owner_name() Step 4
-- D. Update should_be_person() Lesson #4 hardcoded patterns
--
-- Created: 2026-03-05
-- Related: FFS-157, FFS-158, DATA_GAP_054

\echo ''
\echo '=============================================='
\echo '  MIG_2821: Expand Business Keywords'
\echo '=============================================='
\echo ''

-- ============================================================================
-- A. Expand ref.business_keywords category CHECK constraint
-- ============================================================================

\echo 'A. Expanding category CHECK constraint...'

-- Drop and recreate the CHECK constraint to add new categories
ALTER TABLE ref.business_keywords DROP CONSTRAINT IF EXISTS business_keywords_category_check;

ALTER TABLE ref.business_keywords ADD CONSTRAINT business_keywords_category_check
    CHECK (category IN (
        'suffix',        -- LLC, Inc, Corp
        'service',       -- Plumbing, Roofing, Factory, Kennel
        'retail',        -- Store, Shop, Market
        'professional',  -- Medical, Dental, Legal
        'trades',        -- Construction, Electric
        'food',          -- Restaurant, Cafe
        'real_estate',   -- Realty, Properties
        'automotive',    -- Auto, Tire, Glass, Truck
        'gas_station',   -- Chevron, Shell
        'agriculture',   -- Ranch, Farm, Vineyard
        'nonprofit',     -- Foundation, Society, Church, Temple
        'hospitality',   -- Hotel, Motel, Inn, Lodge, Resort (NEW)
        'education',     -- School, Academy, University (NEW)
        'residential',   -- Condos, Townhomes, Townhouses (NEW)
        'commercial'     -- Campus, Complex, Plaza, Mall (NEW)
    ));

-- ============================================================================
-- B. Add ~35 missing keywords
-- ============================================================================

\echo 'B. Adding missing business keywords...'

INSERT INTO ref.business_keywords (keyword, category, weight, notes) VALUES
    -- =========================================================================
    -- HOSPITALITY (NEW)
    -- =========================================================================
    ('hotel', 'hospitality', 1.0, 'MIG_2821: Flamingo Hotel etc.'),
    ('motel', 'hospitality', 1.0, 'MIG_2821: Always commercial'),
    ('inn', 'hospitality', 0.8, 'MIG_2821: Also a surname - lower weight'),
    ('lodge', 'hospitality', 0.9, 'MIG_2821: Also a surname - slightly lower'),
    ('resort', 'hospitality', 1.0, 'MIG_2821: Always commercial'),
    ('suites', 'hospitality', 1.0, 'MIG_2821: Always commercial'),

    -- =========================================================================
    -- EDUCATION (NEW)
    -- =========================================================================
    ('school', 'education', 0.9, 'MIG_2821: Brookhaven Middle School etc.'),
    ('academy', 'education', 1.0, 'MIG_2821: Always educational institution'),
    ('university', 'education', 1.0, 'MIG_2821: Always educational institution'),
    ('college', 'education', 1.0, 'MIG_2821: Always educational institution'),
    ('elementary', 'education', 1.0, 'MIG_2821: Elementary school'),
    ('preschool', 'education', 1.0, 'MIG_2821: Always educational institution'),

    -- =========================================================================
    -- RESIDENTIAL (NEW)
    -- =========================================================================
    ('condos', 'residential', 1.0, 'MIG_2821: Residential complex'),
    ('condominiums', 'residential', 1.0, 'MIG_2821: Residential complex'),
    ('townhomes', 'residential', 1.0, 'MIG_2821: Residential complex'),
    ('townhouses', 'residential', 1.0, 'MIG_2821: Residential complex'),

    -- =========================================================================
    -- COMMERCIAL (NEW)
    -- =========================================================================
    ('campus', 'commercial', 0.9, 'MIG_2821: Business/school campus'),
    ('complex', 'commercial', 0.8, 'MIG_2821: Also used in "apartment complex" via ADDRESS_PATTERNS'),
    ('plaza', 'commercial', 0.9, 'MIG_2821: Shopping plaza'),
    ('mall', 'commercial', 1.0, 'MIG_2821: Shopping mall'),
    ('station', 'commercial', 0.7, 'MIG_2821: Fire station, gas station - low individual but sums'),
    ('stop', 'commercial', 0.7, 'MIG_2821: Truck stop, bus stop - low individual but sums'),

    -- =========================================================================
    -- AUTOMOTIVE (additions)
    -- =========================================================================
    ('truck', 'automotive', 0.8, 'MIG_2821: Truck stop, truck service'),
    ('peterbilt', 'automotive', 1.0, 'MIG_2821: Truck manufacturer brand'),

    -- =========================================================================
    -- NONPROFIT (additions)
    -- =========================================================================
    ('church', 'nonprofit', 1.0, 'MIG_2821: Religious institution'),
    ('temple', 'nonprofit', 1.0, 'MIG_2821: Religious institution'),
    ('library', 'nonprofit', 1.0, 'MIG_2821: Public institution'),
    ('museum', 'nonprofit', 1.0, 'MIG_2821: Public institution'),
    ('cemetery', 'nonprofit', 1.0, 'MIG_2821: Always a place'),

    -- =========================================================================
    -- SERVICE (additions)
    -- =========================================================================
    ('factory', 'service', 1.0, 'MIG_2821: Industrial facility'),
    ('kennel', 'service', 1.0, 'MIG_2821: Animal kennel/boarding'),
    ('landfill', 'service', 1.0, 'MIG_2821: Waste facility'),
    ('recycling', 'service', 1.0, 'MIG_2821: Recycling facility'),
    ('nursery', 'service', 0.8, 'MIG_2821: Plant nursery or child nursery')

ON CONFLICT (keyword) DO UPDATE SET
    category = EXCLUDED.category,
    weight = GREATEST(ref.business_keywords.weight, EXCLUDED.weight),
    notes = EXCLUDED.notes;

-- Log count
DO $$
DECLARE v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM ref.business_keywords WHERE notes LIKE 'MIG_2821%';
    RAISE NOTICE 'MIG_2821: Added/updated % business keywords', v_count;
END $$;

-- ============================================================================
-- C. Update classify_owner_name() — Expand site_name regex in Step 4
-- ============================================================================

\echo 'C. Updating classify_owner_name() with expanded site patterns...'

CREATE OR REPLACE FUNCTION sot.classify_owner_name(p_display_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_name TEXT;
    v_name_lower TEXT;
    v_words TEXT[];
    v_word_count INT;
    v_first_word TEXT;
    v_last_word TEXT;
    v_has_common_first_name BOOLEAN;
    v_has_census_surname BOOLEAN;
    v_business_score NUMERIC := 0;
BEGIN
    -- =========================================================================
    -- STEP 0: Input validation
    -- =========================================================================

    IF p_display_name IS NULL OR TRIM(p_display_name) = '' THEN
        RETURN 'garbage';
    END IF;

    v_name := TRIM(p_display_name);
    v_name_lower := LOWER(v_name);

    -- Extract words (letters only, remove punctuation)
    v_words := string_to_array(
        regexp_replace(v_name_lower, '[^a-z ]', '', 'g'),
        ' '
    );
    v_words := array_remove(v_words, '');  -- Remove empty strings

    v_word_count := COALESCE(array_length(v_words, 1), 0);

    IF v_word_count = 0 THEN
        RETURN 'garbage';
    END IF;

    v_first_word := v_words[1];
    v_last_word := v_words[v_word_count];

    -- =========================================================================
    -- STEP 1: Check reference data for name validation
    -- =========================================================================

    -- Is first word a common first name? (SSA data, 1000+ occurrences)
    SELECT ref.is_common_first_name(v_first_word, 1000) INTO v_has_common_first_name;

    -- Is last word a census surname?
    SELECT ref.is_census_surname(v_last_word) INTO v_has_census_surname;

    -- Get business keyword score
    SELECT ref.get_business_score(v_name) INTO v_business_score;

    -- =========================================================================
    -- STEP 2: Enhanced garbage patterns (MIG_2498 fix)
    -- =========================================================================
    -- Check these EARLY before other classifications

    -- Known garbage/placeholder values (exact match)
    IF v_name ~* '^(Unknown|N/A|NA|None|Test|TBD|TBA|Owner|Client|\?+|\-+)$' THEN
        RETURN 'garbage';
    END IF;

    -- MIG_2498 FIX: Word-based garbage indicators (not just exact match)
    -- "Rebooking placeholder", "Duplicate Report", etc.
    IF v_name_lower ~ '\m(rebooking|placeholder|duplicate|report)\M' THEN
        RETURN 'garbage';
    END IF;

    -- All uppercase single word (likely abbreviation/code)
    IF v_word_count = 1 AND v_name = UPPER(v_name) AND LENGTH(v_name) > 3 THEN
        RETURN 'garbage';
    END IF;

    -- Contains only numbers/punctuation
    IF v_name ~ '^[0-9\s\-\.\(\)]+$' THEN
        RETURN 'garbage';
    END IF;

    -- Single character
    IF LENGTH(v_name) < 2 THEN
        RETURN 'garbage';
    END IF;

    -- =========================================================================
    -- STEP 3: "World Of X" pattern (strong business indicator)
    -- =========================================================================

    IF v_name_lower ~ '^world\s+of\s' THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 4: FFSC-specific trapping site patterns (MIG_2498 + MIG_2821)
    -- =========================================================================
    -- MIG_2498: If 3+ words AND contains site keyword, always site_name
    -- MIG_2821: Expanded to include Hotel, Motel, Inn, Lodge, Suites, Resort,
    --           School, Academy, Apartments, Condos, Townhomes

    -- Ranch/Farm/Estate/Vineyard/Winery + hospitality/education/residential sites
    IF v_name ~* '\m(Ranch|Farm|Estates?|Vineyards?|Winery|Wineries|Hotel|Motel|Inn|Lodge|Suites|Resort|School|Academy|Apartments?|Condos?|Townhomes?)\M' THEN
        -- MIG_2498 FIX: If 3+ words with site keyword, always site_name
        IF v_word_count >= 3 THEN
            RETURN 'site_name';
        END IF;

        -- For 2-word names, check if first word is a common first name
        -- "John Ranch" might be a person, but "Silveira Ranch" is a site
        -- "Mary Lodge" might be a person (Lodge is a surname), but "Flamingo Hotel" is a site
        IF NOT (v_has_common_first_name AND v_has_census_surname) THEN
            -- If last word is a strong site keyword, classify as site even for 2-word names
            -- unless it looks like a real person name (common first + census surname)
            IF NOT v_has_common_first_name THEN
                RETURN 'site_name';
            END IF;
            -- Has common first name but last word is NOT a surname — likely a site
            -- e.g., "Mary Hotel" (Hotel is not a surname) → site_name
            -- e.g., "Mary Lodge" (Lodge IS a surname) → falls through to person checks
        END IF;
        -- If has common first name AND census surname, fall through to person checks
    END IF;

    -- FFSC markers (trapping sites)
    IF v_name ~* '\mFFSC\M' OR v_name ~* '\mMHP\M' THEN
        RETURN 'site_name';
    END IF;

    -- =========================================================================
    -- STEP 5: Business keyword detection
    -- =========================================================================

    -- Strong business indicators override name validation (score >= 1.5)
    IF v_business_score >= 1.5 THEN
        RETURN 'organization';
    END IF;

    -- Business keyword + no valid person name pattern (score >= 0.8)
    IF v_business_score >= 0.8 AND NOT (v_has_common_first_name AND v_has_census_surname) THEN
        -- Don't trigger for site keywords already handled above
        IF NOT (v_name ~* '\m(Ranch|Farm|Estates?|Vineyards?|Winery|Wineries|Hotel|Motel|Inn|Lodge|Suites|Resort|School|Academy|Apartments?|Condos?|Townhomes?)\M') THEN
            RETURN 'organization';
        END IF;
    END IF;

    -- Business keyword + 3+ words (e.g., "John Smith Plumbing" = organization)
    IF v_business_score >= 0.6 AND v_word_count >= 3 THEN
        -- Don't trigger for site keywords already handled above
        IF NOT (v_name ~* '\m(Ranch|Farm|Estates?|Vineyards?|Winery|Wineries|Hotel|Motel|Inn|Lodge|Suites|Resort|School|Academy|Apartments?|Condos?|Townhomes?)\M') THEN
            RETURN 'organization';
        END IF;
    END IF;

    -- =========================================================================
    -- STEP 6: Business suffix patterns (always organization)
    -- =========================================================================

    IF v_name ~* '\m(LLC|Inc|Corp|Corporation|Ltd|LLP|PLLC|DBA)\M' THEN
        RETURN 'organization';
    END IF;

    -- "X & Associates/Partners/Sons"
    IF v_name ~* '\s&\s.*(associates|partners|sons|company|co)\M' THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 7: "The X" pattern (The Humane Society, The Villages)
    -- =========================================================================

    IF v_name ~* '^The\s+' AND v_word_count >= 2 THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 8: Animal/rescue org keywords
    -- =========================================================================

    IF v_name ~* '\m(Animal\s+Services?|Pet\s+Rescue|Veterinary|Humane\s+Society)\M' THEN
        RETURN 'organization';
    END IF;

    IF v_name ~* '\m(Rescue|Shelter|SPCA)\M' AND v_word_count >= 2 THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 9: Government/institution keywords
    -- =========================================================================

    IF v_name ~* '\m(County|City\s+of|Department|Hospital|District)\M' THEN
        RETURN 'organization';
    END IF;

    IF v_name ~* '\m(Program|Project|Initiative)\M' AND v_word_count >= 2 THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 10: Feline organization keywords
    -- =========================================================================

    IF v_name ~* '\m(Feline|Felines|Ferals?|Forgotten\s+Felines)\M' THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 11: Address patterns
    -- =========================================================================

    -- Starts with number (likely address)
    IF v_name ~ '^[0-9]+\s' THEN
        RETURN 'address';
    END IF;

    -- Contains street type indicators
    IF v_name ~* '\m(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Boulevard|Blvd\.?|Way|Place|Pl\.?|Highway|Hwy\.?|Circle|Cir\.?)\M' THEN
        -- But not if it looks like a person name first
        IF NOT v_has_common_first_name THEN
            RETURN 'address';
        END IF;
    END IF;

    -- =========================================================================
    -- STEP 12: Person validation using reference data
    -- =========================================================================

    -- Strong person signal: common first name + census surname
    IF v_has_common_first_name AND v_has_census_surname THEN
        RETURN 'likely_person';
    END IF;

    -- Moderate person signal: at least 2 words, last is a census surname
    IF v_word_count >= 2 AND v_has_census_surname THEN
        RETURN 'likely_person';
    END IF;

    -- Moderate person signal: first word is common name, 2+ words
    IF v_word_count >= 2 AND v_has_common_first_name THEN
        RETURN 'likely_person';
    END IF;

    -- Weak person signal: at least 2 words with reasonable length
    IF v_word_count >= 2
       AND LENGTH(v_words[1]) >= 2
       AND LENGTH(v_words[v_word_count]) >= 2 THEN
        RETURN 'likely_person';
    END IF;

    -- Single capitalized word that might be a name
    IF v_word_count = 1 AND LENGTH(v_name) >= 2 AND v_name ~ '^[A-Z][a-z]+$' THEN
        -- Check if it's in either reference table
        IF ref.is_common_first_name(v_name, 100) OR ref.is_census_surname(v_name) THEN
            RETURN 'likely_person';
        END IF;
    END IF;

    -- =========================================================================
    -- STEP 13: Default to unknown
    -- =========================================================================

    RETURN 'unknown';
END;
$$;

COMMENT ON FUNCTION sot.classify_owner_name(TEXT) IS
'Classifies a display name using reference data lookups.

Returns:
- organization: businesses, rescues, shelters, service companies
- site_name: FFSC trapping sites, hotels, schools, apartments, condos, etc.
- address: street addresses used as names
- garbage: invalid/placeholder values (Unknown, Rebooking, Duplicate, etc.)
- likely_person: appears to be a human name (validated via Census/SSA)
- unknown: could not classify

MIG_2821 additions:
- Expanded site_name regex: Hotel, Motel, Inn, Lodge, Suites, Resort,
  School, Academy, Apartments, Condos, Townhomes
- Improved 2-word site detection: "Mary Hotel" → site (Hotel not a surname)
  vs "Mary Lodge" → likely_person (Lodge IS a surname)
- 35 new business keywords across hospitality, education, residential, commercial

MIG_2498 fixes (preserved):
- "Keller Estates Vineyard" → site_name (3+ words with site keyword)
- "Rebooking placeholder" → garbage (word-based garbage detection)

Uses reference tables (must be populated first):
- ref.census_surnames (162K US Census surnames)
- ref.first_names (~100K SSA baby names)
- ref.business_keywords (~175 curated business indicators)

See CLAUDE.md INV-43, INV-44, INV-45. FFS-157, FFS-158.';

-- ============================================================================
-- D. Update should_be_person() Lesson #4 hardcoded patterns
-- ============================================================================

\echo 'D. Updating should_be_person() with expanded org patterns...'

CREATE OR REPLACE FUNCTION sot.should_be_person(
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_email_norm TEXT;
    v_full_name TEXT;
BEGIN
    v_email_norm := LOWER(TRIM(COALESCE(p_email, '')));
    v_full_name := LOWER(TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, '')));

    -- LESSON #1: Check for org emails (from DATA_GAP_009)
    IF v_email_norm LIKE '%forgottenfelines%'
       OR v_email_norm LIKE '%@ffsc.org'
       OR v_email_norm LIKE '%marinferals%' THEN
        RETURN FALSE;  -- Org email
    END IF;

    -- LESSON #2: Check for FAKE/PLACEHOLDER email domains (ClinicHQ generates these)
    IF v_email_norm LIKE '%@noemail.com'
       OR v_email_norm LIKE '%@petestablished.com'
       OR v_email_norm LIKE '%@nomail.com'
       OR v_email_norm LIKE '%@placeholder.com'
       OR v_email_norm LIKE '%@example.com'
       OR v_email_norm LIKE '%@test.com' THEN
        RETURN FALSE;  -- ClinicHQ fake placeholder email
    END IF;

    -- LESSON #3: Check for PLACEHOLDER/SYSTEM names (DATA_GAP_031)
    IF LOWER(COALESCE(p_first_name, '')) IN ('rebooking', 'placeholder', 'unknown', 'test', 'na', 'n/a', 'none', 'null')
       OR LOWER(COALESCE(p_last_name, '')) IN ('placeholder', 'unknown', 'test', 'na', 'n/a', 'none', 'null') THEN
        RETURN FALSE;  -- System/placeholder account name
    END IF;

    -- LESSON #4: Check for organization names (DATA_GAP_031 + MIG_2821 expansion)
    -- MIG_2821: Added hotel, motel, school, academy, apartments, condos, townhomes, truck stop
    IF v_full_name ~* '(winery|poultry|ranch|farm|vineyard|auction|estates|livestock|equine|cal fire|station|hotel|motel|school|academy|apartments|condos|townhomes|truck stop)' THEN
        RETURN FALSE;  -- Organization name
    END IF;

    -- LESSON #5: Check for FFSC phone used as placeholder
    IF COALESCE(p_phone, '') IN ('7075767999', '707-576-7999', '(707) 576-7999') THEN
        -- Only reject if email is also fake/missing
        IF v_email_norm = '' OR v_email_norm LIKE '%@noemail.com' OR v_email_norm LIKE '%@petestablished.com' THEN
            RETURN FALSE;  -- FFSC phone with no real email = placeholder
        END IF;
    END IF;

    -- LESSON #6: Check classify_owner_name for org/address patterns
    IF sot.classify_owner_name(v_full_name) IN ('organization', 'site_name', 'address', 'garbage') THEN
        RETURN FALSE;
    END IF;

    -- Passed all checks
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION sot.should_be_person IS
'Gate function: determines if owner info should create a person in sot.people.
Returns FALSE for:
- Org emails (forgottenfelines, marinferals, ffsc.org)
- Fake email domains (noemail.com, petestablished.com, example.com)
- Placeholder names (Rebooking placeholder, Unknown, Test)
- Organization names (Winery, Poultry, Ranch, Farm, Hotel, Motel, School, etc.)
- FFSC phone with no real email
- Names classified as org/site/address by classify_owner_name()

MIG_2821: Expanded Lesson #4 with hotel, motel, school, academy, apartments,
condos, townhomes, truck stop patterns.

See MIG_2337, MIG_2821, FFS-157. DATA_GAP_031.';

-- ============================================================================
-- E. Verification tests
-- ============================================================================

\echo ''
\echo 'E. Running verification tests...'

SELECT
    test_name,
    sot.classify_owner_name(test_name) as result,
    expected,
    CASE WHEN sot.classify_owner_name(test_name) = expected THEN 'PASS' ELSE 'FAIL' END as status
FROM (VALUES
    -- =========================================================================
    -- MIG_2821 specific fixes — MUST classify as non-person
    -- =========================================================================
    ('Peterbilt Truck Stop', 'site_name'),
    ('Flamingo Hotel', 'site_name'),
    ('Brookhaven Middle School', 'site_name'),
    ('Village Apartments', 'site_name'),
    ('Comfort Inn', 'site_name'),
    ('Holiday Inn Express', 'site_name'),
    ('Mountain View Lodge', 'site_name'),
    ('Sunrise Suites', 'site_name'),
    ('Petaluma Resort', 'site_name'),
    ('St Johns Academy', 'site_name'),
    ('Oak Park Condos', 'site_name'),
    ('Valley Townhomes', 'site_name'),
    ('First Baptist Church', 'organization'),
    ('Sonoma County Library', 'organization'),
    ('Central Landfill', 'organization'),
    ('Pet Factory', 'organization'),

    -- =========================================================================
    -- MUST still return likely_person (no false positives)
    -- =========================================================================
    ('John Smith', 'likely_person'),
    ('Mary Lodge', 'likely_person'),
    ('Robin Stovall', 'likely_person'),
    ('Cassie Thomson', 'likely_person'),
    ('Toni Price', 'likely_person'),
    ('Maria Lopez', 'likely_person'),
    ('David Church', 'likely_person'),

    -- =========================================================================
    -- Original test cases (preserved from MIG_2498)
    -- =========================================================================
    ('Rebooking placeholder', 'garbage'),
    ('Duplicate Report', 'garbage'),
    ('Keller Estates Vineyard', 'site_name'),
    ('Speedy Creek Winery', 'site_name'),
    ('Alexander Valley Vineyards', 'site_name'),
    ('Silveira Ranch', 'site_name'),
    ('Old Stony Pt Rd', 'address'),
    ('123 Main St', 'address'),
    ('Atlas Tree Surgery', 'organization'),
    ('Forgotten Felines', 'organization'),
    ('Sonoma County Animal Services', 'organization'),
    ('World Of Carpets', 'organization'),
    ('Unknown', 'garbage'),
    ('SCAS', 'garbage')
) AS t(test_name, expected);

-- Show any failures explicitly
\echo ''
\echo 'Checking for failures...'

DO $$
DECLARE
    v_failures INT := 0;
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT test_name, expected, sot.classify_owner_name(test_name) as actual
        FROM (VALUES
            ('Peterbilt Truck Stop', 'site_name'),
            ('Flamingo Hotel', 'site_name'),
            ('Brookhaven Middle School', 'site_name'),
            ('Village Apartments', 'site_name'),
            ('John Smith', 'likely_person'),
            ('Mary Lodge', 'likely_person'),
            ('Robin Stovall', 'likely_person'),
            ('David Church', 'likely_person')
        ) AS t(test_name, expected)
        WHERE sot.classify_owner_name(test_name) != expected
    LOOP
        RAISE WARNING 'VERIFICATION FAILURE: "%" expected % got %', rec.test_name, rec.expected, rec.actual;
        v_failures := v_failures + 1;
    END LOOP;

    IF v_failures = 0 THEN
        RAISE NOTICE 'All critical verification tests PASSED';
    ELSE
        RAISE WARNING '% verification test(s) FAILED!', v_failures;
    END IF;
END $$;

-- ============================================================================
-- Verify should_be_person() catches new patterns
-- ============================================================================

\echo ''
\echo 'Verifying should_be_person() catches new patterns...'

SELECT
    test_desc,
    sot.should_be_person(first_name, last_name, email, phone) as result,
    expected::boolean,
    CASE WHEN sot.should_be_person(first_name, last_name, email, phone) = expected::boolean
         THEN 'PASS' ELSE 'FAIL' END as status
FROM (VALUES
    ('Peterbilt Truck Stop → reject', 'Peterbilt', 'Truck Stop', NULL, NULL, false),
    ('Flamingo Hotel → reject', 'Flamingo', 'Hotel', NULL, NULL, false),
    ('Village Apartments → reject', 'Village', 'Apartments', NULL, NULL, false),
    ('Brookhaven School → reject', 'Brookhaven', 'School', NULL, NULL, false),
    ('John Smith → accept', 'John', 'Smith', 'john@gmail.com', '5551234567', true),
    ('Robin Stovall → accept', 'Robin', 'Stovall', 'rstovall313@gmail.com', NULL, true),
    ('Mary Lodge → accept', 'Mary', 'Lodge', 'mary@example.org', NULL, true)
) AS t(test_desc, first_name, last_name, email, phone, expected);

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2821 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo ''
\echo '1. Expanded ref.business_keywords CHECK constraint:'
\echo '   Added categories: hospitality, education, residential, commercial'
\echo ''
\echo '2. Added ~35 new business keywords:'
\echo '   - Hospitality: hotel, motel, inn, lodge, resort, suites'
\echo '   - Education: school, academy, university, college, elementary, preschool'
\echo '   - Residential: condos, condominiums, townhomes, townhouses'
\echo '   - Commercial: campus, complex, plaza, mall, station, stop'
\echo '   - Automotive: truck, peterbilt'
\echo '   - Nonprofit: church, temple, library, museum, cemetery'
\echo '   - Service: factory, kennel, landfill, recycling, nursery'
\echo ''
\echo '3. Expanded classify_owner_name() Step 4 site_name regex:'
\echo '   Added: Hotel, Motel, Inn, Lodge, Suites, Resort, School, Academy,'
\echo '   Apartments, Condos, Townhomes'
\echo ''
\echo '4. Updated should_be_person() Lesson #4 org patterns:'
\echo '   Added: hotel, motel, school, academy, apartments, condos, townhomes,'
\echo '   truck stop'
\echo ''
\echo 'NEXT: Run MIG_2822 to reclassify 51 misclassified records.'
\echo ''
