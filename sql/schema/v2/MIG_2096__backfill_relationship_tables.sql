-- MIG_2096: Backfill sot.cat_place and sot.person_place from V1 tables
-- Date: 2026-02-14
-- Issue: V2 relationship tables may be empty if migration didn't complete

-- This migration copies data from V1 relationship tables to V2 tables

-- ============================================================================
-- STEP 1: Backfill cat_place from trapper.cat_place_relationships
-- ============================================================================
DO $$
DECLARE
    v_cat_place_count INT;
    v_inserted INT := 0;
BEGIN
    SELECT COUNT(*) INTO v_cat_place_count FROM sot.cat_place;

    IF v_cat_place_count = 0 THEN
        RAISE NOTICE 'MIG_2096: sot.cat_place is empty, attempting backfill from V1...';

        -- Check if V1 table exists
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'trapper' AND table_name = 'cat_place_relationships') THEN

            INSERT INTO sot.cat_place (cat_id, place_id, relationship_type, evidence_type, confidence, source_system, created_at)
            SELECT
                cpr.cat_id,
                cpr.place_id,
                COALESCE(cpr.relationship_type::text, 'residence'),
                COALESCE(cpr.evidence_type::text, 'imported'),
                COALESCE(cpr.confidence, 0.8),
                COALESCE(cpr.source_system, 'v1_migration'),
                COALESCE(cpr.created_at, NOW())
            FROM trapper.cat_place_relationships cpr
            WHERE cpr.cat_id IS NOT NULL
              AND cpr.place_id IS NOT NULL
              -- Only import for active cats and places
              AND EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = cpr.cat_id AND c.merged_into_cat_id IS NULL)
              AND EXISTS (SELECT 1 FROM sot.places p WHERE p.place_id = cpr.place_id AND p.merged_into_place_id IS NULL)
            ON CONFLICT (cat_id, place_id, relationship_type) DO NOTHING;

            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            RAISE NOTICE 'MIG_2096: Backfilled % cat_place relationships from V1', v_inserted;
        ELSE
            RAISE NOTICE 'MIG_2096: V1 trapper.cat_place_relationships does not exist, skipping';
        END IF;
    ELSE
        RAISE NOTICE 'MIG_2096: sot.cat_place already has % records, skipping backfill', v_cat_place_count;
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Backfill person_place from trapper.person_place_relationships
-- ============================================================================
DO $$
DECLARE
    v_person_place_count INT;
    v_inserted INT := 0;
BEGIN
    SELECT COUNT(*) INTO v_person_place_count FROM sot.person_place;

    IF v_person_place_count = 0 THEN
        RAISE NOTICE 'MIG_2096: sot.person_place is empty, attempting backfill from V1...';

        -- Check if V1 table exists
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'trapper' AND table_name = 'person_place_relationships') THEN

            INSERT INTO sot.person_place (person_id, place_id, relationship_type, evidence_type, confidence, is_primary, source_system, created_at)
            SELECT
                ppr.person_id,
                ppr.place_id,
                COALESCE(ppr.relationship_type::text, 'resident'),
                COALESCE(ppr.evidence_type::text, 'imported'),
                COALESCE(ppr.confidence, 0.8),
                COALESCE(ppr.is_primary, FALSE),
                COALESCE(ppr.source_system, 'v1_migration'),
                COALESCE(ppr.created_at, NOW())
            FROM trapper.person_place_relationships ppr
            WHERE ppr.person_id IS NOT NULL
              AND ppr.place_id IS NOT NULL
              -- Only import for active people and places
              AND EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = ppr.person_id AND p.merged_into_person_id IS NULL)
              AND EXISTS (SELECT 1 FROM sot.places pl WHERE pl.place_id = ppr.place_id AND pl.merged_into_place_id IS NULL)
            ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;

            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            RAISE NOTICE 'MIG_2096: Backfilled % person_place relationships from V1', v_inserted;
        ELSE
            RAISE NOTICE 'MIG_2096: V1 trapper.person_place_relationships does not exist, skipping';
        END IF;
    ELSE
        RAISE NOTICE 'MIG_2096: sot.person_place already has % records, skipping backfill', v_person_place_count;
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Backfill person_cat from trapper.person_cat_relationships
-- ============================================================================
DO $$
DECLARE
    v_person_cat_count INT;
    v_inserted INT := 0;
BEGIN
    SELECT COUNT(*) INTO v_person_cat_count FROM sot.person_cat;

    IF v_person_cat_count = 0 THEN
        RAISE NOTICE 'MIG_2096: sot.person_cat is empty, attempting backfill from V1...';

        -- Check if V1 table exists
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'trapper' AND table_name = 'person_cat_relationships') THEN

            INSERT INTO sot.person_cat (person_id, cat_id, relationship_type, evidence_type, confidence, source_system, created_at)
            SELECT
                pcr.person_id,
                pcr.cat_id,
                COALESCE(pcr.relationship_type::text, 'owner'),
                COALESCE(pcr.evidence_type::text, 'imported'),
                COALESCE(pcr.confidence, 0.8),
                COALESCE(pcr.source_system, 'v1_migration'),
                COALESCE(pcr.created_at, NOW())
            FROM trapper.person_cat_relationships pcr
            WHERE pcr.person_id IS NOT NULL
              AND pcr.cat_id IS NOT NULL
              -- Only import for active people and cats
              AND EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = pcr.person_id AND p.merged_into_person_id IS NULL)
              AND EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = pcr.cat_id AND c.merged_into_cat_id IS NULL)
            ON CONFLICT (person_id, cat_id, relationship_type) DO NOTHING;

            GET DIAGNOSTICS v_inserted = ROW_COUNT;
            RAISE NOTICE 'MIG_2096: Backfilled % person_cat relationships from V1', v_inserted;
        ELSE
            RAISE NOTICE 'MIG_2096: V1 trapper.person_cat_relationships does not exist, skipping';
        END IF;
    ELSE
        RAISE NOTICE 'MIG_2096: sot.person_cat already has % records, skipping backfill', v_person_cat_count;
    END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
DO $$
DECLARE
    v_cat_place INT;
    v_person_place INT;
    v_person_cat INT;
BEGIN
    SELECT COUNT(*) INTO v_cat_place FROM sot.cat_place;
    SELECT COUNT(*) INTO v_person_place FROM sot.person_place;
    SELECT COUNT(*) INTO v_person_cat FROM sot.person_cat;

    RAISE NOTICE 'MIG_2096: Final relationship table counts:';
    RAISE NOTICE '  - sot.cat_place: % records', v_cat_place;
    RAISE NOTICE '  - sot.person_place: % records', v_person_place;
    RAISE NOTICE '  - sot.person_cat: % records', v_person_cat;
END $$;
