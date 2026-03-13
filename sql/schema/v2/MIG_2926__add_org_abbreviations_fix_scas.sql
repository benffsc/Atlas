-- MIG_2926: Add org abbreviations to ref.business_keywords + fix SCAS data pollution
-- FFS-522: Org abbreviations like SCAS, HSSC not detected by classify_owner_name()
-- FFS-520: SCAS misclassified as person → entity linking chained 59 cats to 5050 Algiers Ave
--
-- Root cause chain:
--   1. "SCAS" not in ref.business_keywords → get_business_score() = 0
--   2. MIG_2498 moved garbage checks to Step 2 (BEFORE business score at Step 5)
--      classify_owner_name('SCAS') → Step 2 all-caps single word → 'garbage'
--   3. Even after adding keywords, garbage check fires first!
--   4. MIG_2048 marked is_organization=TRUE, but entity linking doesn't check that flag
--   5. link_cats_to_places() chains person→place→cat even for org persons
--   6. SCAS person at 5050 Algiers Ave → 59 cats falsely attributed
--
-- Fixes:
--   A. Add TNR org abbreviations to ref.business_keywords (weight 1.5)
--   A2. Fix classify_owner_name() Step 2 garbage check to consult business score first
--   B. Update is_excluded_from_cat_place_linking() to skip is_organization persons
--   C. Clean up SCAS person_place + cat_place links created via org person chain

BEGIN;

-- ============================================================================
-- A. Add TNR org abbreviations to ref.business_keywords
-- ============================================================================

\echo 'A. Adding org abbreviations to ref.business_keywords...'

INSERT INTO ref.business_keywords (keyword, category, weight, notes) VALUES
    ('scas',   'nonprofit', 1.5, 'Sonoma County Animal Services — frequently in ClinicHQ data'),
    ('hssc',   'nonprofit', 1.5, 'Humane Society of Sonoma County'),
    ('arlgp',  'nonprofit', 1.5, 'Animal Rescue League of Greater Portland'),
    ('snap',   'nonprofit', 1.5, 'Spay Neuter Assistance Program'),
    ('paws',   'nonprofit', 1.5, 'Various PAWS orgs (Pets Are Wonderful Support, etc.)'),
    ('aspca',  'nonprofit', 1.5, 'American Society for Prevention of Cruelty to Animals'),
    ('rpas',   'nonprofit', 1.5, 'Rohnert Park Animal Services'),
    ('lmfm',   'nonprofit', 1.5, 'Low-cost/Managed Feral Modified (SCAS waiver program)'),
    ('hbg',    'nonprofit', 1.5, 'Healdsburg — ClinicHQ shorthand for city animal services'),
    ('nbas',   'nonprofit', 1.5, 'North Bay Animal Services')
ON CONFLICT (keyword) DO NOTHING;

\echo '   Added org abbreviations'

-- Verify keywords added
DO $$
DECLARE
    v_score NUMERIC;
BEGIN
    v_score := ref.get_business_score('SCAS');
    IF v_score < 1.5 THEN
        RAISE EXCEPTION 'VERIFICATION FAILED: SCAS business score = %, expected >= 1.5', v_score;
    END IF;
    RAISE NOTICE 'Verified: SCAS business score = %', v_score;
END $$;

-- ============================================================================
-- A2. Fix classify_owner_name() Step 2 garbage check for uppercase abbreviations
-- ============================================================================
-- MIG_2498 moved garbage checks to Step 2 (BEFORE business score at Step 5).
-- The all-caps single word check catches org abbreviations like SCAS, HSSC before
-- they reach the business keyword check. Fix: consult business_score first.
-- Only the Step 2 garbage block changes — all other steps are identical.

\echo 'A2. Fixing classify_owner_name() uppercase abbreviation handling...'

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
    -- MIG_2926 FIX: Check business keywords first — org abbreviations like SCAS, HSSC
    -- should return 'organization', not 'garbage'
    IF v_word_count = 1 AND v_name = UPPER(v_name) AND LENGTH(v_name) > 3 THEN
        IF v_business_score >= 0.8 THEN
            RETURN 'organization';
        END IF;
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

    -- Starts with number (street address used as name)
    IF v_name ~ '^[0-9]+\s' THEN
        RETURN 'address';
    END IF;

    -- Contains street type words
    IF v_name ~* '\m(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Boulevard|Blvd\.?|Way|Place|Pl\.?|Highway|Hwy\.?|Circle|Cir\.?)\M' THEN
        IF NOT v_has_common_first_name THEN
            RETURN 'address';
        END IF;
    END IF;

    -- =========================================================================
    -- STEP 12: Person validation using reference data
    -- =========================================================================

    -- Strong: Both first name AND surname in reference data
    IF v_has_common_first_name AND v_has_census_surname THEN
        RETURN 'likely_person';
    END IF;

    -- Moderate: 2+ words and surname in reference data
    IF v_word_count >= 2 AND v_has_census_surname THEN
        RETURN 'likely_person';
    END IF;

    -- Moderate: 2+ words and first name in reference data
    IF v_word_count >= 2 AND v_has_common_first_name THEN
        RETURN 'likely_person';
    END IF;

    -- Weak: 2+ words with reasonable lengths
    IF v_word_count >= 2
       AND LENGTH(v_words[1]) >= 2
       AND LENGTH(v_words[v_word_count]) >= 2 THEN
        RETURN 'likely_person';
    END IF;

    -- Single capitalized word that might be a name
    IF v_word_count = 1 AND LENGTH(v_name) >= 2 AND v_name ~ '^[A-Z][a-z]+$' THEN
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
'Classifies a display name into: likely_person, organization, site_name, address, garbage, unknown.
Uses ref tables (census surnames, SSA names, business keywords) for data-driven classification.
MIG_2926: Fixed Step 2 uppercase abbreviation check to consult business_score before returning garbage.
Previously SCAS/HSSC/RPAS were classified as garbage despite being known org keywords.';

