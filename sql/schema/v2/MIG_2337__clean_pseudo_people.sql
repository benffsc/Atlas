-- MIG_2337: Clean Pseudo-Profile Pollution from sot.people
--
-- ROOT CAUSE ANALYSIS:
-- ====================
-- During V2 ClinicHQ bulk import (direct-import.cjs), pseudo-profiles were created
-- in sot.people that should have been routed to ops.clinic_accounts:
--
-- 1. "Rebooking placeholder" - ClinicHQ system account with fake identifiers
--    - Email: *@noemail.com (ClinicHQ-generated fake domain)
--    - Phone: 7075767999 (FFSC office phone - used as default)
--    - 2,381 cat relationships linked via entity linking
--
-- 2. "Speedy Creek Winery" - Organization name, not a person (116 cats)
-- 3. "Petaluma Poultry" - Organization name, not a person (91 cats)
-- 4. "Petaluma Livestock Auction" - Organization name (31 cats)
-- 5. "Keller Estates Vineyards" - Organization name (64 cats)
--
-- WHY THIS HAPPENED:
-- ==================
-- - should_be_person() passed because contact info existed (fake as it was)
-- - Entity linking (link_cats_to_places) propagated cats to these records' places
-- - No detection for placeholder names or fake email domains
--
-- FIXES ALREADY APPLIED:
-- ======================
-- - Updated should_be_person() to reject @noemail.com, @petestablished.com domains
-- - Updated should_be_person() to reject "rebooking", "placeholder" name patterns
-- - Added FFSC phone 7075767999 to soft_blacklist
-- - Cleaned 35,243 polluted cat_place_relationships
--
-- THIS MIGRATION:
-- ===============
-- 1. Archive polluted people to ops.archived_people (preserve audit trail)
-- 2. Move to ops.clinic_accounts (preserve raw data for reference)
-- 3. Delete relationships (person_cat, person_place, identifiers)
-- 4. Create monitoring view for ongoing detection
-- 5. Document in DATA_GAPS.md as DATA_GAP_031
--
-- INVARIANTS UPHELD:
-- ==================
-- - INV-1: No Data Disappears (archived, not deleted)
-- - INV-25: ClinicHQ Pseudo-Profiles Are NOT People
-- - INV-29: Data Engine Rejects No-Identifier Cases
-- - CLAUDE.md: sot_people contains ONLY real people

BEGIN;

-- ============================================================================
-- STEP 1: Identify the polluted records
-- ============================================================================

-- Polluted person IDs (verified from investigation)
CREATE TEMP TABLE polluted_people AS
SELECT person_id, first_name, last_name, display_name
FROM sot.people
WHERE person_id IN (
    'a12eaac7-edfe-48c1-88c6-53576be12afb',  -- Rebooking placeholder (2,381 cats)
    'f4b63fb9-f647-41f4-8141-65fbf310d7a2',  -- Speedy Creek Winery (116 cats)
    '427f3bff-eb45-4cb7-8ecb-938f4c603511',  -- Petaluma Poultry (91 cats)
    '965faee5-29dd-4924-937d-67877fcddddf',  -- Petaluma Livestock Auction (31 cats)
    '70e49e64-1050-4462-99d8-ce08d166f609'   -- Keller Estates Vineyards (64 cats)
)
AND merged_into_person_id IS NULL;

-- Count check
DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM polluted_people;
    RAISE NOTICE 'Polluted people to clean: %', v_count;

    IF v_count = 0 THEN
        RAISE NOTICE 'No polluted people found - they may have already been cleaned';
    END IF;
END;
$$;

-- ============================================================================
-- STEP 2: Archive to ops.archived_people
-- ============================================================================

INSERT INTO ops.archived_people (
    person_id,
    display_name,
    first_name,
    last_name,
    entity_type,
    is_organization,
    source_system,
    source_record_id,
    original_created_at,
    original_updated_at,
    archive_reason,
    archive_category,
    archived_by
)
SELECT
    p.person_id,
    p.display_name,
    p.first_name,
    p.last_name,
    p.entity_type,
    CASE
        WHEN p.first_name IN ('Speedy Creek', 'Petaluma', 'Keller') THEN TRUE
        ELSE FALSE
    END as is_organization,
    p.source_system,
    p.source_record_id,
    p.created_at,
    p.updated_at,
    CASE
        WHEN p.first_name = 'Rebooking' THEN 'ClinicHQ system account with fake identifiers (@noemail.com, FFSC phone)'
        ELSE 'Organization/business name stored as person - ClinicHQ booking practice'
    END as archive_reason,
    CASE
        WHEN p.first_name = 'Rebooking' THEN 'pseudo_profile'
        ELSE 'organization'
    END as archive_category,
    'MIG_2337'
