-- ============================================================================
-- MIG_939: Duplicate Person Prevention and Cleanup
-- ============================================================================
-- Problem: 310 duplicate name groups affecting 699 person records, including
--          20+ same-name-same-address pairs not merged (e.g., Cristina Campbell
--          appears twice at 990 Borden Villa Dr).
--
-- Root Causes:
--   1. Org detection gaps - missing industry keywords (fitness, auto, spa, pet)
--   2. Tier 4 (same-name-same-address) not wired to prevention path
--
-- Solution:
--   Part 1: Add industry patterns to is_organization_or_address_name()
--   Part 2: Add patterns to known_organizations table
--   Part 3: Wire Tier 4 detection into data_engine_resolve_identity()
--   Part 4: Create detection function for same-name-same-address duplicates
--   Part 5: Create batch merge functions with dry-run support
--
-- References:
--   - MIG_931: Original org detection (is_organization_or_address_name)
--   - MIG_919: Data Engine gate (data_engine_resolve_identity)
--   - MIG_801: Person dedup audit (v_person_dedup_candidates, person_safe_to_merge)
--   - TASK_017 in TASK_LEDGER.md: Fellegi-Sunter research and phased roadmap
-- ============================================================================

\echo '=============================================='
\echo 'MIG_939: Duplicate Person Prevention & Cleanup'
\echo '=============================================='
\echo ''

-- ============================================================================
-- PART 1: Enhance is_organization_or_address_name() with Industry Keywords
-- ============================================================================

\echo 'Part 1: Adding industry patterns to org/address detector...'

