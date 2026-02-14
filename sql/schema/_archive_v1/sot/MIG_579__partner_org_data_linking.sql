\echo ''
\echo '=================================================='
\echo 'MIG_579: Partner Org Data Linking (Rerunnable)'
\echo '=================================================='
\echo ''
\echo 'Links all cats to partner organizations based on:'
\echo '  - ShelterLuv transfer source'
\echo '  - ClinicHQ animal name patterns'
\echo '  - sot_people display name patterns'
\echo '  - clinic_owner_accounts brought_by field'
\echo ''
\echo 'This migration is IDEMPOTENT and safe to rerun.'
\echo ''

-- ============================================================
-- STEP 1: Define partner org mappings
-- ============================================================
\echo 'Setting up partner org mappings...'

-- Ensure all partner orgs exist
INSERT INTO trapper.partner_organizations (org_name, org_name_short, org_type, is_active)
VALUES
  ('Sonoma County Animal Services', 'SCAS', 'animal_services', true),
  ('Forgotten Felines of Sonoma County', 'FFSC', 'nonprofit', true),
  ('Rohnert Park Animal Shelter', 'RPAS', 'shelter', true),
  ('Marin Humane', 'MH', 'shelter', true),
  ('Countryside Rescue', 'CR', 'rescue', true)
ON CONFLICT (org_name) DO NOTHING;

-- ============================================================
-- STEP 2: Link cats from ShelterLuv transfer sources
-- ============================================================
\echo ''
\echo 'Linking cats from ShelterLuv transfer sources...'

-- SCAS from ShelterLuv
WITH scas_chips AS (
  SELECT DISTINCT payload->>'Microchip Number' as microchip
  FROM trapper.staged_records
  WHERE source_system = 'shelterluv'
    AND (
      payload->>'Transfer From' ILIKE '%sonoma county animal%'
      OR payload->>'Original Source' ILIKE '%sonoma county animal%'
      OR payload->>'Previous Shelter ID' ILIKE '%scas%'
    )
    AND payload->>'Microchip Number' IS NOT NULL
    AND payload->>'Microchip Number' <> ''
),
scas_cat_ids AS (
  SELECT DISTINCT ci.cat_id
  FROM scas_chips sc
  JOIN trapper.cat_identifiers ci ON ci.id_value = sc.microchip AND ci.id_type = 'microchip'
)
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name_short = 'SCAS' LIMIT 1)
FROM scas_cat_ids sc
WHERE a.cat_id = sc.cat_id
  AND a.partner_org_id IS NULL;

-- Rohnert Park from ShelterLuv
WITH rp_chips AS (
  SELECT DISTINCT payload->>'Microchip Number' as microchip
  FROM trapper.staged_records
  WHERE source_system = 'shelterluv'
    AND payload->>'Transfer From' ILIKE '%rohnert%'
    AND payload->>'Microchip Number' IS NOT NULL
    AND payload->>'Microchip Number' <> ''
),
rp_cat_ids AS (
  SELECT DISTINCT ci.cat_id
  FROM rp_chips rp
  JOIN trapper.cat_identifiers ci ON ci.id_value = rp.microchip AND ci.id_type = 'microchip'
)
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name ILIKE '%rohnert%' LIMIT 1)
FROM rp_cat_ids rc
WHERE a.cat_id = rc.cat_id
  AND a.partner_org_id IS NULL;

-- ============================================================
-- STEP 3: Link cats from ClinicHQ animal name patterns
-- ============================================================
\echo ''
\echo 'Linking cats from ClinicHQ animal name patterns...'

-- SCAS from ClinicHQ animal names
WITH scas_chips AS (
  SELECT DISTINCT payload->>'Microchip Number' as microchip
  FROM trapper.staged_records
  WHERE source_system = 'clinichq'
    AND source_table = 'owner_info'
    AND payload->>'Animal Name' ~* 'scas'
    AND payload->>'Microchip Number' IS NOT NULL
    AND payload->>'Microchip Number' <> ''
),
scas_cat_ids AS (
  SELECT DISTINCT ci.cat_id
  FROM scas_chips sc
  JOIN trapper.cat_identifiers ci ON ci.id_value = sc.microchip AND ci.id_type = 'microchip'
)
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name_short = 'SCAS' LIMIT 1)
FROM scas_cat_ids sc
WHERE a.cat_id = sc.cat_id
  AND a.partner_org_id IS NULL;

