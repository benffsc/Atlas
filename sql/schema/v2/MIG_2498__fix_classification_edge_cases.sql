-- MIG_2498: Fix Classification Edge Cases
--
-- Fixes discovered during QRY_054 data quality audit:
--
-- 1. "Keller Estates Vineyard" → likely_person (should be site_name)
--    Root cause: "Keller" is in SSA first names, so site_name check falls through
--    Fix: If 3+ words AND contains Ranch/Farm/Estate/Vineyard/Winery, always site_name
--
-- 2. "Rebooking placeholder" → likely_person (should be garbage)
--    Root cause: Garbage pattern only catches exact matches
--    Fix: Add word-based garbage indicators
--
-- Created: 2026-02-24
-- Related: DATA_GAP_054, QRY_054

\echo ''
\echo '=============================================='
\echo '  MIG_2498: Fix Classification Edge Cases'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Update classify_owner_name() with edge case fixes
-- ============================================================================

\echo '1. Updating classify_owner_name() with edge case fixes...'

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
    -- STEP 4: FFSC-specific trapping site patterns (MIG_2498 fix)
    -- =========================================================================
    -- MIG_2498: Changed logic - if 3+ words AND contains site keyword, it's a site
    -- regardless of whether first word is a common first name.
    -- "Keller Estates Vineyard" (3 words + Vineyard) = site_name
    -- "John Ranch" (2 words) = still needs the first name check

    -- Ranch/Farm/Estate/Vineyard/Winery (trapping sites)
    -- Note: Using Estates? to match both Estate and Estates
    IF v_name ~* '\m(Ranch|Farm|Estates?|Vineyards?|Winery|Wineries)\M' THEN
        -- MIG_2498 FIX: If 3+ words with site keyword, always site_name
        -- This catches "Keller Estates Vineyard" even though Keller is a name
        IF v_word_count >= 3 THEN
            RETURN 'site_name';
        END IF;

        -- For 2-word names, check if first word is a common first name
        -- "John Ranch" might be a person, but "Silveira Ranch" is a site
        IF NOT v_has_common_first_name THEN
            RETURN 'site_name';
        END IF;
        -- If has common first name with 2 words, fall through to person checks
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
        -- Don't trigger for site keywords (handled above)
        IF NOT (v_name ~* '\m(Ranch|Farm|Estates?|Vineyards?|Winery|Wineries)\M') THEN
            RETURN 'organization';
        END IF;
    END IF;

    -- Business keyword + 3+ words (e.g., "John Smith Plumbing" = organization)
    IF v_business_score >= 0.6 AND v_word_count >= 3 THEN
        -- Don't trigger for site keywords (handled above)
        IF NOT (v_name ~* '\m(Ranch|Farm|Estates?|Vineyards?|Winery|Wineries)\M') THEN
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
- site_name: FFSC trapping sites (ranches, farms, MHPs, wineries, vineyards)
- address: street addresses used as names
- garbage: invalid/placeholder values (Unknown, Rebooking, Duplicate, etc.)
- likely_person: appears to be a human name (validated via Census/SSA)
- unknown: could not classify

MIG_2498 fixes:
- "Keller Estates Vineyard" now correctly → site_name (3+ words with site keyword)
- "Rebooking placeholder" now correctly → garbage (word-based garbage detection)
- Estates/Vineyards plural forms now matched

Uses reference tables (must be populated first):
- ref.census_surnames (162K US Census surnames)
- ref.first_names (~100K SSA baby names)
- ref.business_keywords (~140 curated business indicators)

See CLAUDE.md INV-43, INV-44, INV-45. DATA_GAP_033. MIG_2373, MIG_2498.';

-- ============================================================================
-- 2. Verification tests
-- ============================================================================

\echo ''
\echo '2. Running verification tests...'

SELECT
    test_name,
    sot.classify_owner_name(test_name) as result,
    expected,
    CASE WHEN sot.classify_owner_name(test_name) = expected THEN '✓' ELSE '✗ MISMATCH' END as status
FROM (VALUES
    -- MIG_2498 specific fixes
    ('Rebooking placeholder', 'garbage'),
    ('Duplicate Report', 'garbage'),
    ('Keller Estates Vineyard', 'site_name'),
    ('Speedy Creek Winery', 'site_name'),
    ('Alexander Valley Vineyards', 'site_name'),

    -- Original test cases (should still pass)
    ('Old Stony Pt Rd', 'address'),
    ('Grow Generation', 'organization'),  -- Needs MIG_2497 first!
    ('123 Main St', 'address'),
    ('5403 San Antonio Road Petaluma', 'address'),
    ('Atlas Tree Surgery', 'organization'),
    ('Cassie Thomson', 'likely_person'),
    ('Forgotten Felines', 'organization'),
    ('John Smith', 'likely_person'),
    ('Maria', 'likely_person'),
    ('Marin Humane', 'organization'),
    ('Mary Carpenter', 'likely_person'),
    ('SCAS', 'garbage'),
    ('Silveira Ranch', 'site_name'),
    ('Sonoma County Animal Services', 'organization'),
    ('Toni Price', 'likely_person'),
    ('Unknown', 'garbage'),
    ('World Of Carpets', 'organization')
) AS t(test_name, expected);

-- ============================================================================
-- 3. Retest the problematic cases from audit
-- ============================================================================

\echo ''
\echo '3. Detailed check of previously failing cases:'

SELECT * FROM sot.explain_name_classification('Keller Estates Vineyard');
SELECT * FROM sot.explain_name_classification('Rebooking placeholder');
SELECT * FROM sot.explain_name_classification('Speedy Creek Winery');

-- ============================================================================
-- 4. Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  MIG_2498 COMPLETE'
\echo '=============================================='
\echo ''
\echo 'Fixed edge cases in classify_owner_name():'
\echo ''
\echo '1. 3+ word names with site keywords (Ranch/Farm/Estate/Vineyard/Winery)'
\echo '   now always return site_name, even if first word is a common name.'
\echo '   Example: "Keller Estates Vineyard" → site_name (was: likely_person)'
\echo ''
\echo '2. Word-based garbage detection for placeholder patterns.'
\echo '   Patterns: rebooking, placeholder, duplicate, report'
\echo '   Example: "Rebooking placeholder" → garbage (was: likely_person)'
\echo ''
\echo '3. Added plural forms: Estates, Vineyards, Wineries'
\echo ''
\echo 'NOTE: "Grow Generation" still requires MIG_2497 to add the keyword.'
\echo ''
