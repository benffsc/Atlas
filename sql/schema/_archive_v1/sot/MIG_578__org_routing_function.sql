\echo ''
\echo '=================================================='
\echo 'MIG_578: Partner Org Routing Function'
\echo '=================================================='
\echo ''
\echo 'Creates function to detect and route partner org patterns'
\echo 'for consistent handling in future ClinicHQ imports.'
\echo ''

-- ============================================================
-- Function: Detect partner org pattern in owner name
-- ============================================================
\echo 'Creating detect_partner_org_pattern function...'

CREATE OR REPLACE FUNCTION trapper.detect_partner_org_pattern(p_owner_name TEXT)
RETURNS TABLE (
  pattern_type TEXT,
  org_short_name TEXT,
  extracted_name TEXT,
  is_person BOOLEAN
) AS $$
DECLARE
  v_cleaned TEXT;
  v_org TEXT;
  v_pattern TEXT;
  v_is_person BOOLEAN;
BEGIN
  -- Handle NULL/empty input
  IF p_owner_name IS NULL OR trim(p_owner_name) = '' THEN
    RETURN;
  END IF;

  -- Detect org in name
  IF p_owner_name ~* '(scas|sonoma county animal)' THEN
    v_org := 'SCAS';
  ELSIF p_owner_name ~* '(ffsc|forgotten felines)' THEN
    v_org := 'FFSC';
  ELSIF p_owner_name ~* '^lmfm\s+' THEN
    -- LMFM = Love Me Fix Me (Sonoma Humane waiver program)
    v_org := 'LMFM';
  ELSE
    RETURN;  -- No org pattern detected
  END IF;

  -- Remove org prefix/suffix to get cleaned name
  v_cleaned := p_owner_name;
  v_cleaned := regexp_replace(v_cleaned, '^(scas|ffsc|lmfm)\s+', '', 'i');
  v_cleaned := regexp_replace(v_cleaned, '\s+(scas|ffsc)$', '', 'i');
  v_cleaned := regexp_replace(v_cleaned, '^forgotten felines\s*', '', 'i');
  v_cleaned := regexp_replace(v_cleaned, '^sonoma county animal\s*(services)?\s*', '', 'i');
  v_cleaned := trim(v_cleaned);

  org_short_name := v_org;
  extracted_name := v_cleaned;

  -- Determine pattern type
  IF v_cleaned = '' OR v_cleaned ~* '^(scas|ffsc|forgotten felines|sonoma county)' THEN
    -- Just the org name itself
    pattern_type := 'org_only';
    is_person := FALSE;
  ELSIF v_org = 'LMFM' THEN
    -- LMFM is always a person (waiver program participant)
    pattern_type := 'org_person';
    is_person := TRUE;
  ELSIF v_cleaned ~* '^[A-Z][a-z]+\s+[A-Z][a-z]+$' THEN
    -- Looks like "First Last" person name pattern
    pattern_type := 'org_person';
    is_person := TRUE;
  ELSIF v_cleaned ~* '^[A-Z][a-z]+\s+[A-Z][a-z]+\s+[A-Z][a-z]+$' THEN
    -- Looks like "First Middle Last" person name pattern
    pattern_type := 'org_person';
    is_person := TRUE;
  ELSIF v_cleaned ~* '^\d+' THEN
    -- Starts with number = address
    pattern_type := 'org_address';
    is_person := FALSE;
  ELSIF v_cleaned ~* '\b(school|church|market|store|hospital|center|park|trail|winery|farm|dairy|restaurant|hotel|motel|apartments?|complex|mobile home|trailer)\b' THEN
    -- Contains organization/location keywords
    pattern_type := 'org_location';
    is_person := FALSE;
  ELSE
    -- Default to location for anything else
    pattern_type := 'org_location';
    is_person := FALSE;
  END IF;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.detect_partner_org_pattern IS
'Detects partner org patterns in ClinicHQ owner names. Returns pattern type, org, extracted name, and whether it''s a person.';

-- ============================================================
-- Function: Route owner to appropriate table
-- ============================================================
\echo 'Creating route_clinichq_owner function...'

CREATE OR REPLACE FUNCTION trapper.route_clinichq_owner(
  p_owner_name TEXT,
  p_appointment_id UUID DEFAULT NULL
)
RETURNS TABLE (
  routed_to TEXT,
  entity_id UUID,
  brought_by TEXT,
  routing_notes TEXT
) AS $$
DECLARE
  v_pattern RECORD;
  v_person_id UUID;
  v_account_id UUID;
  v_existing_id UUID;
