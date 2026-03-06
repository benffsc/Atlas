-- MIG_2837: Fix dedup safety gates for person and place merges
--
-- Two critical bugs:
-- 1. sot.place_safe_to_merge() returns BOOLEAN, but API expects TEXT → all merges blocked
-- 2. sot.person_safe_to_merge() does not exist → person merges crash
--
-- Fix: Replace place_safe_to_merge with TEXT-returning version matching cat pattern.
--      Create person_safe_to_merge with TEXT return.

BEGIN;

-- =============================================================================
-- 1. Fix place_safe_to_merge: BOOLEAN → TEXT
-- =============================================================================

-- Must DROP first because return type is changing from BOOLEAN to TEXT
DROP FUNCTION IF EXISTS sot.place_safe_to_merge(UUID, UUID);

CREATE OR REPLACE FUNCTION sot.place_safe_to_merge(p_loser_id UUID, p_winner_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_loser RECORD;
    v_winner RECORD;
    v_loser_has_children BOOLEAN;
    v_winner_has_children BOOLEAN;
BEGIN
    -- Check loser exists and is not already merged
    SELECT place_id, merged_into_place_id
    INTO v_loser
    FROM sot.places
    WHERE place_id = p_loser_id;

    IF NOT FOUND THEN
        RETURN 'loser_not_found';
    END IF;

    IF v_loser.merged_into_place_id IS NOT NULL THEN
        RETURN 'already_merged';
    END IF;

    -- Check winner exists and is not already merged
    SELECT place_id, merged_into_place_id
    INTO v_winner
    FROM sot.places
    WHERE place_id = p_winner_id;

    IF NOT FOUND THEN
        RETURN 'winner_not_found';
    END IF;

    IF v_winner.merged_into_place_id IS NOT NULL THEN
        RETURN 'already_merged';
    END IF;

    -- Check if both have children (would create complex hierarchy)
    SELECT EXISTS (
        SELECT 1 FROM sot.places
        WHERE parent_place_id = p_loser_id AND merged_into_place_id IS NULL
    ) INTO v_loser_has_children;

    SELECT EXISTS (
        SELECT 1 FROM sot.places
        WHERE parent_place_id = p_winner_id AND merged_into_place_id IS NULL
    ) INTO v_winner_has_children;

    IF v_loser_has_children AND v_winner_has_children THEN
        RETURN 'both_have_children';
    END IF;

    RETURN 'safe';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.place_safe_to_merge(UUID, UUID) IS
'Safety gate for place merges. Returns TEXT: safe, both_have_children, loser_not_found, winner_not_found, already_merged';

-- =============================================================================
-- 2. Create person_safe_to_merge
-- =============================================================================

CREATE OR REPLACE FUNCTION sot.person_safe_to_merge(p_loser_id UUID, p_winner_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_loser RECORD;
    v_winner RECORD;
    v_loser_has_roles BOOLEAN;
    v_winner_has_roles BOOLEAN;
BEGIN
    -- Check loser exists and is not already merged
    SELECT person_id, merged_into_person_id, data_quality
    INTO v_loser
    FROM sot.people
    WHERE person_id = p_loser_id;

    IF NOT FOUND THEN
        RETURN 'loser_not_found';
    END IF;

    IF v_loser.merged_into_person_id IS NOT NULL THEN
        RETURN 'already_merged';
    END IF;

    -- Check winner exists and is not already merged
    SELECT person_id, merged_into_person_id, data_quality
    INTO v_winner
    FROM sot.people
    WHERE person_id = p_winner_id;

    IF NOT FOUND THEN
        RETURN 'winner_not_found';
    END IF;

    IF v_winner.merged_into_person_id IS NOT NULL THEN
        RETURN 'already_merged';
    END IF;

    -- INV-2: Manual > AI — verified data cannot be overwritten
    IF v_loser.data_quality = 'verified' THEN
        RETURN 'loser_verified';
    END IF;

    -- Check if both have staff/volunteer roles (requires manual review)
    SELECT EXISTS (
        SELECT 1 FROM sot.person_roles
        WHERE person_id = p_loser_id
    ) INTO v_loser_has_roles;

    SELECT EXISTS (
        SELECT 1 FROM sot.person_roles
        WHERE person_id = p_winner_id
    ) INTO v_winner_has_roles;

    IF v_loser_has_roles AND v_winner_has_roles THEN
        RETURN 'both_have_roles';
    END IF;

    RETURN 'safe';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION sot.person_safe_to_merge(UUID, UUID) IS
'Safety gate for person merges. Returns TEXT: safe, loser_verified, both_have_roles, loser_not_found, winner_not_found, already_merged';

COMMIT;
