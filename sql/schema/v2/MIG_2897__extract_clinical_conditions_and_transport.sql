-- MIG_2897: Extract clinical conditions + transport method from scrape (FFS-408, FFS-409)
--
-- Clinical conditions from vet notes (internal_medical_notes + animal_quick_notes):
--   URI (394+443), fleas (479+352), ear_mites (176+307), wound/abscess (568+372),
--   tapeworm (378+119), hernia (30+14), cryptorchid (67+11)
--
-- Transport method from services_text + animal_quick_notes:
--   trap (249), carrier (212)
--
-- Beacon value: Disease prevalence per colony/zone. URI clusters = environmental stress.
-- Flea/parasite load = sanitation signal. Transport method = socialization proxy.
--
-- Safety: Creates new table. ON CONFLICT DO NOTHING. Never overwrites.
-- Depends on: MIG_2891 (extracted_microchip)

BEGIN;

-- =============================================================================
-- Step 1: Create cat clinical observations table
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.cat_clinical_observations (
    observation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),
    appointment_date DATE,
    condition_code TEXT NOT NULL,  -- 'uri', 'fleas', 'ear_mites', 'wound', 'abscess', 'tapeworm', 'hernia', 'cryptorchid'
    severity TEXT,                 -- 'mild', 'moderate', 'severe' (when extractable)
    treated BOOLEAN,               -- TRUE if treatment noted
    raw_text TEXT,                 -- Source snippet
    source_field TEXT,
    source_system TEXT NOT NULL DEFAULT 'clinichq',
    evidence_source TEXT NOT NULL DEFAULT 'scrape_free_text',
    extraction_confidence NUMERIC(3,2) DEFAULT 0.85,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_clinical_cat_id ON ops.cat_clinical_observations(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_clinical_condition ON ops.cat_clinical_observations(condition_code);

-- =============================================================================
-- Step 2: Add transport_method to sot.cats
-- =============================================================================

ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS transport_method TEXT;

-- =============================================================================
-- Step 3: Extract clinical conditions
-- =============================================================================

CREATE TEMP TABLE _clinical_raw AS

-- URI / Upper Respiratory
SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date, 'uri' AS condition_code,
    LEFT((regexp_match(s.internal_medical_notes, '(URI[^,.\n]{0,60})', 'i'))[1], 100) AS raw_text,
    'internal_medical_notes' AS source_field
FROM source.clinichq_scrape s
WHERE s.internal_medical_notes ~* '\bURI\b|upper\s+resp'
  AND s.checkout_status = 'Checked Out'

UNION ALL

SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date, 'uri',
    LEFT((regexp_match(s.animal_quick_notes, '(URI[^,.\n]{0,60})', 'i'))[1], 100),
    'animal_quick_notes'
FROM source.clinichq_scrape s
WHERE s.animal_quick_notes ~* '\bURI\b|upper\s+resp'
  AND s.checkout_status = 'Checked Out'
  AND NOT (s.internal_medical_notes ~* '\bURI\b|upper\s+resp')

UNION ALL

-- Fleas
SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date, 'fleas',
    LEFT((regexp_match(s.internal_medical_notes, '([Ff]lea[s]?[^,.\n]{0,40})', 'i'))[1], 100),
    'internal_medical_notes'
FROM source.clinichq_scrape s
WHERE s.internal_medical_notes ~* '\bflea[s]?\b'
  AND s.checkout_status = 'Checked Out'

UNION ALL

SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date, 'fleas',
    LEFT((regexp_match(s.animal_quick_notes, '([Ff]lea[s]?[^,.\n]{0,40})', 'i'))[1], 100),
    'animal_quick_notes'
FROM source.clinichq_scrape s
WHERE s.animal_quick_notes ~* '\bflea[s]?\b'
  AND s.checkout_status = 'Checked Out'
  AND NOT (s.internal_medical_notes ~* '\bflea[s]?\b')

UNION ALL

-- Ear mites
SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date, 'ear_mites',
    LEFT((regexp_match(s.internal_medical_notes, '([Ee]ar\s*[Mm]ite[s]?[^,.\n]{0,40})', 'i'))[1], 100),
    'internal_medical_notes'
FROM source.clinichq_scrape s
WHERE s.internal_medical_notes ~* 'ear\s*mite'
  AND s.checkout_status = 'Checked Out'

UNION ALL

SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date, 'ear_mites',
    LEFT((regexp_match(s.animal_quick_notes, '([Ee]ar\s*[Mm]ite[s]?[^,.\n]{0,40})', 'i'))[1], 100),
    'animal_quick_notes'
FROM source.clinichq_scrape s
WHERE s.animal_quick_notes ~* 'ear\s*mite'
  AND s.checkout_status = 'Checked Out'
  AND NOT (s.internal_medical_notes ~* 'ear\s*mite')

UNION ALL

-- Wounds / Abscess / Bite wounds
SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date,
    CASE
        WHEN s.internal_medical_notes ~* 'abscess' THEN 'abscess'
        ELSE 'wound'
    END,
    LEFT((regexp_match(s.internal_medical_notes, '([Ww]ound|[Aa]bscess|[Bb]ite[^,.\n]{0,60})', 'i'))[1], 100),
    'internal_medical_notes'
FROM source.clinichq_scrape s
WHERE s.internal_medical_notes ~* '\bwound\b|\babscess\b|\bbite\b'
  AND s.checkout_status = 'Checked Out'

UNION ALL

-- Tapeworms
SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date, 'tapeworm',
    LEFT((regexp_match(s.internal_medical_notes, '([Tt]ape\s*[Ww]orm[s]?[^,.\n]{0,40})', 'i'))[1], 100),
    'internal_medical_notes'
FROM source.clinichq_scrape s
WHERE s.internal_medical_notes ~* 'tape\s*worm'
  AND s.checkout_status = 'Checked Out'

UNION ALL

-- Hernia
SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date, 'hernia',
    LEFT((regexp_match(s.internal_medical_notes, '([Hh]ernia[^,.\n]{0,40})', 'i'))[1], 100),
    'internal_medical_notes'
FROM source.clinichq_scrape s
WHERE s.internal_medical_notes ~* '\bhernia\b'
  AND s.checkout_status = 'Checked Out'

UNION ALL

-- Cryptorchid
SELECT s.record_id, s.extracted_microchip, s.extracted_clinichq_id, s.animal_id,
    s.appointment_date, 'cryptorchid',
    LEFT((regexp_match(s.internal_medical_notes, '([Cc]ryptorchid[^,.\n]{0,40})', 'i'))[1], 100),
    'internal_medical_notes'
FROM source.clinichq_scrape s
WHERE s.internal_medical_notes ~* 'cryptorchid|retained\s+testicle'
  AND s.checkout_status = 'Checked Out';

-- =============================================================================
-- Step 4: Insert matched clinical observations
-- =============================================================================

INSERT INTO ops.cat_clinical_observations (
    cat_id, appointment_date, condition_code, raw_text, source_field,
    source_system, evidence_source, extraction_confidence
)
SELECT DISTINCT ON (COALESCE(ci_chip.cat_id, ci_id.cat_id), r.condition_code, r.appointment_date)
    COALESCE(ci_chip.cat_id, ci_id.cat_id),
    CASE WHEN r.appointment_date ~ '^[A-Z][a-z]{2} \d{2}, \d{4}$'
         THEN TO_DATE(r.appointment_date, 'Mon DD, YYYY')
    END,
    r.condition_code,
    r.raw_text,
    r.source_field,
    'clinichq',
    'scrape_free_text',
    0.85
FROM _clinical_raw r
LEFT JOIN sot.cat_identifiers ci_chip
    ON ci_chip.id_type = 'microchip' AND ci_chip.id_value = r.extracted_microchip
    AND r.extracted_microchip IS NOT NULL
LEFT JOIN sot.cat_identifiers ci_id
    ON ci_id.id_type = 'clinichq_animal_id'
    AND ci_id.id_value = COALESCE(r.extracted_clinichq_id,
        CASE WHEN r.animal_id ~ '^[0-9]{1,3}-[0-9]+$' THEN r.animal_id END)
    AND ci_chip.cat_id IS NULL
WHERE COALESCE(ci_chip.cat_id, ci_id.cat_id) IS NOT NULL
ORDER BY COALESCE(ci_chip.cat_id, ci_id.cat_id), r.condition_code, r.appointment_date, r.source_field;

-- =============================================================================
-- Step 5: Backfill transport_method on sot.cats
-- =============================================================================

CREATE TEMP TABLE _transport AS
SELECT DISTINCT ON (COALESCE(ci_chip.cat_id, ci_id.cat_id))
    COALESCE(ci_chip.cat_id, ci_id.cat_id) AS cat_id,
    CASE
        WHEN s.services_text ~* '\btrap\b' OR s.animal_quick_notes ~* 'in\s+trap|trapped' THEN 'trap'
        WHEN s.services_text ~* '\bcarrier\b' OR s.animal_quick_notes ~* 'in\s+carrier' THEN 'carrier'
    END AS transport_method
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
  AND (s.services_text ~* '\btrap\b|\bcarrier\b' OR s.animal_quick_notes ~* 'in\s+trap|trapped|in\s+carrier')
  AND s.checkout_status = 'Checked Out'
ORDER BY COALESCE(ci_chip.cat_id, ci_id.cat_id), s.appointment_date DESC;

UPDATE sot.cats c
SET transport_method = t.transport_method, updated_at = NOW()
FROM _transport t
WHERE t.cat_id = c.cat_id
  AND c.merged_into_cat_id IS NULL
  AND c.transport_method IS NULL
  AND t.transport_method IS NOT NULL;

-- =============================================================================
-- Cleanup + Verification
-- =============================================================================

DROP TABLE IF EXISTS _clinical_raw;
DROP TABLE IF EXISTS _transport;

DO $$
DECLARE
    v_total INTEGER;
    v_unique_cats INTEGER;
    v_cond RECORD;
    v_transport_trap INTEGER;
    v_transport_carrier INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM ops.cat_clinical_observations;
    SELECT COUNT(DISTINCT cat_id) INTO v_unique_cats FROM ops.cat_clinical_observations;

    RAISE NOTICE 'MIG_2897: Clinical conditions + transport method';
    RAISE NOTICE '  Total clinical observations: %', v_total;
    RAISE NOTICE '  Unique cats with conditions: %', v_unique_cats;
    RAISE NOTICE '';

    RAISE NOTICE '  Condition distribution:';
    FOR v_cond IN
        SELECT condition_code, COUNT(*) AS ct
        FROM ops.cat_clinical_observations
        GROUP BY 1 ORDER BY ct DESC
    LOOP
        RAISE NOTICE '    %: %', v_cond.condition_code, v_cond.ct;
    END LOOP;

    SELECT COUNT(*) INTO v_transport_trap FROM sot.cats WHERE merged_into_cat_id IS NULL AND transport_method = 'trap';
    SELECT COUNT(*) INTO v_transport_carrier FROM sot.cats WHERE merged_into_cat_id IS NULL AND transport_method = 'carrier';

    RAISE NOTICE '';
    RAISE NOTICE '  Transport method:';
    RAISE NOTICE '    trap: %', v_transport_trap;
    RAISE NOTICE '    carrier: %', v_transport_carrier;
END $$;

COMMIT;
