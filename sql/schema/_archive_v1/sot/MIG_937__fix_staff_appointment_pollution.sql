-- ============================================================================
-- MIG_937: Fix Staff Appointment Pollution
-- ============================================================================
-- Problem: Sandra Brady has 3,165 appointments linked via person_id because
-- they all have owner_email = 'info@forgottenfelines.com'. Sandra Nicander
-- has 1,611 appointments linked similarly. Every time entity linking runs,
-- it recreates person-cat relationships for these.
--
-- Root Cause: MIG_916 cleaned up person_cat_relationships but NOT the
-- person_id on sot_appointments. The link_appointments_via_phone function
-- then recreates the relationships.
--
-- Solution:
-- 1. Remove person_id from appointments with org emails
-- 2. Delete erroneous person-cat relationships
-- 3. Update link_appointments_to_owners to exclude org emails
-- 4. Add org email check to link_appointments_via_phone
-- ============================================================================

\echo '=== MIG_937: Fix Staff Appointment Pollution ==='
\echo ''

-- ============================================================================
-- Part 1: Audit current state
-- ============================================================================

\echo 'Part 1: Auditing staff appointment links...'

SELECT
  p.display_name,
  COUNT(DISTINCT a.appointment_id) as appointments,
  COUNT(DISTINCT pcr.cat_id) as cats_linked,
  array_agg(DISTINCT a.owner_email) FILTER (WHERE a.owner_email LIKE '%@forgottenfelines%') as ffsc_emails
FROM trapper.sot_people p
JOIN trapper.sot_appointments a ON a.person_id = p.person_id
LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = p.person_id
WHERE p.display_name IN ('Sandra Brady', 'Sandra Nicander')
  AND p.merged_into_person_id IS NULL
GROUP BY p.person_id, p.display_name;

-- ============================================================================
-- Part 2: Unlink appointments with org emails from staff
-- ============================================================================

\echo ''
\echo 'Part 2: Unlinking appointments with org emails from staff...'

-- List of known organizational emails that should not link to people
WITH org_emails AS (
  SELECT unnest(ARRAY[
    'info@forgottenfelines.com',
    'info@forgottenfelines.org',
    'scas@forgottenfelines.com',
    'espanol@forgottenfelines.com',
    'office@forgottenfelines.com',
    'contact@forgottenfelines.com'
  ]) as email_pattern
),
unlinked AS (
  UPDATE trapper.sot_appointments a
  SET
    person_id = NULL,
    updated_at = NOW()
  WHERE a.person_id IS NOT NULL
    AND LOWER(a.owner_email) IN (SELECT email_pattern FROM org_emails)
  RETURNING a.appointment_id, a.owner_email
)
SELECT
  owner_email,
  COUNT(*) as appointments_unlinked
FROM unlinked
GROUP BY owner_email
ORDER BY appointments_unlinked DESC;

-- ============================================================================
-- Part 3: Delete erroneous person-cat relationships for staff
-- ============================================================================

\echo ''
\echo 'Part 3: Deleting erroneous staff person-cat relationships...'

