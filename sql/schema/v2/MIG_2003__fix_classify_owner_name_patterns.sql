-- MIG_2003: Fix classify_owner_name() to catch more organization patterns
--
-- Gap 4: The function misclassifies some org/site patterns as likely_person:
--   - "Forgotten Felines Foster" → should be organization
--   - "FFSC Foster" → should be organization
--   - "FFSC Relo Program" → should be organization
--   - "Food Maxx RP ffsc" → should be site_name
--
-- Note: "should_be_person()" already correctly blocks these (no contact info),
-- but better classification improves ops.clinic_accounts.account_type.

CREATE OR REPLACE FUNCTION sot.classify_owner_name(p_display_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    v_name TEXT;
    v_words TEXT[];
    v_word_count INT;
BEGIN
    IF p_display_name IS NULL OR TRIM(p_display_name) = '' THEN
        RETURN 'garbage';
    END IF;

    v_name := TRIM(p_display_name);
    v_words := string_to_array(v_name, ' ');
    v_word_count := array_length(v_words, 1);

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
    IF v_name ~* '\m(County|City|Department|Services|Hospital|Center|Rescue|Shelter|Society|Foundation|Association)\M' THEN
        RETURN 'organization';
    END IF;

    -- =========================
    -- NEW PATTERNS (Gap 4 fix)
    -- =========================

    -- FFSC prefix/suffix patterns (site markers for trapping locations)
    -- "Food Maxx RP ffsc", "FFSC Woodcrest MHP", "FFSC Relo Program", "FFSC Foster"
    -- Check FFSC FIRST before other patterns since it's more specific
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

-- Add comment documenting the classification types
COMMENT ON FUNCTION sot.classify_owner_name(TEXT) IS
'Classifies a display name into categories:
- organization: businesses, rescues, shelters, programs
- site_name: trapping site identifiers (FFSC prefixed locations, MHPs)
- address: street addresses used as names
- garbage: invalid/placeholder values
- likely_person: appears to be a human name
- unknown: could not classify

Note: This is informational only. The should_be_person() function
is the authoritative gate for person creation (requires email/phone).';

-- Verify the fix
DO $$
DECLARE
    v_result TEXT;
BEGIN
    -- Test cases that should now be classified correctly
    SELECT sot.classify_owner_name('Forgotten Felines Foster') INTO v_result;
    ASSERT v_result = 'organization', 'Forgotten Felines Foster should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('FFSC Foster') INTO v_result;
    ASSERT v_result = 'site_name', 'FFSC Foster should be site_name, got: ' || v_result;

    SELECT sot.classify_owner_name('Food Maxx RP ffsc') INTO v_result;
    ASSERT v_result = 'site_name', 'Food Maxx RP ffsc should be site_name, got: ' || v_result;

    SELECT sot.classify_owner_name('FFSC Relo Program') INTO v_result;
    ASSERT v_result = 'site_name', 'FFSC Relo Program should be site_name, got: ' || v_result;

    SELECT sot.classify_owner_name('FFSC Woodcrest MHP') INTO v_result;
    ASSERT v_result = 'site_name', 'FFSC Woodcrest MHP should be site_name, got: ' || v_result;

    -- Ensure we didn't break existing patterns
    SELECT sot.classify_owner_name('Maria Lopez') INTO v_result;
    ASSERT v_result = 'likely_person', 'Maria Lopez should be likely_person, got: ' || v_result;

    SELECT sot.classify_owner_name('Twenty Tails Rescue') INTO v_result;
    ASSERT v_result = 'organization', 'Twenty Tails Rescue should be organization, got: ' || v_result;

    SELECT sot.classify_owner_name('890 Rockwell Rd') INTO v_result;
    ASSERT v_result = 'address', '890 Rockwell Rd should be address, got: ' || v_result;

    RAISE NOTICE 'All classify_owner_name tests passed!';
END $$;
