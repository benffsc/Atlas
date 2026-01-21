\echo ''
\echo '=============================================='
\echo 'MIG_533: SCAS Consolidation & Address Extraction'
\echo '=============================================='
\echo ''
\echo 'Handles SCAS appointment variants:'
\echo '  - "SCAS" → Link to SCAS partner org'
\echo '  - "286 Skillman Petaluma Scas" → Extract address, create place, link both'
\echo '  - "Scas Mark Belew" → Link to SCAS, note staff name'
\echo ''

-- ============================================================================
-- FUNCTION: extract_address_from_scas_name
-- Extracts the address portion from SCAS+address patterns
-- ============================================================================

\echo 'Creating extract_address_from_scas_name function...'

CREATE OR REPLACE FUNCTION trapper.extract_address_from_scas_name(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_address TEXT;
BEGIN
    IF p_name IS NULL THEN
        RETURN NULL;
    END IF;

    -- Pattern: "123 Street Name City Scas" or "123 Street Name Scas"
    -- Remove SCAS/Sonoma County Animal Services suffix
    v_address := TRIM(REGEXP_REPLACE(
        p_name,
        '\s*(Scas|SCAS|Sc Animal Services|Sonoma County Animal Services)\s*$',
        '',
        'i'
    ));

    -- Check if what remains looks like an address (starts with number)
    IF v_address ~ '^\d+\s+\w+' THEN
        -- Add CA if not present and looks like address
        IF v_address !~* ',\s*CA' AND v_address !~* 'California' THEN
            -- Try to detect city and add CA
            IF v_address ~* 'Petaluma|Santa Rosa|Sebastopol|Healdsburg|Rohnert Park|Windsor|Sonoma|Cotati' THEN
                v_address := v_address || ', CA';
            END IF;
        END IF;
        RETURN v_address;
    END IF;

    -- Check if it's "Sonoma County Animal Services 123 Address"
    v_address := TRIM(REGEXP_REPLACE(
        p_name,
        '^(Scas|SCAS|Sc Animal Services|Sonoma County Animal Services)\s+',
        '',
        'i'
    ));

    IF v_address ~ '^\d+\s+\w+' THEN
        IF v_address !~* ',\s*CA' THEN
            v_address := v_address || ', CA';
        END IF;
        RETURN v_address;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.extract_address_from_scas_name IS
'Extracts address from SCAS+address patterns like "286 Skillman Petaluma Scas".
Returns NULL if no address pattern detected.';

-- ============================================================================
-- FUNCTION: extract_staff_name_from_scas
-- Extracts staff name from SCAS+name patterns
-- ============================================================================

\echo 'Creating extract_staff_name_from_scas function...'

CREATE OR REPLACE FUNCTION trapper.extract_staff_name_from_scas(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_staff_name TEXT;
BEGIN
    IF p_name IS NULL THEN
        RETURN NULL;
    END IF;

    -- Pattern: "Scas Mark Belew" or "Mark Belew Scas"
    -- Remove SCAS prefix/suffix
    v_staff_name := TRIM(REGEXP_REPLACE(
        REGEXP_REPLACE(
            p_name,
            '\s*(Scas|SCAS)\s*$',
            '',
            'i'
        ),
        '^(Scas|SCAS)\s+',
        '',
        'i'
    ));

    -- Check if what remains looks like a name (no numbers, 2+ words)
    IF v_staff_name !~ '\d' AND v_staff_name ~ '^\w+\s+\w+' THEN
        RETURN v_staff_name;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION trapper.extract_staff_name_from_scas IS
'Extracts staff name from SCAS+name patterns like "Scas Mark Belew".
Returns NULL if no name pattern detected.';

-- ============================================================================
-- STEP 1: Identify SCAS address patterns and create places
-- ============================================================================

\echo 'Step 1: Creating places for SCAS cat origin addresses...'

WITH scas_addresses AS (
    SELECT DISTINCT
        p.display_name AS owner_name,
        trapper.extract_address_from_scas_name(p.display_name) AS extracted_address
    FROM trapper.sot_appointments a
    JOIN trapper.sot_people p ON a.person_id = p.person_id
    WHERE p.display_name ~* 'SCAS|Sonoma County Animal'
      AND trapper.extract_address_from_scas_name(p.display_name) IS NOT NULL
),
created_places AS (
    SELECT
        sa.owner_name,
        sa.extracted_address,
        trapper.find_or_create_place_deduped(
            sa.extracted_address,
            'SCAS Cat Origin: ' || sa.extracted_address,
            NULL, NULL, 'clinichq'
        ) AS place_id
    FROM scas_addresses sa
)
SELECT
    owner_name,
    extracted_address,
    place_id
FROM created_places
WHERE place_id IS NOT NULL;

\echo 'SCAS origin places created.'

-- ============================================================================
-- STEP 2: Link SCAS appointments with addresses to their places
-- ============================================================================

\echo 'Step 2: Linking SCAS appointments to cat origin places...'

WITH scas_appts AS (
    SELECT
        a.appointment_id,
        p.display_name AS owner_name,
        trapper.extract_address_from_scas_name(p.display_name) AS extracted_address,
        (SELECT place_id FROM trapper.places pl
         WHERE pl.formatted_address ILIKE '%' || trapper.extract_address_from_scas_name(p.display_name) || '%'
            OR pl.display_name ILIKE '%' || trapper.extract_address_from_scas_name(p.display_name) || '%'
         LIMIT 1
        ) AS origin_place_id
    FROM trapper.sot_appointments a
    JOIN trapper.sot_people p ON a.person_id = p.person_id
    WHERE p.display_name ~* 'SCAS|Sonoma County Animal'
      AND a.inferred_place_id IS NULL
      AND trapper.extract_address_from_scas_name(p.display_name) IS NOT NULL
)
UPDATE trapper.sot_appointments a
SET
    inferred_place_id = sa.origin_place_id,
    inferred_place_source = 'scas_address_extraction'
FROM scas_appts sa
WHERE a.appointment_id = sa.appointment_id
  AND sa.origin_place_id IS NOT NULL;

-- ============================================================================
-- STEP 3: Add org_place_mappings for SCAS addresses
-- ============================================================================

\echo 'Step 3: Creating org-place mappings for SCAS addresses...'

-- Create mappings so future appointments auto-link
INSERT INTO trapper.organization_place_mappings (
    org_pattern, org_pattern_type, place_id, org_display_name, notes, created_by
)
SELECT DISTINCT
    '%' || trapper.extract_address_from_scas_name(p.display_name) || '%Scas%',
    'ilike',
    pl.place_id,
    'SCAS: ' || trapper.extract_address_from_scas_name(p.display_name),
    'Auto-created from SCAS appointment address extraction',
    'MIG_533'
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON a.person_id = p.person_id
JOIN trapper.places pl ON (
    pl.formatted_address ILIKE '%' || trapper.extract_address_from_scas_name(p.display_name) || '%'
    OR pl.display_name ILIKE '%' || trapper.extract_address_from_scas_name(p.display_name) || '%'
)
WHERE p.display_name ~* 'SCAS|Sonoma County Animal'
  AND trapper.extract_address_from_scas_name(p.display_name) IS NOT NULL
ON CONFLICT (org_pattern, org_pattern_type) DO NOTHING;

-- ============================================================================
-- STEP 4: Mark places as colony sites
-- ============================================================================

\echo 'Step 4: Marking SCAS origin places as colony sites...'

INSERT INTO trapper.place_contexts (
    place_id, context_type, evidence_type, evidence_notes, assigned_by, source_system
)
SELECT DISTINCT
    a.inferred_place_id,
    'colony_site',
    'scas_referral',
    'Identified as SCAS referral location from appointment data',
    'MIG_533',
    'clinichq'
FROM trapper.sot_appointments a
WHERE a.inferred_place_source = 'scas_address_extraction'
  AND a.inferred_place_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM trapper.place_contexts pc
      WHERE pc.place_id = a.inferred_place_id AND pc.context_type = 'colony_site'
  )
ON CONFLICT DO NOTHING;

-- ============================================================================
-- STEP 5: Ensure all SCAS appointments have partner_org_id
-- ============================================================================

\echo 'Step 5: Ensuring all SCAS appointments have partner_org_id...'

UPDATE trapper.sot_appointments a
SET partner_org_id = (
    SELECT org_id FROM trapper.partner_organizations
    WHERE org_name = 'Sonoma County Animal Services'
    LIMIT 1
)
FROM trapper.sot_people p
WHERE a.person_id = p.person_id
  AND p.display_name ~* 'SCAS|Sonoma County Animal'
  AND a.partner_org_id IS NULL;

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_533 Complete!'
\echo '=============================================='
\echo ''

SELECT 'Total SCAS appointments' AS metric, COUNT(*)::text AS value
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON a.person_id = p.person_id
WHERE p.display_name ~* 'SCAS|Sonoma County Animal'
UNION ALL
SELECT 'SCAS appts with inferred_place_id', COUNT(*)::text
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON a.person_id = p.person_id
WHERE p.display_name ~* 'SCAS|Sonoma County Animal'
  AND a.inferred_place_id IS NOT NULL
UNION ALL
SELECT 'SCAS appts with partner_org_id', COUNT(*)::text
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON a.person_id = p.person_id
WHERE p.display_name ~* 'SCAS|Sonoma County Animal'
  AND a.partner_org_id IS NOT NULL
UNION ALL
SELECT 'SCAS origin places created', COUNT(DISTINCT inferred_place_id)::text
FROM trapper.sot_appointments
WHERE inferred_place_source = 'scas_address_extraction';

\echo ''
\echo 'SCAS variants breakdown:'
SELECT
    CASE
        WHEN trapper.extract_address_from_scas_name(p.display_name) IS NOT NULL THEN 'Address pattern'
        WHEN trapper.extract_staff_name_from_scas(p.display_name) IS NOT NULL THEN 'Staff name pattern'
        ELSE 'Simple SCAS'
    END AS pattern_type,
    COUNT(*) AS appointment_count
FROM trapper.sot_appointments a
JOIN trapper.sot_people p ON a.person_id = p.person_id
WHERE p.display_name ~* 'SCAS|Sonoma County Animal'
GROUP BY 1
ORDER BY 2 DESC;

\echo ''
