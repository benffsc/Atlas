-- QRY_051: Deep Audit of Unlinked Cats
--
-- Investigates why 9,802 cats have no place or person links
-- and why 5,624 cats have no appointments.
--
-- Key questions:
-- 1. What source systems do these cats come from?
-- 2. Do they have microchips that should have matched?
-- 3. Are appointments missing cat_id links?
-- 4. Are cats being filtered out due to staff addresses?
-- 5. What happened during entity linking?
--
-- Created: 2026-02-21

\echo ''
\echo '=============================================='
\echo '  QRY_051: UNLINKED CATS DEEP AUDIT'
\echo '=============================================='
\echo ''

-- ============================================================================
-- SECTION 1: BASELINE COUNTS
-- ============================================================================

\echo '=============================================='
\echo 'SECTION 1: BASELINE COUNTS'
\echo '=============================================='

\echo ''
\echo '1.1 Total cats by source system:'
SELECT
    source_system,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE microchip IS NOT NULL) as with_microchip,
    COUNT(*) FILTER (WHERE clinichq_animal_id IS NOT NULL) as with_clinichq_id,
    COUNT(*) FILTER (WHERE shelterluv_id IS NOT NULL) as with_shelterluv_id
FROM sot.cats
WHERE merged_into_cat_id IS NULL
GROUP BY source_system
ORDER BY count DESC;

\echo ''
\echo '1.2 Cat linkage overview:'
SELECT
    COUNT(*) as total_cats,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id
    )) as with_place_link,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id
    )) as with_person_link,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id
    )) as with_appointment,
    COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id
    ) AND NOT EXISTS (
        SELECT 1 FROM sot.person_cat pc WHERE pc.cat_id = c.cat_id
    )) as no_place_or_person,
    COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id
    )) as no_appointment
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL;

-- ============================================================================
-- SECTION 2: CATS WITHOUT APPOINTMENTS - BREAKDOWN BY SOURCE
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 2: CATS WITHOUT APPOINTMENTS'
\echo '=============================================='

\echo ''
\echo '2.1 Cats without appointments by source:'
SELECT
    c.source_system,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE c.microchip IS NOT NULL) as has_microchip,
    COUNT(*) FILTER (WHERE c.clinichq_animal_id IS NOT NULL) as has_clinichq_id,
    COUNT(*) FILTER (WHERE c.shelterluv_id IS NOT NULL) as has_shelterluv_id
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id)
GROUP BY c.source_system
ORDER BY count DESC;

\echo ''
\echo '2.2 ClinicHQ cats without appointments - do their animal_ids exist in appointments?'
SELECT
    'clinichq_cats_without_appt' as category,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ops.appointments a
        WHERE a.clinichq_animal_id = c.clinichq_animal_id
    )) as animal_id_exists_in_appointments,
    COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM ops.appointments a
        WHERE a.clinichq_animal_id = c.clinichq_animal_id
    )) as animal_id_not_in_appointments
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND c.source_system = 'clinichq'
  AND c.clinichq_animal_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id);

\echo ''
\echo '2.3 Appointments with clinichq_animal_id but NULL cat_id (BROKEN LINKS):'
SELECT
    COUNT(*) as appointments_with_animal_id_but_no_cat,
    COUNT(DISTINCT clinichq_animal_id) as unique_animal_ids
FROM ops.appointments
WHERE clinichq_animal_id IS NOT NULL
  AND cat_id IS NULL;

\echo ''
\echo '2.4 Sample of appointments with animal_id but no cat link:'
SELECT
    a.appointment_id,
    a.clinichq_animal_id,
    a.animal_name,
    a.microchip,
    a.appointment_date,
    a.owner_first_name,
    a.owner_last_name,
    a.owner_address
FROM ops.appointments a
WHERE a.clinichq_animal_id IS NOT NULL
  AND a.cat_id IS NULL
LIMIT 10;

-- ============================================================================
-- SECTION 3: MICROCHIP MATCHING AUDIT
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 3: MICROCHIP MATCHING AUDIT'
\echo '=============================================='

\echo ''
\echo '3.1 Microchipped cats without appointments:'
SELECT
    c.source_system,
    COUNT(*) as microchipped_no_appt,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM ops.appointments a WHERE a.microchip = c.microchip
    )) as microchip_exists_in_appointments,
    COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM ops.appointments a WHERE a.microchip = c.microchip
    )) as microchip_not_in_appointments
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND c.microchip IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id)
GROUP BY c.source_system
ORDER BY microchipped_no_appt DESC;

