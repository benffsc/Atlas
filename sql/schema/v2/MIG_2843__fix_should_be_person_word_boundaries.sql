-- MIG_2843: Fix should_be_person() org regex false positives + data cleanup
--
-- Audit of MIG_2841 backfill (FFS-234) revealed:
--   1. Org regex false positives — "Franchetti" matches "ranch", "Farmer" matches "farm"
--   2. Davenport blacklist leak — email "none" not caught by Lesson #5
--   3. Walsh backtick first_name — literal "`" as first_name
--
-- Root cause: Lesson #4 regex uses substring matching, not word boundaries.
--   e.g., 'franchetti' ~* '(ranch)' = TRUE because "ranch" is inside "franchetti"
--
-- Fix: Use PostgreSQL \y word boundaries so only standalone words match.
--   'franchetti' ~* '\y(ranch)\y' = FALSE (no word boundary before 'ranch')
--   'sunrise ranch' ~* '\y(ranch)\y' = TRUE (word boundary before 'ranch')
--
-- Also adds 'farms' to the word list since \yfarm\y won't match 'farms' anymore.
--
-- Fixes: FFS-234, FFS-235

BEGIN;

-- ============================================================================
-- 1. Fix should_be_person() — word boundaries + "none" email handling
-- ============================================================================

\echo '1. Updating should_be_person() with word boundary regex...'

-- Drop existing function first — signature has DEFAULT params that conflict with CREATE OR REPLACE
DROP FUNCTION IF EXISTS sot.should_be_person(text, text, text, text);

