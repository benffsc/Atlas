-- MIG_2373: Updated classify_owner_name() Using Reference Tables
--
-- Replaces the hardcoded pattern matching with reference table lookups:
--   - ref.census_surnames (162K surnames)
--   - ref.first_names (~100K SSA names)
--   - ref.business_keywords (~120 curated keywords)
--
-- Dependencies: MIG_2370, MIG_2371, MIG_2372
--
-- See CLAUDE.md INV-43, INV-44, INV-45, DATA_GAP_033

-- ============================================================================
-- 1. Drop old helper tables from MIG_2360 (if they exist)
-- ============================================================================

-- These were temporary hardcoded tables; now replaced by ref.* tables
DROP TABLE IF EXISTS sot.common_first_names CASCADE;
DROP TABLE IF EXISTS sot.occupation_surnames CASCADE;
DROP TABLE IF EXISTS sot.business_service_words CASCADE;

-- ============================================================================
-- 2. Create the enhanced classify_owner_name function
-- ============================================================================

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
    -- STEP 2: "World Of X" pattern (strong business indicator)
    -- =========================================================================

    IF v_name_lower ~ '^world\s+of\s' THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 3: FFSC-specific trapping site patterns (check BEFORE business score)
    -- =========================================================================
    -- These are rural properties where FFSC does TNR, not businesses.
    -- Must check before business keywords since "ranch", "farm", etc. are in
    -- the business keywords table but have different meaning for FFSC.

    -- Ranch/Farm/Estate/Vineyard/Winery (trapping sites) - prioritize over business
    IF v_name ~* '\m(Ranch|Farm|Estate|Vineyard|Winery)\M' THEN
        -- If has common first name, might be a person (e.g., "John Ranch")
        IF v_has_common_first_name THEN
            -- Fall through to person checks
            NULL;
        ELSE
            RETURN 'site_name';
        END IF;
    END IF;

    -- FFSC markers (trapping sites)
    IF v_name ~* '\mFFSC\M' OR v_name ~* '\mMHP\M' THEN
        RETURN 'site_name';
    END IF;

    -- =========================================================================
    -- STEP 4: Business keyword detection
    -- =========================================================================

    -- Strong business indicators override name validation (score >= 1.5)
    IF v_business_score >= 1.5 THEN
        RETURN 'organization';
    END IF;

    -- Business keyword + no valid person name pattern (score >= 0.8)
    -- But exclude site keywords (ranch, farm, etc.) which were handled above
    IF v_business_score >= 0.8 AND NOT (v_has_common_first_name AND v_has_census_surname) THEN
        -- Don't trigger for site keywords that fell through due to first name
        IF NOT (v_name ~* '\m(Ranch|Farm|Estate|Vineyard|Winery)\M') THEN
            RETURN 'organization';
        END IF;
    END IF;

    -- Business keyword + 3+ words (e.g., "John Smith Plumbing" = organization)
    IF v_business_score >= 0.6 AND v_word_count >= 3 THEN
        -- Don't trigger for site keywords
        IF NOT (v_name ~* '\m(Ranch|Farm|Estate|Vineyard|Winery)\M') THEN
            RETURN 'organization';
        END IF;
    END IF;

    -- =========================================================================
    -- STEP 4: Business suffix patterns (always organization)
    -- =========================================================================

    IF v_name ~* '\m(LLC|Inc|Corp|Corporation|Ltd|LLP|PLLC|DBA)\M' THEN
        RETURN 'organization';
    END IF;

    -- "X & Associates/Partners/Sons"
    IF v_name ~* '\s&\s.*(associates|partners|sons|company|co)\M' THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 5: "The X" pattern (The Humane Society, The Villages)
    -- =========================================================================

    IF v_name ~* '^The\s+' AND v_word_count >= 2 THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 6: Animal/rescue org keywords
    -- =========================================================================

    IF v_name ~* '\m(Animal\s+Services?|Pet\s+Rescue|Veterinary|Humane\s+Society)\M' THEN
        RETURN 'organization';
    END IF;

    IF v_name ~* '\m(Rescue|Shelter|SPCA)\M' AND v_word_count >= 2 THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 7: Government/institution keywords
    -- =========================================================================

    IF v_name ~* '\m(County|City\s+of|Department|Hospital|District)\M' THEN
        RETURN 'organization';
    END IF;

    IF v_name ~* '\m(Program|Project|Initiative)\M' AND v_word_count >= 2 THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 8: Feline organization keywords
    -- =========================================================================
    -- (FFSC/MHP/Ranch/Farm checks moved to STEP 3 to run before business score)

    -- Feline organization keywords
    IF v_name ~* '\m(Feline|Felines|Ferals?|Forgotten\s+Felines)\M' THEN
        RETURN 'organization';
    END IF;

    -- =========================================================================
    -- STEP 9: Address patterns
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
    -- STEP 10: Garbage patterns
    -- =========================================================================

    -- All uppercase single word (likely abbreviation/code)
    IF v_word_count = 1 AND v_name = UPPER(v_name) AND LENGTH(v_name) > 3 THEN
        RETURN 'garbage';
    END IF;

    -- Contains only numbers/punctuation
    IF v_name ~ '^[0-9\s\-\.\(\)]+$' THEN
        RETURN 'garbage';
    END IF;

    -- Known garbage/placeholder values
    IF v_name ~* '^(Unknown|N/A|NA|None|Test|TBD|TBA|Owner|Client|Placeholder|Rebooking|\?+|\-+)$' THEN
        RETURN 'garbage';
    END IF;

    -- Single character
    IF LENGTH(v_name) < 2 THEN
        RETURN 'garbage';
    END IF;

    -- =========================================================================
    -- STEP 11: Person validation using reference data
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
    -- STEP 12: Default to unknown
    -- =========================================================================

    RETURN 'unknown';
