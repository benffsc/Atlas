-- MIG_2880: ClinicHQ scrape enrichment views (FFS-362)
--
-- Creates views that surface scrape-only data by joining source.clinichq_scrape
-- to existing ops/sot tables. These views make the scrape queryable without
-- modifying any existing tables.
--
-- Matching strategy (tiered, 70% total match rate):
--   Tier 1: Microchip + date → appointment (25,802 — exact, highest precision)
--   Tier 2: client_id + date + cat name → appointment (1,233 — via clinic_accounts)
--   Tier 3: client_id + date solo → appointment (1,295 — single cat that day)
--   Tier 4: Microchip → cat only (548 — cat identified, no appointment match)
--   Unmatched: 12,352 — no microchip and ambiguous client+date
--
-- Bridge: scrape.client_id → ops.clinic_accounts.clinichq_client_id
--         → ops.appointments.owner_account_id
--
-- This migration:
--   Step 1: Coverage summary view (ops.v_clinichq_scrape_coverage)
--   Step 2: Scrape-to-appointment matching view (ops.v_scrape_appointment_enrichment)
--   Step 3: Cat notes view (ops.v_scrape_cat_notes)
--   Step 4: Mortality detail view (ops.v_scrape_mortality_detail)
--   Step 5: Trapper attribution view (ops.v_scrape_trapper_attribution)
--   Step 6: Verification
--
-- Safety: Views only — no data modification. All views use CREATE OR REPLACE.
-- Depends on: MIG_2879 (source.clinichq_scrape table)

BEGIN;

-- Drop existing views that need column changes (safe — these are scrape views, no dependents)
DROP VIEW IF EXISTS ops.v_scrape_appointment_enrichment CASCADE;
DROP VIEW IF EXISTS ops.v_scrape_cat_notes CASCADE;
DROP VIEW IF EXISTS ops.v_scrape_mortality_detail CASCADE;
DROP VIEW IF EXISTS ops.v_scrape_trapper_attribution CASCADE;

-- =============================================================================
-- Step 1: Coverage summary view
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_clinichq_scrape_coverage AS
SELECT
    COUNT(*) AS total_rows,
    COUNT(DISTINCT client_id) AS unique_clients,
    COUNT(*) FILTER (WHERE microchip IS NOT NULL AND microchip != '---') AS with_microchip,
    COUNT(*) FILTER (WHERE animal_id IS NOT NULL) AS with_animal_id,
    COUNT(*) FILTER (WHERE animal_trapper IS NOT NULL AND BTRIM(animal_trapper) != '') AS with_trapper,
    COUNT(*) FILTER (WHERE animal_quick_notes IS NOT NULL AND BTRIM(animal_quick_notes) != '') AS with_quick_notes,
    COUNT(*) FILTER (WHERE animal_appointment_notes IS NOT NULL AND BTRIM(animal_appointment_notes) != '') AS with_appt_notes,
    COUNT(*) FILTER (WHERE internal_medical_notes IS NOT NULL AND BTRIM(internal_medical_notes) != '') AS with_medical_notes,
    COUNT(*) FILTER (WHERE sterilization_status IS NOT NULL AND BTRIM(sterilization_status) != '') AS with_sterilization,
    MIN(scraped_at_utc) AS earliest_scrape,
    MAX(scraped_at_utc) AS latest_scrape,
    MAX(imported_at) AS last_import
FROM source.clinichq_scrape;

COMMENT ON VIEW ops.v_clinichq_scrape_coverage IS
    'Coverage summary of ClinicHQ scrape data — field population rates (MIG_2880)';

