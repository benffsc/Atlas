-- MIG_2005: Fix should_be_person() to detect garbage email values
--
-- Gap: Emails like "none", "no", "n/a" pass should_be_person() because
-- they're not empty strings. This causes 70+ records in Chunk 1 to
-- incorrectly create person records.
--
-- Fix: Add garbage email detection early in should_be_person()

CREATE OR REPLACE FUNCTION sot.should_be_person(p_first_name text, p_last_name text, p_email text, p_phone text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
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
    -- LESSON #5: Garbage email values are not valid identifiers
    -- "none", "no", "n/a", "unknown", "test", etc. should not count as emails
    -- ==========================================================================
    IF v_email_norm IN ('none', 'no', 'n/a', 'na', 'unknown', 'test', 'tbd', '-', '.', 'x', 'null', 'nil', 'email') THEN
        v_email_norm := '';  -- Treat as no email
    END IF;

    -- Also catch obviously invalid patterns
    IF v_email_norm != '' AND (
        v_email_norm !~ '@'                    -- No @ sign
        OR v_email_norm ~ '^[0-9]+$'           -- Just numbers
        OR LENGTH(v_email_norm) < 5            -- Too short
    ) THEN
        v_email_norm := '';  -- Treat as no email
    END IF;

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
    IF v_email_norm != '' AND EXISTS (
        SELECT 1 FROM sot.soft_blacklist
        WHERE identifier_norm = v_email_norm
          AND identifier_type = 'email'
          AND require_name_similarity >= 0.9
    ) THEN
        RETURN FALSE;  -- Soft-blacklisted org email
    END IF;

    -- Also check V1 soft blacklist for backwards compatibility
    IF v_email_norm != '' AND EXISTS (
        SELECT 1 FROM trapper.data_engine_soft_blacklist
        WHERE identifier_norm = v_email_norm
          AND identifier_type = 'email'
          AND require_name_similarity >= 0.9
    ) THEN
        RETURN FALSE;  -- V1 soft-blacklisted org email
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
    IF v_classification NOT IN ('likely_person', 'unknown') THEN
        RETURN FALSE;  -- Organizations, addresses, garbage, site_names → pseudo-profile
    END IF;

    RETURN TRUE;
END;
$function$;

-- Add comment
COMMENT ON FUNCTION sot.should_be_person(text, text, text, text) IS
'Gates person creation. Returns TRUE only if:
1. Has valid email OR valid phone (10+ digits)
2. Email is not garbage (none, n/a, etc.) or invalid format
3. Email is not FFSC org domain
4. Email is not generic org prefix (info@, office@, etc.)
5. Email is not soft-blacklisted
6. Has first name
7. Name classification is likely_person or unknown

Returns FALSE → route to ops.clinic_accounts as pseudo-profile';

-- Verify the fix
DO $$
DECLARE
    v_result BOOLEAN;
BEGIN
    -- Test cases that should now be rejected
    SELECT sot.should_be_person('John', 'Doe', 'none', NULL) INTO v_result;
    ASSERT v_result = FALSE, 'none email should be rejected, got: ' || v_result::text;

    SELECT sot.should_be_person('John', 'Doe', 'no', NULL) INTO v_result;
    ASSERT v_result = FALSE, 'no email should be rejected, got: ' || v_result::text;

    SELECT sot.should_be_person('John', 'Doe', 'n/a', NULL) INTO v_result;
    ASSERT v_result = FALSE, 'n/a email should be rejected, got: ' || v_result::text;

    SELECT sot.should_be_person('John', 'Doe', 'test', NULL) INTO v_result;
    ASSERT v_result = FALSE, 'test email should be rejected, got: ' || v_result::text;

    SELECT sot.should_be_person('John', 'Doe', '12345', NULL) INTO v_result;
    ASSERT v_result = FALSE, 'numeric email should be rejected, got: ' || v_result::text;

    -- Test cases that should still pass
    SELECT sot.should_be_person('John', 'Doe', 'john@example.com', NULL) INTO v_result;
    ASSERT v_result = TRUE, 'valid email should pass, got: ' || v_result::text;

    SELECT sot.should_be_person('John', 'Doe', '', '7075551234') INTO v_result;
    ASSERT v_result = TRUE, 'phone-only should pass, got: ' || v_result::text;

    SELECT sot.should_be_person('John', 'Doe', 'none', '7075551234') INTO v_result;
    ASSERT v_result = TRUE, 'garbage email with valid phone should pass, got: ' || v_result::text;

    -- Test cases that should still be rejected
    SELECT sot.should_be_person('John', 'Doe', '', '') INTO v_result;
    ASSERT v_result = FALSE, 'no contact should be rejected, got: ' || v_result::text;

    SELECT sot.should_be_person('John', 'Doe', 'info@forgottenfelines.com', NULL) INTO v_result;
    ASSERT v_result = FALSE, 'FFSC email should be rejected, got: ' || v_result::text;

    RAISE NOTICE 'All should_be_person tests passed!';
END $$;
