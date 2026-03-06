-- MIG_2838: Address dedup infrastructure
--
-- sot.addresses has merged_into_address_id and address_key columns but zero dedup infrastructure.
-- This migration adds:
-- 1. merge_address_into() — relinks all FK references from loser → winner
-- 2. address_safe_to_merge() — safety gate returning TEXT
-- 3. ops.address_dedup_candidates — candidate pairs table
-- 4. ops.refresh_address_dedup_candidates() — tier-based candidate generation

BEGIN;

-- =============================================================================
-- 1. Safety gate: address_safe_to_merge
-- =============================================================================

CREATE OR REPLACE FUNCTION sot.address_safe_to_merge(p_loser_id UUID, p_winner_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_loser RECORD;
    v_winner RECORD;
BEGIN
    -- Check loser exists and is not already merged
    SELECT address_id, merged_into_address_id, city
    INTO v_loser
    FROM sot.addresses
    WHERE address_id = p_loser_id;

    IF NOT FOUND THEN
        RETURN 'loser_not_found';
    END IF;

    IF v_loser.merged_into_address_id IS NOT NULL THEN
        RETURN 'already_merged';
    END IF;

    -- Check winner exists and is not already merged
    SELECT address_id, merged_into_address_id, city
    INTO v_winner
    FROM sot.addresses
    WHERE address_id = p_winner_id;

    IF NOT FOUND THEN
        RETURN 'winner_not_found';
    END IF;

    IF v_winner.merged_into_address_id IS NOT NULL THEN
        RETURN 'already_merged';
    END IF;

    -- City mismatch = probably not the same address
    IF v_loser.city IS NOT NULL AND v_winner.city IS NOT NULL
       AND LOWER(TRIM(v_loser.city)) != LOWER(TRIM(v_winner.city)) THEN
        RETURN 'different_cities';
    END IF;

    RETURN 'safe';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.address_safe_to_merge(UUID, UUID) IS
'Safety gate for address merges. Returns TEXT: safe, different_cities, loser_not_found, winner_not_found, already_merged';

-- =============================================================================
-- 2. Merge function: merge_address_into
-- =============================================================================

CREATE OR REPLACE FUNCTION sot.merge_address_into(
    p_loser_id UUID,
    p_winner_id UUID,
    p_reason TEXT DEFAULT 'duplicate_address',
    p_changed_by TEXT DEFAULT 'system'
)
RETURNS void AS $$
DECLARE
    v_loser RECORD;
    v_winner RECORD;
    v_relinked_places INT := 0;
    v_relinked_people INT := 0;
    v_relinked_households INT := 0;
BEGIN
    -- Validate both exist and are not merged
    SELECT * INTO v_loser FROM sot.addresses WHERE address_id = p_loser_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loser address % not found', p_loser_id;
    END IF;
    IF v_loser.merged_into_address_id IS NOT NULL THEN
        RAISE EXCEPTION 'Loser address % is already merged into %', p_loser_id, v_loser.merged_into_address_id;
    END IF;

    SELECT * INTO v_winner FROM sot.addresses WHERE address_id = p_winner_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Winner address % not found', p_winner_id;
    END IF;
    IF v_winner.merged_into_address_id IS NOT NULL THEN
        RAISE EXCEPTION 'Winner address % is already merged into %', p_winner_id, v_winner.merged_into_address_id;
    END IF;

    -- Relink sot.places.sot_address_id
    UPDATE sot.places
    SET sot_address_id = p_winner_id, updated_at = NOW()
    WHERE sot_address_id = p_loser_id;
    GET DIAGNOSTICS v_relinked_places = ROW_COUNT;

    -- Relink sot.people.primary_address_id
    UPDATE sot.people
    SET primary_address_id = p_winner_id, updated_at = NOW()
    WHERE primary_address_id = p_loser_id;
    GET DIAGNOSTICS v_relinked_people = ROW_COUNT;

    -- Relink sot.households.primary_address_id (if column exists)
    BEGIN
        UPDATE sot.households
        SET primary_address_id = p_winner_id
        WHERE primary_address_id = p_loser_id;
        GET DIAGNOSTICS v_relinked_households = ROW_COUNT;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
        v_relinked_households := 0;
    END;

    -- Mark loser as merged
    UPDATE sot.addresses
    SET merged_into_address_id = p_winner_id, updated_at = NOW()
    WHERE address_id = p_loser_id;

    -- Log to entity_edits
    INSERT INTO ops.entity_edits (entity_type, entity_id, edit_type, field_name, old_value, new_value, changed_by, change_source)
    VALUES (
        'address',
        p_loser_id,
        'merge',
        'merged_into_address_id',
        NULL,
        to_jsonb(p_winner_id::text),
        p_changed_by,
        p_reason
    );

    RAISE NOTICE 'Merged address % into %. Relinked: % places, % people, % households',
        p_loser_id, p_winner_id, v_relinked_places, v_relinked_people, v_relinked_households;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sot.merge_address_into(UUID, UUID, TEXT, TEXT) IS
'Merge loser address into winner. Relinks places, people, households. Logs to entity_edits.';

-- =============================================================================
-- 3. Candidates table
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.address_dedup_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_address_id UUID NOT NULL REFERENCES sot.addresses(address_id),
    duplicate_address_id UUID NOT NULL REFERENCES sot.addresses(address_id),
    match_tier INT NOT NULL,
    address_similarity NUMERIC(4,3),
    distance_meters NUMERIC(10,1),
    canonical_formatted TEXT,
    duplicate_formatted TEXT,
    canonical_city TEXT,
    duplicate_city TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(canonical_address_id, duplicate_address_id)
);

