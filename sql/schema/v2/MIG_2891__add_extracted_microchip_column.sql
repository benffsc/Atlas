-- MIG_2891: Add extracted_microchip column to clinichq_scrape (FFS-387)
--
-- Problem: The scrape's microchip column contains raw values like
-- "981020053773686 (PetLink) Failed" — real chip numbers with registry suffixes.
-- All JOINs in MIG_2885-2889 used exact match (ci.id_value = s.microchip),
-- which matched 0 records via microchip path.
--
-- Fix: Store a clean extracted chip number in a dedicated column. Same approach
-- as extracted_clinichq_id (MIG_2883). Fallback chain extracts from multiple
-- source columns to maximize coverage.
--
-- Impact: 25,479 scrape rows have extractable microchips (24,528 unique).
-- 24,521 match sot.cat_identifiers (99.97%). With fixed matching:
-- ~27,417 total matches (+7,632 more records via microchip path).
--
-- Also rebuilds enrichment views to use stored column instead of inline SUBSTRING.
--
-- Safety: Additive column + view replacements. No data deleted.
-- Depends on: MIG_2879 (clinichq_scrape), MIG_2883 (extracted_clinichq_id, views)

BEGIN;

-- =============================================================================
-- Step 1: Add extracted_microchip column
-- =============================================================================

ALTER TABLE source.clinichq_scrape
    ADD COLUMN IF NOT EXISTS extracted_microchip TEXT;

COMMENT ON COLUMN source.clinichq_scrape.extracted_microchip IS
    'Clean 9-15 digit microchip extracted from microchip/animal_microchip_info/animal_id/heading/info columns (MIG_2891)';

CREATE INDEX IF NOT EXISTS idx_clinichq_scrape_extracted_microchip
    ON source.clinichq_scrape(extracted_microchip)
    WHERE extracted_microchip IS NOT NULL;

-- =============================================================================
-- Step 2: Populate via fallback chain
-- =============================================================================

UPDATE source.clinichq_scrape
SET extracted_microchip = COALESCE(
    -- Primary: microchip column ("981020053773686 (PetLink) Failed" → "981020053773686")
    SUBSTRING(microchip FROM '^([0-9]{9,15})'),
    -- Fallback 1: animal_microchip_info (same structure, catches NULLs in microchip)
    SUBSTRING(animal_microchip_info FROM '^([0-9]{9,15})'),
    -- Fallback 2: animal_id when it IS a microchip (9-15 digits only)
    CASE WHEN animal_id ~ '^[0-9]{9,15}$' THEN animal_id END,
    -- Fallback 3: embedded in heading text (exactly 15 digits to avoid false positives)
    SUBSTRING(animal_heading_raw FROM '([0-9]{15})'),
    -- Fallback 4: full text block (exactly 15 digits to avoid false positives)
    SUBSTRING(animal_info_raw FROM '([0-9]{15})')
)
WHERE extracted_microchip IS NULL;

-- =============================================================================
-- Step 3: Rebuild enrichment views with stored extracted_microchip
-- =============================================================================

-- Drop views (scrape-only, safe to cascade)
DROP VIEW IF EXISTS ops.v_scrape_appointment_enrichment CASCADE;
DROP VIEW IF EXISTS ops.v_scrape_cat_notes CASCADE;
DROP VIEW IF EXISTS ops.v_scrape_mortality_detail CASCADE;
DROP VIEW IF EXISTS ops.v_scrape_trapper_attribution CASCADE;