-- Verify classify_owner_name now catches SCAS
DO $$
BEGIN
    IF sot.classify_owner_name('SCAS') != 'organization' THEN
        RAISE EXCEPTION 'VERIFICATION FAILED: classify_owner_name(SCAS) = %, expected organization',
            sot.classify_owner_name('SCAS');
    END IF;
    RAISE NOTICE 'Verified: classify_owner_name(SCAS) = organization';

    -- Also verify normal garbage still works
    IF sot.classify_owner_name('XYZQ') != 'garbage' THEN
        RAISE EXCEPTION 'REGRESSION: classify_owner_name(XYZQ) = %, expected garbage',
            sot.classify_owner_name('XYZQ');
    END IF;
    RAISE NOTICE 'Verified: classify_owner_name(XYZQ) = garbage (no regression)';

    -- Verify normal person names still work
    IF sot.classify_owner_name('John Smith') != 'likely_person' THEN
        RAISE EXCEPTION 'REGRESSION: classify_owner_name(John Smith) = %, expected likely_person',
            sot.classify_owner_name('John Smith');
    END IF;
    RAISE NOTICE 'Verified: classify_owner_name(John Smith) = likely_person (no regression)';
END $$;

-- ============================================================================
-- B. Update is_excluded_from_cat_place_linking() to exclude organizations
-- ============================================================================

\echo ''
\echo 'B. Updating is_excluded_from_cat_place_linking() to exclude organizations...'

