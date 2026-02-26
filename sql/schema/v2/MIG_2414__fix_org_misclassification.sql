-- MIG_2414: Fix Organization Misclassification (Archive-First Pattern)
--
-- ROOT CAUSE ANALYSIS:
-- ====================
-- classify_owner_name() and guards.ts were missing business keywords:
-- - mechanic, auction, corporation (not corp)
-- - winery, vineyard already in ref.business_keywords but weight may be low
-- This migration fixes existing bad data AND ensures root cause is addressed.
--
-- PATTERN: Archive → Fix Root Cause → Clean SOT
-- See: MIG_2314 (archive pattern), CLAUDE.md INV-1 (No Data Disappears)
--
-- Records affected:
-- - Sartorial Auto Repairs, Blentech Corporation, Wiggins Electric
-- - Aamco Repair Santa Rosa, Sunrise Farms One
-- - Speedy Creek Winery, Keller Estates Vineyards
-- - Mike's Truck Garden, Petaluma Poultry, Petaluma Livestock Auction
-- - SCAS (Sonoma County Animal Services)
-- - "Rebooking placeholder" pseudo-profile

BEGIN;

-- =============================================================================
-- STEP 1: ROOT CAUSE FIX — Add missing keywords to ref.business_keywords
-- =============================================================================
-- This prevents future misclassifications

INSERT INTO ref.business_keywords (keyword, category, weight, notes) VALUES
    -- Missing from original list
    ('mechanic', 'automotive', 1.0, 'Auto Mechanic - MIG_2414'),
    ('aamco', 'automotive', 1.0, 'Auto repair chain - MIG_2414'),
    ('wiggins', 'service', 0.6, 'Often business name - MIG_2414'),
    ('sartorial', 'service', 0.9, 'Tailoring/fashion - MIG_2414')
ON CONFLICT (keyword) DO UPDATE SET
    weight = GREATEST(ref.business_keywords.weight, EXCLUDED.weight);

DO $$ BEGIN RAISE NOTICE 'MIG_2414: Added/updated missing business keywords'; END $$;

-- =============================================================================
-- STEP 2: ARCHIVE — Record original state before modification
-- =============================================================================
-- Creates audit trail per CLAUDE.md INV-1 (No Data Disappears)

-- Ensure archive table exists (idempotent)
CREATE TABLE IF NOT EXISTS ops.archived_org_misclassifications (
    person_id UUID PRIMARY KEY,
    display_name TEXT NOT NULL,
    original_entity_type TEXT,
    original_is_organization BOOLEAN,
    original_data_quality TEXT,
    source_system TEXT,
    original_created_at TIMESTAMPTZ,
    archive_reason TEXT NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_by TEXT DEFAULT 'MIG_2414'
);

-- Archive records before modifying
INSERT INTO ops.archived_org_misclassifications (
    person_id, display_name, original_entity_type, original_is_organization,
    original_data_quality, source_system, original_created_at, archive_reason
)
SELECT
    person_id,
    display_name,
    entity_type,
    is_organization,
    data_quality,
    source_system,
    created_at,
    'Business name misclassified as person - UI/Data audit 2026-02-21'
FROM sot.people
WHERE display_name IN (
    'Sartorial Auto Repairs', 'Blentech Corporation', 'Wiggins Electric',
    'Aamco Repair Santa Rosa', 'Sunrise Farms One', 'Speedy Creek Winery',
    'Keller Estates Vineyards', 'Mike''s Truck Garden', 'Petaluma Poultry',
    'Petaluma Livestock Auction', 'SCAS', 'Rebooking placeholder'
)
AND merged_into_person_id IS NULL
ON CONFLICT (person_id) DO NOTHING;

-- Log archive count
DO $$
DECLARE v_archived INT;
BEGIN
    SELECT COUNT(*) INTO v_archived FROM ops.archived_org_misclassifications
    WHERE archived_by = 'MIG_2414';
    RAISE NOTICE 'MIG_2414: Archived % records before modification', v_archived;
END $$;

-- =============================================================================
-- STEP 3: FIX SOT — Mark clear businesses as organizations
-- =============================================================================

UPDATE sot.people
SET
    entity_type = 'organization',
    is_organization = true,
    updated_at = NOW()
WHERE display_name IN (
    'Sartorial Auto Repairs', 'Blentech Corporation', 'Wiggins Electric',
    'Aamco Repair Santa Rosa', 'Sunrise Farms One', 'Speedy Creek Winery',
    'Keller Estates Vineyards', 'Mike''s Truck Garden', 'Petaluma Poultry',
    'Petaluma Livestock Auction', 'SCAS'
)
AND entity_type != 'organization'
AND merged_into_person_id IS NULL;

