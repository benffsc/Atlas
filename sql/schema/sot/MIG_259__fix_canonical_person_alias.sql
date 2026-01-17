-- MIG_259: Fix canonical_person_id function naming
--
-- Problem:
--   MIG_251 calls canonical_person_id() but MIG_225 defines get_canonical_person_id()
--   This naming inconsistency causes function not found errors
--
-- Solution:
--   Create canonical_person_id() as an alias to get_canonical_person_id()
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_259__fix_canonical_person_alias.sql

\echo ''
\echo '=============================================='
\echo 'MIG_259: Fix Canonical Person ID Alias'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Create alias function for canonical_person_id
-- ============================================================

\echo 'Creating canonical_person_id() alias...'

CREATE OR REPLACE FUNCTION trapper.canonical_person_id(p_person_id UUID)
RETURNS UUID AS $$
BEGIN
    RETURN trapper.get_canonical_person_id(p_person_id);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.canonical_person_id IS
'Alias for get_canonical_person_id() - follows merge chain to find canonical person.
Created for backwards compatibility with code that uses this naming convention.';

-- ============================================================
-- 2. Verify both functions exist and work
-- ============================================================

\echo ''
\echo 'Verifying functions...'

DO $$
DECLARE
    v_test_id UUID := gen_random_uuid();
    v_result1 UUID;
    v_result2 UUID;
BEGIN
    -- Both functions should return the input if person doesn't exist (no merge chain)
    SELECT trapper.get_canonical_person_id(v_test_id) INTO v_result1;
    SELECT trapper.canonical_person_id(v_test_id) INTO v_result2;

    IF v_result1 = v_result2 THEN
        RAISE NOTICE 'OK: Both functions return consistent results';
    ELSE
        RAISE EXCEPTION 'ERROR: Functions return different results';
    END IF;
END;
$$;

-- ============================================================
-- 3. Summary
-- ============================================================

\echo ''
\echo '====== SUMMARY ======'
\echo 'Created: trapper.canonical_person_id(UUID) -> UUID'
\echo 'Aliases: trapper.get_canonical_person_id(UUID)'
\echo ''

SELECT 'MIG_259 Complete' AS status;