END;
$$;

COMMENT ON FUNCTION sot.classify_owner_name(TEXT) IS
'Classifies a display name using reference data lookups.

Returns:
- organization: businesses, rescues, shelters, service companies
- site_name: FFSC trapping sites (ranches, farms, MHPs)
- address: street addresses used as names
- garbage: invalid/placeholder values
- likely_person: appears to be a human name (validated via Census/SSA)
- unknown: could not classify

Uses reference tables (must be populated first):
- ref.census_surnames (162K US Census surnames)
- ref.first_names (~100K SSA baby names)
- ref.business_keywords (~120 curated business indicators)

Note: This is informational only. The should_be_person() function
is the authoritative gate for person creation (requires email/phone).

See CLAUDE.md INV-43, INV-44, INV-45. DATA_GAP_033. MIG_2373.';

-- ============================================================================
-- 3. Create diagnostic function for debugging classifications
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.explain_name_classification(p_display_name TEXT)
RETURNS TABLE(
    input_name TEXT,
    classification TEXT,
    first_word TEXT,
    last_word TEXT,
    word_count INT,
    is_common_first_name BOOLEAN,
    is_census_surname BOOLEAN,
    business_score NUMERIC,
    business_keywords_found TEXT[]
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_name_lower TEXT;
    v_words TEXT[];
BEGIN
    v_name_lower := LOWER(TRIM(p_display_name));
    v_words := string_to_array(regexp_replace(v_name_lower, '[^a-z ]', '', 'g'), ' ');
    v_words := array_remove(v_words, '');

    RETURN QUERY SELECT
        p_display_name,
        sot.classify_owner_name(p_display_name),
        v_words[1],
        v_words[array_length(v_words, 1)],
        COALESCE(array_length(v_words, 1), 0),
        ref.is_common_first_name(v_words[1], 1000),
        ref.is_census_surname(v_words[array_length(v_words, 1)]),
        ref.get_business_score(p_display_name),
        ref.get_business_keywords_found(p_display_name);
END;
$$;

COMMENT ON FUNCTION sot.explain_name_classification(TEXT) IS
'Diagnostic function that explains why a name was classified a certain way.
Shows the reference data lookups and business keyword matches.
Useful for debugging unexpected classifications.';

-- ============================================================================
-- 4. Verification test cases
-- ============================================================================

DO $$
DECLARE
    v_result TEXT;
    v_test_cases RECORD;
BEGIN
    -- Only run tests if reference tables are populated
    IF NOT EXISTS (SELECT 1 FROM ref.census_surnames LIMIT 1) THEN
        RAISE NOTICE 'Skipping tests - census_surnames not yet populated. Run load scripts first.';
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM ref.first_names LIMIT 1) THEN
        RAISE NOTICE 'Skipping tests - first_names not yet populated. Run load scripts first.';
        RETURN;
    END IF;

    -- Test business patterns (DATA_GAP_033)
    SELECT sot.classify_owner_name('World Of Carpets Santa Rosa') INTO v_result;
    ASSERT v_result = 'organization', 'World Of Carpets should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('Atlas Tree Surgery') INTO v_result;
    ASSERT v_result = 'organization', 'Atlas Tree Surgery should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('Bob''s Plumbing') INTO v_result;
    ASSERT v_result = 'organization', 'Bob''s Plumbing should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('Santa Rosa Roofing') INTO v_result;
    ASSERT v_result = 'organization', 'Santa Rosa Roofing should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('Petaluma Poultry') INTO v_result;
    ASSERT v_result = 'organization', 'Petaluma Poultry should be organization, got: ' || v_result;

    -- Test occupation surname safelist (INV-44)
    SELECT sot.classify_owner_name('John Carpenter') INTO v_result;
    ASSERT v_result = 'likely_person', 'John Carpenter should be likely_person, got: ' || v_result;

    SELECT sot.classify_owner_name('Mary Baker') INTO v_result;
    ASSERT v_result = 'likely_person', 'Mary Baker should be likely_person, got: ' || v_result;

    SELECT sot.classify_owner_name('Tom Mason') INTO v_result;
    ASSERT v_result = 'likely_person', 'Tom Mason should be likely_person, got: ' || v_result;

    SELECT sot.classify_owner_name('Michael Miller') INTO v_result;
    ASSERT v_result = 'likely_person', 'Michael Miller should be likely_person, got: ' || v_result;

    -- Test business + person pattern (3+ words)
    SELECT sot.classify_owner_name('John Carpenter Plumbing') INTO v_result;
    ASSERT v_result = 'organization', 'John Carpenter Plumbing should be organization, got: ' || v_result;

    -- Test existing patterns still work
    SELECT sot.classify_owner_name('Forgotten Felines') INTO v_result;
    ASSERT v_result = 'organization', 'Forgotten Felines should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('FFSC Foster') INTO v_result;
    ASSERT v_result = 'site_name', 'FFSC Foster should be site_name, got: ' || v_result;

    SELECT sot.classify_owner_name('Silveira Ranch') INTO v_result;
    ASSERT v_result = 'site_name', 'Silveira Ranch should be site_name, got: ' || v_result;

    SELECT sot.classify_owner_name('890 Rockwell Rd') INTO v_result;
    ASSERT v_result = 'address', '890 Rockwell Rd should be address, got: ' || v_result;

    SELECT sot.classify_owner_name('Unknown') INTO v_result;
    ASSERT v_result = 'garbage', 'Unknown should be garbage, got: ' || v_result;

    -- Test normal person names
    SELECT sot.classify_owner_name('Maria Lopez') INTO v_result;
    ASSERT v_result = 'likely_person', 'Maria Lopez should be likely_person, got: ' || v_result;

    SELECT sot.classify_owner_name('Sandra Brady') INTO v_result;
    ASSERT v_result = 'likely_person', 'Sandra Brady should be likely_person, got: ' || v_result;

    RAISE NOTICE '=== All classify_owner_name tests passed! ===';
END $$;

-- ============================================================================
-- 5. Show current pseudo-profiles that would be reclassified
-- ============================================================================

\echo ''
\echo '=== Pseudo-profiles that would now be correctly classified ==='
\echo '(Only runs if reference tables are populated)'

SELECT
    display_name,
    sot.classify_owner_name(display_name) AS new_classification,
    ref.get_business_score(display_name) AS business_score
FROM sot.people
WHERE merged_into_person_id IS NULL
  AND sot.classify_owner_name(display_name) IN ('organization', 'site_name', 'address', 'garbage')
ORDER BY ref.get_business_score(display_name) DESC
LIMIT 25;