\echo ''
\echo '3.2 Appointments with microchips that match cats but have NULL cat_id (SHOULD BE LINKED):'
SELECT COUNT(*) as should_be_linked
FROM ops.appointments a
WHERE a.microchip IS NOT NULL
  AND a.cat_id IS NULL
  AND EXISTS (
      SELECT 1 FROM sot.cats c
      WHERE c.microchip = a.microchip
      AND c.merged_into_cat_id IS NULL
  );

\echo ''
\echo '3.3 Sample of appointments with matching microchip but no cat link:'
SELECT
    a.appointment_id,
    a.microchip,
    a.animal_name,
    a.appointment_date,
    c.cat_id as matching_cat_id,
    c.name as cat_name,
    c.source_system as cat_source
FROM ops.appointments a
JOIN sot.cats c ON c.microchip = a.microchip AND c.merged_into_cat_id IS NULL
WHERE a.cat_id IS NULL
LIMIT 10;

-- ============================================================================
-- SECTION 4: CATS WITH APPOINTMENTS BUT NO PLACE LINK
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 4: CATS WITH APPOINTMENTS BUT NO PLACE'
\echo '=============================================='

\echo ''
\echo '4.1 Cats with appointments but no place link - why?'
SELECT
    CASE
        WHEN a.inferred_place_id IS NULL AND a.owner_address IS NULL THEN 'no_address_on_appointment'
        WHEN a.inferred_place_id IS NULL AND a.owner_address IS NOT NULL THEN 'address_not_geocoded'
        WHEN a.inferred_place_id IS NOT NULL AND NOT sot.should_compute_disease_for_place(a.inferred_place_id) THEN 'place_is_clinic_or_blacklisted'
        WHEN a.inferred_place_id IS NOT NULL THEN 'place_exists_but_not_linked'
        ELSE 'unknown'
    END as reason,
    COUNT(DISTINCT c.cat_id) as cats
FROM sot.cats c
JOIN ops.appointments a ON a.cat_id = c.cat_id
WHERE c.merged_into_cat_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM sot.cat_place cp WHERE cp.cat_id = c.cat_id)
GROUP BY 1
ORDER BY cats DESC;

\echo ''
\echo '4.2 Are appointments being linked to clinic addresses?'
SELECT
    p.display_name,
    p.formatted_address,
    p.place_kind,
    COUNT(DISTINCT a.cat_id) as cats_with_this_inferred_place
FROM ops.appointments a
JOIN sot.places p ON p.place_id = a.inferred_place_id
WHERE a.cat_id IS NOT NULL
  AND (
      p.place_kind = 'clinic'
      OR p.formatted_address ILIKE '%1814%Empire%'
      OR p.formatted_address ILIKE '%1820%Empire%'
      OR p.formatted_address ILIKE '%845 Todd%'
  )
GROUP BY p.place_id, p.display_name, p.formatted_address, p.place_kind
ORDER BY cats_with_this_inferred_place DESC;

\echo ''
\echo '4.3 Top addresses that cats are being linked to (sanity check):'
SELECT
    p.formatted_address,
    p.place_kind,
    COUNT(DISTINCT cp.cat_id) as cats_linked
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id
WHERE p.merged_into_place_id IS NULL
GROUP BY p.place_id, p.formatted_address, p.place_kind
ORDER BY cats_linked DESC
LIMIT 20;

-- ============================================================================
-- SECTION 5: STAFF ADDRESS FILTERING CHECK
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 5: STAFF ADDRESS FILTERING'
\echo '=============================================='

\echo ''
\echo '5.1 Person roles that might exclude cats from linking:'
SELECT
    role,
    role_status,
    COUNT(*) as count
FROM sot.person_roles
GROUP BY role, role_status
ORDER BY count DESC;

\echo ''
\echo '5.2 Cats owned by staff/trappers (excluded from person-chain linking):'
SELECT
    pr.role,
    COUNT(DISTINCT pc.cat_id) as cats_owned_by_role
FROM sot.person_cat pc
JOIN sot.person_roles pr ON pr.person_id = pc.person_id
WHERE pr.role_status = 'active'
  AND pr.role IN ('staff', 'trapper')
GROUP BY pr.role;

\echo ''
\echo '5.3 Places in soft blacklist:'
SELECT
    blacklist_type,
    COUNT(*) as count
