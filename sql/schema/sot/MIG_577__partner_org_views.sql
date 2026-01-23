\echo ''
\echo '=================================================='
\echo 'MIG_577: Partner Organization Tracking Views'
\echo '=================================================='
\echo ''
\echo 'Creates comprehensive views for tracking cats by partner org.'
\echo ''

-- ============================================================
-- View 1: All cats by partner organization
-- ============================================================
\echo 'Creating v_partner_org_cats...'

CREATE OR REPLACE VIEW trapper.v_partner_org_cats AS
SELECT DISTINCT ON (c.cat_id, COALESCE(coa.brought_by, po.org_name_short))
  c.cat_id,
  c.display_name as cat_name,
  ci.id_value as microchip,
  c.sex,
  c.altered_status,
  a.appointment_date,
  a.service_type,
  pl.formatted_address as origin_address,
  COALESCE(coa.brought_by,
    CASE WHEN a.partner_org_id IS NOT NULL THEN po.org_name_short END,
    'Unknown'
  ) as brought_by,
  COALESCE(per.display_name, coa.display_name) as contact_or_location,
  CASE
    WHEN per.display_name IS NOT NULL THEN 'person'
    WHEN coa.display_name IS NOT NULL THEN coa.account_type
    ELSE 'unknown'
  END as contact_type
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON a.cat_id = c.cat_id
LEFT JOIN trapper.cat_identifiers ci ON c.cat_id = ci.cat_id AND ci.id_type = 'microchip'
LEFT JOIN trapper.places pl ON COALESCE(a.inferred_place_id, a.place_id) = pl.place_id
LEFT JOIN trapper.sot_people per ON a.person_id = per.person_id
LEFT JOIN trapper.clinic_owner_accounts coa ON a.owner_account_id = coa.account_id
LEFT JOIN trapper.partner_organizations po ON a.partner_org_id = po.org_id
WHERE coa.brought_by IS NOT NULL
   OR a.partner_org_id IS NOT NULL
ORDER BY c.cat_id, COALESCE(coa.brought_by, po.org_name_short), a.appointment_date DESC;

COMMENT ON VIEW trapper.v_partner_org_cats IS 'All cats brought by partner organizations (SCAS, FFSC, etc.)';

-- ============================================================
-- View 2: Partner org summary stats
-- ============================================================
\echo 'Creating v_partner_org_stats...'

DROP VIEW IF EXISTS trapper.v_partner_org_stats;
CREATE VIEW trapper.v_partner_org_stats AS
SELECT
  COALESCE(coa.brought_by, po.org_name_short, 'Unknown') as org,
  COUNT(DISTINCT c.cat_id) as unique_cats,
  COUNT(DISTINCT a.appointment_id) as appointments,
  MIN(a.appointment_date) as first_appointment,
  MAX(a.appointment_date) as last_appointment,
  COUNT(DISTINCT CASE WHEN c.altered_status IN ('spayed', 'neutered') THEN c.cat_id END) as altered_cats,
  COUNT(DISTINCT CASE WHEN c.sex = 'female' THEN c.cat_id END) as female_cats,
  COUNT(DISTINCT CASE WHEN c.sex = 'male' THEN c.cat_id END) as male_cats,
  COUNT(DISTINCT coa.account_id) as unique_locations,
  COUNT(DISTINCT per.person_id) as unique_contacts
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON a.cat_id = c.cat_id
LEFT JOIN trapper.clinic_owner_accounts coa ON a.owner_account_id = coa.account_id
LEFT JOIN trapper.partner_organizations po ON a.partner_org_id = po.org_id
LEFT JOIN trapper.sot_people per ON a.person_id = per.person_id
WHERE coa.brought_by IS NOT NULL OR a.partner_org_id IS NOT NULL
GROUP BY COALESCE(coa.brought_by, po.org_name_short, 'Unknown');

COMMENT ON VIEW trapper.v_partner_org_stats IS 'Summary statistics for each partner organization';

-- ============================================================
-- View 3: SCAS-specific view (frequently queried)
-- ============================================================
\echo 'Creating v_scas_cats...'

CREATE OR REPLACE VIEW trapper.v_scas_cats AS
SELECT
  c.cat_id,
  c.display_name as cat_name,
  ci.id_value as microchip,
  c.sex,
  c.altered_status,
  a.appointment_date,
  a.service_type,
  pl.formatted_address as origin_address,
  COALESCE(per.display_name, coa.display_name) as contact_or_location,
  CASE
    WHEN per.display_name IS NOT NULL THEN 'person'
    WHEN coa.display_name IS NOT NULL THEN coa.account_type
    ELSE 'unknown'
  END as contact_type
