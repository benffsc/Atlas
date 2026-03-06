-- MIG_2839: Request dedup infrastructure
--
-- ops.requests has no merge support at all. This migration adds:
-- 1. merged_into_request_id column
-- 2. request_safe_to_merge() safety gate
-- 3. merge_request_into() merge function
-- 4. ops.request_dedup_candidates table
-- 5. ops.refresh_request_dedup_candidates() candidate generation

BEGIN;

-- =============================================================================
-- 1. Add merge column to ops.requests
-- =============================================================================

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS merged_into_request_id UUID REFERENCES ops.requests(request_id);

CREATE INDEX IF NOT EXISTS idx_requests_merged
    ON ops.requests(merged_into_request_id)
    WHERE merged_into_request_id IS NOT NULL;

-- =============================================================================
-- 2. Safety gate: request_safe_to_merge
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.request_safe_to_merge(p_loser_id UUID, p_winner_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_loser RECORD;
    v_winner RECORD;
BEGIN
    -- Check loser exists and is not already merged
    SELECT request_id, merged_into_request_id, place_id, status
    INTO v_loser
    FROM ops.requests
    WHERE request_id = p_loser_id;

    IF NOT FOUND THEN
        RETURN 'loser_not_found';
    END IF;

    IF v_loser.merged_into_request_id IS NOT NULL THEN
        RETURN 'already_merged';
    END IF;

    -- Check winner exists and is not already merged
    SELECT request_id, merged_into_request_id, place_id, status
    INTO v_winner
    FROM ops.requests
    WHERE request_id = p_winner_id;

    IF NOT FOUND THEN
        RETURN 'winner_not_found';
    END IF;

    IF v_winner.merged_into_request_id IS NOT NULL THEN
        RETURN 'already_merged';
    END IF;

    -- Different places = probably not same request
    IF v_loser.place_id IS NOT NULL AND v_winner.place_id IS NOT NULL
       AND v_loser.place_id != v_winner.place_id THEN
        -- Check if places are in the same family before blocking
        IF NOT EXISTS (
            SELECT 1
            WHERE v_winner.place_id = ANY(sot.get_place_family(v_loser.place_id))
        ) THEN
            RETURN 'different_places';
        END IF;
    END IF;

    -- Both active = need manual decision on which to keep
    IF v_loser.status IN ('new', 'triaged', 'scheduled', 'in_progress')
       AND v_winner.status IN ('new', 'triaged', 'scheduled', 'in_progress') THEN
        RETURN 'both_active';
    END IF;

    RETURN 'safe';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.request_safe_to_merge(UUID, UUID) IS
'Safety gate for request merges. Returns TEXT: safe, different_places, both_active, loser_not_found, winner_not_found, already_merged';

-- =============================================================================
-- 3. Merge function: merge_request_into
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.merge_request_into(
    p_loser_id UUID,
    p_winner_id UUID,
    p_reason TEXT DEFAULT 'duplicate_request',
    p_changed_by TEXT DEFAULT 'system'
)
RETURNS void AS $$
DECLARE
    v_loser RECORD;
    v_winner RECORD;
    v_relinked INT;
BEGIN
    -- Validate both exist and are not merged
    SELECT * INTO v_loser FROM ops.requests WHERE request_id = p_loser_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loser request % not found', p_loser_id;
    END IF;
    IF v_loser.merged_into_request_id IS NOT NULL THEN
        RAISE EXCEPTION 'Loser request % is already merged into %', p_loser_id, v_loser.merged_into_request_id;
    END IF;

    SELECT * INTO v_winner FROM ops.requests WHERE request_id = p_winner_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Winner request % not found', p_winner_id;
    END IF;
    IF v_winner.merged_into_request_id IS NOT NULL THEN
        RAISE EXCEPTION 'Winner request % is already merged into %', p_winner_id, v_winner.merged_into_request_id;
    END IF;

    -- Winner keeps higher estimated_cat_count
    IF v_loser.estimated_cat_count IS NOT NULL AND
       (v_winner.estimated_cat_count IS NULL OR v_loser.estimated_cat_count > v_winner.estimated_cat_count) THEN
        UPDATE ops.requests
        SET estimated_cat_count = v_loser.estimated_cat_count
        WHERE request_id = p_winner_id;
    END IF;

    -- Winner keeps earlier source_created_at
    IF v_loser.source_created_at IS NOT NULL AND
       (v_winner.source_created_at IS NULL OR v_loser.source_created_at < v_winner.source_created_at) THEN
        UPDATE ops.requests
        SET source_created_at = v_loser.source_created_at
        WHERE request_id = p_winner_id;
    END IF;

    -- Relink ops.linear_issues.atlas_request_id
    UPDATE ops.linear_issues
    SET atlas_request_id = p_winner_id
    WHERE atlas_request_id = p_loser_id;

    -- Relink ops.intake_submissions.converted_to_request_id
    UPDATE ops.intake_submissions
    SET converted_to_request_id = p_winner_id
    WHERE converted_to_request_id = p_loser_id;

    -- Relink ops.trapper_trip_reports.request_id
    UPDATE ops.trapper_trip_reports
    SET request_id = p_winner_id
    WHERE request_id = p_loser_id;

    -- Relink ops.trapper_cases.request_id
    BEGIN
        UPDATE ops.trapper_cases
        SET request_id = p_winner_id
        WHERE request_id = p_loser_id;
    EXCEPTION WHEN undefined_table THEN
        NULL; -- Table may not exist yet
    END;

    -- Relink ops.call_logs.request_id
    BEGIN
        UPDATE ops.call_logs
        SET request_id = p_winner_id
        WHERE request_id = p_loser_id;
    EXCEPTION WHEN undefined_table THEN
        NULL; -- Table may not exist yet
    END;

    -- Relink self-referential redirected_to/from
    UPDATE ops.requests
    SET redirected_to_request_id = p_winner_id
    WHERE redirected_to_request_id = p_loser_id
      AND request_id != p_winner_id;

    UPDATE ops.requests
    SET redirected_from_request_id = p_winner_id
    WHERE redirected_from_request_id = p_loser_id
      AND request_id != p_winner_id;

    -- Relink ops.journal_entries (soft link, no FK)
    UPDATE ops.journal_entries
    SET request_id = p_winner_id
    WHERE request_id = p_loser_id;

    UPDATE ops.journal_entries
    SET primary_request_id = p_winner_id
    WHERE primary_request_id = p_loser_id;

    -- Mark loser as merged
    UPDATE ops.requests
    SET merged_into_request_id = p_winner_id, updated_at = NOW()
    WHERE request_id = p_loser_id;

    -- Log to entity_edits
    INSERT INTO ops.entity_edits (entity_type, entity_id, edit_type, field_name, old_value, new_value, changed_by, change_source)
    VALUES (
        'request',
        p_loser_id,
        'merge',
        'merged_into_request_id',
        NULL,
        to_jsonb(p_winner_id::text),
        p_changed_by,
        p_reason
    );

    RAISE NOTICE 'Merged request % into %', p_loser_id, p_winner_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.merge_request_into(UUID, UUID, TEXT, TEXT) IS
'Merge loser request into winner. Relinks trip reports, cases, call logs, intake submissions, linear issues, journal entries. Winner keeps higher cat count and earlier source date.';

-- =============================================================================
-- 4. Candidates table
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.request_dedup_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_request_id UUID NOT NULL REFERENCES ops.requests(request_id),
    duplicate_request_id UUID NOT NULL REFERENCES ops.requests(request_id),
    match_tier INT NOT NULL,
    match_reasons JSONB,
    canonical_summary TEXT,
    duplicate_summary TEXT,
    canonical_place_address TEXT,
    duplicate_place_address TEXT,
    canonical_status TEXT,
    duplicate_status TEXT,
    canonical_source TEXT,
    duplicate_source TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(canonical_request_id, duplicate_request_id)
);