-- 3a: Appointment enrichment — uses stored extracted_microchip
CREATE OR REPLACE VIEW ops.v_scrape_appointment_enrichment AS
WITH scrape_base AS (
    SELECT
        s.*,
        COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id ELSE NULL END
        ) AS resolved_clinichq_id,
        TO_DATE(s.appointment_date, 'Mon DD, YYYY') AS parsed_date
    FROM source.clinichq_scrape s
),
-- Tier 1: Microchip + date → appointment (highest precision)
tier1 AS (
    SELECT DISTINCT ON (sb.record_id)
        sb.record_id, a.appointment_id, a.cat_id, 'microchip_date'::text AS match_method
    FROM scrape_base sb
    JOIN ops.appointments a
        ON a.appointment_date = sb.parsed_date
        AND SUBSTRING(a.clinichq_appointment_id FROM '_([^_]+)$') = sb.extracted_microchip
    WHERE a.source_system = 'clinichq'
      AND sb.extracted_microchip IS NOT NULL
),
-- Tier 2: client_id + date + animal name → appointment (via clinic_accounts)
tier2 AS (
    SELECT DISTINCT ON (sb.record_id)
        sb.record_id, a.appointment_id, a.cat_id, 'client_name_date'::text AS match_method
    FROM scrape_base sb
    JOIN ops.clinic_accounts ca ON ca.clinichq_client_id = sb.client_id::bigint
    JOIN ops.appointments a ON a.owner_account_id = ca.account_id
        AND a.appointment_date = sb.parsed_date
    JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE a.source_system = 'clinichq'
      AND LOWER(BTRIM(c.name)) = LOWER(BTRIM(sb.animal_name))
      AND sb.record_id NOT IN (SELECT record_id FROM tier1)
),
-- Tier 3: client_id + date, only when 1 appointment that day (unambiguous)
tier3_candidates AS (
    SELECT sb.record_id, a.appointment_id, a.cat_id,
           COUNT(*) OVER (PARTITION BY sb.record_id) AS match_ct
    FROM scrape_base sb
    JOIN ops.clinic_accounts ca ON ca.clinichq_client_id = sb.client_id::bigint
    JOIN ops.appointments a ON a.owner_account_id = ca.account_id
        AND a.appointment_date = sb.parsed_date
    WHERE a.source_system = 'clinichq'
      AND sb.record_id NOT IN (SELECT record_id FROM tier1)
      AND sb.record_id NOT IN (SELECT record_id FROM tier2)
),
tier3 AS (
    SELECT record_id, appointment_id, cat_id, 'client_date_solo'::text AS match_method
    FROM tier3_candidates WHERE match_ct = 1
),
-- Tier 4: clinichq_animal_id → cat (cat identified, may not match appointment)
tier4 AS (
    SELECT DISTINCT ON (sb.record_id)
        sb.record_id,
        NULL::uuid AS appointment_id,
        ci.cat_id,
        'clinichq_id'::text AS match_method
    FROM scrape_base sb
    JOIN sot.cat_identifiers ci ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = sb.resolved_clinichq_id
    WHERE sb.resolved_clinichq_id IS NOT NULL
      AND sb.record_id NOT IN (SELECT record_id FROM tier1)
      AND sb.record_id NOT IN (SELECT record_id FROM tier2)
      AND sb.record_id NOT IN (SELECT record_id FROM tier3)
),
-- Combine all tiers
all_matches AS (
    SELECT * FROM tier1
    UNION ALL SELECT * FROM tier2
    UNION ALL SELECT * FROM tier3
    UNION ALL SELECT * FROM tier4
)
SELECT
    sb.record_id,
    m.appointment_id,
    m.cat_id,
    sb.appointment_date,
    sb.appointment_type,
    sb.checkout_status,
    sb.animal_name,
    sb.owner_display_name,
    -- Scrape-only fields
    sb.animal_quick_notes,
    sb.animal_appointment_notes,
    sb.internal_medical_notes,
    sb.animal_caution,
    sb.sterilization_status,
    sb.animal_trapper,
    -- Match metadata
    COALESCE(m.match_method,
        CASE
            WHEN sb.extracted_microchip IS NOT NULL THEN 'unmatched_has_microchip'
            WHEN sb.resolved_clinichq_id IS NOT NULL THEN 'unmatched_has_clinichq_id'
            ELSE 'unmatched_no_identifier'
        END
    ) AS match_status
FROM scrape_base sb
LEFT JOIN all_matches m ON m.record_id = sb.record_id;

COMMENT ON VIEW ops.v_scrape_appointment_enrichment IS
    'Joins scrape to appointments via tiered matching: microchip+date > client+name+date > client+date solo > clinichq_id (MIG_2891). Uses stored extracted_microchip.';