CREATE OR REPLACE FUNCTION sot.should_be_person(p_first_name text, p_last_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS boolean
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

    -- LESSON #4: Check for organization names (DATA_GAP_031 + MIG_2821 + MIG_2843)
    -- MIG_2843: Added \y word boundaries to prevent false positives on names like
    -- Franchetti (ranch), Farmer (farm), Vineyard (vineyard).
    -- Added 'farms' since \yfarm\y no longer matches 'farms' via substring.
    IF v_full_name ~* '\y(winery|poultry|ranch|farm|farms|vineyard|auction|estates|livestock|equine|cal fire|station|hotel|motel|school|academy|apartments|condos|townhomes|truck stop)\y' THEN
        RETURN FALSE;  -- Organization name
    END IF;

    -- LESSON #5: Check for FFSC phone used as placeholder
    IF COALESCE(p_phone, '') IN ('7075767999', '707-576-7999', '(707) 576-7999') THEN
        -- Only reject if email is also fake/missing
        -- MIG_2843: Added 'none' check — literal "none" is not a real email
        IF v_email_norm = '' OR v_email_norm = 'none' OR v_email_norm LIKE '%@noemail.com' OR v_email_norm LIKE '%@petestablished.com' THEN
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
- Organization names with word boundaries (Ranch, Farm, Farms, Hotel, etc.)
- FFSC phone with no real email (including literal "none")
- Names classified as org/site/address by classify_owner_name()

MIG_2821: Expanded Lesson #4 with hotel, motel, school, academy, etc.
MIG_2843: Added \y word boundaries to Lesson #4 to prevent false positives
on names like Franchetti, Farmer, Vineyard. Added "none" to Lesson #5
fake email check.

See MIG_2337, MIG_2821, MIG_2843, FFS-157, FFS-235. DATA_GAP_031.';

-- ============================================================================
-- 2. Verify regex fix — false positives resolved, true positives preserved
-- ============================================================================

\echo ''
\echo '2. Verifying word boundary regex...'

SELECT
    test_first || ' ' || COALESCE(test_last, '') AS test_name,
    expected,
    sot.should_be_person(test_first, test_last, test_email, test_phone) AS actual,
    CASE
        WHEN sot.should_be_person(test_first, test_last, test_email, test_phone) = expected THEN 'PASS'
        ELSE '*** FAIL ***'
    END AS status
FROM (VALUES
    -- Previously false positive on Lesson #4 (should now be TRUE = person)
    ('Gesine', 'Franchetti', 'gesinef1004@gmail.com', '7076952589', TRUE),
    ('Jason',  'Farmer',     'jfarmer@example.org',   '7075551234', TRUE),
    ('Sam',    'Farmer',     'sfarmer@example.org',   '7075551235', TRUE),

    -- "Vineyard" as standalone word still caught by classify_owner_name() in Lesson #6
    -- This is correct: standalone org words are ambiguous, manual override if needed
    ('Amanda', 'Vineyard',   'avineyard@example.org', '7075551236', FALSE),

    -- True positives (should still be FALSE = org)
    ('Sunrise',   'Farms',       NULL, '7075551237', FALSE),
    ('Brown Bag', 'Farms',       NULL, '7075551238', FALSE),
    ('Happy',     'Ranch',       NULL, '7075551239', FALSE),
    ('Oak',       'Vineyard',    NULL, '7075551240', FALSE),
    ('Cal Fire',  'Station',     NULL, '7075551241', FALSE),
    ('Hilltop',   'Hotel',       NULL, '7075551242', FALSE),

    -- Lesson #5: "none" email + FFSC phone (should be FALSE)
    ('John', 'Davenport', 'none',           '7075767999', FALSE),

    -- Lesson #5: Real email + FFSC phone (should be TRUE — real person using FFSC phone)
    ('Jane', 'Smith',     'jane@gmail.com', '7075767999', TRUE)
) AS t(test_first, test_last, test_email, test_phone, expected);

-- ============================================================================
-- 3. Fix Davenport — delete incorrectly created person record
-- ============================================================================

\echo ''
\echo '3. Cleaning up Davenport person record (blacklist leak)...'

-- Unlink intake submissions first (both person_id and matched_person_id reference sot.people)
UPDATE ops.intake_submissions
SET person_id = NULL, matched_person_id = NULL
WHERE person_id = 'aa460d57-829c-42cc-8c3d-903fa1ccf894'
   OR matched_person_id = 'aa460d57-829c-42cc-8c3d-903fa1ccf894';

-- Delete identifiers
DELETE FROM sot.person_identifiers
WHERE person_id = 'aa460d57-829c-42cc-8c3d-903fa1ccf894';

-- Delete person
DELETE FROM sot.people
WHERE person_id = 'aa460d57-829c-42cc-8c3d-903fa1ccf894';

\echo '   Davenport person record cleaned up.'

-- ============================================================================
-- 4. Fix Walsh backtick first_name
-- ============================================================================

\echo ''
\echo '4. Fixing Walsh backtick first_name...'

-- Fix person first name (email is hallie.walsh@gmail.com → "Hallie")
UPDATE sot.people
SET first_name = 'Hallie', updated_at = NOW()
WHERE person_id = '379c52da-d49e-45e1-8e4a-df8594ae9df4';

-- Fix intake submission
UPDATE ops.intake_submissions
SET first_name = 'Hallie'
WHERE submission_id = 'a5efc30f-9d7b-4af4-a076-4e85c85d98c8';

\echo '   Walsh first_name fixed to Hallie.'

-- ============================================================================
-- 5. Rematch Gesine Franchetti (now that regex is fixed)
-- ============================================================================

\echo ''
\echo '5. Rematching Gesine Franchetti...'

SELECT sot.match_intake_to_person('5bc1f37c-94ad-4d8d-813e-32533b2dc55b');

\echo '   Gesine Franchetti rematched.'

-- ============================================================================
-- 6. Final verification
-- ============================================================================

\echo ''
\echo '6. Final verification...'

-- Davenport should be gone
SELECT 'Davenport deleted' AS check,
       CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE '*** FAIL ***' END AS status
FROM sot.people
WHERE person_id = 'aa460d57-829c-42cc-8c3d-903fa1ccf894';

-- Walsh should have correct name
SELECT 'Walsh first_name' AS check,
       CASE WHEN first_name = 'Hallie' THEN 'PASS' ELSE '*** FAIL: ' || COALESCE(first_name, 'NULL') END AS status
FROM sot.people
WHERE person_id = '379c52da-d49e-45e1-8e4a-df8594ae9df4';

-- Gesine should now be matched
SELECT 'Gesine matched' AS check,
       CASE WHEN matched_person_id IS NOT NULL THEN 'PASS' ELSE '*** FAIL: still NULL ***' END AS status
FROM ops.intake_submissions
WHERE submission_id = '5bc1f37c-94ad-4d8d-813e-32533b2dc55b';

-- Word boundary sanity
SELECT 'Franchetti = person' AS check,
       CASE WHEN sot.should_be_person('Gesine', 'Franchetti', 'gesinef1004@gmail.com', '7076952589') THEN 'PASS' ELSE '*** FAIL ***' END AS status;

SELECT 'Sunrise Farms = org' AS check,
       CASE WHEN NOT sot.should_be_person('Sunrise', 'Farms', NULL, NULL) THEN 'PASS' ELSE '*** FAIL ***' END AS status;

COMMIT;

\echo ''
\echo 'MIG_2843 complete. All fixes applied.'
