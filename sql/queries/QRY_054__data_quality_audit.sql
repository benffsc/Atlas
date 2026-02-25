-- QRY_054: Comprehensive Data Quality Audit
--
-- PURPOSE: Audit before running MIG_2496/2497 to identify:
-- 1. Cats table bloat/pollution
-- 2. People table misclassifications (orgs/addresses as people)
-- 3. Clinic accounts classification accuracy
-- 4. Entity linking gaps
-- 5. Problematic ClinicHQ patterns not yet handled
--
-- KNOWN PROBLEMATIC PATTERNS (from MIG_2337, MIG_2414):
-- - "Rebooking placeholder" - ClinicHQ system account (2,381 cats, @noemail.com domain)
-- - "Speedy Creek Winery", "Petaluma Poultry", "Petaluma Livestock Auction" - orgs
-- - "Keller Estates Vineyards", "Sartorial Auto Repairs", "Blentech Corporation" - orgs
-- - "@noemail.com", "@petestablished.com" - fake ClinicHQ email domains
-- - "7075767999" - FFSC office phone used as placeholder
--
-- Created: 2026-02-24

\echo ''
\echo '=============================================='
\echo '  QRY_054: DATA QUALITY AUDIT'
\echo '=============================================='
\echo ''

-- ============================================================================
-- SECTION 1: CATS TABLE OVERVIEW
-- ============================================================================

\echo '=============================================='
\echo 'SECTION 1: CATS TABLE OVERVIEW'
\echo '=============================================='

\echo ''
\echo '1.1 Total cats by source system:'
SELECT
    source_system,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE merged_into_cat_id IS NOT NULL) as merged,
    COUNT(*) FILTER (WHERE merged_into_cat_id IS NULL) as active
FROM sot.cats
GROUP BY source_system
ORDER BY total DESC;

\echo ''
\echo '1.2 Cats with vs without key identifiers:'
SELECT
    'Total active cats' as metric,
    COUNT(*) as count
FROM sot.cats WHERE merged_into_cat_id IS NULL
UNION ALL
SELECT 'With microchip', COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL AND microchip IS NOT NULL
UNION ALL
SELECT 'With clinichq_animal_id', COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL AND clinichq_animal_id IS NOT NULL
UNION ALL
SELECT 'With shelterluv_animal_id', COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL AND shelterluv_animal_id IS NOT NULL
UNION ALL
SELECT 'No identifiers at all', COUNT(*) FROM sot.cats WHERE merged_into_cat_id IS NULL
    AND microchip IS NULL AND clinichq_animal_id IS NULL AND shelterluv_animal_id IS NULL;

\echo ''
\echo '1.3 Cats linked to places vs not:'
SELECT
    'Total active cats' as metric,
    COUNT(*) as count
FROM sot.cats WHERE merged_into_cat_id IS NULL
UNION ALL
SELECT 'With cat_place link', COUNT(DISTINCT c.cat_id)
FROM sot.cats c
JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NULL
UNION ALL
SELECT 'Without cat_place link', COUNT(*)
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id);

\echo ''
\echo '1.4 Cats with appointments vs not:'
SELECT
    'With appointments' as metric,
    COUNT(DISTINCT c.cat_id) as count
FROM sot.cats c
JOIN ops.appointments a ON a.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NULL
UNION ALL
SELECT 'Without appointments', COUNT(*)
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id);

-- ============================================================================
-- SECTION 2: PEOPLE TABLE AUDIT
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 2: PEOPLE TABLE AUDIT'
\echo '=============================================='

\echo ''
\echo '2.1 Total people by source system:'
SELECT
    source_system,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE merged_into_person_id IS NOT NULL) as merged,
    COUNT(*) FILTER (WHERE merged_into_person_id IS NULL) as active
FROM sot.people
GROUP BY source_system
ORDER BY total DESC;

\echo ''
\echo '2.2 People with identifiers vs not:'
SELECT
    'Total active people' as metric,
    COUNT(*) as count
FROM sot.people WHERE merged_into_person_id IS NULL
UNION ALL
SELECT 'With email', COUNT(DISTINCT p.person_id)
FROM sot.people p
JOIN sot.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'email'
WHERE p.merged_into_person_id IS NULL
UNION ALL
SELECT 'With phone', COUNT(DISTINCT p.person_id)
FROM sot.people p
JOIN sot.person_identifiers pi ON pi.person_id = p.person_id AND pi.id_type = 'phone'
WHERE p.merged_into_person_id IS NULL
UNION ALL
SELECT 'With NO identifiers', COUNT(*)
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM sot.person_identifiers pi WHERE pi.person_id = p.person_id);

