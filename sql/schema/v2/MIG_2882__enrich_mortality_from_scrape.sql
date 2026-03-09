-- MIG_2882: Enrich cat_mortality_events with scrape cause-of-death detail (FFS-368)
--
-- Current state: 56 mortality events (54 ShelterLuv, 2 ClinicHQ), all mortality_type='euthanasia'.
-- Scrape provides: 422 deceased records (283 with cat match, 208 unique cats).
--   - 207 cats NOT in existing mortality events → insert new records
--   - 1 cat overlaps → enrich with timing/cause detail
--
-- New columns on cat_mortality_events:
--   mortality_timing:      pre_operative | intra_operative | post_operative | unspecified
--   mortality_cause_detail: Granular cause (euthanasia_owner_request, pre_existing_condition, etc.)
--   scrape_deceased_label:  Raw label text from heading_labels_json for provenance
--
-- mortality_type mapping (fits existing CHECK constraint):
--   euthanasia_owner_request → euthanasia
--   pre_existing_condition   → natural
--   surgical_complication    → trauma
--   stress_disease           → natural
--   anesthetic_reaction      → trauma
--   hemorrhage               → trauma
--   undetermined/unknown     → unknown
--
-- Safety: Additive columns + safe inserts. No deletes/updates to unrelated data.
-- Depends on: MIG_2880 (ops.v_scrape_mortality_detail view)

BEGIN;

-- =============================================================================
-- Step 1: Add detail columns to cat_mortality_events
-- =============================================================================

ALTER TABLE sot.cat_mortality_events
    ADD COLUMN IF NOT EXISTS mortality_timing TEXT,
    ADD COLUMN IF NOT EXISTS mortality_cause_detail TEXT,
    ADD COLUMN IF NOT EXISTS scrape_deceased_label TEXT;

COMMENT ON COLUMN sot.cat_mortality_events.mortality_timing IS
    'Operative timing: pre_operative, intra_operative, post_operative, unspecified (from scrape labels)';
COMMENT ON COLUMN sot.cat_mortality_events.mortality_cause_detail IS
    'Granular cause of death from scrape labels (e.g., euthanasia_owner_request, pre_existing_condition)';
COMMENT ON COLUMN sot.cat_mortality_events.scrape_deceased_label IS
    'Raw deceased label text from ClinicHQ heading_labels_json (provenance)';

-- =============================================================================
-- Step 2: Insert new mortality events from scrape (207 cats not in table)
-- =============================================================================

-- For cats with multiple scrape records, pick the most specific label
-- (prefer records with actual timing/cause over bare "Deceased: ()")
WITH best_scrape AS (
    SELECT DISTINCT ON (v.cat_id)
        v.cat_id,
        v.record_id,
        v.appointment_date,
        v.deceased_label,
        v.mortality_timing,
        v.mortality_cause,
        -- Map scrape cause → mortality_type (existing CHECK constraint)
        CASE
            WHEN v.mortality_cause = 'euthanasia_owner_request' THEN 'euthanasia'
            WHEN v.mortality_cause IN ('pre_existing_condition', 'stress_disease') THEN 'natural'
            WHEN v.mortality_cause IN ('surgical_complication', 'anesthetic_reaction', 'hemorrhage') THEN 'trauma'
            ELSE 'unknown'
        END AS mapped_mortality_type
    FROM ops.v_scrape_mortality_detail v
    WHERE v.cat_id IS NOT NULL
    ORDER BY v.cat_id,
        -- Prefer specific causes over unknown/unspecified
        CASE WHEN v.mortality_cause NOT IN ('unknown', 'undetermined') THEN 0 ELSE 1 END,
        CASE WHEN v.mortality_timing != 'unspecified' THEN 0 ELSE 1 END,
        v.appointment_date DESC
)
INSERT INTO sot.cat_mortality_events
    (event_id, cat_id, mortality_type, event_date, cause, notes,
     mortality_timing, mortality_cause_detail, scrape_deceased_label,
     source_system, source_record_id, created_at)
SELECT
    gen_random_uuid(),
    bs.cat_id,
    bs.mapped_mortality_type,
    -- Parse appointment_date text to DATE (format: "Mon DD, YYYY")
    -- Fall back to current date if unparseable (1 record has NULL date)
    COALESCE(
        CASE
            WHEN bs.appointment_date ~ '^[A-Z][a-z]+ \d{1,2}, \d{4}$'
                THEN TO_DATE(bs.appointment_date, 'Mon DD, YYYY')
            ELSE NULL
        END,
        CURRENT_DATE
    ),
    bs.mortality_cause,
    'Extracted from ClinicHQ scrape heading labels: ' || bs.deceased_label,
    bs.mortality_timing,
    bs.mortality_cause,
    bs.deceased_label,
    'clinichq',
    bs.record_id,
    NOW()
FROM best_scrape bs
WHERE bs.cat_id NOT IN (SELECT cat_id FROM sot.cat_mortality_events)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Step 3: Enrich existing records with scrape detail (1 overlapping cat)
-- =============================================================================

UPDATE sot.cat_mortality_events m
SET
    mortality_timing = bs.mortality_timing,
    mortality_cause_detail = bs.mortality_cause,
    scrape_deceased_label = bs.deceased_label
FROM (
    SELECT DISTINCT ON (cat_id)
        cat_id, mortality_timing, mortality_cause, deceased_label
    FROM ops.v_scrape_mortality_detail
    WHERE cat_id IS NOT NULL
    ORDER BY cat_id,
        CASE WHEN mortality_cause NOT IN ('unknown', 'undetermined') THEN 0 ELSE 1 END,
        CASE WHEN mortality_timing != 'unspecified' THEN 0 ELSE 1 END
) bs
WHERE bs.cat_id = m.cat_id
  AND m.mortality_timing IS NULL;

-- =============================================================================
-- Step 4: Verification
-- =============================================================================

DO $$
DECLARE
    v_total INTEGER;
    v_new INTEGER;
    v_enriched INTEGER;
    v_by_type RECORD;
BEGIN
    SELECT COUNT(*) INTO v_total FROM sot.cat_mortality_events;

    SELECT COUNT(*) INTO v_new
    FROM sot.cat_mortality_events
    WHERE source_system = 'clinichq' AND scrape_deceased_label IS NOT NULL;

    SELECT COUNT(*) INTO v_enriched
    FROM sot.cat_mortality_events
    WHERE scrape_deceased_label IS NOT NULL AND source_system != 'clinichq';

    RAISE NOTICE 'MIG_2882: Mortality enrichment from scrape complete';
    RAISE NOTICE '  Total mortality events: %', v_total;
    RAISE NOTICE '  New from scrape: %', v_new;
    RAISE NOTICE '  Existing enriched with scrape detail: %', v_enriched;
    RAISE NOTICE '';

    RAISE NOTICE '  Breakdown by type:';
    FOR v_by_type IN
        SELECT mortality_type, mortality_timing, COUNT(*) AS ct
        FROM sot.cat_mortality_events
        WHERE scrape_deceased_label IS NOT NULL
        GROUP BY 1, 2 ORDER BY ct DESC
    LOOP
        RAISE NOTICE '    % / %: %', v_by_type.mortality_type, v_by_type.mortality_timing, v_by_type.ct;
    END LOOP;
END $$;

COMMIT;
