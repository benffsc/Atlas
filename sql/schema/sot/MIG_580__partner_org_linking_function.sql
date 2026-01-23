\echo ''
\echo '=================================================='
\echo 'MIG_580: Partner Org Linking Function'
\echo '=================================================='
\echo ''
\echo 'Creates a function to link appointments to partner orgs'
\echo 'based on all available data sources. Call after each ingest.'
\echo ''

-- ============================================================
-- Function: Link appointments to partner organizations
-- ============================================================
CREATE OR REPLACE FUNCTION trapper.link_appointments_to_partner_orgs()
RETURNS TABLE (
  source TEXT,
  appointments_linked INT
) AS $$
DECLARE
  v_scas_id UUID;
  v_ffsc_id UUID;
  v_rp_id UUID;
  v_mh_id UUID;
  v_cr_id UUID;
  v_count INT;
BEGIN
  -- Get partner org IDs
  SELECT org_id INTO v_scas_id FROM trapper.partner_organizations WHERE org_name_short = 'SCAS' LIMIT 1;
  SELECT org_id INTO v_ffsc_id FROM trapper.partner_organizations WHERE org_name_short = 'FFSC' LIMIT 1;
  SELECT org_id INTO v_rp_id FROM trapper.partner_organizations WHERE org_name ILIKE '%rohnert%' LIMIT 1;
  SELECT org_id INTO v_mh_id FROM trapper.partner_organizations WHERE org_name = 'Marin Humane' LIMIT 1;
  SELECT org_id INTO v_cr_id FROM trapper.partner_organizations WHERE org_name = 'Countryside Rescue' LIMIT 1;

  -- 1. Link SCAS from ShelterLuv
  WITH scas_chips AS (
    SELECT DISTINCT payload->>'Microchip Number' as microchip
    FROM trapper.staged_records
    WHERE source_system = 'shelterluv'
      AND (payload->>'Transfer From' ILIKE '%sonoma county animal%'
           OR payload->>'Original Source' ILIKE '%sonoma county animal%'
           OR payload->>'Previous Shelter ID' ILIKE '%scas%')
      AND payload->>'Microchip Number' IS NOT NULL AND payload->>'Microchip Number' <> ''
  ),
  scas_cat_ids AS (
    SELECT DISTINCT ci.cat_id FROM scas_chips sc
    JOIN trapper.cat_identifiers ci ON ci.id_value = sc.microchip AND ci.id_type = 'microchip'
  ),
  updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_scas_id
    FROM scas_cat_ids sc WHERE a.cat_id = sc.cat_id AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'ShelterLuv SCAS transfer'; appointments_linked := v_count; RETURN NEXT;

  -- 2. Link SCAS from ClinicHQ animal names
  WITH scas_chips AS (
    SELECT DISTINCT payload->>'Microchip Number' as microchip
    FROM trapper.staged_records
    WHERE source_system = 'clinichq' AND source_table = 'owner_info'
      AND payload->>'Animal Name' ~* 'scas'
      AND payload->>'Microchip Number' IS NOT NULL AND payload->>'Microchip Number' <> ''
  ),
  scas_cat_ids AS (
    SELECT DISTINCT ci.cat_id FROM scas_chips sc
    JOIN trapper.cat_identifiers ci ON ci.id_value = sc.microchip AND ci.id_type = 'microchip'
  ),
  updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_scas_id
    FROM scas_cat_ids sc WHERE a.cat_id = sc.cat_id AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'ClinicHQ SCAS animal name'; appointments_linked := v_count; RETURN NEXT;

  -- 3. Link FFSC from ClinicHQ animal names
  WITH ffsc_chips AS (
    SELECT DISTINCT payload->>'Microchip Number' as microchip
    FROM trapper.staged_records
    WHERE source_system = 'clinichq' AND source_table = 'owner_info'
      AND payload->>'Animal Name' ~* 'ffsc|forgotten'
      AND payload->>'Microchip Number' IS NOT NULL AND payload->>'Microchip Number' <> ''
  ),
  ffsc_cat_ids AS (
    SELECT DISTINCT ci.cat_id FROM ffsc_chips fc
    JOIN trapper.cat_identifiers ci ON ci.id_value = fc.microchip AND ci.id_type = 'microchip'
  ),
  updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_ffsc_id
    FROM ffsc_cat_ids fc WHERE a.cat_id = fc.cat_id AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'ClinicHQ FFSC animal name'; appointments_linked := v_count; RETURN NEXT;

  -- 4. Link via sot_people display name patterns
  WITH updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_ffsc_id
    FROM trapper.sot_people p
    WHERE a.person_id = p.person_id AND p.display_name ~* 'ffsc|forgotten felines' AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'sot_people FFSC pattern'; appointments_linked := v_count; RETURN NEXT;

  WITH updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_scas_id
    FROM trapper.sot_people p
    WHERE a.person_id = p.person_id AND p.display_name ~* 'scas|sonoma county animal' AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'sot_people SCAS pattern'; appointments_linked := v_count; RETURN NEXT;

  WITH updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_rp_id
    FROM trapper.sot_people p
    WHERE a.person_id = p.person_id AND p.display_name ~* 'rohnert' AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'sot_people Rohnert Park pattern'; appointments_linked := v_count; RETURN NEXT;

  WITH updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_mh_id
    FROM trapper.sot_people p
    WHERE a.person_id = p.person_id AND p.display_name ~* 'marin.*humane' AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'sot_people Marin Humane pattern'; appointments_linked := v_count; RETURN NEXT;

  WITH updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_cr_id
    FROM trapper.sot_people p
    WHERE a.person_id = p.person_id AND p.display_name ~* 'countryside' AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'sot_people Countryside pattern'; appointments_linked := v_count; RETURN NEXT;

  -- 5. Link via clinic_owner_accounts brought_by
  WITH updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_scas_id
    FROM trapper.clinic_owner_accounts coa
    WHERE a.owner_account_id = coa.account_id AND coa.brought_by = 'SCAS' AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'clinic_owner_accounts SCAS'; appointments_linked := v_count; RETURN NEXT;

  WITH updated AS (
    UPDATE trapper.sot_appointments a SET partner_org_id = v_ffsc_id
    FROM trapper.clinic_owner_accounts coa
    WHERE a.owner_account_id = coa.account_id AND coa.brought_by = 'FFSC' AND a.partner_org_id IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;
  source := 'clinic_owner_accounts FFSC'; appointments_linked := v_count; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointments_to_partner_orgs IS
'Links appointments to partner organizations based on ShelterLuv transfers, ClinicHQ animal names, sot_people patterns, and clinic_owner_accounts. Call after each data ingest.';

-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_580 Complete!'
\echo '=================================================='
\echo ''

\echo 'Created function: trapper.link_appointments_to_partner_orgs()'
\echo ''
\echo 'Usage: SELECT * FROM trapper.link_appointments_to_partner_orgs();'
\echo ''
\echo 'Run after each data ingest to maintain partner org linkage.'