-- 3b: Cat notes view — uses stored extracted_microchip
CREATE OR REPLACE VIEW ops.v_scrape_cat_notes AS
WITH scrape_chips AS (
    SELECT
        s.record_id,
        s.client_id,
        s.animal_name,
        s.appointment_date,
        s.animal_quick_notes,
        s.animal_appointment_notes,
        s.internal_medical_notes,
        s.animal_caution,
        s.extracted_microchip,
        COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id ELSE NULL END
        ) AS resolved_clinichq_id
    FROM source.clinichq_scrape s
),
-- Primary: match via microchip
chip_match AS (
    SELECT
        sc.record_id, sc.client_id, sc.animal_name, sc.appointment_date,
        sc.animal_quick_notes, sc.animal_appointment_notes,
        sc.internal_medical_notes, sc.animal_caution,
        c.cat_id, c.name AS cat_name, c.microchip AS sot_microchip,
        'microchip'::text AS match_type
    FROM scrape_chips sc
    JOIN sot.cats c
        ON c.microchip = sc.extracted_microchip
        AND c.merged_into_cat_id IS NULL
    WHERE sc.extracted_microchip IS NOT NULL
),
-- Secondary: match via clinichq_animal_id
id_match AS (
    SELECT DISTINCT ON (sc.record_id)
        sc.record_id, sc.client_id, sc.animal_name, sc.appointment_date,
        sc.animal_quick_notes, sc.animal_appointment_notes,
        sc.internal_medical_notes, sc.animal_caution,
        c.cat_id, c.name AS cat_name, c.microchip AS sot_microchip,
        'clinichq_id'::text AS match_type
    FROM scrape_chips sc
    JOIN sot.cat_identifiers ci ON ci.id_type = 'clinichq_animal_id'
        AND ci.id_value = sc.resolved_clinichq_id
    JOIN sot.cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
    WHERE sc.resolved_clinichq_id IS NOT NULL
      AND sc.record_id NOT IN (SELECT record_id FROM chip_match)
    ORDER BY sc.record_id
),
-- Tertiary: match via client_id → clinic_accounts → appointments → cat name
name_match AS (
    SELECT DISTINCT ON (sc.record_id)
        sc.record_id, sc.client_id, sc.animal_name, sc.appointment_date,
        sc.animal_quick_notes, sc.animal_appointment_notes,
        sc.internal_medical_notes, sc.animal_caution,
        c.cat_id, c.name AS cat_name, c.microchip AS sot_microchip,
        'animal_name'::text AS match_type
    FROM scrape_chips sc
    JOIN ops.clinic_accounts ca ON ca.clinichq_client_id = sc.client_id::bigint
    JOIN ops.appointments a ON a.owner_account_id = ca.account_id
    JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
    WHERE LOWER(BTRIM(c.name)) = LOWER(BTRIM(sc.animal_name))
      AND sc.record_id NOT IN (SELECT record_id FROM chip_match)
      AND sc.record_id NOT IN (SELECT record_id FROM id_match)
      AND sc.extracted_microchip IS NULL
      AND sc.resolved_clinichq_id IS NULL
    ORDER BY sc.record_id, a.appointment_date DESC
)
SELECT cat_id, cat_name, sot_microchip, record_id, appointment_date,
       animal_quick_notes, animal_appointment_notes, internal_medical_notes,
       animal_caution, match_type
FROM chip_match
UNION ALL
SELECT cat_id, cat_name, sot_microchip, record_id, appointment_date,
       animal_quick_notes, animal_appointment_notes, internal_medical_notes,
       animal_caution, match_type
FROM id_match
UNION ALL
SELECT cat_id, cat_name, sot_microchip, record_id, appointment_date,
       animal_quick_notes, animal_appointment_notes, internal_medical_notes,
       animal_caution, match_type
FROM name_match
ORDER BY cat_id, appointment_date;

COMMENT ON VIEW ops.v_scrape_cat_notes IS
    'Scrape notes joined to sot.cats via microchip (primary) > clinichq_id > animal name (MIG_2891). Uses stored extracted_microchip.';

-- 3c: Mortality detail view — uses stored extracted_microchip
CREATE OR REPLACE VIEW ops.v_scrape_mortality_detail AS
WITH deceased_records AS (
    SELECT
        s.record_id,
        s.animal_name,
        s.appointment_date,
        s.extracted_microchip,
        COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id ELSE NULL END
        ) AS resolved_clinichq_id,
        label AS deceased_label
    FROM source.clinichq_scrape s,
         jsonb_array_elements_text(s.heading_labels_json) AS label
    WHERE label LIKE 'Deceased:%'
)
SELECT
    d.record_id,
    COALESCE(c.cat_id, ci.cat_id) AS cat_id,
    d.animal_name,
    d.appointment_date,
    d.deceased_label,
    CASE
        WHEN d.deceased_label LIKE '%Pre-operative%' THEN 'pre_operative'
        WHEN d.deceased_label LIKE '%Intra-operative%' THEN 'intra_operative'
        WHEN d.deceased_label LIKE '%Post-operative%' THEN 'post_operative'
        ELSE 'unspecified'
    END AS mortality_timing,
    CASE
        WHEN d.deceased_label LIKE '%Euthanized per owner request%' THEN 'euthanasia_owner_request'
        WHEN d.deceased_label LIKE '%Pre-Existing Condition%' THEN 'pre_existing_condition'
        WHEN d.deceased_label LIKE '%Surgical Complication%' THEN 'surgical_complication'
        WHEN d.deceased_label LIKE '%Stress-exacerbated Disease%' THEN 'stress_disease'
        WHEN d.deceased_label LIKE '%Anesthetic Reaction%' THEN 'anesthetic_reaction'
        WHEN d.deceased_label LIKE '%Hemorrhage%' THEN 'hemorrhage'
        WHEN d.deceased_label LIKE '%Undetermined%' THEN 'undetermined'
        ELSE 'unknown'
    END AS mortality_cause
