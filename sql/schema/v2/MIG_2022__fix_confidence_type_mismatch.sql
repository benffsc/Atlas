-- MIG_2022: Fix confidence type mismatch in link functions
--
-- Problem: Confidence columns are NUMERIC but functions pass TEXT ('high', 'medium', 'low')
-- Solution: Add helper function to convert text to numeric, update link functions
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2022: Fix Confidence Type Mismatch'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. HELPER FUNCTION: CONFIDENCE TEXT TO NUMERIC
-- ============================================================================

\echo '1. Creating sot.confidence_to_numeric()...'

CREATE OR REPLACE FUNCTION sot.confidence_to_numeric(p_confidence TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN CASE LOWER(COALESCE(p_confidence, 'medium'))
        WHEN 'high' THEN 0.9
        WHEN 'medium' THEN 0.7
        WHEN 'low' THEN 0.5
        WHEN 'very_low' THEN 0.3
        ELSE 0.7  -- default to medium
    END;
END;
$$;

COMMENT ON FUNCTION sot.confidence_to_numeric IS
'Converts text confidence levels to numeric values for storage.
high=0.9, medium=0.7, low=0.5, very_low=0.3';

\echo '   Created sot.confidence_to_numeric()'

-- ============================================================================
-- 2. FIX LINK_PERSON_TO_PLACE
-- ============================================================================

\echo ''
\echo '2. Fixing sot.link_person_to_place()...'

DROP FUNCTION IF EXISTS sot.link_person_to_place(UUID, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION sot.link_person_to_place(
    p_person_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT DEFAULT 'resident',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas',
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
    v_confidence_num NUMERIC;
BEGIN
    -- Convert text confidence to numeric
    v_confidence_num := sot.confidence_to_numeric(p_confidence);

    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.people WHERE person_id = p_person_id AND merged_into_person_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.person_place (
        person_id, place_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_person_id, p_place_id, p_relationship_type,
        v_confidence_num, p_evidence_type, p_source_system
    )
    ON CONFLICT (person_id, place_id, relationship_type)
    DO UPDATE SET
        confidence = GREATEST(EXCLUDED.confidence, sot.person_place.confidence),
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_person_to_place IS
'V2: Creates or updates a person-place relationship.
Accepts text confidence (high/medium/low) and converts to numeric.';

\echo '   Fixed sot.link_person_to_place()'

-- ============================================================================
-- 3. FIX LINK_PERSON_TO_CAT
-- ============================================================================

\echo ''
\echo '3. Fixing sot.link_person_to_cat()...'

DROP FUNCTION IF EXISTS sot.link_person_to_cat(UUID, UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION sot.link_person_to_cat(
    p_person_id UUID,
    p_cat_id UUID,
    p_relationship_type TEXT DEFAULT 'owner',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas',
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
    v_confidence_num NUMERIC;
BEGIN
    -- Convert text confidence to numeric
    v_confidence_num := sot.confidence_to_numeric(p_confidence);

    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.people WHERE person_id = p_person_id AND merged_into_person_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.cats WHERE cat_id = p_cat_id AND merged_into_cat_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.person_cat (
        person_id, cat_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_person_id, p_cat_id, p_relationship_type,
        v_confidence_num, p_evidence_type, p_source_system
    )
    ON CONFLICT (person_id, cat_id, relationship_type)
    DO UPDATE SET
        confidence = GREATEST(EXCLUDED.confidence, sot.person_cat.confidence),
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_person_to_cat IS
'V2: Creates or updates a person-cat relationship.
Accepts text confidence (high/medium/low) and converts to numeric.';

\echo '   Fixed sot.link_person_to_cat()'

-- ============================================================================
-- 4. FIX LINK_CAT_TO_PLACE
-- ============================================================================

\echo ''
\echo '4. Fixing sot.link_cat_to_place()...'

DROP FUNCTION IF EXISTS sot.link_cat_to_place(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION sot.link_cat_to_place(
    p_cat_id UUID,
    p_place_id UUID,
    p_relationship_type TEXT DEFAULT 'seen_at',
    p_evidence_type TEXT DEFAULT 'appointment',
    p_source_system TEXT DEFAULT 'atlas',
    p_source_table TEXT DEFAULT NULL,
    p_evidence_detail JSONB DEFAULT NULL,
    p_confidence TEXT DEFAULT 'medium'
)
RETURNS UUID AS $$
DECLARE
    v_link_id UUID;
    v_confidence_num NUMERIC;
BEGIN
    -- Convert text confidence to numeric
    v_confidence_num := sot.confidence_to_numeric(p_confidence);

    -- Validate entities exist and aren't merged
    IF NOT EXISTS (
        SELECT 1 FROM sot.cats WHERE cat_id = p_cat_id AND merged_into_cat_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM sot.places WHERE place_id = p_place_id AND merged_into_place_id IS NULL
    ) THEN
        RETURN NULL;
    END IF;

    -- Insert or update relationship
    INSERT INTO sot.cat_place (
        cat_id, place_id, relationship_type,
        confidence, evidence_type, source_system
    ) VALUES (
        p_cat_id, p_place_id, p_relationship_type,
        v_confidence_num, p_evidence_type, p_source_system
    )
    ON CONFLICT (cat_id, place_id, relationship_type)
    DO UPDATE SET
        confidence = GREATEST(EXCLUDED.confidence, sot.cat_place.confidence),
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_cat_to_place IS
'V2: Creates or updates a cat-place relationship.
Accepts text confidence (high/medium/low) and converts to numeric.';

\echo '   Fixed sot.link_cat_to_place()'

-- ============================================================================
-- 5. ADD MISSING updated_at COLUMNS
-- ============================================================================

\echo ''
\echo '5. Adding missing updated_at columns...'

ALTER TABLE sot.person_cat ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE sot.cat_place ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

\echo '   Added updated_at columns'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'Testing all link functions...'

DO $$
DECLARE
    v_test_person_id UUID;
    v_test_place_id UUID;
    v_test_cat_id UUID;
BEGIN
    -- Create test data
    v_test_person_id := sot.find_or_create_person(
        p_email := 'schema_verify@example.com',
        p_first_name := 'Verify',
        p_last_name := 'Test',
        p_source_system := 'test'
    );

    v_test_place_id := sot.find_or_create_place_deduped(
        p_formatted_address := '456 Verify Test Ave, Santa Rosa, CA 95401',
        p_source_system := 'test'
    );

    v_test_cat_id := sot.find_or_create_cat_by_microchip(
        p_microchip := '111222333444555',
        p_name := 'VerifyCat',
        p_source_system := 'test'
    );

    -- Test link functions
    IF v_test_person_id IS NOT NULL AND v_test_place_id IS NOT NULL THEN
        PERFORM sot.link_person_to_place(v_test_person_id, v_test_place_id, 'resident', 'test', 'test', 'high');
        RAISE NOTICE 'link_person_to_place: OK';
    END IF;

    IF v_test_person_id IS NOT NULL AND v_test_cat_id IS NOT NULL THEN
        PERFORM sot.link_person_to_cat(v_test_person_id, v_test_cat_id, 'owner', 'test', 'test', 'medium');
        RAISE NOTICE 'link_person_to_cat: OK';
    END IF;

    IF v_test_cat_id IS NOT NULL AND v_test_place_id IS NOT NULL THEN
        PERFORM sot.link_cat_to_place(v_test_cat_id, v_test_place_id, 'seen_at', 'test', 'test');
        RAISE NOTICE 'link_cat_to_place: OK';
    END IF;

    -- Cleanup
    DELETE FROM sot.cat_place WHERE source_system = 'test';
    DELETE FROM sot.person_cat WHERE source_system = 'test';
    DELETE FROM sot.person_place WHERE source_system = 'test';
    DELETE FROM sot.cat_identifiers WHERE source_system = 'test';
    DELETE FROM sot.cats WHERE source_system = 'test';
    DELETE FROM sot.person_identifiers WHERE source_system = 'test';
    DELETE FROM sot.people WHERE source_system = 'test';
    DELETE FROM sot.places WHERE source_system = 'test';
    DELETE FROM sot.match_decisions WHERE source_system = 'test';
    DELETE FROM sot.addresses WHERE source_system = 'test';

    RAISE NOTICE 'All link functions verified!';
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2022 Complete!'
\echo '=============================================='
\echo ''
