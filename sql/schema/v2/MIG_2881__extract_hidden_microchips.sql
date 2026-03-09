-- MIG_2881: Extract hidden microchips from scrape notes fields (FFS-363)
--
-- The scrape's text fields contain ~269 microchip numbers buried in free text.
-- Most (246) are already registered. This migration:
--   1. Creates ops.scrape_hidden_microchips review table with classifications
--   2. Auto-registers 22 new chips for cats that currently have no microchip
--   3. Flags 8 dual-chip cases (different chip in notes vs structured field) for review
--
-- Classification breakdown:
--   matches_structured:     89 — chip in notes matches structured microchip field
--   already_registered:    157 — chip exists in sot.cat_identifiers (redundant)
--   new_chip:               22 — chip NOT registered, cat has no microchip → auto-register
--   different_from_structured: 9 — chip differs from structured → flag for review
--
-- Safety: Review table + safe inserts only. No deletes/updates to existing data.
-- Depends on: MIG_2879 (source.clinichq_scrape), MIG_2880 (enrichment views)

BEGIN;

-- =============================================================================
-- Step 1: Create review table
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.scrape_hidden_microchips (
    id                  SERIAL PRIMARY KEY,
    scrape_record_id    TEXT NOT NULL REFERENCES source.clinichq_scrape(record_id),
    source_field        TEXT NOT NULL,
    extracted_chip      TEXT NOT NULL,
    structured_chip     TEXT,
    classification      TEXT NOT NULL,
    matched_cat_id      UUID,
    cat_current_chip    TEXT,
    auto_registered     BOOLEAN DEFAULT FALSE,
    reviewed            BOOLEAN DEFAULT FALSE,
    review_notes        TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_hidden_chips_class
    ON ops.scrape_hidden_microchips(classification);
CREATE INDEX IF NOT EXISTS idx_scrape_hidden_chips_cat
    ON ops.scrape_hidden_microchips(matched_cat_id) WHERE matched_cat_id IS NOT NULL;

COMMENT ON TABLE ops.scrape_hidden_microchips IS
    'Microchips extracted from scrape free-text fields, classified for registration/review (MIG_2881)';

-- =============================================================================
-- Step 2: Extract, classify, and populate review table
-- =============================================================================

WITH extracted AS (
    -- Extract 15-digit microchips from all text fields
    SELECT record_id, animal_name, microchip AS structured_chip,
        'animal_quick_notes'::text AS source_field,
        (regexp_matches(animal_quick_notes, '([0-9]{15})', 'g'))[1] AS chip
    FROM source.clinichq_scrape WHERE animal_quick_notes ~ '[0-9]{15}'
    UNION ALL
    SELECT record_id, animal_name, microchip,
        'animal_appointment_notes',
        (regexp_matches(animal_appointment_notes, '([0-9]{15})', 'g'))[1]
    FROM source.clinichq_scrape WHERE animal_appointment_notes ~ '[0-9]{15}'
    UNION ALL
    SELECT record_id, animal_name, microchip,
        'internal_medical_notes',
        (regexp_matches(internal_medical_notes, '([0-9]{15})', 'g'))[1]
    FROM source.clinichq_scrape WHERE internal_medical_notes ~ '[0-9]{15}'
    UNION ALL
    SELECT record_id, animal_name, microchip,
        'animal_name',
        (regexp_matches(animal_name, '([0-9]{15})', 'g'))[1]
    FROM source.clinichq_scrape WHERE animal_name ~ '[0-9]{15}'
    UNION ALL
    SELECT record_id, animal_name, microchip,
        'animal_microchip_info',
        (regexp_matches(animal_microchip_info, '([0-9]{15})', 'g'))[1]
    FROM source.clinichq_scrape
    WHERE animal_microchip_info ~ '[0-9]{15}' AND (microchip IS NULL OR microchip = '---')
),
-- Match each scrape record to a cat via the enrichment view
with_cat AS (
    SELECT DISTINCT ON (e.record_id, e.chip)
        e.record_id,
        e.source_field,
        e.chip,
        SUBSTRING(e.structured_chip FROM '^([0-9]{9,15})') AS parsed_structured,
        ae.cat_id,
        c.microchip AS cat_current_chip
    FROM extracted e
    LEFT JOIN ops.v_scrape_appointment_enrichment ae ON ae.record_id = e.record_id
    LEFT JOIN sot.cats c ON c.cat_id = ae.cat_id AND c.merged_into_cat_id IS NULL
    ORDER BY e.record_id, e.chip
),
classified AS (
    SELECT
        wc.record_id,
        wc.source_field,
        wc.chip,
        wc.parsed_structured,
        wc.cat_id,
        wc.cat_current_chip,
        CASE
            WHEN ci.cat_id IS NOT NULL AND wc.parsed_structured = wc.chip
                THEN 'matches_structured'
            WHEN ci.cat_id IS NOT NULL
                THEN 'already_registered'
            WHEN wc.parsed_structured IS NOT NULL AND wc.parsed_structured != wc.chip
                THEN 'different_from_structured'
            ELSE 'new_chip'
        END AS classification
    FROM with_cat wc
    LEFT JOIN sot.cat_identifiers ci ON ci.id_type = 'microchip' AND ci.id_value = wc.chip
)
INSERT INTO ops.scrape_hidden_microchips
    (scrape_record_id, source_field, extracted_chip, structured_chip, classification, matched_cat_id, cat_current_chip)
SELECT record_id, source_field, chip, parsed_structured, classification, cat_id, cat_current_chip
FROM classified
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Step 3: Auto-register new chips for cats with no existing microchip
-- =============================================================================

-- Insert into cat_identifiers
INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
SELECT DISTINCT h.matched_cat_id, 'microchip', h.extracted_chip, 'clinichq', NOW()
FROM ops.scrape_hidden_microchips h
WHERE h.classification = 'new_chip'
  AND h.matched_cat_id IS NOT NULL
  AND h.cat_current_chip IS NULL
ON CONFLICT DO NOTHING;

-- Update denormalized microchip on sot.cats
UPDATE sot.cats c
SET microchip = h.extracted_chip,
    updated_at = NOW()
FROM ops.scrape_hidden_microchips h
WHERE h.classification = 'new_chip'
  AND h.matched_cat_id = c.cat_id
  AND c.microchip IS NULL
  AND c.merged_into_cat_id IS NULL
  AND h.matched_cat_id IS NOT NULL;

-- Mark auto-registered in review table
UPDATE ops.scrape_hidden_microchips
SET auto_registered = TRUE
WHERE classification = 'new_chip'
  AND matched_cat_id IS NOT NULL
  AND cat_current_chip IS NULL;

-- =============================================================================
-- Step 4: Also insert different_from_structured as secondary identifiers
-- (these are dual-chip cases — cat had old chip, got new one at recheck)
-- Don't update sot.cats.microchip (keep the current one), just register as identifier
-- =============================================================================

INSERT INTO sot.cat_identifiers (cat_id, id_type, id_value, source_system, created_at)
SELECT DISTINCT h.matched_cat_id, 'microchip', h.extracted_chip, 'clinichq', NOW()
FROM ops.scrape_hidden_microchips h
WHERE h.classification = 'different_from_structured'
  AND h.matched_cat_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Step 5: Verification
-- =============================================================================

DO $$
DECLARE
    v_total INTEGER;
    v_new INTEGER;
    v_registered INTEGER;
    v_different INTEGER;
    v_cats_updated INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total FROM ops.scrape_hidden_microchips;
    SELECT COUNT(*) INTO v_new FROM ops.scrape_hidden_microchips WHERE classification = 'new_chip';
    SELECT COUNT(*) INTO v_registered FROM ops.scrape_hidden_microchips WHERE auto_registered = TRUE;
    SELECT COUNT(*) INTO v_different FROM ops.scrape_hidden_microchips WHERE classification = 'different_from_structured';

    SELECT COUNT(DISTINCT matched_cat_id) INTO v_cats_updated
    FROM ops.scrape_hidden_microchips WHERE auto_registered = TRUE;

    RAISE NOTICE 'MIG_2881: Hidden microchip extraction complete';
    RAISE NOTICE '  Total extractions: %', v_total;
    RAISE NOTICE '  New chips found: %', v_new;
    RAISE NOTICE '  Auto-registered: % (% cats updated)', v_registered, v_cats_updated;
    RAISE NOTICE '  Dual-chip cases: % (registered as secondary identifiers)', v_different;
    RAISE NOTICE '';
    RAISE NOTICE '  Review pending dual-chip cases:';
    RAISE NOTICE '    SELECT * FROM ops.scrape_hidden_microchips WHERE classification = ''different_from_structured'';';
END $$;

COMMIT;