\echo ''
\echo '2.3 Potential misclassified people (orgs/addresses as people):'
\echo '    Testing display_name against classify_owner_name()...'

SELECT
    p.person_id,
    p.display_name,
    sot.classify_owner_name(p.display_name) as would_classify_as,
    p.source_system,
    (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cat_count,
    (SELECT COUNT(*) FROM ops.appointments a WHERE a.resolved_person_id = p.person_id) as appointment_count
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND sot.classify_owner_name(p.display_name) IN ('organization', 'address', 'site_name', 'garbage', 'known_org')
ORDER BY appointment_count DESC NULLS LAST
LIMIT 30;

\echo ''
\echo '2.4 People with suspicious names (potential orgs/places):'
SELECT
    p.display_name,
    p.source_system,
    sot.classify_owner_name(p.display_name) as classification,
    (SELECT string_agg(pi.id_value_raw, ', ') FROM sot.person_identifiers pi WHERE pi.person_id = p.person_id) as identifiers
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND (
    -- Business patterns
    p.display_name ~* '\y(LLC|Inc|Corp|Company|Services|Store|Shop|Market|Generation|World Of)\y'
    OR p.display_name ~* '\y(Ranch|Vineyard|Winery|Farm|Estate|Mobile Home)\y'
    OR p.display_name ~* '\y(Veterinary|Vet|Animal|Pet|Shelter|Rescue|SPCA|Humane)\y'
    -- Address patterns
    OR p.display_name ~ '^\d+\s'
    OR p.display_name ~* '\y(Road|Rd|Street|St|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Way|Blvd)\y'
  )
ORDER BY p.display_name
LIMIT 40;

-- ============================================================================
-- SECTION 3: CLINIC ACCOUNTS AUDIT
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 3: CLINIC ACCOUNTS AUDIT'
\echo '=============================================='

\echo ''
\echo '3.1 Clinic accounts by account_type:'
SELECT
    account_type,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE resolved_person_id IS NOT NULL) as resolved_to_person,
    COUNT(*) FILTER (WHERE resolved_place_id IS NOT NULL) as resolved_to_place,
    SUM(appointment_count) as total_appointments,
    SUM(cat_count) as total_cats
FROM ops.clinic_accounts
WHERE merged_into_account_id IS NULL
GROUP BY account_type
ORDER BY total DESC;

\echo ''
\echo '3.2 Sample address-type accounts (should have places):'
SELECT
    display_name,
    owner_address,
    resolved_place_id IS NOT NULL as has_place,
    appointment_count,
    cat_count
FROM ops.clinic_accounts
WHERE account_type = 'address'
  AND merged_into_account_id IS NULL
ORDER BY appointment_count DESC
LIMIT 15;

\echo ''
\echo '3.3 Sample organization-type accounts:'
SELECT
    display_name,
    resolved_person_id IS NOT NULL as resolved_to_person,
    appointment_count,
    cat_count
FROM ops.clinic_accounts
WHERE account_type = 'organization'
  AND merged_into_account_id IS NULL
ORDER BY appointment_count DESC
LIMIT 15;

\echo ''
\echo '3.4 Sample site_name accounts:'
SELECT
    display_name,
    owner_address,
    resolved_place_id IS NOT NULL as has_place,
    appointment_count
FROM ops.clinic_accounts
WHERE account_type = 'site_name'
  AND merged_into_account_id IS NULL
ORDER BY appointment_count DESC
LIMIT 15;

\echo ''
\echo '3.5 Sample resident-type accounts (should be real people):'
SELECT
    display_name,
    owner_email,
    owner_phone,
    resolved_person_id IS NOT NULL as resolved_to_person,
    appointment_count
FROM ops.clinic_accounts
WHERE account_type = 'resident'
  AND merged_into_account_id IS NULL
ORDER BY appointment_count DESC
LIMIT 15;

-- ============================================================================
-- SECTION 4: CLASSIFICATION FUNCTION TESTING
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 4: CLASSIFICATION FUNCTION TESTING'
\echo '=============================================='

\echo ''
\echo '4.1 Test known examples:'
\echo '    (classify_owner_name takes full display_name, not separate first/last)'
SELECT
    test_name,
    sot.classify_owner_name(test_name) as result,
    expected,
    CASE WHEN sot.classify_owner_name(test_name) = expected THEN '✓' ELSE '✗ MISMATCH' END as status