-- =============================================================================
-- Step 2: Appointment enrichment view — tiered matching
--
-- Scrape and API use different ID systems. Bridge paths:
--   1. Microchip: scrape.microchip or scrape.animal_id (when 12-15 digits)
--      → clinichq_appointment_id suffix on ops.appointments + date match
--   2. Client ID: scrape.client_id → clinic_accounts.clinichq_client_id
--      → appointments.owner_account_id + date + cat name disambiguation
--   3. Solo: client_id + date when only one appointment that day
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_scrape_appointment_enrichment AS
WITH scrape_base AS (
    -- Extract microchip from either animal_id (when numeric) or microchip field
    SELECT
        s.*,
        COALESCE(
            CASE WHEN s.animal_id ~ '^[0-9]{12,15}$' THEN s.animal_id ELSE NULL END,
            SUBSTRING(s.microchip FROM '^([0-9]{9,15})')
        ) AS extracted_microchip,
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
-- Combine all tiers
all_matches AS (
    SELECT * FROM tier1
    UNION ALL SELECT * FROM tier2
    UNION ALL SELECT * FROM tier3
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
            ELSE 'unmatched_no_identifier'
        END
    ) AS match_status
FROM scrape_base sb
LEFT JOIN all_matches m ON m.record_id = sb.record_id;

COMMENT ON VIEW ops.v_scrape_appointment_enrichment IS
    'Joins scrape to appointments via tiered matching: microchip+date > client+name+date > client+date solo (MIG_2880). ~70% match rate.';

-- =============================================================================
-- Step 3: Cat notes view
-- Match scrape to sot.cats via microchip (primary) or animal name (fallback).
-- Uses same tiered approach: microchip direct match first, then cat name via
-- clinic_accounts bridge for records without microchip.
-- =============================================================================

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
        COALESCE(
            CASE WHEN s.animal_id ~ '^[0-9]{12,15}$' THEN s.animal_id ELSE NULL END,
            SUBSTRING(s.microchip FROM '^([0-9]{9,15})')
        ) AS extracted_microchip
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
-- Fallback: match via client_id → clinic_accounts → appointments → cat name
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
      AND sc.extracted_microchip IS NULL
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
FROM name_match
ORDER BY cat_id, appointment_date;

COMMENT ON VIEW ops.v_scrape_cat_notes IS
    'Scrape notes joined to sot.cats via microchip (primary) or animal name via clinic_accounts (fallback) (MIG_2880)';

-- =============================================================================
-- Step 4: Mortality detail view
-- Parses heading_labels_json for "Deceased:" labels with timing and cause.
-- Cat matching via microchip (extracted from scrape fields).
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_scrape_mortality_detail AS
WITH deceased_records AS (
    SELECT
        s.record_id,
        s.animal_name,
        s.appointment_date,
        COALESCE(
            CASE WHEN s.animal_id ~ '^[0-9]{12,15}$' THEN s.animal_id ELSE NULL END,
            SUBSTRING(s.microchip FROM '^([0-9]{9,15})')
        ) AS extracted_microchip,
        label AS deceased_label
    FROM source.clinichq_scrape s,
         jsonb_array_elements_text(s.heading_labels_json) AS label
    WHERE label LIKE 'Deceased:%'
)
SELECT
    d.record_id,
    c.cat_id,
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
    AND d.extracted_microchip IS NOT NULL;

COMMENT ON VIEW ops.v_scrape_mortality_detail IS
    'Parses deceased labels from heading_labels_json — timing (pre/intra/post-op) and cause (MIG_2880)';

-- =============================================================================
-- Step 5: Trapper attribution view
-- Aggregates trapper names with matched cat counts via microchip.
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_scrape_trapper_attribution AS
WITH scrape_with_chip AS (
    SELECT
        s.animal_trapper,
        s.client_id,
        s.appointment_date,
        COALESCE(
            CASE WHEN s.animal_id ~ '^[0-9]{12,15}$' THEN s.animal_id ELSE NULL END,
            SUBSTRING(s.microchip FROM '^([0-9]{9,15})')
        ) AS extracted_microchip
    FROM source.clinichq_scrape s
    WHERE s.animal_trapper IS NOT NULL AND BTRIM(s.animal_trapper) != ''
)
SELECT
    sw.animal_trapper,
    COUNT(*) AS appointment_count,
    COUNT(DISTINCT sw.client_id) AS unique_clients,
    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.cat_id IS NOT NULL) AS matched_cats,
    MIN(sw.appointment_date) AS first_seen,
    MAX(sw.appointment_date) AS last_seen
FROM scrape_with_chip sw
LEFT JOIN sot.cats c
    ON c.microchip = sw.extracted_microchip
    AND c.merged_into_cat_id IS NULL
    AND sw.extracted_microchip IS NOT NULL
GROUP BY sw.animal_trapper
ORDER BY appointment_count DESC;

COMMENT ON VIEW ops.v_scrape_trapper_attribution IS
    'Trapper attribution from scrape data — appointment counts, unique clients, matched cats (MIG_2880)';

-- =============================================================================
-- Step 6: Verification
-- =============================================================================

DO $$
DECLARE
    v_total INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM source.clinichq_scrape;

    RAISE NOTICE 'MIG_2880: ClinicHQ scrape enrichment views created';
    RAISE NOTICE '  source.clinichq_scrape rows: %', v_total;
    RAISE NOTICE '';
    RAISE NOTICE '  Views created:';
    RAISE NOTICE '    ops.v_clinichq_scrape_coverage         — Field population rates';
    RAISE NOTICE '    ops.v_scrape_appointment_enrichment     — Tiered scrape ↔ appointments join (~70%% match)';
    RAISE NOTICE '    ops.v_scrape_cat_notes                  — Scrape notes ↔ sot.cats (microchip + name fallback)';
    RAISE NOTICE '    ops.v_scrape_mortality_detail            — Deceased label parsing';
    RAISE NOTICE '    ops.v_scrape_trapper_attribution         — Trapper name aggregation';

    IF v_total = 0 THEN
        RAISE NOTICE '';
        RAISE NOTICE '  Table is empty — run import first:';
        RAISE NOTICE '    node scripts/ingest/clinichq_scrape_import.mjs';
    END IF;
END $$;

COMMIT;
