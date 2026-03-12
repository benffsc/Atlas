-- MIG_2895: Extract reproductive data from scrape notes (FFS-406)
--
-- Structured data from internal_medical_notes and animal_quick_notes:
--   - Fetus counts + gestation weeks: "OVH (4 fetuses at 6.5 weeks)"  (247 records)
--   - Lactation status: "Lactating, kittens older"                     (331 records)
--   - Pregnancy mentions in quick_notes: "female pregnant adult"       (418 records)
--
-- Beacon value: Reproductive rates are a core population dynamics signal.
-- Fetus counts + gestation timing feed directly into birth rate estimation.
--
-- Safety: Creates new table, ON CONFLICT DO NOTHING. Never overwrites.
-- Depends on: MIG_2891 (extracted_microchip)

BEGIN;

-- =============================================================================
-- Step 1: Create reproductive observations table
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.cat_reproductive_observations (
    observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
    appointment_date DATE,
    observation_type TEXT NOT NULL,  -- 'pregnancy', 'lactation', 'fetus_count'
    fetus_count SMALLINT,           -- NULL unless observation_type = 'fetus_count'
    gestation_weeks NUMERIC(4,1),   -- NULL unless fetus_count
    is_lactating BOOLEAN,           -- TRUE for lactation observations
    raw_text TEXT,                   -- Source text snippet
    source_field TEXT,               -- Which column the data came from
    source_system TEXT NOT NULL DEFAULT 'clinichq',
    evidence_source TEXT NOT NULL DEFAULT 'scrape_free_text',
    extraction_confidence NUMERIC(3,2) DEFAULT 0.9,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_repro_cat_id ON ops.cat_reproductive_observations(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_repro_type ON ops.cat_reproductive_observations(observation_type);

-- =============================================================================
-- Step 2: Extract fetus counts from internal_medical_notes
-- Pattern: "OVH (N fetuses at X weeks)" or "OVH (N fetus at X weeks)"
-- =============================================================================

CREATE TEMP TABLE _scrape_repro AS

-- Fetus counts (most valuable — 247 records)
SELECT
    s.record_id,
    s.extracted_microchip,
    s.extracted_clinichq_id,
    s.animal_id,
    s.appointment_date,
    'fetus_count' AS observation_type,
    (regexp_match(s.internal_medical_notes, '(\d+)\s+fetus(?:es)?', 'i'))[1]::smallint AS fetus_count,
    (regexp_match(s.internal_medical_notes, 'at\s+(\d+(?:\.\d+)?)\s+weeks?', 'i'))[1]::numeric AS gestation_weeks,
    NULL::boolean AS is_lactating,
    LEFT((regexp_match(s.internal_medical_notes, '(OVH\s*\([^)]+\))', 'i'))[1], 100) AS raw_text,
    'internal_medical_notes' AS source_field
FROM source.clinichq_scrape s
WHERE s.internal_medical_notes ~* '\d+\s+fetus'
  AND s.checkout_status = 'Checked Out'

UNION ALL

-- Lactation from internal_medical_notes (331 records)
SELECT
    s.record_id,
    s.extracted_microchip,
    s.extracted_clinichq_id,
    s.animal_id,
    s.appointment_date,
    'lactation',
    NULL,
    NULL,
    TRUE,
    LEFT((regexp_match(s.internal_medical_notes, '([Ll]actating[^,.\n]{0,50})', 'i'))[1], 100),
    'internal_medical_notes'
FROM source.clinichq_scrape s
WHERE s.internal_medical_notes ~* 'lactat'
  AND s.checkout_status = 'Checked Out'

UNION ALL

-- Lactation from animal_quick_notes (367 records, some overlap)
SELECT
    s.record_id,
    s.extracted_microchip,
    s.extracted_clinichq_id,
    s.animal_id,
    s.appointment_date,
    'lactation',
    NULL,
    NULL,
    TRUE,
    LEFT((regexp_match(s.animal_quick_notes, '([Ll]actating[^,.\n]{0,50})', 'i'))[1], 100),
    'animal_quick_notes'
FROM source.clinichq_scrape s
WHERE s.animal_quick_notes ~* 'lactat'
  AND s.checkout_status = 'Checked Out'
  -- Avoid double-counting if also in internal_medical_notes for same record
  AND NOT (s.internal_medical_notes ~* 'lactat')

UNION ALL

-- Pregnancy mentions from animal_quick_notes (418 records)
-- These are intake notes like "female pregnant adult" — less structured
SELECT
    s.record_id,
    s.extracted_microchip,
    s.extracted_clinichq_id,
    s.animal_id,
    s.appointment_date,
    'pregnancy',
    NULL,
    NULL,
    NULL,
    LEFT((regexp_match(s.animal_quick_notes, '([Pp]regnan[ct][^,.\n]{0,50})', 'i'))[1], 100),
    'animal_quick_notes'
FROM source.clinichq_scrape s
WHERE s.animal_quick_notes ~* 'pregn'
  AND s.checkout_status = 'Checked Out'
  -- Don't double-count records that already have fetus counts
  AND NOT (s.internal_medical_notes ~* '\d+\s+fetus');

-- =============================================================================
-- Step 3: Insert matched observations
-- =============================================================================

INSERT INTO ops.cat_reproductive_observations (
    cat_id, appointment_date, observation_type, fetus_count, gestation_weeks,
    is_lactating, raw_text, source_field, source_system, evidence_source,
    extraction_confidence
)
SELECT DISTINCT ON (COALESCE(ci_chip.cat_id, ci_id.cat_id), r.observation_type, r.appointment_date)
    COALESCE(ci_chip.cat_id, ci_id.cat_id) AS cat_id,
    CASE WHEN r.appointment_date ~ '^[A-Z][a-z]{2} \d{2}, \d{4}$'
         THEN TO_DATE(r.appointment_date, 'Mon DD, YYYY')
    END AS appointment_date,
    r.observation_type,
    r.fetus_count,
    r.gestation_weeks,
    r.is_lactating,
    r.raw_text,
    r.source_field,
    'clinichq',
    'scrape_free_text',
    CASE
        WHEN r.observation_type = 'fetus_count' THEN 0.95  -- Very structured "OVH (N fetuses at X weeks)"
        WHEN r.observation_type = 'lactation' THEN 0.90    -- Clear keyword
        ELSE 0.75                                           -- Pregnancy mentions less structured
    END
FROM _scrape_repro r
LEFT JOIN sot.cat_identifiers ci_chip
    ON ci_chip.id_type = 'microchip' AND ci_chip.id_value = r.extracted_microchip
    AND r.extracted_microchip IS NOT NULL
LEFT JOIN sot.cat_identifiers ci_id
    ON ci_id.id_type = 'clinichq_animal_id'
    AND ci_id.id_value = COALESCE(r.extracted_clinichq_id,
        CASE WHEN r.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN r.animal_id END)
    AND ci_chip.cat_id IS NULL
WHERE COALESCE(ci_chip.cat_id, ci_id.cat_id) IS NOT NULL
ORDER BY COALESCE(ci_chip.cat_id, ci_id.cat_id), r.observation_type, r.appointment_date,
         r.source_field;

-- =============================================================================
-- Cleanup + Verification
-- =============================================================================

DROP TABLE IF EXISTS _scrape_repro;

DO $$
DECLARE
    v_total INTEGER;
    v_fetus INTEGER;
    v_lactation INTEGER;
    v_pregnancy INTEGER;
    v_avg_fetus NUMERIC;
    v_unique_cats INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM ops.cat_reproductive_observations;
    SELECT COUNT(*) INTO v_fetus FROM ops.cat_reproductive_observations WHERE observation_type = 'fetus_count';
    SELECT COUNT(*) INTO v_lactation FROM ops.cat_reproductive_observations WHERE observation_type = 'lactation';
    SELECT COUNT(*) INTO v_pregnancy FROM ops.cat_reproductive_observations WHERE observation_type = 'pregnancy';
    SELECT AVG(fetus_count) INTO v_avg_fetus FROM ops.cat_reproductive_observations WHERE fetus_count IS NOT NULL;
    SELECT COUNT(DISTINCT cat_id) INTO v_unique_cats FROM ops.cat_reproductive_observations;

    RAISE NOTICE 'MIG_2895: Reproductive data extraction';
    RAISE NOTICE '  Total observations: %', v_total;
    RAISE NOTICE '  Fetus counts: % (avg %.1f fetuses)', v_fetus, v_avg_fetus;
    RAISE NOTICE '  Lactation: %', v_lactation;
    RAISE NOTICE '  Pregnancy mentions: %', v_pregnancy;
    RAISE NOTICE '  Unique cats: %', v_unique_cats;
END $$;

COMMIT;