CREATE INDEX IF NOT EXISTS idx_request_dedup_status ON ops.request_dedup_candidates(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_request_dedup_tier ON ops.request_dedup_candidates(match_tier) WHERE status = 'pending';

-- =============================================================================
-- 5. Candidate refresh function
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

    -- Determine canonical = more activity
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
        -- Canonical = more linked data (trip reports + journal entries)
        CASE WHEN (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r1.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r1.request_id)
        ) >= (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r2.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r2.request_id)
        ) THEN r1.request_id ELSE r2.request_id END,
        CASE WHEN (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r1.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r1.request_id)
        ) >= (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r2.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r2.request_id)
        ) THEN r2.request_id ELSE r1.request_id END,
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
    FROM ops.requests r1
    JOIN ops.requests r2
        ON r1.request_id < r2.request_id
        AND r1.place_id = r2.place_id
        AND r1.source_system = r2.source_system
        AND similarity(COALESCE(r1.source_record_id, ''), COALESCE(r2.source_record_id, '')) > 0.7
    LEFT JOIN sot.places p1 ON p1.place_id = r1.place_id
    LEFT JOIN sot.places p2 ON p2.place_id = r2.place_id
    WHERE r1.merged_into_request_id IS NULL
      AND r2.merged_into_request_id IS NULL
      AND r1.place_id IS NOT NULL
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
        CASE WHEN (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r1.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r1.request_id)
        ) >= (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r2.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r2.request_id)
        ) THEN r1.request_id ELSE r2.request_id END,
        CASE WHEN (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r1.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r1.request_id)
        ) >= (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r2.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r2.request_id)
        ) THEN r2.request_id ELSE r1.request_id END,
        2,
        jsonb_build_object(
            'same_place', TRUE,
            'different_source', TRUE,
            'date_diff_days', ABS(EXTRACT(EPOCH FROM (
                COALESCE(r1.source_created_at, r1.created_at) - COALESCE(r2.source_created_at, r2.created_at)
            )) / 86400)::int
        ),
        COALESCE(r1.notes, r1.source_record_id, ''),
        COALESCE(r2.notes, r2.source_record_id, ''),
        p1.formatted_address,
        p2.formatted_address,
        r1.status,
        r2.status,
        r1.source_system,
        r2.source_system
    FROM ops.requests r1
    JOIN ops.requests r2
        ON r1.request_id < r2.request_id
        AND r1.place_id = r2.place_id
        AND r1.source_system != r2.source_system
        AND ABS(EXTRACT(EPOCH FROM (
            COALESCE(r1.source_created_at, r1.created_at) - COALESCE(r2.source_created_at, r2.created_at)
        ))) < 15768000 -- 6 months in seconds
    LEFT JOIN sot.places p1 ON p1.place_id = r1.place_id
    LEFT JOIN sot.places p2 ON p2.place_id = r2.place_id
    WHERE r1.merged_into_request_id IS NULL
      AND r2.merged_into_request_id IS NULL
      AND r1.place_id IS NOT NULL
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
        CASE WHEN (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r1.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r1.request_id)
        ) >= (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r2.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r2.request_id)
        ) THEN r1.request_id ELSE r2.request_id END,
        CASE WHEN (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r1.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r1.request_id)
        ) >= (
            (SELECT COUNT(*) FROM ops.trapper_trip_reports WHERE request_id = r2.request_id)
            + (SELECT COUNT(*) FROM ops.journal_entries WHERE request_id = r2.request_id)
        ) THEN r2.request_id ELSE r1.request_id END,
        3,
        jsonb_build_object(
            'place_family', TRUE,
            'date_diff_days', ABS(EXTRACT(EPOCH FROM (
                COALESCE(r1.source_created_at, r1.created_at) - COALESCE(r2.source_created_at, r2.created_at)
            )) / 86400)::int
        ),
        COALESCE(r1.notes, r1.source_record_id, ''),
        COALESCE(r2.notes, r2.source_record_id, ''),
        p1.formatted_address,
        p2.formatted_address,
        r1.status,
        r2.status,
        r1.source_system,
        r2.source_system
    FROM ops.requests r1
    JOIN ops.requests r2
        ON r1.request_id < r2.request_id
        AND r1.place_id != r2.place_id
        AND r2.place_id = ANY(sot.get_place_family(r1.place_id))
        AND ABS(EXTRACT(EPOCH FROM (
            COALESCE(r1.source_created_at, r1.created_at) - COALESCE(r2.source_created_at, r2.created_at)
        ))) < 15768000 -- 6 months
    LEFT JOIN sot.places p1 ON p1.place_id = r1.place_id
    LEFT JOIN sot.places p2 ON p2.place_id = r2.place_id
    WHERE r1.merged_into_request_id IS NULL
      AND r2.merged_into_request_id IS NULL
      AND r1.place_id IS NOT NULL
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
'Refresh request dedup candidates. T1: same place + same source + similar record ID, T2: same place + different source + 6mo, T3: place family + 6mo';

COMMIT;
