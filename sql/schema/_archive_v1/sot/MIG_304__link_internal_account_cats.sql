-- MIG_304: Link Cats from Internal Accounts to Organizations
--
-- Problem:
--   Cats from internal accounts (FF Foster, FFSC locations, etc.) were not
--   linked to organizations via cat_organization_relationships. This happened
--   because the data was processed before the org-linking function was created.
--
--   Example: "Forgotten Felines Foster" has 2,735 records but 0 cats linked
--   to FOSTER_ADOPT organization.
--
-- Solution:
--   Retroactively link cats to organizations based on their ClinicHQ owner
--   account names using the existing internal_account_types patterns.
--
-- Integration Notes:
--   - This fix should be integrated into reingest-clinichq-week.mjs
--   - The function process_clinichq_visit_v2() already handles this for new data
--   - Future ingests should call link_cat_to_organization() for internal accounts
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_304__link_internal_account_cats.sql

\echo ''
\echo '=============================================='
\echo 'MIG_304: Link Internal Account Cats'
\echo '=============================================='
\echo ''

-- ============================================
-- COUNT BEFORE
-- ============================================

\echo 'Current cat-organization links by org:'
SELECT o.org_code, o.display_name, COUNT(cor.cat_id) as cat_count
FROM trapper.organizations o
LEFT JOIN trapper.cat_organization_relationships cor ON cor.org_id = o.org_id
GROUP BY o.org_id, o.org_code, o.display_name
ORDER BY cat_count DESC;

-- ============================================
-- LINK CATS FROM INTERNAL ACCOUNTS
-- ============================================

\echo ''
\echo 'Linking cats from internal accounts to organizations...'

-- This query:
-- 1. Finds cats that have ClinicHQ owner records matching internal account patterns
-- 2. Gets the correct org_code for each internal account type
-- 3. Creates cat_organization_relationships

WITH internal_account_cats AS (
  -- Get unique cat/account combinations from ClinicHQ
  SELECT DISTINCT
    ci.cat_id,
    TRIM(CONCAT_WS(' ',
      NULLIF(TRIM(sr.payload->>'Owner First Name'), ''),
      NULLIF(TRIM(sr.payload->>'Owner Last Name'), '')
    )) as account_name
  FROM trapper.staged_records sr
  JOIN trapper.cat_identifiers ci ON ci.id_value = sr.payload->>'Microchip Number'
    AND ci.id_type = 'microchip'
  WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'owner_info'
    AND sr.payload->>'Microchip Number' IS NOT NULL
    AND sr.payload->>'Microchip Number' != ''
),
cats_with_org AS (
  -- Filter to only internal accounts and get their department
  SELECT
    iac.cat_id,
    iac.account_name,
    trapper.get_internal_account_department(iac.account_name) as org_code
  FROM internal_account_cats iac
  WHERE trapper.is_internal_account(iac.account_name)
)
INSERT INTO trapper.cat_organization_relationships (
  cat_id, org_id, relationship_type, original_account_name,
  source_system, source_table
)
SELECT
  cwo.cat_id,
  o.org_id,
  'program_cat',
  cwo.account_name,
  'clinichq',
  'MIG_304_backfill'
FROM cats_with_org cwo
JOIN trapper.organizations o ON o.org_code = cwo.org_code
ON CONFLICT (cat_id, org_id, relationship_type) DO UPDATE SET
  original_account_name = EXCLUDED.original_account_name;

-- ============================================
-- VERIFICATION
-- ============================================

\echo ''
\echo 'Cat-organization links AFTER migration:'
SELECT o.org_code, o.display_name, COUNT(cor.cat_id) as cat_count
FROM trapper.organizations o
LEFT JOIN trapper.cat_organization_relationships cor ON cor.org_id = o.org_id
GROUP BY o.org_id, o.org_code, o.display_name
ORDER BY cat_count DESC;

\echo ''
\echo 'Sample of newly linked cats:'
SELECT c.display_name as cat, o.display_name as organization, cor.original_account_name
FROM trapper.cat_organization_relationships cor
JOIN trapper.sot_cats c ON c.cat_id = cor.cat_id
JOIN trapper.organizations o ON o.org_id = cor.org_id
WHERE cor.source_table = 'MIG_304_backfill'
LIMIT 10;

\echo ''
\echo 'MIG_304 Complete!'
\echo ''
\echo 'IMPORTANT: To prevent this issue in future ingests:'
\echo '  1. reingest-clinichq-week.mjs should call process_clinichq_visit_v2()'
\echo '  2. Or explicitly call link_cat_to_organization() for internal accounts'
\echo '  3. The is_internal_account() function detects internal accounts'
\echo ''