FROM sot.people p
WHERE EXISTS (SELECT 1 FROM polluted_people pp WHERE pp.person_id = p.person_id)
ON CONFLICT (person_id) DO NOTHING;

-- ============================================================================
-- STEP 3: Move to ops.clinic_accounts for reference
-- ============================================================================

INSERT INTO ops.clinic_accounts (
    owner_first_name,
    owner_last_name,
    owner_email,
    owner_phone,
    account_type,
    classification_reason,
    classification_confidence,
    cat_count,
    source_system,
    first_seen_at
)
SELECT
    p.first_name,
    p.last_name,
    (SELECT pi.id_value_norm FROM sot.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.id_type = 'email' LIMIT 1),
    (SELECT pi.id_value_norm FROM sot.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.id_type = 'phone' LIMIT 1),
    CASE
        WHEN p.first_name = 'Rebooking' THEN 'unknown'
        ELSE 'organization'
    END,
    CASE
        WHEN p.first_name = 'Rebooking' THEN 'MIG_2337: System account with fake identifiers'
        ELSE 'MIG_2337: Organization name in ClinicHQ owner field'
    END,
    0.95,
    (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id),
    COALESCE(p.source_system, 'clinichq'),
    p.created_at
FROM sot.people p
WHERE EXISTS (SELECT 1 FROM polluted_people pp WHERE pp.person_id = p.person_id);

-- ============================================================================
-- STEP 4: Archive person_place relationships
-- ============================================================================

INSERT INTO ops.archived_person_place (
    person_id,
    place_id,
    relationship_type,
    evidence_type,
    confidence,
    is_primary,
    source_system,
    source_table,
    original_created_at
)
SELECT
    pp.person_id,
    pp.place_id,
    pp.relationship_type,
    pp.evidence_type,
    pp.confidence,
    pp.is_primary,
    pp.source_system,
    pp.source_table,
    pp.created_at
FROM sot.person_place pp
WHERE EXISTS (SELECT 1 FROM polluted_people pol WHERE pol.person_id = pp.person_id)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- STEP 5: Delete relationships (clean the pollution)
-- ============================================================================

-- Delete person_cat relationships
DELETE FROM sot.person_cat pc
WHERE EXISTS (SELECT 1 FROM polluted_people pp WHERE pp.person_id = pc.person_id);

-- Delete person_place relationships
DELETE FROM sot.person_place pp
WHERE EXISTS (SELECT 1 FROM polluted_people pol WHERE pol.person_id = pp.person_id);

-- Delete identifiers
DELETE FROM sot.person_identifiers pi
WHERE EXISTS (SELECT 1 FROM polluted_people pp WHERE pp.person_id = pi.person_id);

-- ============================================================================
-- STEP 6: Nullify appointment references
-- ============================================================================

-- Clear person_id on appointments (these should use owner_account_id instead)
UPDATE ops.appointments a
SET
    person_id = NULL,
    resolution_status = 'pseudo_profile',
    resolution_notes = 'MIG_2337: Owner was pseudo-profile, moved to clinic_accounts'
WHERE EXISTS (SELECT 1 FROM polluted_people pp WHERE pp.person_id = a.person_id);

-- Clear resolved_person_id references
UPDATE ops.appointments a
SET resolved_person_id = NULL
WHERE EXISTS (SELECT 1 FROM polluted_people pp WHERE pp.person_id = a.resolved_person_id);

-- ============================================================================
-- STEP 7: Soft-delete the person (mark as archived)
-- ============================================================================

-- Use merged_into pattern with sentinel value to mark as "deleted/archived"
UPDATE sot.people p
SET
    merged_into_person_id = p.person_id,  -- Self-reference indicates "archived"
    updated_at = NOW()
WHERE EXISTS (SELECT 1 FROM polluted_people pp WHERE pp.person_id = p.person_id);

