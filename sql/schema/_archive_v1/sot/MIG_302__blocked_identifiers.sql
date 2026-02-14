-- MIG_302: Blocked Identifiers Table and Validation
--
-- Problem:
--   Organizational identifiers (FFSC office phone, generic emails) were being
--   matched to individual person records, causing incorrect person-place links.
--
-- Solution:
--   1. Create blocked_identifiers table with known org/invalid values
--   2. Add is_blocked_identifier() function for validation
--   3. Create norm_identifier() function that returns NULL for blocked values
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_302__blocked_identifiers.sql

\echo ''
\echo '=============================================='
\echo 'MIG_302: Blocked Identifiers'
\echo '=============================================='
\echo ''

-- ============================================
-- BLOCKED IDENTIFIERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS trapper.blocked_identifiers (
    id SERIAL PRIMARY KEY,
    id_type TEXT NOT NULL,  -- 'email' or 'phone'
    id_value_norm TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id_type, id_value_norm)
);

COMMENT ON TABLE trapper.blocked_identifiers IS
'Identifiers that should never be used for person matching.
Includes organizational phones/emails and invalid placeholder values.';

-- Seed with known blocked values
INSERT INTO trapper.blocked_identifiers (id_type, id_value_norm, reason) VALUES
    -- FFSC organizational identifiers
    ('phone', '7075767999', 'FFSC office phone - used for 4000+ internal records'),
    ('email', 'info@forgottenfelines.com', 'FFSC generic email - used for 2800+ internal records'),
    ('email', 'ffsteph@sonic.net', 'FFSC staff email used as placeholder'),
    -- Invalid placeholder values
    ('email', 'none', 'Invalid placeholder'),
    ('email', 'n/a', 'Invalid placeholder'),
    ('email', 'na', 'Invalid placeholder'),
    ('email', 'null', 'Invalid placeholder'),
    ('email', '', 'Empty value'),
    ('email', 'unknown', 'Invalid placeholder'),
    ('email', 'no email', 'Invalid placeholder'),
    ('email', 'noemail', 'Invalid placeholder'),
    ('phone', '', 'Empty value'),
    ('phone', '0000000000', 'Invalid placeholder'),
    ('phone', '1111111111', 'Invalid placeholder'),
    ('phone', '1234567890', 'Invalid placeholder')
ON CONFLICT DO NOTHING;

\echo 'Created blocked_identifiers table with seed data'

-- ============================================
-- VALIDATION FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION trapper.is_blocked_identifier(
    p_id_type TEXT,
    p_id_value TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_normalized TEXT;
BEGIN
    IF p_id_value IS NULL OR TRIM(p_id_value) = '' THEN
        RETURN TRUE;  -- Empty values are blocked
    END IF;

    -- Normalize the value
    IF p_id_type = 'email' THEN
        v_normalized := LOWER(TRIM(p_id_value));
    ELSIF p_id_type = 'phone' THEN
        v_normalized := trapper.norm_phone_us(p_id_value);
    ELSE
        v_normalized := LOWER(TRIM(p_id_value));
    END IF;

    -- Check blocklist
    RETURN EXISTS (
        SELECT 1 FROM trapper.blocked_identifiers
        WHERE id_type = p_id_type AND id_value_norm = v_normalized
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.is_blocked_identifier IS
'Returns TRUE if the identifier is in the blocklist (organizational or invalid).
Use this before creating person_identifiers or matching people.';

-- ============================================
-- SAFE NORMALIZATION FUNCTIONS
-- ============================================

CREATE OR REPLACE FUNCTION trapper.safe_norm_email(p_email TEXT)
RETURNS TEXT AS $$
DECLARE
    v_normalized TEXT;
BEGIN
    IF p_email IS NULL OR TRIM(p_email) = '' THEN
        RETURN NULL;
    END IF;

    v_normalized := LOWER(TRIM(p_email));

    -- Return NULL if blocked
    IF trapper.is_blocked_identifier('email', v_normalized) THEN
        RETURN NULL;
    END IF;

    RETURN v_normalized;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.safe_norm_email IS
'Normalizes email and returns NULL if blocked or invalid.
Use instead of LOWER(TRIM()) for email matching.';


CREATE OR REPLACE FUNCTION trapper.safe_norm_phone(p_phone TEXT)
RETURNS TEXT AS $$
DECLARE
    v_normalized TEXT;
BEGIN
    IF p_phone IS NULL OR TRIM(p_phone) = '' THEN
        RETURN NULL;
    END IF;

    v_normalized := trapper.norm_phone_us(p_phone);

    -- Return NULL if blocked
    IF trapper.is_blocked_identifier('phone', v_normalized) THEN
        RETURN NULL;
    END IF;

    RETURN v_normalized;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.safe_norm_phone IS
'Normalizes phone and returns NULL if blocked or invalid.
Use instead of norm_phone_us() for phone matching.';

-- ============================================
-- VERIFICATION
-- ============================================

\echo ''
\echo 'Testing blocklist functions...'

SELECT
    trapper.is_blocked_identifier('phone', '707-576-7999') as ffsc_phone_blocked,
    trapper.is_blocked_identifier('email', 'info@forgottenfelines.com') as ffsc_email_blocked,
    trapper.is_blocked_identifier('email', 'none') as none_blocked,
    trapper.is_blocked_identifier('email', 'valid@example.com') as valid_not_blocked;

SELECT
    trapper.safe_norm_email('info@forgottenfelines.com') as blocked_returns_null,
    trapper.safe_norm_email('valid@example.com') as valid_returns_value,
    trapper.safe_norm_phone('707-576-7999') as blocked_phone_null,
    trapper.safe_norm_phone('707-123-4567') as valid_phone_returns;

\echo ''
\echo 'MIG_302 Complete!'
\echo ''
\echo 'New functions:'
\echo '  - is_blocked_identifier(type, value) - Check if identifier is blocked'
\echo '  - safe_norm_email(email) - Returns NULL for blocked emails'
\echo '  - safe_norm_phone(phone) - Returns NULL for blocked phones'
\echo ''
\echo 'Usage in ingest scripts:'
\echo '  Replace: LOWER(TRIM(email))'
\echo '  With:    trapper.safe_norm_email(email)'
\echo ''
\echo '  Replace: trapper.norm_phone_us(phone)'
\echo '  With:    trapper.safe_norm_phone(phone)'
\echo ''