-- FFSC from ClinicHQ animal names
WITH ffsc_chips AS (
  SELECT DISTINCT payload->>'Microchip Number' as microchip
  FROM trapper.staged_records
  WHERE source_system = 'clinichq'
    AND source_table = 'owner_info'
    AND payload->>'Animal Name' ~* 'ffsc|forgotten'
    AND payload->>'Microchip Number' IS NOT NULL
    AND payload->>'Microchip Number' <> ''
),
ffsc_cat_ids AS (
  SELECT DISTINCT ci.cat_id
  FROM ffsc_chips fc
  JOIN trapper.cat_identifiers ci ON ci.id_value = fc.microchip AND ci.id_type = 'microchip'
)
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name_short = 'FFSC' LIMIT 1)
FROM ffsc_cat_ids fc
WHERE a.cat_id = fc.cat_id
  AND a.partner_org_id IS NULL;

-- ============================================================
-- STEP 4: Link appointments via sot_people display name patterns
-- ============================================================
\echo ''
\echo 'Linking appointments via sot_people display name patterns...'

-- FFSC patterns
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name_short = 'FFSC' LIMIT 1)
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND p.display_name ~* 'ffsc|forgotten felines'
  AND a.partner_org_id IS NULL;

-- SCAS patterns
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name_short = 'SCAS' LIMIT 1)
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND p.display_name ~* 'scas|sonoma county animal'
  AND a.partner_org_id IS NULL;

-- Rohnert Park patterns
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name ILIKE '%rohnert%' LIMIT 1)
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND p.display_name ~* 'rohnert'
  AND a.partner_org_id IS NULL;

-- Marin Humane patterns
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name = 'Marin Humane' LIMIT 1)
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND p.display_name ~* 'marin.*humane'
  AND a.partner_org_id IS NULL;

-- Countryside Rescue patterns
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name = 'Countryside Rescue' LIMIT 1)
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND p.display_name ~* 'countryside'
  AND a.partner_org_id IS NULL;

-- ============================================================
-- STEP 5: Link appointments via clinic_owner_accounts brought_by
-- ============================================================
\echo ''
\echo 'Linking appointments via clinic_owner_accounts brought_by...'

-- SCAS via brought_by
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name_short = 'SCAS' LIMIT 1)
FROM trapper.clinic_owner_accounts coa
WHERE a.owner_account_id = coa.account_id
  AND coa.brought_by = 'SCAS'
  AND a.partner_org_id IS NULL;

-- FFSC via brought_by
UPDATE trapper.sot_appointments a
SET partner_org_id = (SELECT org_id FROM trapper.partner_organizations WHERE org_name_short = 'FFSC' LIMIT 1)
FROM trapper.clinic_owner_accounts coa
WHERE a.owner_account_id = coa.account_id
  AND coa.brought_by = 'FFSC'
  AND a.partner_org_id IS NULL;

-- ============================================================
-- STEP 6: Clear person_id on migrated accounts
-- ============================================================
\echo ''
\echo 'Clearing person_id on migrated appointments...'

UPDATE trapper.sot_appointments a
SET person_id = NULL
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND p.account_type = 'migrated_to_account'
  AND a.owner_account_id IS NOT NULL;

-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_579 Complete!'
\echo '=================================================='
\echo ''

\echo 'Partner org statistics:'
SELECT
  COALESCE(po.org_name_short, 'Unknown') as org,
  COUNT(DISTINCT c.cat_id) as unique_cats,
  COUNT(DISTINCT a.appointment_id) as appointments
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON a.cat_id = c.cat_id
LEFT JOIN trapper.partner_organizations po ON a.partner_org_id = po.org_id
WHERE a.partner_org_id IS NOT NULL
GROUP BY COALESCE(po.org_name_short, 'Unknown')
ORDER BY unique_cats DESC;

\echo ''
\echo 'Linking summary:'
SELECT
  'Total ClinicHQ appointments' as metric,
  COUNT(*)::text as value
FROM trapper.sot_appointments
WHERE source_system = 'clinichq'
UNION ALL
SELECT 'With partner_org_id', COUNT(*)::text
FROM trapper.sot_appointments
WHERE source_system = 'clinichq' AND partner_org_id IS NOT NULL
UNION ALL
SELECT 'With owner_account_id', COUNT(*)::text
FROM trapper.sot_appointments
WHERE source_system = 'clinichq' AND owner_account_id IS NOT NULL;
