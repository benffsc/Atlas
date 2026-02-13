-- MIG_1011_v2__standalone_identity.sql
-- V2 Standalone Identity Validation Functions (No V1 Dependencies)
--
-- This is a STANDALONE version of MIG_1011 that works on fresh DB
-- without trapper.* schema. It removes all V1 references.
--
-- Created: 2026-02-12 (US-East-2 → US-West-2 migration)
--
-- Implements 3 critical architectural lessons:
-- #1. Identity Validation Gate (should_be_person)
-- #2. Soft Blacklist Before Matching
-- #9. Microchip Validation at Entry
--
-- Creates:
-- 1. sot.soft_blacklist - Block organizational/shared identifiers
-- 2. sot.classify_owner_name() - Name classification
-- 3. sot.should_be_person() - Gate for person creation (V2-only, no trapper refs)
-- 4. sot.validate_microchip() - Microchip validation
-- 5. sot.is_identifier_blacklisted() - Blacklist helper (V2-only)

\echo ''
\echo '=============================================='
\echo '  MIG_1011_v2: Standalone Identity Functions'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. SOFT BLACKLIST TABLE (Lesson #2)
-- ============================================================================

\echo '1. Creating sot.soft_blacklist...'

CREATE TABLE IF NOT EXISTS sot.soft_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identifier
    identifier_type TEXT NOT NULL CHECK (identifier_type IN ('email', 'phone')),
    identifier_norm TEXT NOT NULL,  -- Normalized value

    -- Behavior
    reason TEXT NOT NULL,  -- Why this identifier is blacklisted
    require_name_similarity NUMERIC(3,2) DEFAULT 0.9,  -- 0.9+ = effectively blocked
    auto_detected BOOLEAN DEFAULT FALSE,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',

    UNIQUE (identifier_type, identifier_norm)
);

CREATE INDEX IF NOT EXISTS idx_sot_soft_blacklist_lookup
    ON sot.soft_blacklist(identifier_type, identifier_norm);

COMMENT ON TABLE sot.soft_blacklist IS
'V2 SOT: Block organizational/shared identifiers from identity matching.
Lesson #2: Soft blacklist BEFORE matching, not after.
require_name_similarity >= 0.9 = effectively blocked (org email).
require_name_similarity < 0.9 = require name match (shared identifier).';

-- Seed with known org emails (comprehensive list)
INSERT INTO sot.soft_blacklist (identifier_type, identifier_norm, reason, require_name_similarity, auto_detected)
VALUES
    -- FFSC organizational emails
    ('email', 'info@forgottenfelines.com', 'FFSC organizational email', 1.0, FALSE),
    ('email', 'info@forgottenfelines.org', 'FFSC organizational email', 1.0, FALSE),
    ('email', 'office@forgottenfelines.com', 'FFSC organizational email', 1.0, FALSE),
    ('email', 'office@forgottenfelines.org', 'FFSC organizational email', 1.0, FALSE),
    ('email', 'sandra@forgottenfelines.com', 'FFSC staff email (shared)', 0.95, FALSE),

    -- Partner org emails
    ('email', 'marinferals@yahoo.com', 'Partner org: Marin Ferals', 0.95, TRUE),
    ('email', 'cats@humanesociety.org', 'Generic humane society email', 0.95, TRUE),
    ('email', 'info@petalumaanimalservices.org', 'Partner org: Petaluma Animal Services', 0.95, TRUE),
    ('email', 'intake@sonomahumane.org', 'Partner org: Sonoma Humane', 0.95, TRUE),

    -- Known shared phones (from V1 MIG_888)
    ('phone', '7075441373', 'FFSC main office phone', 1.0, FALSE),
    ('phone', '7073211111', 'Known shared phone', 0.95, TRUE),

    -- Additional org emails from data analysis
    ('email', 'cats@sonomacounty.org', 'Sonoma County org email', 0.95, TRUE),
    ('email', 'animalservices@sonomacounty.org', 'County animal services', 0.95, TRUE)
ON CONFLICT (identifier_type, identifier_norm) DO NOTHING;

\echo '   Created sot.soft_blacklist with seed data'

-- ============================================================================
-- 2. CLASSIFY OWNER NAME FUNCTION
-- ============================================================================

\echo ''
\echo '2. Creating sot.classify_owner_name()...'

