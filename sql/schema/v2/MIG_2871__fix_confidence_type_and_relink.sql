-- ============================================================================
-- MIG_2871: Fix Confidence Type Mismatch & Restore Entity Links
-- ============================================================================
-- MIG_2860 regressed MIG_2022's fix: it overwrote link_cat_to_place() and
-- link_person_to_cat() WITHOUT the confidence_to_numeric() conversion.
-- These functions accept TEXT p_confidence ('high','medium','low') but
-- INSERT directly into NUMERIC columns, causing:
--   ERROR: invalid input syntax for type numeric: "high"
--
-- MIG_2869 deleted 40,166 cat_place and 37,663 person_cat automated links,
-- then failed to re-link due to this type mismatch.
--
-- Fix: Drop stale numeric-param overloads, restore confidence_to_numeric()
-- usage in both functions, rebuild person_cat from appointments, and
-- re-run entity linking to restore cat_place links.
--
-- FFS-313
-- ============================================================================

\echo ''
\echo '================================================'
\echo '  MIG_2871: Fix Confidence Type & Restore Links'
\echo '================================================'
\echo ''

-- ============================================================================
-- 1. Add NUMERIC overload for confidence_rank()
-- ============================================================================

\echo '1. Adding confidence_rank(NUMERIC) overload...'

CREATE OR REPLACE FUNCTION sot.confidence_rank(p_confidence NUMERIC)
RETURNS INTEGER AS $$
BEGIN
    RETURN CASE
        WHEN p_confidence >= 0.8 THEN 3  -- high
        WHEN p_confidence >= 0.6 THEN 2  -- medium
        WHEN p_confidence > 0   THEN 1   -- low
        ELSE 0
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION sot.confidence_rank(NUMERIC) IS
'MIG_2871: Numeric overload of confidence_rank(). Maps 0-1 scale to rank:
>=0.8 → 3 (high), >=0.6 → 2 (medium), >0 → 1 (low), 0/NULL → 0.';

\echo '   Created confidence_rank(NUMERIC)'

-- ============================================================================
-- 2. Drop stale NUMERIC-param overloads of link functions
-- ============================================================================

\echo ''
\echo '2. Dropping stale NUMERIC-param overloads...'

-- MIG_2022 created these with NUMERIC p_confidence, but we keep the TEXT
-- versions (which convert internally via confidence_to_numeric()).
DROP FUNCTION IF EXISTS sot.link_cat_to_place(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC);
DROP FUNCTION IF EXISTS sot.link_person_to_cat(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, NUMERIC);

\echo '   Dropped stale overloads'

-- ============================================================================
-- 3. Fix link_cat_to_place() — restore confidence_to_numeric() conversion
-- ============================================================================

\echo ''
\echo '3. Fixing sot.link_cat_to_place() with confidence_to_numeric()...'

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
    -- MIG_2871 FIX: Convert text confidence to numeric (was missing in MIG_2860)
    v_confidence_num := sot.confidence_to_numeric(p_confidence);

    -- Validate entities exist and aren't merged (from MIG_2860)
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
        evidence_type = CASE
            WHEN EXCLUDED.confidence > sot.cat_place.confidence
            THEN EXCLUDED.evidence_type
            ELSE sot.cat_place.evidence_type
        END,
        source_system = CASE
            WHEN EXCLUDED.confidence > sot.cat_place.confidence
            THEN EXCLUDED.source_system
            ELSE sot.cat_place.source_system
        END,
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_cat_to_place(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) IS
'V2/MIG_2871: Creates or updates a cat-place relationship.
Validates entities exist and arent merged. Accepts TEXT confidence, converts to NUMERIC.
Uses GREATEST for ON CONFLICT. Updates evidence/source on confidence upgrade (MIG_2860).';

\echo '   Fixed sot.link_cat_to_place()'

-- ============================================================================
-- 4. Fix link_person_to_cat() — same fix
-- ============================================================================

