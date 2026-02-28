-- MIG_2547: Fix classify_owner_name call in upsert_clinic_account_for_owner
--
-- Problem: ops.upsert_clinic_account_for_owner() calls sot.classify_owner_name
-- with 2 parameters (p_first_name, p_last_name) but the function only accepts 1.
--
-- Solution: Create a 2-parameter overload that concatenates the names, OR fix
-- the caller to concatenate before calling. We'll do the cleaner solution:
-- create a 2-param version that wraps the 1-param version.
--
-- Created: 2026-02-26

\echo ''
\echo '=============================================='
\echo '  MIG_2547: Fix classify_owner_name signature'
\echo '=============================================='
\echo ''

-- Option: Create a 2-parameter overload that delegates to the 1-param version
CREATE OR REPLACE FUNCTION sot.classify_owner_name(p_first_name TEXT, p_last_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
BEGIN
    -- Concatenate names and delegate to the main function
    RETURN sot.classify_owner_name(
        TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''))
    );
END;
$$;

COMMENT ON FUNCTION sot.classify_owner_name(TEXT, TEXT) IS
'2-parameter overload for classify_owner_name.
Concatenates first and last name, then delegates to the 1-param version.
Used by ops.upsert_clinic_account_for_owner().';

\echo ''
\echo 'Testing the new overload...'

SELECT
    'John Smith' as test_input,
    sot.classify_owner_name('John', 'Smith') as result_2param,
    sot.classify_owner_name('John Smith') as result_1param;

SELECT
    'World Of Carpets' as test_input,
    sot.classify_owner_name('World Of Carpets', 'Santa Rosa') as result_2param,
    sot.classify_owner_name('World Of Carpets Santa Rosa') as result_1param;

SELECT
    '123 Main St' as test_input,
    sot.classify_owner_name('123 Main St', 'Apt 4') as result_2param,
    sot.classify_owner_name('123 Main St Apt 4') as result_1param;

\echo ''
\echo '=============================================='
\echo '  MIG_2547 Complete'
\echo '=============================================='
\echo ''