CREATE OR REPLACE FUNCTION sot.classify_owner_name(p_display_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
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

    -- ========================================================================
    -- FFSC-SPECIFIC PATTERNS (check first)
    -- ========================================================================

    -- "FFSC" anywhere = organization/site (MIG_2003 gap fix)
    IF v_name ~* '\mFFSC\M' THEN
        RETURN 'site_name';
    END IF;

    -- "Forgotten Felines" / "Feline" patterns = organization
    IF v_name ~* '\m(Forgotten\s+Felines?|Feline)\M' THEN
        RETURN 'organization';
    END IF;

    -- ========================================================================
    -- ORGANIZATIONAL PATTERNS
    -- ========================================================================

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

    -- Program/Project patterns (MIG_2003 gap fix)
    IF v_name ~* '\m(Program|Project|Initiative)\M' THEN
        RETURN 'organization';
    END IF;

    -- ========================================================================
    -- SITE NAME PATTERNS (trapping locations stored as owner name)
    -- ========================================================================

    -- Ranch/Farm patterns
    IF v_name ~* '\m(Ranch|Farm|Estate|Vineyard|Winery)\M' THEN
        RETURN 'site_name';
    END IF;

    -- Mobile Home Park patterns (MIG_2003 gap fix)
    IF v_name ~* '\mMHP\M' OR v_name ~* '\m(Mobile\s+Home|Trailer)\s+(Park|Court)\M' THEN
        RETURN 'site_name';
    END IF;

    -- ========================================================================
    -- ADDRESS PATTERNS
    -- ========================================================================

    -- Starts with number (likely address)
    IF v_name ~ '^[0-9]+\s' THEN
        RETURN 'address';
    END IF;

    -- Contains street indicators
    IF v_name ~* '\m(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Place|Pl)\M' THEN
        RETURN 'address';
    END IF;

    -- ========================================================================
    -- GARBAGE PATTERNS
    -- ========================================================================

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

    -- ========================================================================
    -- LIKELY PERSON PATTERNS
    -- ========================================================================

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
$$;

COMMENT ON FUNCTION sot.classify_owner_name IS
'Classifies a name as: likely_person, organization, site_name, address, garbage, unknown.
Used by should_be_person() to filter pseudo-profiles from person creation.
V2 version includes FFSC-specific patterns and site_name classification.';

\echo '   Created sot.classify_owner_name()'

-- ============================================================================
-- 3. SHOULD BE PERSON GATE FUNCTION (Lesson #1) - V2 STANDALONE
-- ============================================================================

\echo ''
\echo '3. Creating sot.should_be_person() [STANDALONE - no trapper refs]...'

CREATE OR REPLACE FUNCTION sot.should_be_person(
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT,
    p_phone TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_display_name TEXT;
    v_classification TEXT;
    v_email_norm TEXT;
    v_phone_norm TEXT;
BEGIN
    -- Normalize identifiers
    v_email_norm := LOWER(TRIM(COALESCE(p_email, '')));
    v_phone_norm := REGEXP_REPLACE(COALESCE(p_phone, ''), '[^0-9]', '', 'g');

    -- ==========================================================================
    -- LESSON #1: Must have contact info to be a real person
    -- ==========================================================================
    IF v_email_norm = '' AND (v_phone_norm = '' OR LENGTH(v_phone_norm) < 10) THEN
        RETURN FALSE;  -- No identifiers = cannot create person
    END IF;

    -- ==========================================================================
    -- LESSON #2: Check soft blacklist BEFORE identity matching
    -- ==========================================================================

    -- Check for FFSC organizational domain
    IF v_email_norm LIKE '%@forgottenfelines.com'
       OR v_email_norm LIKE '%@forgottenfelines.org' THEN
        RETURN FALSE;  -- Route to pseudo-profile
    END IF;

    -- Check for generic organizational email prefixes
    IF v_email_norm LIKE 'info@%'
       OR v_email_norm LIKE 'office@%'
       OR v_email_norm LIKE 'contact@%'
       OR v_email_norm LIKE 'admin@%'
       OR v_email_norm LIKE 'help@%'
       OR v_email_norm LIKE 'support@%'
       OR v_email_norm LIKE 'cats@%'
       OR v_email_norm LIKE 'adopt@%'
       OR v_email_norm LIKE 'rescue@%'
       OR v_email_norm LIKE 'intake@%' THEN
        RETURN FALSE;  -- Generic org emails
    END IF;

    -- Check V2 soft blacklist (high-threshold = org email block)
    -- NOTE: V2 standalone - no trapper.data_engine_soft_blacklist reference
    IF v_email_norm != '' AND EXISTS (
        SELECT 1 FROM sot.soft_blacklist
        WHERE identifier_norm = v_email_norm
          AND identifier_type = 'email'
          AND require_name_similarity >= 0.9
    ) THEN
        RETURN FALSE;  -- Soft-blacklisted org email
    END IF;

    -- Check phone blacklist too
    IF v_phone_norm != '' AND LENGTH(v_phone_norm) >= 10 AND EXISTS (
        SELECT 1 FROM sot.soft_blacklist
        WHERE identifier_norm = v_phone_norm
          AND identifier_type = 'phone'
          AND require_name_similarity >= 0.9
    ) THEN
        RETURN FALSE;  -- Soft-blacklisted shared phone
    END IF;

    -- ==========================================================================
    -- Name validation: Must have at least first name
    -- ==========================================================================
    IF p_first_name IS NULL OR TRIM(p_first_name) = '' THEN
        RETURN FALSE;
    END IF;

    -- Build display name and classify
    v_display_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
    v_classification := sot.classify_owner_name(v_display_name);

    -- Only create person if classified as likely_person
    RETURN v_classification = 'likely_person';
END;
$$;

COMMENT ON FUNCTION sot.should_be_person IS
'V2 Identity Validation Gate (Lesson #1) - STANDALONE VERSION.
Determines if an owner record should create a person or route to pseudo-profile.
Checks:
1. Must have email OR phone (no identifier = no person)
2. Email/phone not on sot.soft_blacklist (org emails/shared phones blocked)
3. Name classified as likely_person (not org/site_name/address/garbage)
Returns TRUE only if record should create a person.
NOTE: This V2 version has no trapper.* schema dependencies.';

\echo '   Created sot.should_be_person() [STANDALONE]'

-- ============================================================================
-- 4. VALIDATE MICROCHIP FUNCTION (Lesson #9)
-- ============================================================================

\echo ''
\echo '4. Creating sot.validate_microchip()...'

CREATE OR REPLACE FUNCTION sot.validate_microchip(p_raw TEXT)
RETURNS TABLE(is_valid BOOLEAN, cleaned TEXT, rejection_reason TEXT)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_cleaned TEXT;
    v_digits TEXT;
    v_len INT;
BEGIN
    -- NULL / empty
    IF p_raw IS NULL OR TRIM(p_raw) = '' THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'empty_or_null'::TEXT;
        RETURN;
    END IF;

    -- Basic cleanup: trim whitespace, remove dashes/dots/spaces/parens
    v_cleaned := TRIM(REGEXP_REPLACE(p_raw, '[\s\.\-\(\)]', '', 'g'));
    v_digits := REGEXP_REPLACE(v_cleaned, '[^0-9]', '', 'g');
    v_len := LENGTH(v_digits);

    -- Too short (< 9 digits) — not a real microchip
    IF v_len < 9 THEN
        RETURN QUERY SELECT FALSE, v_digits, 'too_short'::TEXT;
        RETURN;
    END IF;

    -- Too long (> 15 digits) — concatenated or corrupted
    IF v_len > 15 THEN
        RETURN QUERY SELECT FALSE, v_digits, 'too_long_suspect_concatenation'::TEXT;
        RETURN;
    END IF;

    -- All zeros (junk data) - the "Daphne" phantom cat pattern
    IF v_digits ~ '^0+$' THEN
        RETURN QUERY SELECT FALSE, v_digits, 'all_zeros_junk'::TEXT;
        RETURN;
    END IF;

    -- Test/placeholder patterns
    IF v_digits ~ '^(12345|00000|99999)' THEN
        RETURN QUERY SELECT FALSE, v_digits, 'test_pattern'::TEXT;
        RETURN;
    END IF;

    -- Repeating digit pattern (111111111, 222222222, etc.)
    IF v_digits ~ '^(.)\1{8,}$' THEN
        RETURN QUERY SELECT FALSE, v_digits, 'repeating_digits'::TEXT;
        RETURN;
    END IF;

    -- Known bad microchips (from MIG_873)
    IF v_digits IN ('981020000000000', '981020000000001', '123456789012345') THEN
        RETURN QUERY SELECT FALSE, v_digits, 'known_bad_microchip'::TEXT;
        RETURN;
    END IF;

    -- Valid microchip
    RETURN QUERY SELECT TRUE, v_digits, NULL::TEXT;
END;
$$;

COMMENT ON FUNCTION sot.validate_microchip IS
'V2 Microchip Validation (Lesson #9).
Rejects invalid microchips BEFORE storage:
- Empty/null
- Too short (< 9 digits)
- Too long (> 15 digits, suspect concatenation)
- All zeros (junk data like phantom cat "Daphne")
- Test patterns (12345, 00000, 99999)
- Repeating digits
- Known bad microchips
Returns: (is_valid, cleaned_value, rejection_reason)';

\echo '   Created sot.validate_microchip()'

-- ============================================================================
-- 5. CHECK IDENTIFIER BLACKLIST HELPER - V2 STANDALONE
-- ============================================================================

\echo ''
\echo '5. Creating sot.is_identifier_blacklisted() [STANDALONE]...'

CREATE OR REPLACE FUNCTION sot.is_identifier_blacklisted(
    p_type TEXT,  -- 'email' or 'phone'
    p_value TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_norm TEXT;
BEGIN
    IF p_value IS NULL OR TRIM(p_value) = '' THEN
        RETURN FALSE;
    END IF;

    -- Normalize
    IF p_type = 'email' THEN
        v_norm := LOWER(TRIM(p_value));
    ELSE
        v_norm := REGEXP_REPLACE(p_value, '[^0-9]', '', 'g');
    END IF;

    -- Check V2 soft blacklist only (no V1 dependency)
    RETURN EXISTS (
        SELECT 1 FROM sot.soft_blacklist
        WHERE identifier_type = p_type
          AND identifier_norm = v_norm
          AND require_name_similarity >= 0.9
    );
END;
$$;

COMMENT ON FUNCTION sot.is_identifier_blacklisted IS
'V2 STANDALONE: Checks if an identifier (email/phone) is on the soft blacklist.
Used to prevent identity matching on organizational/shared identifiers.
NOTE: This V2 version only checks sot.soft_blacklist (no trapper.* refs).';

\echo '   Created sot.is_identifier_blacklisted() [STANDALONE]'

-- ============================================================================
-- 6. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Soft blacklist entries:'
SELECT identifier_type, identifier_norm, reason
FROM sot.soft_blacklist
ORDER BY identifier_type, identifier_norm;

\echo ''
\echo 'Testing classify_owner_name():'
SELECT
    input,
    sot.classify_owner_name(input) AS classification
FROM (VALUES
    ('John Smith'),
    ('Sonoma Humane Society'),
    ('123 Main Street'),
    ('Unknown'),
    ('FFSC Foster'),
    ('Maria'),
    ('Silveira Ranch'),
    ('Forgotten Felines Foster'),
    ('FFSC Relo Program'),
    ('Food Maxx RP ffsc')
) AS t(input);

\echo ''
\echo 'Testing should_be_person():'
SELECT
    first_name,
    email,
    sot.should_be_person(first_name, 'Smith', email, NULL) AS should_create
FROM (VALUES
    ('John', 'john@example.com'),
    ('', 'john@example.com'),
    ('John', ''),
    ('Sonoma Humane', 'info@sonomahumane.org'),
    ('John', 'info@forgottenfelines.com'),
    ('FFSC Foster', 'test@test.com'),
    ('John', 'marinferals@yahoo.com')
) AS t(first_name, email);

\echo ''
\echo 'Testing validate_microchip():'
SELECT
    input,
    (sot.validate_microchip(input)).*
FROM (VALUES
    ('985112345678901'),
    ('000000000000000'),
    ('123'),
    ('981020000000000'),
    (NULL)
) AS t(input);

\echo ''
\echo '=============================================='
\echo '  MIG_1011_v2 Complete'
\echo '=============================================='
\echo 'Created (STANDALONE - no trapper.* dependencies):'
\echo '  - sot.soft_blacklist table (Lesson #2)'
\echo '  - sot.classify_owner_name() function (with FFSC patterns)'
\echo '  - sot.should_be_person() gate (Lesson #1) [V2 only]'
\echo '  - sot.validate_microchip() validation (Lesson #9)'
\echo '  - sot.is_identifier_blacklisted() helper [V2 only]'
\echo ''
\echo 'Architectural Lessons Implemented:'
\echo '  #1: Identity Validation Gate - should_be_person()'
\echo '  #2: Soft Blacklist Before Matching - soft_blacklist table'
\echo '  #9: Microchip Validation at Entry - validate_microchip()'
\echo ''