FROM (VALUES
    -- Places/Addresses
    ('Old Stony Pt Rd', 'address'),
    ('5403 San Antonio Road Petaluma', 'address'),
    ('123 Main St', 'address'),

    -- Businesses
    ('Grow Generation', 'organization'),
    ('World Of Carpets', 'organization'),
    ('Atlas Tree Surgery', 'organization'),
    ('Silveira Ranch', 'site_name'),
    ('Keller Estates Vineyard', 'site_name'),

    -- Real people
    ('John Smith', 'likely_person'),
    ('Mary Carpenter', 'likely_person'),
    ('Toni Price', 'likely_person'),
    ('Cassie Thomson', 'likely_person'),

    -- Edge cases
    ('SCAS', 'garbage'),
    ('Unknown', 'garbage'),
    ('Maria', 'likely_person'),
    ('Rebooking placeholder', 'garbage'),

    -- Known orgs
    ('Forgotten Felines', 'organization'),
    ('Marin Humane', 'organization'),
    ('Sonoma County Animal Services', 'organization')
) AS t(test_name, expected)
ORDER BY status DESC, test_name;

\echo ''
\echo '4.2 Accounts that might be misclassified:'
SELECT
    ca.display_name,
    ca.account_type as current_type,
    sot.classify_owner_name(ca.owner_first_name, ca.owner_last_name) as would_classify_as,
    ca.appointment_count
FROM ops.clinic_accounts ca
WHERE ca.merged_into_account_id IS NULL
  AND ca.account_type != sot.classify_owner_name(ca.owner_first_name, ca.owner_last_name)
  AND sot.classify_owner_name(ca.owner_first_name, ca.owner_last_name) IS NOT NULL
ORDER BY ca.appointment_count DESC
LIMIT 20;

-- ============================================================================
-- SECTION 5: APPOINTMENT LINKAGE GAPS
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 5: APPOINTMENT LINKAGE GAPS'
\echo '=============================================='

\echo ''
\echo '5.1 Appointments overview:'
SELECT
    'Total appointments' as metric,
    COUNT(*) as count
FROM ops.appointments
UNION ALL
SELECT 'With cat_id', COUNT(*) FROM ops.appointments WHERE cat_id IS NOT NULL
UNION ALL
SELECT 'With inferred_place_id', COUNT(*) FROM ops.appointments WHERE inferred_place_id IS NOT NULL
UNION ALL
SELECT 'With owner_account_id', COUNT(*) FROM ops.appointments WHERE owner_account_id IS NOT NULL
UNION ALL
SELECT 'With resolved_person_id', COUNT(*) FROM ops.appointments WHERE resolved_person_id IS NOT NULL
UNION ALL
SELECT 'Missing ALL linkages', COUNT(*) FROM ops.appointments
WHERE cat_id IS NULL AND inferred_place_id IS NULL AND owner_account_id IS NULL AND resolved_person_id IS NULL;

\echo ''
\echo '5.2 Appointments missing inferred_place_id - breakdown:'
SELECT
    CASE
        WHEN owner_address IS NULL OR TRIM(owner_address) = '' THEN 'No owner_address'
        WHEN LENGTH(TRIM(owner_address)) < 10 THEN 'Short owner_address'
        ELSE 'Has owner_address but no place match'
    END as reason,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE cat_id IS NOT NULL) as with_cat
FROM ops.appointments
WHERE inferred_place_id IS NULL
GROUP BY 1
ORDER BY count DESC;

\echo ''
\echo '5.3 Sample appointments with cats but no place link:'
SELECT
    a.appointment_date,
    c.name as cat_name,
    a.client_name,
    a.owner_address,
    ca.display_name as account_name,
    ca.account_type
FROM ops.appointments a
JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN ops.clinic_accounts ca ON ca.account_id = a.owner_account_id
WHERE a.inferred_place_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = a.cat_id)
ORDER BY a.appointment_date DESC
LIMIT 20;

-- ============================================================================
-- SECTION 6: SPECIFIC EXAMPLES
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 6: SPECIFIC EXAMPLES'
\echo '=============================================='

\echo ''
\echo '6.1 OLD STONY PT RD - FULL DATA TRACE:'
\echo '    This is the primary case we are investigating.'
\echo ''
\echo '    Step 1: Check if clinic_account exists with this name'
SELECT
    ca.account_id,
    ca.display_name,
    ca.account_type,
    ca.resolved_place_id,
    ca.appointment_count,
    ca.cat_count
