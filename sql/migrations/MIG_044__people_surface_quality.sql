-- MIG_044__people_surface_quality.sql
-- Add surface quality classification for people
--
-- Purpose:
--   Classify people by evidence strength so address-like names and shells
--   don't pollute the main UI. High-confidence people surface first.
--
-- Surface Quality:
--   High: Valid name + has email OR phone
--   Medium: Valid name only
--   Low: Address-like name OR missing signals
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_044__people_surface_quality.sql

\echo '============================================'
\echo 'MIG_044: People Surface Quality'
\echo '============================================'

-- ============================================
-- PART 1: Helper function - is_address_like_name
-- ============================================
\echo ''
\echo 'Creating is_address_like_name function...'

CREATE OR REPLACE FUNCTION trapper.is_address_like_name(p_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_name IS NULL OR TRIM(p_name) = '' THEN
        RETURN FALSE;
    END IF;

    -- Starts with a number (likely an address)
    IF p_name ~ '^\d' THEN
        RETURN TRUE;
    END IF;

    -- Contains common street suffixes
    IF p_name ~* '\m(St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pl|Place)\M' THEN
        -- But not if it's a name like "Dr. Smith" (has a period after Dr)
        IF NOT p_name ~* '\mDr\.' THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.is_address_like_name IS
'Returns TRUE if the name looks like a street address.
Checks for: starting with number, common street suffixes (St, Rd, Ave, etc.)';

-- ============================================
-- PART 2: Surface quality view
-- ============================================
\echo ''
\echo 'Creating v_person_surface_quality...'

DROP VIEW IF EXISTS trapper.v_person_surface_quality CASCADE;

CREATE VIEW trapper.v_person_surface_quality AS
WITH person_signals AS (
    SELECT
        sp.person_id,
        sp.display_name,
        sp.account_type,
        -- Check for identifiers
        EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE pi.person_id = sp.person_id
            AND pi.id_type = 'email'
        ) AS has_email,
        EXISTS (
            SELECT 1 FROM trapper.person_identifiers pi
            WHERE pi.person_id = sp.person_id
            AND pi.id_type = 'phone'
        ) AS has_phone,
        -- Check for cats
        EXISTS (
            SELECT 1 FROM trapper.person_cat_relationships pcr
            WHERE trapper.canonical_person_id(pcr.person_id) = sp.person_id
        ) AS has_cats
    FROM trapper.sot_people sp
    WHERE sp.merged_into_person_id IS NULL
)
SELECT
    ps.person_id,
    ps.display_name,
    ps.account_type,
    ps.has_email,
    ps.has_phone,
    ps.has_cats,
    -- Surface quality
    CASE
        -- Non-person accounts are always Low for People page
        WHEN ps.account_type != 'person' THEN 'Low'
        -- Address-like names are Low
        WHEN trapper.is_address_like_name(ps.display_name) THEN 'Low'
        -- Invalid names are Low
        WHEN NOT trapper.is_valid_person_name(ps.display_name) THEN 'Low'
        -- Valid name + email or phone = High
        WHEN ps.has_email OR ps.has_phone THEN 'High'
        -- Valid name + cats = Medium
        WHEN ps.has_cats THEN 'Medium'
        -- Valid name only = Medium
        ELSE 'Medium'
    END AS surface_quality,
    -- Reason for classification
    CASE
        WHEN ps.account_type != 'person' THEN 'non_person_account'
        WHEN trapper.is_address_like_name(ps.display_name) THEN 'address_like_name'
        WHEN NOT trapper.is_valid_person_name(ps.display_name) THEN 'invalid_name'
        WHEN ps.has_email AND ps.has_phone THEN 'has_email_and_phone'
        WHEN ps.has_email THEN 'has_email'
        WHEN ps.has_phone THEN 'has_phone'
        WHEN ps.has_cats THEN 'has_cats'
        ELSE 'valid_name_only'
    END AS quality_reason
FROM person_signals ps;

COMMENT ON VIEW trapper.v_person_surface_quality IS
'Person surface quality classification.
High: Valid name + email or phone
Medium: Valid name + cats, or valid name only
Low: Non-person account, address-like name, or invalid name';

-- ============================================
-- PART 3: Update v_people_list if it exists
-- ============================================
\echo ''
\echo 'Creating/updating v_person_list...'

DROP VIEW IF EXISTS trapper.v_person_list CASCADE;

CREATE VIEW trapper.v_person_list AS
SELECT
    sp.person_id,
    sp.display_name,
    sp.account_type,
    sq.surface_quality,
    sq.quality_reason,
    sq.has_email,
    sq.has_phone,
    sq.has_cats,
    -- Alias count
    (
        SELECT COUNT(*) FROM trapper.person_aliases pa
        WHERE pa.person_id = sp.person_id
    ) AS alias_count,
    -- Cat count
    (
        SELECT COUNT(DISTINCT pcr.cat_id) FROM trapper.person_cat_relationships pcr
        WHERE trapper.canonical_person_id(pcr.person_id) = sp.person_id
    ) AS cat_count,
    -- Place count
    (
        SELECT COUNT(DISTINCT ppr.place_id) FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = sp.person_id
    ) AS place_count,
    sp.created_at,
    sp.updated_at
FROM trapper.sot_people sp
LEFT JOIN trapper.v_person_surface_quality sq ON sq.person_id = sp.person_id
WHERE sp.merged_into_person_id IS NULL;

COMMENT ON VIEW trapper.v_person_list IS
'Person list view with surface quality for UI display.
Includes account_type, surface_quality, and relationship counts.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_044 Complete'
\echo '============================================'

\echo ''
\echo 'Surface quality distribution:'
SELECT surface_quality, quality_reason, COUNT(*) AS person_count
FROM trapper.v_person_surface_quality
GROUP BY surface_quality, quality_reason
ORDER BY surface_quality, quality_reason;

\echo ''
\echo 'Address-like names detected:'
SELECT display_name, account_type, surface_quality
FROM trapper.v_person_surface_quality
WHERE quality_reason = 'address_like_name'
LIMIT 10;