FROM sot.place_soft_blacklist
GROUP BY blacklist_type;

\echo ''
\echo '5.4 Cats whose only person has blacklisted place:'
SELECT COUNT(DISTINCT pc.cat_id) as cats_with_blacklisted_owner_place
FROM sot.person_cat pc
JOIN sot.person_place pp ON pp.person_id = pc.person_id
JOIN sot.place_soft_blacklist psb ON psb.place_id = pp.place_id
WHERE NOT EXISTS (
    SELECT 1 FROM sot.person_place pp2
    WHERE pp2.person_id = pc.person_id
    AND NOT EXISTS (
        SELECT 1 FROM sot.place_soft_blacklist psb2
        WHERE psb2.place_id = pp2.place_id
    )
);

-- ============================================================================
-- SECTION 6: ENTITY LINKING SKIPPED RECORDS
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 6: ENTITY LINKING SKIP REASONS'
\echo '=============================================='

\echo ''
\echo '6.1 Why were cats skipped during entity linking?'
SELECT
    reason,
    COUNT(*) as count
FROM ops.entity_linking_skipped
WHERE entity_type = 'cat'
GROUP BY reason
ORDER BY count DESC;

-- ============================================================================
-- SECTION 7: ORPHANED APPOINTMENTS (NO CAT LINK)
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 7: ORPHANED APPOINTMENTS'
\echo '=============================================='

\echo ''
\echo '7.1 Appointments without cat_id by year:'
SELECT
    EXTRACT(YEAR FROM appointment_date) as year,
    COUNT(*) as total_appointments,
    COUNT(*) FILTER (WHERE cat_id IS NULL) as no_cat_link,
    COUNT(*) FILTER (WHERE cat_id IS NULL AND microchip IS NOT NULL) as no_cat_but_has_chip,
    COUNT(*) FILTER (WHERE cat_id IS NULL AND clinichq_animal_id IS NOT NULL) as no_cat_but_has_animal_id
FROM ops.appointments
GROUP BY 1
ORDER BY 1 DESC;

\echo ''
\echo '7.2 Recent appointments (2024+) without cat link - sample:'
SELECT
    a.appointment_id,
    a.appointment_date,
    a.clinichq_animal_id,
    a.microchip,
    a.animal_name,
    a.owner_address,
    a.owner_first_name,
    a.owner_last_name
FROM ops.appointments a
WHERE a.cat_id IS NULL
  AND a.appointment_date >= '2024-01-01'
ORDER BY a.appointment_date DESC
LIMIT 15;

-- ============================================================================
-- SECTION 8: DIAGNOSIS - WHAT'S BROKEN?
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'SECTION 8: DIAGNOSIS SUMMARY'
\echo '=============================================='

\echo ''
\echo '8.1 Potential data pipeline issues:'
SELECT
    'appointments_without_cat_that_should_match' as issue,
    COUNT(*) as count,
    'Appointments have microchip/animal_id but cat_id is NULL' as description
FROM ops.appointments a
WHERE a.cat_id IS NULL
  AND (
      (a.microchip IS NOT NULL AND EXISTS (
          SELECT 1 FROM sot.cats c WHERE c.microchip = a.microchip AND c.merged_into_cat_id IS NULL
      ))
      OR
      (a.clinichq_animal_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM sot.cats c WHERE c.clinichq_animal_id = a.clinichq_animal_id AND c.merged_into_cat_id IS NULL
      ))
  )
UNION ALL
SELECT
    'cats_without_any_identifier' as issue,
    COUNT(*) as count,
    'Cats with no microchip, no clinichq_animal_id, no shelterluv_id' as description
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND c.microchip IS NULL
  AND c.clinichq_animal_id IS NULL
  AND c.shelterluv_id IS NULL
UNION ALL
SELECT
    'petlink_only_cats' as issue,
    COUNT(*) as count,
    'Cats from PetLink bulk import - external registry only' as description
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND c.source_system = 'petlink'
UNION ALL
SELECT
    'shelterluv_only_cats_no_appt' as issue,
    COUNT(*) as count,
    'ShelterLuv cats never seen at FFSC clinic' as description
FROM sot.cats c
WHERE c.merged_into_cat_id IS NULL
  AND c.source_system = 'shelterluv'
  AND NOT EXISTS (SELECT 1 FROM ops.appointments a WHERE a.cat_id = c.cat_id);

\echo ''
\echo '=============================================='
\echo 'END OF AUDIT'
\echo '=============================================='