BEGIN
  -- Detect pattern
  SELECT * INTO v_pattern
  FROM trapper.detect_partner_org_pattern(p_owner_name);

  IF v_pattern IS NULL THEN
    -- No org pattern, return empty (let normal processing handle it)
    RETURN;
  END IF;

  IF v_pattern.pattern_type = 'org_only' THEN
    -- Just the org name, only set partner_org_id on appointment
    routed_to := 'partner_org_only';
    brought_by := v_pattern.org_short_name;
    routing_notes := 'Owner is just org name, set partner_org_id only';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_pattern.is_person THEN
    -- Check if person already exists
    SELECT person_id INTO v_existing_id
    FROM trapper.sot_people
    WHERE lower(display_name) = lower(v_pattern.extracted_name)
      AND merged_into_person_id IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      entity_id := v_existing_id;
      routed_to := 'existing_person';
    ELSE
      -- Create new person
      INSERT INTO trapper.sot_people (
        display_name,
        data_source,
        account_type,
        account_type_reason
      ) VALUES (
        v_pattern.extracted_name,
        'clinichq',
        'person',
        v_pattern.org_short_name || ' contact - extracted from ClinicHQ'
      )
      RETURNING person_id INTO entity_id;
      routed_to := 'new_person';
    END IF;

    brought_by := v_pattern.org_short_name;
    routing_notes := 'Person extracted from ' || p_owner_name;

  ELSE
    -- Location/address - goes to clinic_owner_accounts
    SELECT account_id INTO v_existing_id
    FROM trapper.clinic_owner_accounts
    WHERE lower(display_name) = lower(v_pattern.extracted_name)
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      entity_id := v_existing_id;
      routed_to := 'existing_account';
    ELSE
      -- Create new account
      INSERT INTO trapper.clinic_owner_accounts (
        display_name,
        account_type,
        brought_by,
        source_system,
        source_display_names,
        ai_research_notes
      ) VALUES (
        v_pattern.extracted_name,
        CASE
          WHEN v_pattern.pattern_type = 'org_address' THEN 'address'
          ELSE 'organization'
        END,
        v_pattern.org_short_name,
        'clinichq',
        ARRAY[p_owner_name],
        'Auto-created from ClinicHQ import'
      )
      RETURNING account_id INTO entity_id;
      routed_to := 'new_account';
    END IF;

    brought_by := v_pattern.org_short_name;
    routing_notes := 'Location extracted from ' || p_owner_name;
  END IF;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.route_clinichq_owner IS
'Routes ClinicHQ owner names to appropriate tables (sot_people or clinic_owner_accounts) based on detected patterns.';

-- ============================================================
-- Create organization_person_mappings for known contacts
-- ============================================================
\echo 'Creating org-person mappings for known contacts...'

INSERT INTO trapper.organization_person_mappings (
  org_pattern,
  org_pattern_type,
  representative_person_id,
  org_display_name,
  notes
)
SELECT
  '%' || p.display_name || '%',
  'ilike',
  p.person_id,
  CASE
    WHEN p.account_type_reason LIKE '%SCAS%' THEN 'SCAS - ' || p.display_name
    WHEN p.account_type_reason LIKE '%FFSC%' THEN 'FFSC - ' || p.display_name
    WHEN p.account_type_reason LIKE '%LMFM%' THEN 'LMFM - ' || p.display_name
  END,
  'Auto-created for partner org contact recognition'
FROM trapper.sot_people p
WHERE p.account_type_reason LIKE '%contact%'
  AND p.merged_into_person_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM trapper.organization_person_mappings opm
    WHERE opm.representative_person_id = p.person_id
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- SUMMARY
-- ============================================================
\echo ''
\echo '=================================================='
\echo 'MIG_578 Complete!'
\echo '=================================================='
\echo ''

\echo 'Created functions:'
\echo '  - detect_partner_org_pattern(owner_name) - Detects org patterns'
\echo '  - route_clinichq_owner(owner_name, appt_id) - Routes to correct table'
\echo ''

\echo 'Pattern detection examples:'
SELECT
  test_name,
  (trapper.detect_partner_org_pattern(test_name)).*
FROM (VALUES
  ('Scas Mark Belew'),
  ('286 Skillman SCAS'),
  ('Ffsc Big John''s Market'),
  ('Comstock Middle School FFSC'),
  ('LMFM John Smith'),
  ('Forgotten Felines Foster'),
  ('Regular Owner Name')
) AS t(test_name);