FROM deceased_records d
LEFT JOIN sot.cats c
    ON c.microchip = d.extracted_microchip
    AND c.merged_into_cat_id IS NULL
    AND d.extracted_microchip IS NOT NULL
LEFT JOIN sot.cat_identifiers ci
    ON ci.id_type = 'clinichq_animal_id'
    AND ci.id_value = d.resolved_clinichq_id
    AND d.resolved_clinichq_id IS NOT NULL
    AND c.cat_id IS NULL;

COMMENT ON VIEW ops.v_scrape_mortality_detail IS
    'Parses deceased labels — timing and cause. Cat match via microchip > clinichq_id (MIG_2891). Uses stored extracted_microchip.';

-- 3d: Trapper attribution view — uses stored extracted_microchip
CREATE OR REPLACE VIEW ops.v_scrape_trapper_attribution AS
WITH scrape_with_chip AS (
    SELECT
        s.animal_trapper,
        s.client_id,
        s.appointment_date,
        s.extracted_microchip,
        COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id ELSE NULL END
        ) AS resolved_clinichq_id
    FROM source.clinichq_scrape s
    WHERE s.animal_trapper IS NOT NULL AND BTRIM(s.animal_trapper) != ''
)
SELECT
    sw.animal_trapper,
    COUNT(*) AS appointment_count,
    COUNT(DISTINCT sw.client_id) AS unique_clients,
    COUNT(DISTINCT COALESCE(c.cat_id, ci.cat_id))
        FILTER (WHERE COALESCE(c.cat_id, ci.cat_id) IS NOT NULL) AS matched_cats,
    MIN(sw.appointment_date) AS first_seen,
    MAX(sw.appointment_date) AS last_seen
FROM scrape_with_chip sw
LEFT JOIN sot.cats c
    ON c.microchip = sw.extracted_microchip
    AND c.merged_into_cat_id IS NULL
    AND sw.extracted_microchip IS NOT NULL
LEFT JOIN sot.cat_identifiers ci
    ON ci.id_type = 'clinichq_animal_id'
    AND ci.id_value = sw.resolved_clinichq_id
    AND sw.resolved_clinichq_id IS NOT NULL
    AND c.cat_id IS NULL
GROUP BY sw.animal_trapper
ORDER BY appointment_count DESC;

COMMENT ON VIEW ops.v_scrape_trapper_attribution IS
    'Trapper attribution — cat match via microchip > clinichq_id (MIG_2891). Uses stored extracted_microchip.';

-- =============================================================================
-- Step 4: Verification
-- =============================================================================

DO $$
DECLARE
    v_extracted INTEGER;
    v_total INTEGER;
    v_unique_chips INTEGER;
    v_matching_chips INTEGER;
    v_match_status RECORD;
BEGIN
    SELECT COUNT(*) INTO v_total FROM source.clinichq_scrape;
    SELECT COUNT(*) INTO v_extracted FROM source.clinichq_scrape WHERE extracted_microchip IS NOT NULL;
    SELECT COUNT(DISTINCT extracted_microchip) INTO v_unique_chips FROM source.clinichq_scrape WHERE extracted_microchip IS NOT NULL;
    SELECT COUNT(DISTINCT s.extracted_microchip) INTO v_matching_chips
    FROM source.clinichq_scrape s
    JOIN sot.cat_identifiers ci ON ci.id_type = 'microchip' AND ci.id_value = s.extracted_microchip
    WHERE s.extracted_microchip IS NOT NULL;

    RAISE NOTICE 'MIG_2891: extracted_microchip column populated';
    RAISE NOTICE '  Rows with extracted_microchip: % of % (%.1f%%)', v_extracted, v_total, (v_extracted::numeric / v_total * 100);
    RAISE NOTICE '  Unique chips: %', v_unique_chips;
    RAISE NOTICE '  Chips matching sot.cat_identifiers: % (%.1f%%)', v_matching_chips, (v_matching_chips::numeric / GREATEST(v_unique_chips, 1) * 100);
    RAISE NOTICE '';

    RAISE NOTICE '  Appointment enrichment match rates:';
    FOR v_match_status IN
        SELECT match_status, COUNT(*) AS ct
        FROM ops.v_scrape_appointment_enrichment
        GROUP BY 1 ORDER BY ct DESC
    LOOP
        RAISE NOTICE '    %: %', v_match_status.match_status, v_match_status.ct;
    END LOOP;
END $$;

COMMIT;