CREATE INDEX IF NOT EXISTS idx_address_dedup_status ON ops.address_dedup_candidates(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_address_dedup_tier ON ops.address_dedup_candidates(match_tier) WHERE status = 'pending';

-- =============================================================================
-- 4. Candidate refresh function
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.refresh_address_dedup_candidates()
RETURNS TABLE(tier1_count INT, tier2_count INT, tier3_count INT, total INT) AS $$
DECLARE
    v_t1 INT := 0;
    v_t2 INT := 0;
    v_t3 INT := 0;
BEGIN
    -- Clear pending candidates (keep resolved history)
    DELETE FROM ops.address_dedup_candidates WHERE status = 'pending';

    -- Tier 1: Same address_key (exact normalized match)
    INSERT INTO ops.address_dedup_candidates (
        canonical_address_id, duplicate_address_id, match_tier,
        address_similarity, distance_meters,
        canonical_formatted, duplicate_formatted,
        canonical_city, duplicate_city
    )
    SELECT
        a1.address_id,
        a2.address_id,
        1,
        1.000,
        CASE
            WHEN a1.location IS NOT NULL AND a2.location IS NOT NULL
            THEN ST_Distance(a1.location, a2.location)
            ELSE NULL
        END,
        a1.formatted_address,
        a2.formatted_address,
        a1.city,
        a2.city
    FROM sot.addresses a1
    JOIN sot.addresses a2
        ON a1.address_key = a2.address_key
        AND a1.address_id < a2.address_id
    WHERE a1.merged_into_address_id IS NULL
      AND a2.merged_into_address_id IS NULL
      AND a1.address_key IS NOT NULL
      AND a1.address_key != ''
      -- Exclude already-resolved pairs
      AND NOT EXISTS (
          SELECT 1 FROM ops.address_dedup_candidates adc
          WHERE adc.status IN ('merged', 'kept_separate', 'dismissed')
            AND (
                (adc.canonical_address_id = a1.address_id AND adc.duplicate_address_id = a2.address_id)
                OR (adc.canonical_address_id = a2.address_id AND adc.duplicate_address_id = a1.address_id)
            )
      )
    ON CONFLICT (canonical_address_id, duplicate_address_id) DO NOTHING;

    SELECT COUNT(*)::int INTO v_t1
    FROM ops.address_dedup_candidates WHERE match_tier = 1 AND status = 'pending';

    -- Tier 2: Trigram similarity > 0.8 on formatted_address + same city
    INSERT INTO ops.address_dedup_candidates (
        canonical_address_id, duplicate_address_id, match_tier,
        address_similarity, distance_meters,
        canonical_formatted, duplicate_formatted,
        canonical_city, duplicate_city
    )
    SELECT
        a1.address_id,
        a2.address_id,
        2,
        similarity(a1.formatted_address, a2.formatted_address),
        CASE
            WHEN a1.location IS NOT NULL AND a2.location IS NOT NULL
            THEN ST_Distance(a1.location, a2.location)
            ELSE NULL
        END,
        a1.formatted_address,
        a2.formatted_address,
        a1.city,
        a2.city
    FROM sot.addresses a1
    JOIN sot.addresses a2
        ON a1.address_id < a2.address_id
        AND LOWER(TRIM(a1.city)) = LOWER(TRIM(a2.city))
        AND similarity(a1.formatted_address, a2.formatted_address) > 0.8
    WHERE a1.merged_into_address_id IS NULL
      AND a2.merged_into_address_id IS NULL
      AND a1.formatted_address IS NOT NULL
      AND a2.formatted_address IS NOT NULL
      AND a1.city IS NOT NULL
      -- Exclude T1 (already found by address_key)
      AND NOT EXISTS (
          SELECT 1 FROM ops.address_dedup_candidates adc
          WHERE (adc.canonical_address_id = a1.address_id AND adc.duplicate_address_id = a2.address_id)
             OR (adc.canonical_address_id = a2.address_id AND adc.duplicate_address_id = a1.address_id)
      )
    ON CONFLICT (canonical_address_id, duplicate_address_id) DO NOTHING;

    SELECT COUNT(*)::int INTO v_t2
    FROM ops.address_dedup_candidates WHERE match_tier = 2 AND status = 'pending';

    -- Tier 3: Within 50m geocoding distance + similarity > 0.5
    INSERT INTO ops.address_dedup_candidates (
        canonical_address_id, duplicate_address_id, match_tier,
        address_similarity, distance_meters,
        canonical_formatted, duplicate_formatted,
        canonical_city, duplicate_city
    )
    SELECT
        a1.address_id,
        a2.address_id,
        3,
        similarity(a1.formatted_address, a2.formatted_address),
        ST_Distance(a1.location, a2.location),
        a1.formatted_address,
        a2.formatted_address,
        a1.city,
        a2.city
    FROM sot.addresses a1
    JOIN sot.addresses a2
        ON a1.address_id < a2.address_id
        AND ST_DWithin(a1.location, a2.location, 50)
        AND similarity(a1.formatted_address, a2.formatted_address) > 0.5
    WHERE a1.merged_into_address_id IS NULL
      AND a2.merged_into_address_id IS NULL
      AND a1.location IS NOT NULL
      AND a2.location IS NOT NULL
      -- Exclude already-found pairs
      AND NOT EXISTS (
          SELECT 1 FROM ops.address_dedup_candidates adc
          WHERE (adc.canonical_address_id = a1.address_id AND adc.duplicate_address_id = a2.address_id)
             OR (adc.canonical_address_id = a2.address_id AND adc.duplicate_address_id = a1.address_id)
      )
    ON CONFLICT (canonical_address_id, duplicate_address_id) DO NOTHING;

    SELECT COUNT(*)::int INTO v_t3
    FROM ops.address_dedup_candidates WHERE match_tier = 3 AND status = 'pending';

    RETURN QUERY SELECT v_t1, v_t2, v_t3, v_t1 + v_t2 + v_t3;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.refresh_address_dedup_candidates() IS
'Refresh address dedup candidates. T1: same address_key, T2: trigram > 0.8 + same city, T3: within 50m + similarity > 0.5';

COMMIT;