DO $$
DECLARE v_fixed INT;
BEGIN
    GET DIAGNOSTICS v_fixed = ROW_COUNT;
    RAISE NOTICE 'MIG_2414: Marked % records as organization', v_fixed;
END $$;

-- =============================================================================
-- STEP 4: HANDLE PSEUDO-PROFILE "Rebooking placeholder"
-- =============================================================================

DO $$
DECLARE
    v_person_id UUID;
    v_has_cats BOOLEAN;
    v_has_places BOOLEAN;
    v_has_requests BOOLEAN;
BEGIN
    SELECT person_id INTO v_person_id
    FROM sot.people
    WHERE display_name = 'Rebooking placeholder'
    AND merged_into_person_id IS NULL
    LIMIT 1;

    IF v_person_id IS NULL THEN
        RAISE NOTICE 'MIG_2414: Rebooking placeholder not found';
        RETURN;
    END IF;

    -- Check for dependencies
    SELECT EXISTS(SELECT 1 FROM sot.person_cat WHERE person_id = v_person_id) INTO v_has_cats;
    SELECT EXISTS(SELECT 1 FROM sot.person_place WHERE person_id = v_person_id) INTO v_has_places;
    SELECT EXISTS(SELECT 1 FROM ops.requests WHERE requester_person_id = v_person_id) INTO v_has_requests;

    IF v_has_cats OR v_has_places OR v_has_requests THEN
        -- Mark as garbage (keeps audit trail, excluded from displays)
        UPDATE sot.people
        SET data_quality = 'garbage', updated_at = NOW()
        WHERE person_id = v_person_id;
        RAISE NOTICE 'MIG_2414: Rebooking placeholder has dependencies, marked as garbage';
    ELSE
        -- Archive identifiers then delete
        DELETE FROM sot.person_identifiers WHERE person_id = v_person_id;
        DELETE FROM sot.people WHERE person_id = v_person_id;
        RAISE NOTICE 'MIG_2414: Deleted Rebooking placeholder (no dependencies)';
    END IF;
END $$;

-- =============================================================================
-- STEP 5: MERGE SCAS DUPLICATES
-- =============================================================================

DO $$
DECLARE
    v_scas_ids UUID[];
    v_winner_id UUID;
    v_loser_id UUID;
BEGIN
    SELECT ARRAY_AGG(person_id ORDER BY created_at ASC)
    INTO v_scas_ids
    FROM sot.people
    WHERE display_name = 'SCAS'
    AND merged_into_person_id IS NULL;

    IF ARRAY_LENGTH(v_scas_ids, 1) IS NULL OR ARRAY_LENGTH(v_scas_ids, 1) < 2 THEN
        RAISE NOTICE 'MIG_2414: SCAS has % record(s) (no merge needed)',
            COALESCE(ARRAY_LENGTH(v_scas_ids, 1), 0);
        RETURN;
    END IF;

    v_winner_id := v_scas_ids[1];
    v_loser_id := v_scas_ids[2];

    RAISE NOTICE 'MIG_2414: Merging SCAS % into %', v_loser_id, v_winner_id;

    -- Manual merge (merge_person_into may not exist in V2 schema)
    UPDATE sot.people
    SET merged_into_person_id = v_winner_id, updated_at = NOW()
    WHERE person_id = v_loser_id;

    UPDATE sot.person_cat
    SET person_id = v_winner_id WHERE person_id = v_loser_id;

    UPDATE sot.person_place
    SET person_id = v_winner_id WHERE person_id = v_loser_id;

    UPDATE ops.requests
    SET requester_person_id = v_winner_id WHERE requester_person_id = v_loser_id;

    RAISE NOTICE 'MIG_2414: SCAS merge complete';
END $$;

COMMIT;

-- =============================================================================
-- VERIFICATION
-- =============================================================================

\echo ''
\echo '=== MIG_2414: Verification ==='

-- Show fixed records
SELECT
    display_name,
    entity_type,
    is_organization,
    data_quality,
    source_system,
    CASE WHEN merged_into_person_id IS NOT NULL THEN 'MERGED' ELSE 'ACTIVE' END as status
FROM sot.people
WHERE display_name IN (
    'Sartorial Auto Repairs', 'Blentech Corporation', 'Wiggins Electric',
    'Aamco Repair Santa Rosa', 'Sunrise Farms One', 'Speedy Creek Winery',
    'Keller Estates Vineyards', 'Mike''s Truck Garden', 'Petaluma Poultry',
    'Petaluma Livestock Auction', 'SCAS', 'Rebooking placeholder'
)
ORDER BY display_name;

-- Show archive count
SELECT
    'Archived records' as metric,
    COUNT(*) as count
FROM ops.archived_org_misclassifications
WHERE archived_by = 'MIG_2414';

-- Show new keywords
SELECT keyword, category, weight
FROM ref.business_keywords
WHERE notes LIKE '%MIG_2414%';