\echo ''
\echo '4. Fixing sot.link_person_to_cat() with confidence_to_numeric()...'

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
    v_confidence_num := sot.confidence_to_numeric(p_confidence);

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
        evidence_type = CASE
            WHEN EXCLUDED.confidence > sot.person_cat.confidence
            THEN EXCLUDED.evidence_type
            ELSE sot.person_cat.evidence_type
        END,
        source_system = CASE
            WHEN EXCLUDED.confidence > sot.person_cat.confidence
            THEN EXCLUDED.source_system
            ELSE sot.person_cat.source_system
        END,
        updated_at = NOW()
    RETURNING id INTO v_link_id;

    RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.link_person_to_cat(UUID, UUID, TEXT, TEXT, TEXT, TEXT) IS
'V2/MIG_2871: Creates or updates a person-cat relationship.
Validates entities exist and arent merged. Accepts TEXT confidence, converts to NUMERIC.
Uses GREATEST for ON CONFLICT. Updates evidence/source on confidence upgrade (MIG_2860).';

\echo '   Fixed sot.link_person_to_cat()'

-- ============================================================================
-- 5. Fix check_entity_linking_health() — confidence check uses numeric column
-- ============================================================================

\echo ''
\echo '5. Fixing ops.check_entity_linking_health() confidence check...'

-- Must DROP first because OUT parameter names changed between versions
DROP FUNCTION IF EXISTS ops.check_entity_linking_health();

-- Renamed OUT params to avoid PL/pgSQL ambiguity with table columns (e.g., status)
CREATE FUNCTION ops.check_entity_linking_health()
RETURNS TABLE(check_name TEXT, check_status TEXT, value INT, threshold INT, detail TEXT)
AS $$
BEGIN
    RETURN QUERY SELECT 'clinic_leakage'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'ok' ELSE 'alert' END::TEXT,
        COUNT(*)::INT, 0::INT,
        'Cats linked to clinic addresses'::TEXT
    FROM ops.v_clinic_leakage;

    RETURN QUERY SELECT 'cat_place_coverage'::TEXT,
        CASE WHEN (SELECT place_coverage_pct FROM ops.v_cat_place_coverage) >= 80 THEN 'ok' ELSE 'warning' END::TEXT,
        (SELECT place_coverage_pct::INT FROM ops.v_cat_place_coverage), 50::INT,
        'Cat-place coverage pct'::TEXT;

    RETURN QUERY SELECT 'last_run_status'::TEXT,
        COALESCE((SELECT elr.status FROM ops.entity_linking_runs elr ORDER BY elr.created_at DESC LIMIT 1), 'never_run')::TEXT,
        COALESCE((SELECT ROUND((elr.result->>'cat_coverage_pct')::NUMERIC)::INT FROM ops.entity_linking_runs elr ORDER BY elr.created_at DESC LIMIT 1), 0)::INT,
        0::INT, 'Most recent entity linking run'::TEXT;

    -- MIG_2871 FIX: confidence column is NUMERIC, not TEXT
    RETURN QUERY SELECT 'confidence_integrity'::TEXT,
        CASE WHEN (SELECT COUNT(*) FROM sot.cat_place WHERE confidence >= 0.8) > 0
             THEN 'ok' ELSE 'warning' END::TEXT,
        (SELECT COUNT(*)::INT FROM sot.cat_place WHERE confidence >= 0.8), 0::INT,
        'Links with non-standard confidence'::TEXT;

    -- Use table alias to avoid PL/pgSQL variable/column name ambiguity
    RETURN QUERY SELECT 'recent_partial_failures'::TEXT,
        CASE WHEN (SELECT COUNT(*) FROM ops.entity_linking_runs elr2
              WHERE elr2.status IN ('partial_failure', 'failed') AND elr2.created_at > NOW() - INTERVAL '7 days') = 0
             THEN 'ok' ELSE 'alert' END::TEXT,
        (SELECT COUNT(*)::INT FROM ops.entity_linking_runs elr3
         WHERE elr3.status IN ('partial_failure', 'failed') AND elr3.created_at > NOW() - INTERVAL '7 days'),
        0::INT, 'Partial failures last 7 days'::TEXT;

    RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.check_entity_linking_health IS