FROM ops.clinic_accounts ca
WHERE ca.display_name ILIKE '%stony%'
  AND ca.merged_into_account_id IS NULL;

\echo ''
\echo '    Step 2: Check if any places exist for this address'
SELECT
    pl.place_id,
    pl.display_name,
    pl.formatted_address,
    pl.place_kind,
    (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = pl.place_id) as cats_at_place
FROM sot.places pl
WHERE (pl.display_name ILIKE '%stony%' OR pl.formatted_address ILIKE '%stony%')
  AND pl.merged_into_place_id IS NULL;

\echo ''
\echo '    Step 3: Check appointments booked under this name'
SELECT
    a.appointment_id,
    a.appointment_date,
    a.client_name,
    c.name as cat_name,
    c.cat_id,
    a.inferred_place_id,
    a.owner_account_id
FROM ops.appointments a
LEFT JOIN sot.cats c ON c.cat_id = a.cat_id
WHERE a.client_name ILIKE '%stony%'
ORDER BY a.appointment_date DESC
LIMIT 15;

\echo ''
\echo '    Step 4: Check if cats from this account have place links'
SELECT
    c.cat_id,
    c.name as cat_name,
    EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id) as has_cat_place_link,
    (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id) as place_link_count
FROM ops.appointments a
JOIN sot.cats c ON c.cat_id = a.cat_id AND c.merged_into_cat_id IS NULL
WHERE a.client_name ILIKE '%stony%'
LIMIT 15;

\echo ''
\echo '    Step 5: DIAGNOSIS - Why cats are missing from map:'
SELECT
    'Root Cause' as diagnosis,
    CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM ops.clinic_accounts ca
            WHERE ca.display_name ILIKE '%stony%' AND ca.merged_into_account_id IS NULL
        ) THEN 'No clinic_account exists for this name'
        WHEN EXISTS (
            SELECT 1 FROM ops.clinic_accounts ca
            WHERE ca.display_name ILIKE '%stony%'
              AND ca.merged_into_account_id IS NULL
              AND ca.resolved_place_id IS NULL
        ) THEN 'clinic_account EXISTS but resolved_place_id is NULL (MIG_2496 will fix this)'
        WHEN EXISTS (
            SELECT 1 FROM ops.appointments a
            WHERE a.client_name ILIKE '%stony%' AND a.inferred_place_id IS NULL
        ) THEN 'Appointments exist but inferred_place_id is NULL'
        ELSE 'Unknown - check detailed queries above'
    END as root_cause;

\echo ''
\echo '6.2 ALL ADDRESS-TYPE ACCOUNTS MISSING PLACE LINKS:'
\echo '    These are the "Old Stony Pt Rd" pattern - address names with cats but no place'
SELECT
    ca.display_name,
    ca.account_type,
    ca.resolved_place_id IS NOT NULL as has_place,
    ca.appointment_count,
    ca.cat_count,
    sot.classify_owner_name(ca.display_name) as classification_check
FROM ops.clinic_accounts ca
WHERE ca.merged_into_account_id IS NULL
  AND ca.account_type IN ('address', 'site_name')
  AND ca.resolved_place_id IS NULL
  AND (ca.appointment_count > 0 OR ca.cat_count > 0)
ORDER BY ca.appointment_count DESC NULLS LAST
LIMIT 25;