CREATE OR REPLACE FUNCTION trapper.is_organization_or_address_name(p_display_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_name TEXT;
BEGIN
  v_name := TRIM(COALESCE(p_display_name, ''));

  -- Empty check
  IF v_name = '' THEN
    RETURN FALSE;
  END IF;

  -- ==========================================================================
  -- Address patterns (likely a place, not a person)
  -- ==========================================================================

  -- Starts with number + space (address like "890 Rockwell Rd")
  IF v_name ~ '^\d+ ' THEN
    RETURN TRUE;
  END IF;

  -- Contains street type suffixes
  IF v_name ~* '\s(rd\.?|road|st\.?|street|ave\.?|avenue|blvd\.?|boulevard|dr\.?|drive|ln\.?|lane|way|ct\.?|court|pl\.?|place|cir\.?|circle)\s*$' THEN
    RETURN TRUE;
  END IF;

  -- Contains street type in middle (like "890 Rockwell Rd. Unit 5")
  IF v_name ~* '\s(rd\.?|road|st\.?|street|ave\.?|avenue|blvd\.?|boulevard)\s' THEN
    RETURN TRUE;
  END IF;

  -- ==========================================================================
  -- Location/Place patterns
  -- ==========================================================================

  -- Parking, plaza, area, center keywords
  IF v_name ~* '(parking|plaza|area|center|centre|lot|complex|facility|building|terminal)' THEN
    RETURN TRUE;
  END IF;

  -- "The ..." pattern (like "The Villages", "The Meadows")
  IF v_name ~* '^the\s' AND v_name !~* '^the\s(great|good|real|original)\s' THEN
    -- Allow "The Great John" but catch "The Villages"
    IF v_name ~* '\s(village|meadow|park|garden|estate|ranch|farm|lodge|inn|resort|place|manor|court|terrace)s?\s*$' THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- ==========================================================================
  -- Business/Organization patterns
  -- ==========================================================================

  -- Corporate suffixes
  IF v_name ~* '\s(inc\.?|llc\.?|corp\.?|corporation|company|co\.?|ltd\.?|limited|enterprise|enterprises|group|partners|associates|services|service|supply|supplies|solutions|systems|industries|industry)\.?\s*$' THEN
    RETURN TRUE;
  END IF;

  -- Rescue/Shelter organizations
  IF v_name ~* '(rescue|shelter|humane|spca|animal\s+(control|services)|foster\s+program|sanctuary)' THEN
    RETURN TRUE;
  END IF;

  -- "... of ..." pattern often indicates organization
  IF v_name ~* '(friends|society|association|foundation|alliance|coalition)\s+of\s+' THEN
    RETURN TRUE;
  END IF;

  -- Transit/Government
  IF v_name ~* '(transit|transportation|county|city\s+of|state\s+of|department|district)' THEN
    RETURN TRUE;
  END IF;

  -- All caps name that's more than 2 words (usually an org, not a person)
  IF v_name = UPPER(v_name) AND v_name ~ '\s.*\s' AND LENGTH(v_name) > 15 THEN
    -- Three or more words, all caps, longer than 15 chars - likely an org
    RETURN TRUE;
  END IF;

  -- ==========================================================================
  -- MIG_939: Industry-Specific Business Patterns (NEW)
  -- ==========================================================================

  -- Fitness/Wellness - catches "Anytime Fitness Sr", "CrossFit Petaluma"
  IF v_name ~* '(fitness|gym|athletic|crossfit|cross\s*fit|workout|pilates|yoga|exercise|martial\s*arts|karate|jiu\s*jitsu)' THEN
    RETURN TRUE;
  END IF;

  -- Auto Services - catches "Downtown Auto Body", "Joe's Mechanic Shop"
  IF v_name ~* '(auto\s*body|body\s*shop|auto\s*repair|automotive|mechanic|tire\s|muffler|transmission|car\s*wash|lube|oil\s*change|smog)' THEN
    RETURN TRUE;
  END IF;

  -- Spa/Beauty/Wellness - catches "Sonoma Oasis", "Healing Touch Massage"
  IF v_name ~* '(oasis|spa\s|wellness|massage|salon|beauty|nails|barber|hair\s*cut|wax|tan|aesthetic|medi\s*spa)' THEN
    RETURN TRUE;
  END IF;

  -- Pet Services - catches "Happy Paws Grooming", "Doggy Day Care"
  IF v_name ~* '(grooming|pet\s*boarding|kennel|doggy|dog\s*day|cat\s*boarding|pet\s*sitting|pet\s*hotel|veterinar|vet\s*clinic)' THEN
    RETURN TRUE;
  END IF;

  -- Retail chains (common businesses that slip through)
  IF v_name ~* '(lowe''?s|home\s*depot|target|walmart|costco|safeway|trader\s*joe|whole\s*foods|cvs|walgreen|rite\s*aid)' THEN
    RETURN TRUE;
  END IF;

  -- Restaurants/Food (common in notes)
  IF v_name ~* '(restaurant|cafe|coffee|pizza|burger|taco|sushi|bakery|deli|bar\s*&\s*grill|pub|brewery|winery|vineyard)' THEN
    RETURN TRUE;
  END IF;

  -- Real Estate/Property
  IF v_name ~* '(real\s*estate|realty|property|apartment|condo|townhouse|mobile\s*home|rv\s*park|trailer\s*park|storage)' THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

COMMENT ON FUNCTION trapper.is_organization_or_address_name IS
'MIG_931+939: Detects if a display_name is likely an organization or address rather than a person.

Patterns checked (MIG_931 original):
- Address patterns: starts with number, street suffixes (Rd, St, Ave, etc.)
- Location keywords: parking, plaza, center, facility, building
- Corporate suffixes: Inc, LLC, Corp, Ltd, etc.
- Rescue/shelter organizations
- Transit/Government entities
- All-caps multi-word names

MIG_939 additions:
- Fitness/Wellness: fitness, gym, crossfit, yoga, pilates
- Auto Services: auto body, mechanic, car wash, smog
- Spa/Beauty: oasis, spa, salon, massage, barber
- Pet Services: grooming, kennel, pet boarding, vet clinic
- Retail Chains: Lowes, Home Depot, Target, Costco, etc.
- Restaurants: cafe, restaurant, brewery, winery
- Real Estate: realty, apartments, mobile home, storage

Used to flag records for review and prevent future bad entries.';

-- Verify the new patterns work
\echo ''
\echo 'Verifying new patterns...'

SELECT 'Anytime Fitness Sr' as test_name,
       trapper.is_organization_or_address_name('Anytime Fitness Sr') as detected,
       TRUE as expected;
SELECT 'Sonoma Oasis' as test_name,
       trapper.is_organization_or_address_name('Sonoma Oasis') as detected,
       TRUE as expected;
SELECT 'Downtown Auto Body' as test_name,
       trapper.is_organization_or_address_name('Downtown Auto Body') as detected,
       TRUE as expected;
SELECT 'Happy Paws Grooming' as test_name,
       trapper.is_organization_or_address_name('Happy Paws Grooming') as detected,
       TRUE as expected;
SELECT 'Cristina Campbell' as test_name,
       trapper.is_organization_or_address_name('Cristina Campbell') as detected,
       FALSE as expected;

-- ============================================================================
-- PART 2: Add Patterns to known_organizations Table
-- ============================================================================

\echo ''
\echo 'Part 2: Adding industry patterns to known_organizations...'

-- Fitness/Wellness
INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
  ('Fitness Center (generic)', '%Fitness%', 'business', 'MIG_939: Fitness centers, gyms'),
  ('Gym (generic)', '%Gym%', 'business', 'MIG_939: Gyms'),
  ('CrossFit (generic)', '%CrossFit%', 'business', 'MIG_939: CrossFit gyms'),
  ('Yoga Studio (generic)', '%Yoga%', 'business', 'MIG_939: Yoga studios'),
  ('Pilates Studio (generic)', '%Pilates%', 'business', 'MIG_939: Pilates studios')
ON CONFLICT DO NOTHING;

-- Auto Services
INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
  ('Auto Body Shop (generic)', '%Auto Body%', 'business', 'MIG_939: Auto body shops'),
  ('Body Shop (generic)', '%Body Shop%', 'business', 'MIG_939: Body shops'),
  ('Auto Repair (generic)', '%Auto Repair%', 'business', 'MIG_939: Auto repair shops'),
  ('Mechanic (generic)', '%Mechanic%', 'business', 'MIG_939: Mechanic shops'),
  ('Car Wash (generic)', '%Car Wash%', 'business', 'MIG_939: Car washes'),
  ('Smog Shop (generic)', '%Smog%', 'business', 'MIG_939: Smog check stations')
ON CONFLICT DO NOTHING;

-- Spa/Beauty
INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
  ('Oasis (generic)', '%Oasis%', 'hospitality', 'MIG_939: Spas with Oasis in name'),
  ('Spa (generic)', '% Spa%', 'hospitality', 'MIG_939: Spas'),
  ('Wellness Center (generic)', '%Wellness%', 'hospitality', 'MIG_939: Wellness centers'),
  ('Salon (generic)', '%Salon%', 'business', 'MIG_939: Hair/beauty salons'),
  ('Barber (generic)', '%Barber%', 'business', 'MIG_939: Barber shops')
ON CONFLICT DO NOTHING;

-- Pet Services
INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
  ('Pet Grooming (generic)', '%Grooming%', 'business', 'MIG_939: Pet grooming'),
  ('Kennel (generic)', '%Kennel%', 'business', 'MIG_939: Kennels'),
  ('Pet Boarding (generic)', '%Pet Boarding%', 'business', 'MIG_939: Pet boarding facilities'),
  ('Doggy Daycare (generic)', '%Doggy Day%', 'business', 'MIG_939: Doggy daycares'),
  ('Pet Hotel (generic)', '%Pet Hotel%', 'business', 'MIG_939: Pet hotels')
ON CONFLICT DO NOTHING;

-- Retail
INSERT INTO trapper.known_organizations (org_name, org_name_pattern, org_type, notes)
VALUES
  ('Lowes (generic)', '%Lowe%s%', 'business', 'MIG_939: Lowes stores'),
  ('Home Depot (generic)', '%Home Depot%', 'business', 'MIG_939: Home Depot stores'),
  ('Target (generic)', '%Target%', 'business', 'MIG_939: Target stores'),
  ('Walmart (generic)', '%Walmart%', 'business', 'MIG_939: Walmart stores'),
  ('Costco (generic)', '%Costco%', 'business', 'MIG_939: Costco stores')
ON CONFLICT DO NOTHING;

\echo 'Added industry patterns to known_organizations'

-- ============================================================================
-- PART 3: Wire Tier 4 Detection into data_engine_resolve_identity()
-- ============================================================================

\echo ''
\echo 'Part 3: Creating Tier 4 (same-name-same-address) check function...'

-- Create a helper function for Tier 4 matching that can be called from data_engine_resolve_identity
CREATE OR REPLACE FUNCTION trapper.check_tier4_same_name_same_address(
  p_display_name TEXT,
  p_address TEXT
) RETURNS TABLE (
  matched_person_id UUID,
  matched_name TEXT,
  matched_address TEXT,
  name_similarity FLOAT
) AS $$
DECLARE
  v_display_name TEXT;
  v_address_norm TEXT;
BEGIN
  -- Normalize inputs
  v_display_name := TRIM(COALESCE(p_display_name, ''));
  v_address_norm := UPPER(TRIM(COALESCE(p_address, '')));

  -- Skip if no name or address
  IF v_display_name = '' OR v_address_norm = '' THEN
    RETURN;
  END IF;

  -- Skip if name looks like an organization
  IF trapper.is_organization_or_address_name(v_display_name) THEN
    RETURN;
  END IF;

  -- Look for existing person with same name at same address
  RETURN QUERY
  SELECT
    p.person_id,
    p.display_name,
    pl.formatted_address,
    trapper.name_similarity(p.display_name, v_display_name)::FLOAT as name_sim
  FROM trapper.sot_people p
  JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
  JOIN trapper.places pl ON pl.place_id = ppr.place_id
  WHERE p.merged_into_person_id IS NULL
    AND p.display_name IS NOT NULL
    AND trapper.name_similarity(p.display_name, v_display_name) >= 0.85
    AND (
        -- Fuzzy address match using similarity
        SIMILARITY(UPPER(pl.formatted_address), v_address_norm) >= 0.7
        -- Or substring match for partial addresses
        OR UPPER(pl.formatted_address) ILIKE '%' || LEFT(v_address_norm, 20) || '%'
    )
  ORDER BY trapper.name_similarity(p.display_name, v_display_name) DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.check_tier4_same_name_same_address IS
'MIG_939: Tier 4 duplicate detection - finds existing person with same name at same address.

Called during identity resolution to prevent creating duplicates when:
- No email/phone match exists
- But person with same name already exists at the same address

Returns the matched person if found, allowing data_engine_resolve_identity to either:
- Return the existing person (auto-match)
- Queue for review (if confidence not high enough)

Skips org/address names to avoid false positives.';

-- ============================================================================
-- PART 3B: Update data_engine_resolve_identity() to use Tier 4 check
-- ============================================================================

\echo ''
\echo 'Part 3B: Wiring Tier 4 check into data_engine_resolve_identity()...'

CREATE OR REPLACE FUNCTION trapper.data_engine_resolve_identity(
    p_email TEXT,
    p_phone TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_address TEXT,
    p_source_system TEXT
)
RETURNS TABLE(
    decision_type TEXT,
    person_id UUID,
    display_name TEXT,
    confidence NUMERIC,
    reason TEXT,
    match_details JSONB,
    created_place_id UUID
) AS $$
DECLARE
    v_email_norm TEXT;
    v_phone_norm TEXT;
    v_display_name TEXT;
    v_address_norm TEXT;
    v_candidate RECORD;
    v_tier4_match RECORD;
    v_decision_type TEXT;
    v_reason TEXT;
    v_match_details JSONB;
    v_person_id UUID;
    v_place_id UUID;
    v_has_address_name_match BOOLEAN := FALSE;
    v_classification TEXT;
BEGIN
    -- Normalize inputs
    v_email_norm := LOWER(TRIM(COALESCE(p_email, '')));
    v_phone_norm := trapper.norm_phone_us(COALESCE(p_phone, ''));
    v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
    v_address_norm := UPPER(TRIM(COALESCE(p_address, '')));

    -- =========================================================================
    -- PHASE 0: CONSOLIDATED GATE (MIG_919)
    -- =========================================================================
    -- This is now the SINGLE place where we decide if this should be a person.
    -- All sources go through here: ClinicHQ, web_intake, ShelterLuv, JS scripts.
    --
    -- Uses should_be_person() which checks:
    --   1. Org email domains (@forgottenfelines.com, @forgottenfelines.org)
    --   2. Generic org prefixes (info@, office@, contact@, admin@, help@, support@)
    --   3. Soft-blacklisted emails with high threshold (require_name_similarity >= 0.9)
    --   4. Must have email OR phone
    --   5. Must have first name
    --   6. classify_owner_name() must return 'likely_person'
    -- =========================================================================

    IF NOT trapper.should_be_person(p_first_name, p_last_name, p_email, p_phone) THEN
        -- Build specific rejection reason for logging
        v_reason := 'Failed should_be_person() gate: ';

        -- Check which specific rule triggered rejection
        IF v_email_norm LIKE '%@forgottenfelines.com' OR v_email_norm LIKE '%@forgottenfelines.org' THEN
            v_reason := v_reason || 'FFSC organizational email';
        ELSIF v_email_norm LIKE 'info@%' OR v_email_norm LIKE 'office@%' OR v_email_norm LIKE 'contact@%'
              OR v_email_norm LIKE 'admin@%' OR v_email_norm LIKE 'help@%' OR v_email_norm LIKE 'support@%' THEN
            v_reason := v_reason || 'Generic organizational email prefix';
        ELSIF v_email_norm != '' AND EXISTS (
            SELECT 1 FROM trapper.data_engine_soft_blacklist
            WHERE identifier_norm = v_email_norm
              AND identifier_type = 'email'
              AND require_name_similarity >= 0.9
        ) THEN
            v_reason := v_reason || 'Soft-blacklisted organizational email';
        ELSIF (v_email_norm = '' OR v_email_norm IS NULL) AND (v_phone_norm = '' OR v_phone_norm IS NULL) THEN
            v_reason := v_reason || 'No email or phone provided';
        ELSIF p_first_name IS NULL OR TRIM(COALESCE(p_first_name, '')) = '' THEN
            v_reason := v_reason || 'No first name provided';
        ELSE
            -- Must be name classification rejection
            v_classification := trapper.classify_owner_name(v_display_name);
            CASE v_classification
                WHEN 'organization' THEN
                    v_reason := v_reason || 'Organization name detected: ' || v_display_name;
                WHEN 'address' THEN
                    v_reason := v_reason || 'Address pattern detected: ' || v_display_name;
                WHEN 'apartment_complex' THEN
                    v_reason := v_reason || 'Apartment complex name detected: ' || v_display_name;
                WHEN 'garbage' THEN
                    v_reason := v_reason || 'Garbage/test name detected: ' || v_display_name;
                ELSE
                    v_reason := v_reason || 'Classification: ' || COALESCE(v_classification, 'unknown');
            END CASE;
        END IF;

        -- Log the rejection to match decisions
        INSERT INTO trapper.data_engine_match_decisions (
            source_system, input_email, input_phone, input_name, input_address,
            decision_type, matched_person_id, confidence_score, match_rules, reason
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'rejected', NULL, 0.0, ARRAY['should_be_person_gate'], v_reason
        );

        -- Return rejection
        RETURN QUERY SELECT
            'rejected'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            0.0::NUMERIC,
            v_reason,
            jsonb_build_object(
                'gate', 'should_be_person',
                'email_checked', v_email_norm,
                'name_checked', v_display_name,
                'classification', trapper.classify_owner_name(v_display_name)
            ),
            NULL::UUID;
        RETURN;
    END IF;

    -- =========================================================================
    -- PHASE 1: LEGACY INTERNAL/TEST ACCOUNT CHECK
    -- =========================================================================
    -- Note: This is now largely redundant with Phase 0, but kept for defense-in-depth.
    -- should_be_person() already catches @forgottenfelines.com and @test.% patterns.
    -- =========================================================================

    -- Kept for backwards compatibility but most should be caught by Phase 0
    IF v_email_norm LIKE '%@test.%' OR v_email_norm LIKE 'test@%' THEN
        RETURN QUERY SELECT
            'rejected'::TEXT,
            NULL::UUID,
            NULL::TEXT,
            0.0::NUMERIC,
            'Test account'::TEXT,
            '{}'::JSONB,
            NULL::UUID;
        RETURN;
    END IF;

    -- =========================================================================
    -- PHASE 2+: EXISTING LOGIC (unchanged from MIG_896)
    -- =========================================================================

    -- Find or create place if address provided
    IF v_address_norm != '' THEN
        SELECT trapper.find_or_create_place_deduped(p_address, NULL, NULL, NULL, p_source_system)
        INTO v_place_id;
    END IF;

    -- Get best candidate from scoring function
    SELECT * INTO v_candidate
    FROM trapper.data_engine_score_candidates(
        NULLIF(v_email_norm, ''),
        NULLIF(v_phone_norm, ''),
        NULLIF(v_display_name, ''),
        NULLIF(v_address_norm, '')
    )
    LIMIT 1;

    -- MIG_896: Check if this is an address_name_similarity match
    IF v_candidate.person_id IS NOT NULL THEN
        v_has_address_name_match := 'address_name_similarity' = ANY(v_candidate.matched_rules);
    END IF;

    -- =========================================================================
    -- MIG_939: TIER 4 CHECK - Same name + same address (PREVENTION)
    -- =========================================================================
    -- This check runs when no email/phone match was found, but before creating
    -- a new person. It catches duplicates like Cristina Campbell (same name,
    -- same address, different phone numbers).
    -- =========================================================================

    IF v_candidate.person_id IS NULL AND v_display_name != '' AND v_address_norm != '' THEN
        -- Look for existing person with same name at same address
        SELECT * INTO v_tier4_match
        FROM trapper.check_tier4_same_name_same_address(v_display_name, p_address);

        IF v_tier4_match.matched_person_id IS NOT NULL THEN
            -- Found Tier 4 match! Route to review, return existing person
            v_decision_type := 'review_pending';
            v_reason := 'MIG_939: Same name + same address - possible duplicate of ' || v_tier4_match.matched_name;
            v_person_id := v_tier4_match.matched_person_id;  -- Return EXISTING person
            v_match_details := jsonb_build_object(
                'tier4_match', true,
                'matched_person_id', v_tier4_match.matched_person_id,
                'matched_name', v_tier4_match.matched_name,
                'name_similarity', v_tier4_match.name_similarity,
                'matched_address', v_tier4_match.matched_address
            );

            -- Log to potential duplicates for staff review
            INSERT INTO trapper.potential_person_duplicates (
                person_id, potential_match_id, match_type,
                new_name, existing_name, name_similarity,
                new_source_system, status, created_at
            ) VALUES (
                v_tier4_match.matched_person_id, v_tier4_match.matched_person_id, 'same_name_same_address',
                v_display_name, v_tier4_match.matched_name, v_tier4_match.name_similarity,
                p_source_system, 'pending', NOW()
            ) ON CONFLICT DO NOTHING;

            -- Log to match decisions
            INSERT INTO trapper.data_engine_match_decisions (
                source_system, input_email, input_phone, input_name, input_address,
                decision_type, matched_person_id, confidence_score, match_rules, reason
            ) VALUES (
                p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
                'review_pending', v_tier4_match.matched_person_id, v_tier4_match.name_similarity,
                ARRAY['tier4_same_name_same_address'], v_reason
            );

            -- Add new identifiers to existing person (if any)
            IF v_email_norm != '' AND NOT EXISTS (
                SELECT 1 FROM trapper.person_identifiers pi
                WHERE pi.person_id = v_tier4_match.matched_person_id
                AND pi.id_type = 'email' AND pi.id_value_norm = v_email_norm
            ) THEN
                INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
                VALUES (v_tier4_match.matched_person_id, 'email', p_email, v_email_norm, 0.7, p_source_system)
                ON CONFLICT DO NOTHING;
            END IF;

            IF v_phone_norm != '' AND NOT EXISTS (
                SELECT 1 FROM trapper.person_identifiers pi
                WHERE pi.person_id = v_tier4_match.matched_person_id
                AND pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
            ) THEN
                INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
                VALUES (v_tier4_match.matched_person_id, 'phone', p_phone, v_phone_norm, 0.7, p_source_system)
                ON CONFLICT DO NOTHING;
            END IF;

            RETURN QUERY SELECT
                v_decision_type,
                v_person_id,
                v_display_name,
                v_tier4_match.name_similarity::NUMERIC,
                v_reason,
                v_match_details,
                v_place_id;
            RETURN;
        END IF;
    END IF;

    -- Decision logic (original from MIG_919)
    IF v_candidate.person_id IS NULL THEN
        -- No match found - create new person
        v_decision_type := 'new_entity';
        v_reason := 'No matching person found';
        v_match_details := '{}'::JSONB;

        -- Create new person
        SELECT trapper.find_or_create_person(
            NULLIF(v_email_norm, ''),
            NULLIF(v_phone_norm, ''),
            p_first_name,
            p_last_name,
            p_address,
            p_source_system
        ) INTO v_person_id;

    ELSIF v_has_address_name_match THEN
        -- MIG_896: Address+name match found - ALWAYS route to review
        v_decision_type := 'review_pending';
        v_reason := 'Matched by address and name similarity - please verify identity (returning historical person)';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'matched_rules', v_candidate.matched_rules,
            'address_name_fallback', true
        );

        -- Log to match decisions
        INSERT INTO trapper.data_engine_match_decisions (
            source_system, input_email, input_phone, input_name, input_address,
            decision_type, matched_person_id, confidence_score, match_rules, reason
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'review_pending', v_candidate.person_id, v_candidate.total_score,
            v_candidate.matched_rules, v_reason
        );

    ELSIF v_candidate.total_score >= 0.95 THEN
        -- High confidence - auto match
        v_decision_type := 'auto_match';
        v_reason := 'High confidence match';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'matched_rules', v_candidate.matched_rules
        );

        -- Add new identifiers to existing person
        IF v_email_norm != '' AND NOT EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE pi.person_id = v_candidate.person_id
            AND pi.id_type = 'email' AND pi.id_value_norm = v_email_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_candidate.person_id, 'email', p_email, v_email_norm, 0.9, p_source_system)
            ON CONFLICT DO NOTHING;
        END IF;

        IF v_phone_norm != '' AND NOT EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE pi.person_id = v_candidate.person_id
            AND pi.id_type = 'phone' AND pi.id_value_norm = v_phone_norm
        ) THEN
            INSERT INTO trapper.person_identifiers (person_id, id_type, id_value_raw, id_value_norm, confidence, source_system)
            VALUES (v_candidate.person_id, 'phone', p_phone, v_phone_norm, 0.9, p_source_system)
            ON CONFLICT DO NOTHING;
        END IF;

        -- Link to place if not already linked
        IF v_place_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM trapper.person_place_relationships ppr
            WHERE ppr.person_id = v_candidate.person_id AND ppr.place_id = v_place_id
        ) THEN
            INSERT INTO trapper.person_place_relationships (person_id, place_id, role, confidence, source_system, source_table)
            VALUES (v_candidate.person_id, v_place_id, 'resident', 0.8, p_source_system, 'data_engine')
            ON CONFLICT DO NOTHING;
        END IF;

    ELSIF v_candidate.total_score >= 0.50 THEN
        -- Medium confidence - needs review
        v_decision_type := 'review_pending';
        v_reason := 'Medium confidence match - needs verification';
        v_person_id := v_candidate.person_id;
        v_match_details := jsonb_build_object(
            'matched_person_id', v_candidate.person_id,
            'matched_name', v_candidate.display_name,
            'score', v_candidate.total_score,
            'score_breakdown', v_candidate.score_breakdown,
            'matched_rules', v_candidate.matched_rules
        );

        -- Log to match decisions
        INSERT INTO trapper.data_engine_match_decisions (
            source_system, input_email, input_phone, input_name, input_address,
            decision_type, matched_person_id, confidence_score, match_rules, reason
        ) VALUES (
            p_source_system, v_email_norm, v_phone_norm, v_display_name, v_address_norm,
            'review_pending', v_candidate.person_id, v_candidate.total_score,
            v_candidate.matched_rules, v_reason
        );

    ELSIF v_candidate.is_household_candidate THEN
        -- Household member detection
        v_decision_type := 'household_member';
        v_reason := 'Possible household member at same address';

        -- Create new person and add to household
        SELECT trapper.find_or_create_person(
            NULLIF(v_email_norm, ''),
            NULLIF(v_phone_norm, ''),
            p_first_name,
            p_last_name,
            p_address,
            p_source_system
        ) INTO v_person_id;

        -- Add to household if one exists
        IF v_candidate.household_id IS NOT NULL THEN
            INSERT INTO trapper.household_members (household_id, person_id, role)
            VALUES (v_candidate.household_id, v_person_id, 'member')
            ON CONFLICT DO NOTHING;
        END IF;

        v_match_details := jsonb_build_object(
            'related_person_id', v_candidate.person_id,
            'household_id', v_candidate.household_id,
            'score', v_candidate.total_score
        );

    ELSE
        -- Low confidence - create new
        v_decision_type := 'new_entity';
        v_reason := 'Low confidence match - creating new person';
        v_match_details := jsonb_build_object(
            'nearest_match', v_candidate.person_id,
            'score', v_candidate.total_score
        );

        SELECT trapper.find_or_create_person(
            NULLIF(v_email_norm, ''),
            NULLIF(v_phone_norm, ''),
            p_first_name,
            p_last_name,
            p_address,
            p_source_system
        ) INTO v_person_id;
    END IF;

    RETURN QUERY SELECT
        v_decision_type,
        v_person_id,
        v_display_name,
        COALESCE(v_candidate.total_score, 0.0)::NUMERIC,
        v_reason,
        v_match_details,
        v_place_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_resolve_identity(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
'MIG_919+939: CONSOLIDATED IDENTITY GATE with TIER 4 PREVENTION

This function is the SINGLE FORTRESS for all identity resolution.
Every path to person creation goes through here:
  - ClinicHQ via process_clinichq_owner_info() → find_or_create_person()
  - Web Intake via create_person_from_intake() → find_or_create_person()
  - ShelterLuv via process_shelterluv_person() → find_or_create_person()
  - JS ingest scripts → find_or_create_person()
  - API routes → find_or_create_person()

Phase 0 (MIG_919): should_be_person() gate catches ALL rejectable inputs:
  - Org emails (@forgottenfelines.com, info@, office@, etc.)
  - Soft-blacklisted org emails
  - Location names (addresses, apartments, organizations)
  - No contact info (no email AND no phone)
  - No first name

Phase 1: Test account check

Phase 2: Scoring via data_engine_score_candidates()

MIG_939 ADDITION - Tier 4 Check:
  - Runs when no email/phone match found
  - Checks for existing person with same name at same address
  - If found: routes to review_pending, returns EXISTING person
  - Prevents duplicates like Cristina Campbell

Phase 3+: Decision logic (auto_match, review_pending, household, new_entity)

Invariants Enforced:
  INV-17: Organizational emails rejected at Phase 0
  INV-18: Location names rejected at Phase 0
  INV-19: Same-name-same-address triggers review (MIG_939)';

-- ============================================================================
-- PART 4: Create Detection Function for Existing Duplicates
-- ============================================================================

\echo ''
\echo 'Part 4: Creating duplicate detection function...'

CREATE OR REPLACE FUNCTION trapper.find_same_name_same_address_duplicates()
RETURNS TABLE(
  display_name TEXT,
  place_id UUID,
  formatted_address TEXT,
  person_count INT,
  person_ids UUID[],
  oldest_person_id UUID,
  merge_safety TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH base_data AS (
    -- Get unique person-place combinations with created_at for ordering
    SELECT DISTINCT ON (p.person_id, pl.place_id)
      p.display_name,
      p.person_id,
      p.created_at,
      pl.place_id,
      pl.formatted_address
    FROM trapper.sot_people p
    JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
    JOIN trapper.places pl ON pl.place_id = ppr.place_id
    WHERE p.merged_into_person_id IS NULL
      AND p.display_name IS NOT NULL
      AND p.display_name ~ ' '  -- Has space (first+last name)
      AND NOT trapper.is_organization_or_address_name(p.display_name)
  ),
  dupes AS (
    SELECT
      b.display_name,
      b.place_id,
      b.formatted_address,
      COUNT(*)::INT as cnt,
      array_agg(b.person_id ORDER BY b.created_at) as pids
    FROM base_data b
    GROUP BY b.display_name, b.place_id, b.formatted_address
    HAVING COUNT(*) > 1
  )
  SELECT
    d.display_name,
    d.place_id,
    d.formatted_address,
    d.cnt,
    d.pids,
    d.pids[1] as oldest,
    CASE
      WHEN d.cnt = 2 THEN trapper.person_safe_to_merge(d.pids[1], d.pids[2])
      ELSE 'needs_review'::TEXT
    END as safety
  FROM dupes d
  ORDER BY d.cnt DESC, d.display_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.find_same_name_same_address_duplicates IS
'MIG_939: Finds person records that share the same name AND same address.

Returns:
- display_name: The shared name
- place_id: The shared address
- formatted_address: Human-readable address
- person_count: Number of duplicates
- person_ids: Array of person IDs (oldest first)
- oldest_person_id: The canonical record to keep
- merge_safety: Result from person_safe_to_merge (safe, review, both_are_staff, etc.)

Used for:
1. Identifying existing duplicates to clean up
2. Reporting on data quality
3. Feeding merge_same_name_same_address_duplicates()';

-- ============================================================================
-- PART 5: Create Batch Merge Functions
-- ============================================================================

\echo ''
\echo 'Part 5: Creating batch merge functions...'

-- Merge same-name-same-address duplicates
CREATE OR REPLACE FUNCTION trapper.merge_same_name_same_address_duplicates(
  p_dry_run BOOLEAN DEFAULT TRUE
) RETURNS JSONB AS $$
DECLARE
  v_merged INT := 0;
  v_skipped INT := 0;
  v_reviewed INT := 0;
  v_details JSONB := '[]'::JSONB;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT * FROM trapper.find_same_name_same_address_duplicates()
    WHERE person_count = 2  -- Only 2-way duplicates for auto-merge
  LOOP
    IF rec.merge_safety = 'safe' THEN
      IF NOT p_dry_run THEN
        -- Merge newer into older (canonical)
        PERFORM trapper.merge_people(
          rec.person_ids[2],  -- source (newer)
          rec.person_ids[1],  -- target (older/canonical)
          'MIG_939: same_name_same_address',
          'MIG_939'
        );
      END IF;
      v_merged := v_merged + 1;
      v_details := v_details || jsonb_build_object(
        'action', 'merged',
        'name', rec.display_name,
        'address', rec.formatted_address,
        'source_id', rec.person_ids[2],
        'target_id', rec.person_ids[1]
      );
    ELSIF rec.merge_safety = 'review' THEN
      -- Queue for staff review
      IF NOT p_dry_run THEN
        INSERT INTO trapper.potential_person_duplicates (
          person_id, potential_match_id, match_type,
          new_name, existing_name, name_similarity, status
        ) VALUES (
          rec.person_ids[2], rec.person_ids[1], 'same_name_same_address',
          rec.display_name, rec.display_name, 1.0, 'pending'
        ) ON CONFLICT DO NOTHING;
      END IF;
      v_reviewed := v_reviewed + 1;
      v_details := v_details || jsonb_build_object(
        'action', 'queued_for_review',
        'name', rec.display_name,
        'address', rec.formatted_address,
        'reason', rec.merge_safety
      );
    ELSE
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'action', 'skipped',
        'name', rec.display_name,
        'address', rec.formatted_address,
        'reason', rec.merge_safety
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'merged', v_merged,
    'queued_for_review', v_reviewed,
    'skipped', v_skipped,
    'dry_run', p_dry_run,
    'details', v_details
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_same_name_same_address_duplicates IS
'MIG_939: Batch merges same-name-same-address duplicates.

Parameters:
- p_dry_run: If TRUE, only returns what would happen without making changes

Logic:
- Only processes pairs (2 records) - 3+ records need manual review
- Uses person_safe_to_merge() to determine safety:
  - "safe": Auto-merge (tier 1/2 confidence)
  - "review": Queue for staff review
  - Other: Skip (both_are_staff, already_merged, etc.)

Always call with TRUE first to preview changes!';

-- Merge org-name duplicates
CREATE OR REPLACE FUNCTION trapper.merge_org_name_duplicates(
  p_dry_run BOOLEAN DEFAULT TRUE
) RETURNS JSONB AS $$
DECLARE
  v_merged INT := 0;
  v_details JSONB := '[]'::JSONB;
  rec RECORD;
  i INT;
BEGIN
  FOR rec IN
    SELECT
      display_name,
      array_agg(person_id ORDER BY created_at) as person_ids,
      COUNT(*) as cnt
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL
      AND trapper.is_organization_or_address_name(display_name)
    GROUP BY display_name
    HAVING COUNT(*) > 1
  LOOP
    -- Merge all into first (oldest) record
    FOR i IN 2..array_length(rec.person_ids, 1) LOOP
      IF NOT p_dry_run THEN
        PERFORM trapper.merge_people(
          rec.person_ids[i],
          rec.person_ids[1],
          'MIG_939: duplicate_org_name',
          'MIG_939'
        );
      END IF;
      v_merged := v_merged + 1;
    END LOOP;

    v_details := v_details || jsonb_build_object(
      'name', rec.display_name,
      'merged_count', rec.cnt - 1,
      'canonical_id', rec.person_ids[1]
    );
  END LOOP;

  RETURN jsonb_build_object(
    'merged', v_merged,
    'dry_run', p_dry_run,
    'details', v_details
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.merge_org_name_duplicates IS
'MIG_939: Merges duplicate records that have organization/address names.

Finds records where:
- display_name matches is_organization_or_address_name()
- Multiple records exist with same name

Merges all into the oldest record.

Always call with TRUE first to preview changes!';

-- ============================================================================
-- PART 6: Diagnostic Views
-- ============================================================================

\echo ''
\echo 'Part 6: Creating diagnostic views...'

CREATE OR REPLACE VIEW trapper.v_mig939_same_name_same_address_duplicates AS
SELECT
  d.display_name,
  d.place_id,
  d.formatted_address,
  d.person_count,
  d.person_ids,
  d.oldest_person_id,
  d.merge_safety,
  -- Additional context
  (SELECT array_agg(DISTINCT pi.id_value_norm)
   FROM trapper.person_identifiers pi
   WHERE pi.person_id = ANY(d.person_ids) AND pi.id_type = 'email') as emails,
  (SELECT array_agg(DISTINCT pi.id_value_norm)
   FROM trapper.person_identifiers pi
   WHERE pi.person_id = ANY(d.person_ids) AND pi.id_type = 'phone') as phones
FROM trapper.find_same_name_same_address_duplicates() d;

COMMENT ON VIEW trapper.v_mig939_same_name_same_address_duplicates IS
'MIG_939: Shows all same-name-same-address duplicates with contact info for debugging.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_939 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created/Updated:'
\echo '  1. is_organization_or_address_name() - Added 7 new industry patterns'
\echo '  2. known_organizations - Added 10 industry pattern entries'
\echo '  3. check_tier4_same_name_same_address() - Tier 4 detection helper'
\echo '  4. find_same_name_same_address_duplicates() - Detection function'
\echo '  5. merge_same_name_same_address_duplicates(dry_run) - Batch merge'
\echo '  6. merge_org_name_duplicates(dry_run) - Org duplicate merge'
\echo '  7. v_mig939_same_name_same_address_duplicates - Diagnostic view'
\echo ''
\echo 'Next Steps:'
\echo '  1. Preview duplicates:'
\echo '     SELECT * FROM trapper.find_same_name_same_address_duplicates();'
\echo ''
\echo '  2. Dry-run merge:'
\echo '     SELECT * FROM trapper.merge_same_name_same_address_duplicates(TRUE);'
\echo ''
\echo '  3. Execute merge (after verification):'
\echo '     SELECT * FROM trapper.merge_same_name_same_address_duplicates(FALSE);'
\echo ''
\echo '  4. Verify Cristina Campbell:'
\echo '     SELECT COUNT(*) FROM trapper.sot_people'
\echo '     WHERE display_name = ''Cristina Campbell'''
\echo '       AND merged_into_person_id IS NULL;'
\echo ''