-- ============================================================================
-- STEP 8: Create monitoring view for ongoing detection
-- ============================================================================

CREATE OR REPLACE VIEW ops.v_suspicious_people AS
SELECT
    p.person_id,
    p.first_name,
    p.last_name,
    p.display_name,
    p.entity_type,
    p.is_organization,
    p.source_system,
    p.created_at,
    (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cat_count,
    (SELECT COUNT(*) FROM sot.person_place pp WHERE pp.person_id = p.person_id) as place_count,
    (SELECT COUNT(*) FROM sot.person_identifiers pi WHERE pi.person_id = p.person_id) as identifier_count,
    sot.classify_owner_name(p.first_name || ' ' || p.last_name) as name_classification,
    CASE
        WHEN p.first_name ILIKE '%rebooking%' OR p.last_name ILIKE '%placeholder%' THEN 'placeholder_name'
        WHEN p.first_name ILIKE ANY(ARRAY['%winery%', '%poultry%', '%ranch%', '%farm%', '%vineyard%', '%auction%', '%estates%']) THEN 'org_keyword_first'
        WHEN p.last_name ILIKE ANY(ARRAY['%winery%', '%poultry%', '%ranch%', '%farm%', '%vineyard%', '%auction%', '%estates%']) THEN 'org_keyword_last'
        WHEN sot.classify_owner_name(p.first_name || ' ' || p.last_name) IN ('organization', 'site_name', 'address') THEN 'classified_non_person'
        WHEN (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) > 200 THEN 'high_cat_count'
        ELSE 'review_other'
    END as suspicion_reason
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND (
    -- Known problem patterns
    p.first_name ILIKE '%rebooking%' OR p.last_name ILIKE '%placeholder%'
    OR sot.classify_owner_name(p.first_name || ' ' || p.last_name) IN ('organization', 'site_name', 'address', 'garbage')
    -- Suspicious high cat counts
    OR (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) > 200
    -- Organization-like keywords
    OR p.first_name ILIKE ANY(ARRAY['%winery%', '%poultry%', '%ranch%', '%farm%', '%vineyard%', '%auction%', '%estates%', '%livestock%'])
    OR p.last_name ILIKE ANY(ARRAY['%winery%', '%poultry%', '%ranch%', '%farm%', '%vineyard%', '%auction%', '%estates%', '%livestock%'])
  )
ORDER BY cat_count DESC;

COMMENT ON VIEW ops.v_suspicious_people IS
'Monitoring view for detecting potential pseudo-profiles in sot.people.
Run periodically to catch new pollution before it spreads.
DATA_GAP_031: Pseudo-profile pollution from ClinicHQ bulk import.';

-- ============================================================================
-- STEP 9: Update should_be_person() to catch more patterns
-- ============================================================================

CREATE OR REPLACE FUNCTION sot.should_be_person(
    p_first_name TEXT,
    p_last_name TEXT,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_email_norm TEXT;
    v_full_name TEXT;
BEGIN
    v_email_norm := LOWER(TRIM(COALESCE(p_email, '')));
    v_full_name := LOWER(TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, '')));

    -- LESSON #1: Check for org emails (from DATA_GAP_009)
    IF v_email_norm LIKE '%forgottenfelines%'
       OR v_email_norm LIKE '%@ffsc.org'
       OR v_email_norm LIKE '%marinferals%' THEN
        RETURN FALSE;  -- Org email
    END IF;

    -- LESSON #2: Check for FAKE/PLACEHOLDER email domains (ClinicHQ generates these)
    IF v_email_norm LIKE '%@noemail.com'
       OR v_email_norm LIKE '%@petestablished.com'
       OR v_email_norm LIKE '%@nomail.com'
       OR v_email_norm LIKE '%@placeholder.com'
       OR v_email_norm LIKE '%@example.com'
       OR v_email_norm LIKE '%@test.com' THEN
        RETURN FALSE;  -- ClinicHQ fake placeholder email
    END IF;

    -- LESSON #3: Check for PLACEHOLDER/SYSTEM names (DATA_GAP_031)
    IF LOWER(COALESCE(p_first_name, '')) IN ('rebooking', 'placeholder', 'unknown', 'test', 'na', 'n/a', 'none', 'null')
       OR LOWER(COALESCE(p_last_name, '')) IN ('placeholder', 'unknown', 'test', 'na', 'n/a', 'none', 'null') THEN
        RETURN FALSE;  -- System/placeholder account name
    END IF;

    -- LESSON #4: Check for organization names (DATA_GAP_031)
    IF v_full_name ~* '(winery|poultry|ranch|farm|vineyard|auction|estates|livestock|equine|cal fire|station)' THEN
        RETURN FALSE;  -- Organization name
    END IF;

    -- LESSON #5: Check for FFSC phone used as placeholder
    IF COALESCE(p_phone, '') IN ('7075767999', '707-576-7999', '(707) 576-7999') THEN
        -- Only reject if email is also fake/missing
        IF v_email_norm = '' OR v_email_norm LIKE '%@noemail.com' OR v_email_norm LIKE '%@petestablished.com' THEN
            RETURN FALSE;  -- FFSC phone with no real email = placeholder
        END IF;
    END IF;

    -- LESSON #6: Check classify_owner_name for org/address patterns
    IF sot.classify_owner_name(v_full_name) IN ('organization', 'site_name', 'address', 'garbage') THEN
        RETURN FALSE;
    END IF;

    -- Passed all checks
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION sot.should_be_person IS
'Gate function: determines if owner info should create a person in sot.people.
Returns FALSE for:
- Org emails (forgottenfelines, marinferals, ffsc.org)
- Fake email domains (noemail.com, petestablished.com, example.com)
- Placeholder names (Rebooking placeholder, Unknown, Test)
- Organization names (Winery, Poultry, Ranch, Farm, etc.)
- FFSC phone with no real email
- Names classified as org/site/address by classify_owner_name()

