-- MIG_2419: Fix Mega-Place - 217 Healdsburg Ave (Chamber of Commerce)
--
-- ROOT CAUSE: V2 migration created cat_place relationships with evidence_type = 'person_relationship'
-- for 2,346 cats that have NO actual person_cat relationships. This is invalid data.
--
-- PROBLEM: 217 Healdsburg Ave is the Healdsburg Chamber of Commerce - an FFSC trapping SITE,
-- not a residential address. Only 7 cats were actually booked there via appointments.
-- But 2,375 cats got incorrectly linked via migration bug.
--
-- FIX:
-- 1. Archive invalid cat_place relationships before deletion
-- 2. Delete cat_place relationships that claim 'person_relationship' but have no backing person_cat
-- 3. Blacklist the Chamber of Commerce as a non-residential trapping site
-- 4. Classify it as 'business' place_kind

BEGIN;

-- =============================================================================
-- STEP 1: Archive invalid relationships before deletion
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.archived_invalid_cat_place (
    cat_id UUID NOT NULL,
    place_id UUID NOT NULL,
    relationship_type TEXT,
    evidence_type TEXT,
    source_system TEXT,
    original_created_at TIMESTAMPTZ,
    archive_reason TEXT NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_by TEXT DEFAULT 'MIG_2419'
);

INSERT INTO ops.archived_invalid_cat_place (
    cat_id, place_id, relationship_type, evidence_type, source_system, original_created_at, archive_reason
)
SELECT
    cp.cat_id,
    cp.place_id,
    cp.relationship_type,
    cp.evidence_type,
    cp.source_system,
    cp.created_at,
    'person_relationship evidence but no backing person_cat - V2 migration bug'
FROM sot.cat_place cp
WHERE cp.evidence_type = 'person_relationship'
AND NOT EXISTS (
    SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = cp.cat_id
)
ON CONFLICT DO NOTHING;

DO $$
DECLARE v_archived INT;
BEGIN
    SELECT COUNT(*) INTO v_archived FROM ops.archived_invalid_cat_place
    WHERE archived_by = 'MIG_2419';
    RAISE NOTICE 'MIG_2419: Archived % invalid cat_place relationships', v_archived;
END $$;

-- =============================================================================
-- STEP 2: Delete invalid cat_place relationships
-- =============================================================================

DELETE FROM sot.cat_place cp
WHERE cp.evidence_type = 'person_relationship'
AND NOT EXISTS (
    SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = cp.cat_id
);

DO $$
DECLARE v_deleted INT;
BEGIN
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE 'MIG_2419: Deleted % invalid cat_place relationships', v_deleted;
END $$;

-- =============================================================================
-- STEP 3: Blacklist Healdsburg Chamber of Commerce
-- =============================================================================

DO $$
DECLARE
    v_place_id UUID := '9420ddb8-d063-40b2-8936-90ef320123a0';
    v_exists BOOLEAN;
BEGIN
    -- Check if already in blacklist
    SELECT EXISTS(
        SELECT 1 FROM sot.place_soft_blacklist WHERE place_id = v_place_id
    ) INTO v_exists;

    IF NOT v_exists THEN
        INSERT INTO sot.place_soft_blacklist (place_id, blacklist_type, reason, created_by)
        VALUES (
            v_place_id,
            'all',
            'Healdsburg Chamber of Commerce - FFSC trapping site, not residential',
            'MIG_2419'
        );
        RAISE NOTICE 'MIG_2419: Added Healdsburg Chamber of Commerce to blacklist';
    ELSE
        RAISE NOTICE 'MIG_2419: Healdsburg Chamber of Commerce already in blacklist';
    END IF;
END $$;

-- =============================================================================
-- STEP 4: Classify as business
-- =============================================================================

UPDATE sot.places
SET
    place_kind = 'business',
    updated_at = NOW()
WHERE place_id = '9420ddb8-d063-40b2-8936-90ef320123a0'
AND (place_kind != 'business' OR place_kind IS NULL);

DO $$
DECLARE v_updated INT;
BEGIN
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
        RAISE NOTICE 'MIG_2419: Updated Healdsburg Chamber of Commerce to place_kind = business';
    END IF;
END $$;

COMMIT;

-- =============================================================================
-- VERIFICATION
-- =============================================================================

-- Show remaining cat_place for 217 Healdsburg (should be only legitimate appointment-based)
SELECT
    relationship_type,
    evidence_type,
    source_system,
    COUNT(*) as cnt
FROM sot.cat_place
WHERE place_id = '9420ddb8-d063-40b2-8936-90ef320123a0'
GROUP BY 1,2,3
ORDER BY cnt DESC;

-- Check archive count
SELECT
    'Archived invalid cat_place' as metric,
    COUNT(*) as count
FROM ops.archived_invalid_cat_place
WHERE archived_by = 'MIG_2419';

-- Check blacklist status
SELECT
    p.display_name,
    p.place_kind,
    psb.blacklist_type,
    psb.reason
FROM sot.places p
LEFT JOIN sot.place_soft_blacklist psb ON psb.place_id = p.place_id
WHERE p.place_id = '9420ddb8-d063-40b2-8936-90ef320123a0';