FROM trapper.sot_appointments a
JOIN trapper.sot_cats c ON a.cat_id = c.cat_id
LEFT JOIN trapper.cat_identifiers ci ON c.cat_id = ci.cat_id AND ci.id_type = 'microchip'
LEFT JOIN trapper.places pl ON COALESCE(a.inferred_place_id, a.place_id) = pl.place_id
LEFT JOIN trapper.sot_people per ON a.person_id = per.person_id
LEFT JOIN trapper.clinic_owner_accounts coa ON a.owner_account_id = coa.account_id
LEFT JOIN trapper.partner_organizations po ON a.partner_org_id = po.org_id
WHERE coa.brought_by = 'SCAS'
   OR a.partner_org_id = '21236166-35e4-48b7-9b5f-8fec7e7a4e3f'::uuid
   OR per.account_type_reason LIKE '%SCAS%'
ORDER BY a.appointment_date DESC;

COMMENT ON VIEW trapper.v_scas_cats IS 'All cats brought by SCAS (Sonoma County Animal Services)';

-- ============================================================
-- View 4: FFSC trapping locations
-- ============================================================
\echo 'Creating v_ffsc_trapping_locations...'

CREATE OR REPLACE VIEW trapper.v_ffsc_trapping_locations AS
SELECT
  coa.account_id,
  coa.display_name as location_name,
  coa.account_type,
  pl.formatted_address,
  COUNT(DISTINCT a.cat_id) as cats_trapped,
  COUNT(DISTINCT a.appointment_id) as appointments,
  MIN(a.appointment_date) as first_appointment,
  MAX(a.appointment_date) as last_appointment,
  COUNT(DISTINCT CASE WHEN c.altered_status IN ('spayed', 'neutered') THEN c.cat_id END) as altered_cats
FROM trapper.clinic_owner_accounts coa
LEFT JOIN trapper.places pl ON coa.linked_place_id = pl.place_id
LEFT JOIN trapper.sot_appointments a ON a.owner_account_id = coa.account_id
LEFT JOIN trapper.sot_cats c ON a.cat_id = c.cat_id
WHERE coa.brought_by = 'FFSC'
GROUP BY coa.account_id, coa.display_name, coa.account_type, pl.formatted_address
ORDER BY cats_trapped DESC;

COMMENT ON VIEW trapper.v_ffsc_trapping_locations IS 'FFSC trapping locations with cat counts';

-- ============================================================
-- View 5: Partner org contacts (people linked to orgs)
-- ============================================================
\echo 'Creating v_partner_org_contacts...'

CREATE OR REPLACE VIEW trapper.v_partner_org_contacts AS
SELECT
  p.person_id,
  p.display_name,
  p.account_type_reason,
  CASE
    WHEN p.account_type_reason LIKE '%SCAS%' THEN 'SCAS'
    WHEN p.account_type_reason LIKE '%FFSC%' THEN 'FFSC'
  END as org,
  COUNT(DISTINCT a.cat_id) as cats_handled,
  COUNT(DISTINCT a.appointment_id) as appointments,
  MIN(a.appointment_date) as first_appointment,
  MAX(a.appointment_date) as last_appointment
FROM trapper.sot_people p
LEFT JOIN trapper.sot_appointments a ON a.person_id = p.person_id
WHERE p.account_type_reason LIKE '%contact%'
  AND p.merged_into_person_id IS NULL
GROUP BY p.person_id, p.display_name, p.account_type_reason
ORDER BY cats_handled DESC;

COMMENT ON VIEW trapper.v_partner_org_contacts IS 'People identified as contacts for partner organizations';

-- ============================================================
-- View 6: Accounts by brought_by (for admin dashboards)
-- ============================================================
\echo 'Creating v_clinic_accounts_by_org...'

CREATE OR REPLACE VIEW trapper.v_clinic_accounts_by_org AS
SELECT
  coa.brought_by,
  coa.account_type,
  COUNT(*) as account_count,
  COUNT(coa.linked_place_id) as with_place,
  COUNT(coa.ai_researched_at) as ai_enriched
FROM trapper.clinic_owner_accounts coa
WHERE coa.brought_by IS NOT NULL
GROUP BY coa.brought_by, coa.account_type
ORDER BY coa.brought_by, account_count DESC;

COMMENT ON VIEW trapper.v_clinic_accounts_by_org IS 'Summary of clinic owner accounts by partner org';

-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_577 Complete!'
\echo '=================================================='
\echo ''

\echo 'Created views:'
\echo '  - v_partner_org_cats (all cats by partner org)'
\echo '  - v_partner_org_stats (summary stats by org)'
\echo '  - v_scas_cats (SCAS-specific cats)'
\echo '  - v_ffsc_trapping_locations (FFSC trapping sites)'
\echo '  - v_partner_org_contacts (org contact people)'
\echo '  - v_clinic_accounts_by_org (account summary)'
\echo ''