CREATE OR REPLACE FUNCTION sot.is_excluded_from_cat_place_linking(p_person_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  -- Returns TRUE if this person should be excluded from person→place→cat linking.
  -- Checks person_roles, trapper_profiles, AND is_organization flag.
  -- Colony caretakers intentionally NOT excluded — they genuinely manage colony locations.
  --
  -- MIG_2926/FFS-522: Added is_organization check. Org persons (SCAS, HSSC, etc.)
  -- should never create cat-place links via person chain.

  -- Check 0: Organizations are never valid for cat-place linking
  SELECT EXISTS (
    SELECT 1 FROM sot.people p
    WHERE p.person_id = p_person_id
      AND p.is_organization = TRUE
      AND p.merged_into_person_id IS NULL
  )
  OR EXISTS (
    -- Check 1: person_roles (expanded role list)
    SELECT 1 FROM sot.person_roles pr
    WHERE pr.person_id = p_person_id
      AND pr.role_status = 'active'
      AND pr.role IN ('staff', 'trapper', 'ffsc_trapper', 'community_trapper', 'head_trapper', 'coordinator')
  )
  OR EXISTS (
    -- Check 2: trapper_profiles (catches entries without person_roles)
    SELECT 1 FROM sot.trapper_profiles tp
    WHERE tp.person_id = p_person_id
      AND tp.is_active = TRUE
      AND tp.trapper_type NOT IN ('colony_caretaker')
  );
$$;

COMMENT ON FUNCTION sot.is_excluded_from_cat_place_linking IS
'FFS-449/FFS-522: Centralized check for whether a person should be excluded from
person→place→cat linking. Checks sot.person_roles, sot.trapper_profiles,
AND sot.people.is_organization flag.
Colony caretakers are intentionally NOT excluded — they genuinely manage colony locations.
MIG_2926: Added is_organization check to prevent org person chains (SCAS, HSSC, etc.).';

\echo '   Updated is_excluded_from_cat_place_linking()'

-- ============================================================================
-- C. Clean up SCAS and other org person chains
-- ============================================================================

\echo ''
\echo 'C. Cleaning up cat_place links created via organization person chains...'

-- C1: Find org persons that have person_place links (these are the problem)
DO $$
DECLARE
    v_org_count INT;
    v_cat_place_deleted INT := 0;
    v_person_place_deleted INT := 0;
    v_person_cat_deleted INT := 0;
    r RECORD;
BEGIN
    -- Count org persons with active place links
    SELECT COUNT(*) INTO v_org_count
    FROM sot.people p
    WHERE p.is_organization = TRUE
      AND p.merged_into_person_id IS NULL
      AND EXISTS (
          SELECT 1 FROM sot.person_place pp WHERE pp.person_id = p.person_id
      );

    RAISE NOTICE 'Found % organization persons with person_place links', v_org_count;

    -- C2: Delete cat_place links created via entity linking where the chain goes through an org person
    -- These are identifiable by: source_system = 'entity_linking' AND source_table = 'link_cats_to_places'
    -- AND the cat has a person_cat link to an org person at the same place
    DELETE FROM sot.cat_place cp
    WHERE cp.source_system = 'entity_linking'
      AND cp.source_table = 'link_cats_to_places'
      AND EXISTS (
          SELECT 1
          FROM sot.person_cat pc
          JOIN sot.people p ON p.person_id = pc.person_id
          JOIN sot.person_place pp ON pp.person_id = pc.person_id
          WHERE pc.cat_id = cp.cat_id
            AND pp.place_id = cp.place_id
            AND p.is_organization = TRUE
            AND p.merged_into_person_id IS NULL
      );
    GET DIAGNOSTICS v_cat_place_deleted = ROW_COUNT;
    RAISE NOTICE 'Deleted % cat_place links created via org person chains', v_cat_place_deleted;

    -- C3: Delete person_cat links where person is an org
    -- Orgs don't "own" or "caretake" cats — these links were created erroneously
    DELETE FROM sot.person_cat pc
    WHERE EXISTS (
        SELECT 1 FROM sot.people p
        WHERE p.person_id = pc.person_id
          AND p.is_organization = TRUE
          AND p.merged_into_person_id IS NULL
    )
    AND pc.source_system != 'atlas_ui';  -- Preserve any staff-created links
    GET DIAGNOSTICS v_person_cat_deleted = ROW_COUNT;
    RAISE NOTICE 'Deleted % person_cat links for org persons', v_person_cat_deleted;

    -- C4: Delete person_place links where person is an org AND type is 'resident'/'contact_address'
    -- Orgs might legitimately have 'works_at' or similar, but not 'resident'
    DELETE FROM sot.person_place pp
    WHERE pp.relationship_type IN ('resident', 'contact_address', 'owner', 'requester')
      AND EXISTS (
          SELECT 1 FROM sot.people p
          WHERE p.person_id = pp.person_id
            AND p.is_organization = TRUE
            AND p.merged_into_person_id IS NULL
      )
      AND pp.is_staff_verified = FALSE;  -- Never delete staff-verified links
    GET DIAGNOSTICS v_person_place_deleted = ROW_COUNT;
    RAISE NOTICE 'Deleted % residential person_place links for org persons', v_person_place_deleted;

    -- Summary
    RAISE NOTICE '';
    RAISE NOTICE '=== CLEANUP SUMMARY ===';
    RAISE NOTICE 'Org persons with place links: %', v_org_count;
    RAISE NOTICE 'Cat-place links removed:       %', v_cat_place_deleted;
    RAISE NOTICE 'Person-cat links removed:       %', v_person_cat_deleted;
    RAISE NOTICE 'Person-place links removed:     %', v_person_place_deleted;
END $$;

-- ============================================================================
-- D. Verify SCAS is no longer linked to 5050 Algiers Ave
-- ============================================================================

\echo ''
\echo 'D. Verifying SCAS cleanup...'

DO $$
DECLARE
    v_remaining INT;
BEGIN
    -- Check if any SCAS person still has residential place links
    SELECT COUNT(*) INTO v_remaining
    FROM sot.people p
    JOIN sot.person_place pp ON pp.person_id = p.person_id
    WHERE (p.display_name ILIKE '%SCAS%' OR p.first_name ILIKE 'SCAS')
      AND p.is_organization = TRUE
      AND p.merged_into_person_id IS NULL
      AND pp.relationship_type IN ('resident', 'contact_address');

    IF v_remaining > 0 THEN
        RAISE WARNING 'Still % SCAS residential links remaining (may be staff-verified)', v_remaining;
    ELSE
        RAISE NOTICE 'Verified: No SCAS residential place links remain';
    END IF;
END $$;

-- Show remaining org persons with any place links (for monitoring)
SELECT
    p.person_id,
    p.display_name,
    pp.relationship_type,
    pl.formatted_address,
    pp.is_staff_verified
FROM sot.people p
JOIN sot.person_place pp ON pp.person_id = p.person_id
JOIN sot.places pl ON pl.place_id = pp.place_id
WHERE p.is_organization = TRUE
  AND p.merged_into_person_id IS NULL
ORDER BY p.display_name
LIMIT 20;

\echo ''
\echo 'MIG_2926: Org abbreviations added, is_excluded_from_cat_place_linking updated, SCAS cleanup complete'

COMMIT;
