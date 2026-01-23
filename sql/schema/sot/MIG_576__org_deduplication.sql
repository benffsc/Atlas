\echo ''
\echo '=================================================='
\echo 'MIG_576: Org Deduplication & Cleanup'
\echo '=================================================='
\echo ''

-- ============================================================
-- STEP 1: Show current duplicates
-- ============================================================
\echo 'Checking for duplicate clinic_owner_accounts...'

SELECT display_name, COUNT(*) as count
FROM trapper.clinic_owner_accounts
GROUP BY display_name
HAVING COUNT(*) > 1
ORDER BY count DESC
LIMIT 10;

-- ============================================================
-- STEP 2: Deduplicate clinic_owner_accounts
-- ============================================================
\echo ''
\echo 'Deduplicating clinic_owner_accounts (keeping best record)...'

-- First, reassign appointments to the keeper record
WITH duplicates AS (
  SELECT
    lower(display_name) as lower_name,
    array_agg(account_id ORDER BY
      CASE WHEN linked_place_id IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN ai_researched_at IS NOT NULL THEN 0 ELSE 1 END,
      created_at
    ) as account_ids
  FROM trapper.clinic_owner_accounts
  GROUP BY lower(display_name)
  HAVING COUNT(*) > 1
),
keeper_mapping AS (
  SELECT
    unnest(account_ids[2:]) as dup_id,
    account_ids[1] as keeper_id
  FROM duplicates
)
UPDATE trapper.sot_appointments a
SET owner_account_id = km.keeper_id
FROM keeper_mapping km
WHERE a.owner_account_id = km.dup_id;

-- Now delete the duplicates
WITH duplicates AS (
  SELECT lower(display_name) as norm_name,
    array_agg(account_id ORDER BY
      CASE WHEN linked_place_id IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN ai_researched_at IS NOT NULL THEN 0 ELSE 1 END,
      created_at
    ) as account_ids
  FROM trapper.clinic_owner_accounts
  GROUP BY lower(display_name)
  HAVING COUNT(*) > 1
)
DELETE FROM trapper.clinic_owner_accounts
WHERE account_id IN (SELECT unnest(account_ids[2:]) FROM duplicates);

\echo 'Duplicates removed'

-- ============================================================
-- STEP 3: Clean up partner_organizations
-- ============================================================
\echo ''
\echo 'Cleaning up partner_organizations (removing location entries)...'

-- Show what will be deleted
SELECT org_name FROM trapper.partner_organizations
WHERE org_name ILIKE '%FFSC'
  AND org_name NOT IN ('FFSC', 'Forgotten Felines of Sonoma County');

-- First, clear partner_org_id on appointments referencing these entries
UPDATE trapper.sot_appointments
SET partner_org_id = NULL
WHERE partner_org_id IN (
  SELECT org_id FROM trapper.partner_organizations
  WHERE org_name ILIKE '%FFSC'
    AND org_name NOT IN ('FFSC', 'Forgotten Felines of Sonoma County')
);

-- Now delete the location entries
DELETE FROM trapper.partner_organizations
WHERE org_name ILIKE '%FFSC'
  AND org_name NOT IN ('FFSC', 'Forgotten Felines of Sonoma County');

\echo 'Location entries removed from partner_organizations'

-- ============================================================
-- STEP 4: Ensure FFSC is in partner_organizations
-- ============================================================
\echo ''
\echo 'Ensuring FFSC is in partner_organizations...'

INSERT INTO trapper.partner_organizations (org_name, org_name_short, org_type, is_active)
VALUES ('Forgotten Felines of Sonoma County', 'FFSC', 'nonprofit', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_576 Complete!'
\echo '=================================================='
\echo ''

\echo 'Current partner_organizations:'
SELECT org_id, org_name, org_name_short, org_type
FROM trapper.partner_organizations
ORDER BY org_name;

\echo ''
\echo 'Clinic owner accounts by brought_by:'
SELECT brought_by, COUNT(*) as accounts
FROM trapper.clinic_owner_accounts
WHERE brought_by IS NOT NULL
GROUP BY brought_by
ORDER BY accounts DESC;