'MIG_2871: Health check for entity linking pipeline.
Fixes: confidence uses numeric >= 0.8, ROUND for decimal cast, table aliases for ambiguity.';

\echo '   Fixed ops.check_entity_linking_health()'

-- ============================================================================
-- 6. Rebuild person_cat links from appointments
-- ============================================================================
-- person_cat links are NOT created by run_all_entity_linking() — they come
-- from ingest pipelines. MIG_2869 deleted 37,663 of them. Rebuild from
-- appointments that have both person_id and cat_id.

\echo ''
\echo '6. Rebuilding person_cat links from appointments...'

DO $$
DECLARE
    v_linked INT := 0;
    v_skipped INT := 0;
    v_rec RECORD;
    v_result UUID;
BEGIN
    FOR v_rec IN
        SELECT DISTINCT a.person_id, a.cat_id
        FROM ops.appointments a
        WHERE a.person_id IS NOT NULL
          AND a.cat_id IS NOT NULL
          -- Only link to non-merged entities
          AND EXISTS (SELECT 1 FROM sot.people p WHERE p.person_id = a.person_id AND p.merged_into_person_id IS NULL)
          AND EXISTS (SELECT 1 FROM sot.cats c WHERE c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL)
    LOOP
        BEGIN
            v_result := sot.link_person_to_cat(
                v_rec.person_id, v_rec.cat_id,
                'owner', 'appointment', 'clinichq', 'high'
            );
            IF v_result IS NOT NULL THEN
                v_linked := v_linked + 1;
            ELSE
                v_skipped := v_skipped + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_skipped := v_skipped + 1;
        END;
    END LOOP;

    RAISE NOTICE 'person_cat rebuild: % linked, % skipped', v_linked, v_skipped;
END;
$$;

-- ============================================================================
-- 7. Re-run entity linking for cat_place restoration
-- ============================================================================

\echo ''
\echo '7. Re-running entity linking pipeline...'

SELECT jsonb_pretty(sot.run_all_entity_linking());

-- ============================================================================
-- 8. Post-check
-- ============================================================================

\echo ''
\echo '8. Post-check: link counts...'

SELECT
    (SELECT COUNT(*) FROM sot.cat_place) as cat_place_count,
    (SELECT COUNT(*) FROM sot.person_cat) as person_cat_count;

\echo ''
\echo '   Confidence distribution (cat_place):'
SELECT
    CASE
        WHEN confidence >= 0.8 THEN 'high (>= 0.8)'
        WHEN confidence >= 0.6 THEN 'medium (0.6-0.79)'
        WHEN confidence > 0 THEN 'low (< 0.6)'
        ELSE 'zero/null'
    END as confidence_level,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER(), 0), 1) as pct
FROM sot.cat_place
GROUP BY 1
ORDER BY MIN(confidence) DESC;

\echo ''
\echo '   Confidence distribution (person_cat):'
SELECT
    CASE
        WHEN confidence >= 0.8 THEN 'high (>= 0.8)'
        WHEN confidence >= 0.6 THEN 'medium (0.6-0.79)'
        WHEN confidence > 0 THEN 'low (< 0.6)'
        ELSE 'zero/null'
    END as confidence_level,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER(), 0), 1) as pct
FROM sot.person_cat
GROUP BY 1
ORDER BY MIN(confidence) DESC;

\echo ''
\echo '   Health check:'
SELECT * FROM ops.check_entity_linking_health();

\echo ''
\echo '================================================'
\echo '  MIG_2871 Complete (FFS-313)'
\echo '================================================'
\echo ''
\echo 'Fixes applied:'
\echo '  1. Added confidence_rank(NUMERIC) overload'
\echo '  2. Dropped stale NUMERIC-param overloads of link functions'
\echo '  3. CRITICAL: link_cat_to_place() now uses confidence_to_numeric()'
\echo '  4. CRITICAL: link_person_to_cat() same fix'
\echo '  5. check_entity_linking_health() uses numeric >= 0.8'
\echo '  6. Rebuilt person_cat links from appointments'
\echo '  7. Re-ran entity linking for cat_place restoration'
\echo ''