\echo ''
\echo '6.3 NAMES CLASSIFIED AS ADDRESS but in PEOPLE table:'
\echo '    These are addresses stored as people (pollution)'
SELECT
    p.person_id,
    p.display_name,
    p.source_system,
    sot.classify_owner_name(p.display_name) as classification,
    (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cat_count
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND sot.classify_owner_name(p.display_name) = 'address'
ORDER BY cat_count DESC
LIMIT 20;

\echo ''
\echo '6.4 Grow Generation (should be org, not person):'
SELECT
    'clinic_accounts' as table_name,
    ca.display_name,
    ca.account_type,
    ca.appointment_count::text as extra
FROM ops.clinic_accounts ca
WHERE ca.display_name ILIKE '%grow%generation%'
  OR ca.display_name ILIKE '%generation%grow%'
UNION ALL
SELECT
    'people' as table_name,
    p.display_name,
    p.source_system,
    (SELECT COUNT(*)::text FROM sot.person_cat pc WHERE pc.person_id = p.person_id)
FROM sot.people p
WHERE p.display_name ILIKE '%grow%generation%'
  OR p.display_name ILIKE '%generation%grow%';

\echo ''
\echo '6.3 Other potentially misclassified businesses in people table:'
SELECT
    p.display_name,
    sot.classify_owner_name(p.display_name) as current_classification,
    p.source_system,
    (SELECT COUNT(*) FROM sot.person_cat pc WHERE pc.person_id = p.person_id) as cat_count
FROM sot.people p
WHERE p.merged_into_person_id IS NULL
  AND p.display_name ~* '\y(Generation|Surgery|Carpets|Market|Store|Services|Plumbing|Electric)\y'
ORDER BY cat_count DESC;

-- ============================================================================
-- SECTION 7: SUMMARY RECOMMENDATIONS
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 7: FILTER FUNCTION VERIFICATION'
\echo '=============================================='

\echo ''
\echo '7.1 Test should_be_person() with known problem patterns:'
SELECT
    test_name,
    sot.should_be_person(first_name, last_name, email, phone) as result,
    CASE WHEN sot.should_be_person(first_name, last_name, email, phone) = expected THEN '✓' ELSE '✗ PROBLEM' END as status
FROM (VALUES
    -- These should return FALSE (rejected as not-a-person)
    ('Rebooking placeholder w/ fake email', 'Rebooking', 'placeholder', 'test@noemail.com', '7075767999', FALSE),
    ('Organization name', 'Speedy Creek', 'Winery', NULL, NULL, FALSE),
    ('FFSC email domain', 'Staff', 'Person', 'staff@ffsc.org', NULL, FALSE),
    ('Org email marinferals', 'Someone', '', 'marinferals@yahoo.com', NULL, FALSE),
    ('Address as name', 'Old Stony Pt', 'Rd', NULL, NULL, FALSE),
    ('Placeholder email domain', 'Test', 'User', 'test@petestablished.com', NULL, FALSE),
    ('Unknown placeholder', 'Unknown', '', NULL, NULL, FALSE),
    ('Address with number', '5403 San Antonio', 'Road', NULL, NULL, FALSE),

    -- These should return TRUE (allowed as real person)
    ('Real person with email', 'John', 'Smith', 'john@gmail.com', '5551234567', TRUE),
    ('Real person with phone only', 'Mary', 'Jones', NULL, '7075551234', TRUE),
    ('Person name without contact', 'Bob', 'Wilson', NULL, NULL, TRUE)
) AS t(test_name, first_name, last_name, email, phone, expected)
ORDER BY status DESC, test_name;

\echo ''
\echo '7.2 Check for suspicious patterns that might slip through:'
SELECT
    ca.display_name,
    ca.account_type,
    sot.should_be_person(ca.owner_first_name, ca.owner_last_name, ca.owner_email, ca.owner_phone) as would_create_person,
    sot.classify_owner_name(ca.display_name) as classification
FROM ops.clinic_accounts ca
WHERE ca.merged_into_account_id IS NULL
  AND ca.appointment_count > 5
  AND ca.account_type NOT IN ('resident')
ORDER BY ca.appointment_count DESC
LIMIT 20;

-- ============================================================================
-- SECTION 8: SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 8: AUDIT SUMMARY'
\echo '=============================================='
\echo ''
\echo 'KEY ISSUES TO CHECK:'
\echo ''
\echo '1. OLD STONY PT RD PATTERN (Section 6.1-6.2):'
\echo '   - Address-type clinic_accounts missing resolved_place_id'
\echo '   - FIX: MIG_2496 extracts places for address-type accounts'
\echo ''
\echo '2. CLASSIFICATION GAPS (Section 4.1, 6.4):'
\echo '   - "Grow Generation" not recognized as organization'
\echo '   - FIX: MIG_2497 adds missing business keywords'
\echo ''
\echo '3. ADDRESSES IN PEOPLE TABLE (Section 6.3):'
\echo '   - Address names that slipped through and became people'
\echo '   - REVIEW: Should be cleaned up or marked as garbage'
\echo ''
\echo '4. CATS WITHOUT PLACES (Section 1.3):'
\echo '   - Cats with no cat_place links (wont appear on map)'
\echo '   - Some are expected (PetLink cats, ShelterLuv without FFSC appts)'
\echo '   - Others are caused by address-type accounts without places'
\echo ''
\echo 'RECOMMENDED ORDER OF MIGRATIONS:'
\echo '1. Run this audit (QRY_054) first'
\echo '2. Apply MIG_2497 (add missing business keywords)'
\echo '3. Apply MIG_2496 (extract places for address-type accounts)'
\echo '4. Run entity linking: SELECT sot.run_all_entity_linking();'
\echo '5. Re-run audit to verify improvements'
\echo ''
