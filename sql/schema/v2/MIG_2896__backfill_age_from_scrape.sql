-- MIG_2896: Backfill estimated_birth_date from scrape animal_age (FFS-407)
--
-- Pattern: "X years, Y months" (e.g., "0 years, 4 months", "2 years, 0 months")
-- 26,338 matched cats have parseable age data. No age columns exist yet.
--
-- Adds: estimated_birth_date (date), age_group (text) to sot.cats
-- age_group: kitten (<6mo), juvenile (6mo-1yr), adult (1-7yr), senior (7yr+)
--
-- Birth date computed as: appointment_date - parsed_age
-- Uses most recent appointment for each cat (most accurate age).
--
-- Safety: Only fills NULLs. Merge-aware.
-- Depends on: MIG_2891 (extracted_microchip)

BEGIN;

-- =============================================================================
-- Step 1: Add columns
-- =============================================================================

ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS estimated_birth_date DATE;
ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS age_group TEXT;

-- =============================================================================
-- Step 2: Parse age and compute birth date from most recent appointment
-- =============================================================================

CREATE TEMP TABLE _age_data AS
WITH parsed AS (
    SELECT
        COALESCE(ci_chip.cat_id, ci_id.cat_id) AS cat_id,
        CASE WHEN s.appointment_date ~ '^[A-Z][a-z]{2} \d{2}, \d{4}$'
             THEN TO_DATE(s.appointment_date, 'Mon DD, YYYY')
        END AS appt_date,
        -- Parse "X years, Y months" or "X years, Y.Z months"
        (regexp_match(s.animal_age, '^(\d+)\s+years?,\s+(\d+(?:\.\d+)?)\s+months?$'))[1]::int AS years,
        (regexp_match(s.animal_age, '^(\d+)\s+years?,\s+(\d+(?:\.\d+)?)\s+months?$'))[2]::numeric AS months,
        s.animal_age
    FROM source.clinichq_scrape s
    LEFT JOIN sot.cat_identifiers ci_chip
        ON ci_chip.id_type = 'microchip' AND ci_chip.id_value = s.extracted_microchip
        AND s.extracted_microchip IS NOT NULL
    LEFT JOIN sot.cat_identifiers ci_id
        ON ci_id.id_type = 'clinichq_animal_id'
        AND ci_id.id_value = COALESCE(s.extracted_clinichq_id,
            CASE WHEN s.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN s.animal_id END)
        AND ci_chip.cat_id IS NULL
    WHERE COALESCE(ci_chip.cat_id, ci_id.cat_id) IS NOT NULL
      AND s.animal_age IS NOT NULL AND s.animal_age != ''
      AND s.animal_age ~ '^\d+\s+years?,\s+\d'
      AND s.checkout_status = 'Checked Out'
)
SELECT DISTINCT ON (cat_id)
    cat_id,
    -- Compute birth date: appointment_date - age
    appt_date - (years * 365 + ROUND(months * 30.44))::int AS estimated_birth_date,
    -- Total age in months for age_group
    (years * 12 + months) AS total_months,
    -- Age group classification (at time of appointment)
    CASE
        WHEN (years * 12 + months) < 6 THEN 'kitten'
        WHEN (years * 12 + months) < 12 THEN 'juvenile'
        WHEN (years * 12 + months) < 84 THEN 'adult'    -- 7 years
        ELSE 'senior'
    END AS age_group
FROM parsed
WHERE appt_date IS NOT NULL
  AND years IS NOT NULL
ORDER BY cat_id, appt_date DESC;  -- Most recent appointment = most accurate age

-- =============================================================================
-- Step 3: Update sot.cats
-- =============================================================================

UPDATE sot.cats c
SET
    estimated_birth_date = ad.estimated_birth_date,
    age_group = ad.age_group,
    updated_at = NOW()
FROM _age_data ad
WHERE ad.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.estimated_birth_date IS NULL;

-- =============================================================================
-- Cleanup + Verification
-- =============================================================================

DROP TABLE IF EXISTS _age_data;

DO $$
DECLARE
    v_total INTEGER;
    v_has_birth INTEGER;
    v_has_age_group INTEGER;
    v_group RECORD;
BEGIN
    SELECT COUNT(*) INTO v_total FROM sot.cats WHERE merged_into_cat_id IS NULL;
    SELECT COUNT(*) INTO v_has_birth FROM sot.cats WHERE merged_into_cat_id IS NULL AND estimated_birth_date IS NOT NULL;
    SELECT COUNT(*) INTO v_has_age_group FROM sot.cats WHERE merged_into_cat_id IS NULL AND age_group IS NOT NULL;

    RAISE NOTICE 'MIG_2896: Age backfill from scrape';
    RAISE NOTICE '  Total cats: %', v_total;
    RAISE NOTICE '  Has estimated_birth_date: % (%.1f%%)', v_has_birth, (v_has_birth::numeric / v_total * 100);
    RAISE NOTICE '  Has age_group: % (%.1f%%)', v_has_age_group, (v_has_age_group::numeric / v_total * 100);
    RAISE NOTICE '';

    RAISE NOTICE '  age_group distribution:';
    FOR v_group IN
        SELECT COALESCE(age_group, 'NULL') AS ag, COUNT(*) AS ct
        FROM sot.cats WHERE merged_into_cat_id IS NULL
        GROUP BY 1 ORDER BY ct DESC
    LOOP
        RAISE NOTICE '    %: %', v_group.ag, v_group.ct;
    END LOOP;
END $$;

COMMIT;