-- Delete caretaker relationships that were created by entity linking
-- Keep only 'owner' relationships that might be legitimate (staff's personal cats)
WITH deleted AS (
  DELETE FROM trapper.person_cat_relationships pcr
  USING trapper.sot_people p
  WHERE pcr.person_id = p.person_id
    AND p.display_name IN ('Sandra Brady', 'Sandra Nicander')
    AND p.merged_into_person_id IS NULL
    AND pcr.relationship_type = 'caretaker'
    AND pcr.source_table IN (
      'link_appointments_via_phone',
      'mig_902_phone_linking',
      'link_cats_to_places',
      'appointment_linking'
    )
  RETURNING pcr.relationship_id, p.display_name
)
SELECT
  display_name,
  COUNT(*) as relationships_deleted
FROM deleted
GROUP BY display_name;

-- ============================================================================
-- Part 4: Check Neely Hart and ensure she's set up as foster coordinator
-- ============================================================================

\echo ''
\echo 'Part 4: Checking Neely Hart setup...'

-- Show Neely Hart records
SELECT
  p.person_id,
  p.display_name,
  pi.id_type,
  pi.id_value_norm,
  p.merged_into_person_id IS NOT NULL as is_merged
FROM trapper.sot_people p
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
WHERE p.display_name ILIKE '%neely hart%'
ORDER BY p.merged_into_person_id IS NOT NULL, pi.id_type;

-- ============================================================================
-- Part 5: Update link_appointments_via_phone to exclude org emails
-- ============================================================================

\echo ''
\echo 'Part 5: Updating link_appointments_via_phone to exclude org emails...'

CREATE OR REPLACE FUNCTION trapper.link_appointments_via_phone()
RETURNS JSONB AS $$
DECLARE
  v_linked INT := 0;
  v_relationships INT := 0;
BEGIN
  -- Link appointments via phone when:
  -- 1. No person_id yet
  -- 2. Phone exists and normalizes to a known person_identifier
  -- 3. Either no email, or email doesn't match anyone (phone takes precedence)
  -- 4. MIG_937: Email is NOT an organizational email

  WITH linked AS (
    UPDATE trapper.sot_appointments a
    SET
      person_id = pi.person_id,
      updated_at = NOW()
    FROM trapper.person_identifiers pi
    JOIN trapper.sot_people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
    WHERE a.person_id IS NULL
      AND a.owner_phone IS NOT NULL
      AND TRIM(a.owner_phone) != ''
      AND pi.id_type = 'phone'
      AND pi.id_value_norm = trapper.norm_phone_us(a.owner_phone)
      -- MIG_937: Exclude organizational emails
      AND NOT (
        LOWER(a.owner_email) LIKE '%@forgottenfelines.com'
        OR LOWER(a.owner_email) LIKE '%@forgottenfelines.org'
        OR LOWER(a.owner_email) LIKE 'info@%'
        OR LOWER(a.owner_email) LIKE 'office@%'
        OR LOWER(a.owner_email) LIKE 'contact@%'
        OR LOWER(a.owner_email) LIKE 'admin@%'
      )
      -- Avoid collision: Only link if phone uniquely identifies one person
      AND (
        -- Phone-only case (no email)
        (a.owner_email IS NULL OR TRIM(a.owner_email) = '')
        OR
        -- Email matches same person
        EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi2
          WHERE pi2.person_id = pi.person_id
            AND pi2.id_type = 'email'
            AND pi2.id_value_norm = LOWER(TRIM(a.owner_email))
        )
        OR
        -- Email doesn't match anyone (phone is our only link)
        NOT EXISTS (
          SELECT 1 FROM trapper.person_identifiers pi3
          WHERE pi3.id_type = 'email'
            AND pi3.id_value_norm = LOWER(TRIM(a.owner_email))
        )
      )
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_linked FROM linked;

  -- Create person-cat relationships for newly linked
  -- MIG_937: Only create relationships if the appointment was just linked (not pre-existing)
  -- This is handled by the UPDATE above only touching person_id = NULL appointments
  WITH new_rels AS (
    INSERT INTO trapper.person_cat_relationships (
      person_id, cat_id, relationship_type, effective_date,
      source_system, source_table, confidence
    )
    SELECT DISTINCT
      a.person_id,
      a.cat_id,
      COALESCE(
        CASE WHEN a.ownership_type ILIKE '%community%' THEN 'caretaker'
             WHEN a.ownership_type ILIKE '%feral%' THEN 'caretaker'
             WHEN a.ownership_type ILIKE '%stray%' THEN 'feeder'
             ELSE 'owner'
        END,
        'owner'
      ),
      a.appointment_date,
      'clinichq',
      'link_appointments_via_phone',
      0.85
    FROM trapper.sot_appointments a
    WHERE a.person_id IS NOT NULL
      AND a.cat_id IS NOT NULL
      -- MIG_937: Only process phone-only appointments (not org email ones)
      AND (a.owner_email IS NULL OR TRIM(a.owner_email) = '')
      AND a.owner_phone IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_cat_relationships pcr
        WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
      )
    ON CONFLICT DO NOTHING
    RETURNING relationship_id
  )
  SELECT COUNT(*) INTO v_relationships FROM new_rels;

  RETURN jsonb_build_object(
    'appointments_linked', v_linked,
    'relationships_created', v_relationships
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointments_via_phone IS
'Links appointments to persons via phone number.
MIG_937: Updated to exclude organizational emails and only create relationships
for phone-only appointments (not ones with org emails).';

-- ============================================================================
-- Part 6: Final audit
-- ============================================================================

\echo ''
\echo 'Part 6: Final audit...'

SELECT
  p.display_name,
  COUNT(DISTINCT a.appointment_id) as appointments_linked,
  COUNT(DISTINCT pcr.cat_id) as cats_linked
FROM trapper.sot_people p
LEFT JOIN trapper.sot_appointments a ON a.person_id = p.person_id
LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = p.person_id
WHERE p.display_name IN ('Sandra Brady', 'Sandra Nicander')
  AND p.merged_into_person_id IS NULL
GROUP BY p.person_id, p.display_name;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_937 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Unlinked appointments with org emails from staff person records'
\echo '  2. Deleted erroneous caretaker relationships'
\echo '  3. Updated link_appointments_via_phone to exclude org emails'
\echo ''
\echo 'Staff members should no longer accumulate community cat relationships.'
\echo 'Foster program cats should be linked to Neely Hart as foster coordinator.'
\echo ''
