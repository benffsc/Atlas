-- MIG_2846: Dedup refresh performance improvements
--
-- Problem: ops.refresh_address_dedup_candidates() T2 tier times out on 11K addresses
-- because trigram similarity cross-join has no supporting index.
-- ops.refresh_request_dedup_candidates() times out because canonical selection
-- uses 4 correlated subqueries repeated 3 times (12 total per candidate pair).
--
-- Fixes FFS-239

BEGIN;

-- =============================================================================
-- 1. Add trigram GIN index on formatted_address for address dedup T2
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_addresses_formatted_trgm
    ON sot.addresses USING gin (formatted_address gin_trgm_ops)
    WHERE merged_into_address_id IS NULL AND formatted_address IS NOT NULL;

-- =============================================================================
-- 2. Rewrite request dedup refresh with CTE pre-computation
-- Instead of 4 correlated subqueries per request repeated per tier,
-- pre-compute activity scores once and join.
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.refresh_request_dedup_candidates()
RETURNS TABLE(tier1_count INT, tier2_count INT, tier3_count INT, total INT) AS $$
DECLARE
    v_t1 INT := 0;
    v_t2 INT := 0;
    v_t3 INT := 0;
BEGIN
    -- Clear pending candidates (keep resolved history)
    DELETE FROM ops.request_dedup_candidates WHERE status = 'pending';

    -- Pre-compute activity scores for all unmerged requests into a temp table
    CREATE TEMP TABLE _request_activity ON COMMIT DROP AS
    SELECT
        r.request_id,
        r.place_id,
        r.source_system,
        r.source_record_id,
        r.status,
        r.notes,
        COALESCE(r.source_created_at, r.created_at) AS effective_date,
        COALESCE(ttr.cnt, 0) + COALESCE(je.cnt, 0) AS activity_score
    FROM ops.requests r
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM ops.trapper_trip_reports WHERE request_id = r.request_id
    ) ttr ON true
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM ops.journal_entries WHERE request_id = r.request_id
    ) je ON true
    WHERE r.merged_into_request_id IS NULL;

    CREATE INDEX ON _request_activity (place_id);
    CREATE INDEX ON _request_activity (request_id);

    -- Tier 1: Same place_id + same source_system + similar source_record_id (likely reimport)
    INSERT INTO ops.request_dedup_candidates (
        canonical_request_id, duplicate_request_id, match_tier,
        match_reasons,
        canonical_summary, duplicate_summary,
        canonical_place_address, duplicate_place_address,
        canonical_status, duplicate_status,
        canonical_source, duplicate_source
    )
    SELECT
        CASE WHEN r1.activity_score >= r2.activity_score THEN r1.request_id ELSE r2.request_id END,
        CASE WHEN r1.activity_score >= r2.activity_score THEN r2.request_id ELSE r1.request_id END,
        1,
        jsonb_build_object(
            'same_place', TRUE,
            'same_source', TRUE,
            'source_record_similarity', similarity(r1.source_record_id, r2.source_record_id)
        ),
        COALESCE(r1.notes, r1.source_record_id, ''),
        COALESCE(r2.notes, r2.source_record_id, ''),
        p1.formatted_address,
        p2.formatted_address,
        r1.status,
        r2.status,
        r1.source_system,
        r2.source_system
    FROM _request_activity r1
    JOIN _request_activity r2
        ON r1.request_id < r2.request_id
        AND r1.place_id = r2.place_id
        AND r1.source_system = r2.source_system
        AND similarity(COALESCE(r1.source_record_id, ''), COALESCE(r2.source_record_id, '')) > 0.7
    LEFT JOIN sot.places p1 ON p1.place_id = r1.place_id
    LEFT JOIN sot.places p2 ON p2.place_id = r2.place_id
    WHERE r1.place_id IS NOT NULL
      -- Exclude already-resolved pairs
      AND NOT EXISTS (
          SELECT 1 FROM ops.request_dedup_candidates rdc
          WHERE rdc.status IN ('merged', 'kept_separate', 'dismissed')
            AND (
                (rdc.canonical_request_id = r1.request_id AND rdc.duplicate_request_id = r2.request_id)
                OR (rdc.canonical_request_id = r2.request_id AND rdc.duplicate_request_id = r1.request_id)
            )
      )
    ON CONFLICT (canonical_request_id, duplicate_request_id) DO NOTHING;

    SELECT COUNT(*)::int INTO v_t1
    FROM ops.request_dedup_candidates WHERE match_tier = 1 AND status = 'pending';

    -- Tier 2: Same place_id + different source + dates within 6 months
    INSERT INTO ops.request_dedup_candidates (
        canonical_request_id, duplicate_request_id, match_tier,
        match_reasons,
        canonical_summary, duplicate_summary,
        canonical_place_address, duplicate_place_address,
        canonical_status, duplicate_status,
        canonical_source, duplicate_source
    )
    SELECT
        CASE WHEN r1.activity_score >= r2.activity_score THEN r1.request_id ELSE r2.request_id END,
        CASE WHEN r1.activity_score >= r2.activity_score THEN r2.request_id ELSE r1.request_id END,
        2,
        jsonb_build_object(
            'same_place', TRUE,
            'different_source', TRUE,
            'date_diff_days', ABS(EXTRACT(EPOCH FROM (r1.effective_date - r2.effective_date)) / 86400)::int
        ),
        COALESCE(r1.notes, r1.source_record_id, ''),
        COALESCE(r2.notes, r2.source_record_id, ''),
        p1.formatted_address,
        p2.formatted_address,
        r1.status,
        r2.status,
        r1.source_system,
        r2.source_system
    FROM _request_activity r1
    JOIN _request_activity r2
        ON r1.request_id < r2.request_id
        AND r1.place_id = r2.place_id
        AND r1.source_system != r2.source_system
        AND ABS(EXTRACT(EPOCH FROM (r1.effective_date - r2.effective_date))) < 15768000
    LEFT JOIN sot.places p1 ON p1.place_id = r1.place_id
    LEFT JOIN sot.places p2 ON p2.place_id = r2.place_id
    WHERE r1.place_id IS NOT NULL
      -- Exclude already-found pairs
      AND NOT EXISTS (
          SELECT 1 FROM ops.request_dedup_candidates rdc
          WHERE (rdc.canonical_request_id = r1.request_id AND rdc.duplicate_request_id = r2.request_id)
             OR (rdc.canonical_request_id = r2.request_id AND rdc.duplicate_request_id = r1.request_id)
      )
    ON CONFLICT (canonical_request_id, duplicate_request_id) DO NOTHING;

    SELECT COUNT(*)::int INTO v_t2
    FROM ops.request_dedup_candidates WHERE match_tier = 2 AND status = 'pending';

    -- Tier 3: Place in same get_place_family() + dates within 6 months
    INSERT INTO ops.request_dedup_candidates (
        canonical_request_id, duplicate_request_id, match_tier,
        match_reasons,
        canonical_summary, duplicate_summary,
        canonical_place_address, duplicate_place_address,
        canonical_status, duplicate_status,
        canonical_source, duplicate_source
    )
    SELECT
        CASE WHEN r1.activity_score >= r2.activity_score THEN r1.request_id ELSE r2.request_id END,
        CASE WHEN r1.activity_score >= r2.activity_score THEN r2.request_id ELSE r1.request_id END,
        3,
        jsonb_build_object(
            'place_family', TRUE,
            'date_diff_days', ABS(EXTRACT(EPOCH FROM (r1.effective_date - r2.effective_date)) / 86400)::int
        ),
        COALESCE(r1.notes, r1.source_record_id, ''),
        COALESCE(r2.notes, r2.source_record_id, ''),
        p1.formatted_address,
        p2.formatted_address,
        r1.status,
        r2.status,
        r1.source_system,
        r2.source_system
    FROM _request_activity r1
    JOIN _request_activity r2
        ON r1.request_id < r2.request_id
        AND r1.place_id != r2.place_id
        AND r2.place_id = ANY(sot.get_place_family(r1.place_id))
        AND ABS(EXTRACT(EPOCH FROM (r1.effective_date - r2.effective_date))) < 15768000
    LEFT JOIN sot.places p1 ON p1.place_id = r1.place_id
    LEFT JOIN sot.places p2 ON p2.place_id = r2.place_id
    WHERE r1.place_id IS NOT NULL
      AND r2.place_id IS NOT NULL
      -- Exclude already-found pairs
      AND NOT EXISTS (
          SELECT 1 FROM ops.request_dedup_candidates rdc
          WHERE (rdc.canonical_request_id = r1.request_id AND rdc.duplicate_request_id = r2.request_id)
             OR (rdc.canonical_request_id = r2.request_id AND rdc.duplicate_request_id = r1.request_id)
      )
    ON CONFLICT (canonical_request_id, duplicate_request_id) DO NOTHING;

    SELECT COUNT(*)::int INTO v_t3
    FROM ops.request_dedup_candidates WHERE match_tier = 3 AND status = 'pending';

    RETURN QUERY SELECT v_t1, v_t2, v_t3, v_t1 + v_t2 + v_t3;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.refresh_request_dedup_candidates() IS
'Refresh request dedup candidates. T1: same place + same source + similar record ID, T2: same place + different source + 6mo, T3: place family + 6mo. Uses pre-computed activity scores for canonical selection.';

COMMIT;