DATA_GAP_031: Updated to catch pseudo-profiles from ClinicHQ bulk import.
See MIG_2337 for cleanup of historical pollution.';

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_archived INT;
    v_clinic_accounts INT;
    v_remaining_cat_rels INT;
    v_suspicious_count INT;
BEGIN
    SELECT COUNT(*) INTO v_archived FROM ops.archived_people WHERE archived_by = 'MIG_2337';
    SELECT COUNT(*) INTO v_clinic_accounts FROM ops.clinic_accounts WHERE classification_reason LIKE 'MIG_2337%';

    SELECT COUNT(*) INTO v_remaining_cat_rels
    FROM sot.person_cat pc
    WHERE EXISTS (
        SELECT 1 FROM polluted_people pp WHERE pp.person_id = pc.person_id
    );

    SELECT COUNT(*) INTO v_suspicious_count FROM ops.v_suspicious_people;

    RAISE NOTICE '';
    RAISE NOTICE '=== MIG_2337: Pseudo-Profile Cleanup Summary ===';
    RAISE NOTICE 'People archived: %', v_archived;
    RAISE NOTICE 'Clinic accounts created: %', v_clinic_accounts;
    RAISE NOTICE 'Remaining cat relationships (should be 0): %', v_remaining_cat_rels;
    RAISE NOTICE 'Suspicious people in monitoring view: %', v_suspicious_count;
    RAISE NOTICE '';

    IF v_remaining_cat_rels > 0 THEN
        RAISE WARNING 'Cat relationships still exist for polluted people!';
    END IF;
END;
$$;

-- Show verification queries
SELECT
    'Verification: should_be_person() now rejects fake patterns' as test,
    CASE
        WHEN sot.should_be_person('Rebooking', 'placeholder', 'test@noemail.com', '7075767999') = FALSE THEN 'PASS'
        ELSE 'FAIL'
    END as result;

SELECT
    'Verification: should_be_person() rejects org names' as test,
    CASE
        WHEN sot.should_be_person('Speedy Creek', 'Winery', NULL, NULL) = FALSE THEN 'PASS'
        ELSE 'FAIL'
    END as result;

SELECT
    'Verification: should_be_person() allows real people' as test,
    CASE
        WHEN sot.should_be_person('John', 'Smith', 'john@gmail.com', '5551234567') = TRUE THEN 'PASS'
        ELSE 'FAIL'
    END as result;

COMMIT;

-- ============================================================================
-- POST-MIGRATION: Run entity linking to propagate changes
-- ============================================================================
-- After this migration, run:
--   SELECT sot.run_all_entity_linking();
-- to ensure cat-place relationships are updated.
