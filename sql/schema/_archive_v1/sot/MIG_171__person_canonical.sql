-- MIG_171__person_canonical.sql
-- Adds is_canonical flag to sot_people and functions to compute it
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_171__person_canonical.sql

\echo ''
\echo 'MIG_171: Person Canonical Flag'
\echo '==============================='
\echo ''

-- ============================================================
-- 1. Add is_canonical column to sot_people
-- ============================================================

\echo 'Adding is_canonical column to sot_people...'

ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS is_canonical BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_sot_people_canonical
ON trapper.sot_people(is_canonical) WHERE is_canonical = TRUE;

-- ============================================================
-- 2. Function to check if name matches internal account patterns
-- ============================================================

\echo 'Creating is_internal_account function...'

CREATE OR REPLACE FUNCTION trapper.is_internal_account(p_display_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF p_display_name IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM trapper.internal_account_types iat
        WHERE iat.is_active = TRUE
          AND (
              (iat.pattern_type = 'contains' AND LOWER(p_display_name) LIKE '%' || LOWER(iat.account_pattern) || '%')
              OR (iat.pattern_type = 'equals' AND LOWER(p_display_name) = LOWER(iat.account_pattern))
              OR (iat.pattern_type = 'starts_with' AND LOWER(p_display_name) LIKE LOWER(iat.account_pattern) || '%')
          )
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 3. Function to determine if a person is canonical
-- ============================================================

\echo 'Creating compute_is_canonical function...'

CREATE OR REPLACE FUNCTION trapper.compute_is_canonical(p_person_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_real_email BOOLEAN;
    v_has_real_phone BOOLEAN;
    v_is_internal BOOLEAN;
    v_display_name TEXT;
BEGIN
    -- Get display name
    SELECT display_name INTO v_display_name
    FROM trapper.sot_people WHERE person_id = p_person_id;

    -- Check if name matches internal account patterns
    v_is_internal := trapper.is_internal_account(v_display_name);

    -- If internal account, not canonical
    IF v_is_internal THEN
        RETURN FALSE;
    END IF;

    -- Check for real email (not @forgottenfelines.org or ffsc internal)
    SELECT EXISTS (
        SELECT 1 FROM trapper.person_identifiers
        WHERE person_id = p_person_id
          AND id_type = 'email'
          AND id_value_norm IS NOT NULL
          AND id_value_norm != ''
          AND id_value_norm NOT LIKE '%@forgottenfelines.org'
          AND id_value_norm NOT LIKE '%ffsc%'
          AND id_value_norm NOT LIKE '%test@%'
          AND id_value_norm NOT LIKE '%example.com'
    ) INTO v_has_real_email;

    -- Check for real phone (not in blacklist)
    SELECT EXISTS (
        SELECT 1 FROM trapper.person_identifiers pi
        WHERE pi.person_id = p_person_id
          AND pi.id_type = 'phone'
          AND pi.id_value_norm IS NOT NULL
          AND pi.id_value_norm != ''
          AND NOT EXISTS (
              SELECT 1 FROM trapper.identity_phone_blacklist bl
              WHERE bl.phone_norm = pi.id_value_norm
          )
    ) INTO v_has_real_phone;

    -- Canonical if has real email OR real phone (and not internal)
    RETURN v_has_real_email OR v_has_real_phone;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 4. Function to refresh all canonical flags
-- ============================================================

\echo 'Creating refresh_canonical_flags function...'

CREATE OR REPLACE FUNCTION trapper.refresh_canonical_flags()
RETURNS TABLE(total_people INT, canonical INT, non_canonical INT) AS $$
DECLARE
    v_total INT;
    v_canonical INT;
    v_non_canonical INT;
BEGIN
    -- Update all non-merged people
    UPDATE trapper.sot_people
    SET is_canonical = trapper.compute_is_canonical(person_id),
        updated_at = NOW()
    WHERE merged_into_person_id IS NULL;

    -- Count results
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE is_canonical = TRUE),
        COUNT(*) FILTER (WHERE is_canonical = FALSE OR is_canonical IS NULL)
    INTO v_total, v_canonical, v_non_canonical
    FROM trapper.sot_people
    WHERE merged_into_person_id IS NULL;

    RETURN QUERY SELECT v_total, v_canonical, v_non_canonical;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Function to get department for internal account
-- ============================================================

\echo 'Creating get_internal_account_department function...'

CREATE OR REPLACE FUNCTION trapper.get_internal_account_department(p_display_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_org_code TEXT;
BEGIN
    SELECT iat.maps_to_org_code INTO v_org_code
    FROM trapper.internal_account_types iat
    WHERE iat.is_active = TRUE
      AND (
          (iat.pattern_type = 'contains' AND LOWER(p_display_name) LIKE '%' || LOWER(iat.account_pattern) || '%')
          OR (iat.pattern_type = 'equals' AND LOWER(p_display_name) = LOWER(iat.account_pattern))
          OR (iat.pattern_type = 'starts_with' AND LOWER(p_display_name) LIKE LOWER(iat.account_pattern) || '%')
      )
    LIMIT 1;

    -- Default to CLINIC if pattern matched but no department
    RETURN COALESCE(v_org_code, 'CLINIC');
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 6. View for internal accounts with their department mapping
-- ============================================================

\echo 'Creating v_internal_accounts view...'

CREATE OR REPLACE VIEW trapper.v_internal_accounts AS
SELECT
    p.person_id,
    p.display_name,
    p.is_canonical,
    iat.account_pattern AS matched_pattern,
    iat.maps_to_org_code AS department_code,
    o.display_name AS department_name,
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count
FROM trapper.sot_people p
LEFT JOIN trapper.internal_account_types iat ON
    iat.is_active = TRUE
    AND (
        (iat.pattern_type = 'contains' AND LOWER(p.display_name) LIKE '%' || LOWER(iat.account_pattern) || '%')
        OR (iat.pattern_type = 'equals' AND LOWER(p.display_name) = LOWER(iat.account_pattern))
        OR (iat.pattern_type = 'starts_with' AND LOWER(p.display_name) LIKE LOWER(iat.account_pattern) || '%')
    )
LEFT JOIN trapper.organizations o ON o.org_code = iat.maps_to_org_code
WHERE p.merged_into_person_id IS NULL
  AND trapper.is_internal_account(p.display_name);

-- ============================================================
-- 7. Initial run of canonical flags
-- ============================================================

\echo ''
\echo 'Running initial canonical flag computation...'

SELECT * FROM trapper.refresh_canonical_flags();

-- ============================================================
-- 8. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'
\echo ''

\echo 'Canonical distribution:'
SELECT
    CASE WHEN is_canonical THEN 'Canonical' ELSE 'Non-Canonical' END as type,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) as pct
FROM trapper.sot_people
WHERE merged_into_person_id IS NULL
GROUP BY is_canonical
ORDER BY is_canonical DESC NULLS LAST;

\echo ''
\echo 'Sample internal accounts:'
SELECT display_name, department_code, cat_count
FROM trapper.v_internal_accounts
ORDER BY cat_count DESC
LIMIT 10;

SELECT 'MIG_171 Complete' AS status;
