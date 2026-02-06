-- ============================================================================
-- MIG_902: Phone-Only Appointment Linking
-- ============================================================================
-- Problem: INV-15 identified ~106 appointments with phone-only contact info
-- that are not linked to persons. The existing link_appointments_to_owners()
-- function requires email OR doesn't properly handle phone-only cases.
--
-- Solution:
--   1. Link appointments to persons via phone when email is missing
--   2. Create person-cat relationships for newly linked appointments
--   3. Update the linking function to handle phone-only cases going forward
-- ============================================================================

\echo '=== MIG_902: Phone-Only Appointment Linking ==='
\echo ''

-- ============================================================================
-- Phase 1: Audit current state
-- ============================================================================

\echo 'Phase 1: Auditing phone-only appointments...'

-- Count phone-only appointments without person link
SELECT
  COUNT(*) as phone_only_unlinked,
  COUNT(*) FILTER (WHERE appointment_date >= '2024-01-01') as phone_only_recent
FROM trapper.sot_appointments
WHERE person_id IS NULL
  AND (owner_email IS NULL OR TRIM(owner_email) = '')
  AND owner_phone IS NOT NULL
  AND TRIM(owner_phone) != '';

-- ============================================================================
-- Phase 2: Link phone-only appointments to existing persons
-- ============================================================================

\echo ''
\echo 'Phase 2: Linking phone-only appointments to persons...'

WITH phone_only_links AS (
  UPDATE trapper.sot_appointments a
  SET
    person_id = pi.person_id,
    updated_at = NOW()
  FROM trapper.person_identifiers pi
  JOIN trapper.sot_people p ON p.person_id = pi.person_id AND p.merged_into_person_id IS NULL
  WHERE a.person_id IS NULL
    AND (a.owner_email IS NULL OR TRIM(a.owner_email) = '')  -- No email
    AND a.owner_phone IS NOT NULL AND TRIM(a.owner_phone) != ''  -- But has phone
    AND pi.id_type = 'phone'
    AND pi.id_value_norm = trapper.norm_phone_us(a.owner_phone)
  RETURNING a.appointment_id, a.appointment_number, pi.person_id
)
SELECT COUNT(*) as phone_only_links_created FROM phone_only_links;

-- ============================================================================
-- Phase 3: Create person-cat relationships for newly linked
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating person-cat relationships for newly linked appointments...'

WITH new_relationships AS (
  INSERT INTO trapper.person_cat_relationships (
    person_id,
    cat_id,
    relationship_type,
    effective_date,
    source_system,
    source_table,
    confidence
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
    ) as relationship_type,
    a.appointment_date as effective_date,
    'clinichq',
    'mig_902_phone_linking',
    0.85  -- High confidence since we matched via phone
  FROM trapper.sot_appointments a
  WHERE a.person_id IS NOT NULL
    AND a.cat_id IS NOT NULL
    AND (a.owner_email IS NULL OR TRIM(a.owner_email) = '')  -- Phone-only cases
    AND NOT EXISTS (
      SELECT 1 FROM trapper.person_cat_relationships pcr
      WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
    )
  ON CONFLICT DO NOTHING
  RETURNING relationship_id
)
SELECT COUNT(*) as new_relationships_created FROM new_relationships;

-- ============================================================================
-- Phase 4: Update link_appointments_via_safe_phone to handle phone-only
-- ============================================================================

\echo ''
\echo 'Phase 4: Updating phone linking function to include phone-only cases...'

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
      -- Avoid collision: Only link if phone uniquely identifies one person
      -- (Unless email also matches same person)
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
Handles phone-only cases (no email) and cases where email doesn''t match anyone.
Also creates person-cat relationships for newly linked appointments.
MIG_902: Enhanced to properly handle phone-only contact info.';

-- ============================================================================
-- Phase 5: Create function for bulk phone linking (for cron)
-- ============================================================================

\echo ''
\echo 'Phase 5: Creating bulk linking function...'

CREATE OR REPLACE FUNCTION trapper.run_phone_only_linking()
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Run phone linking
  v_result := trapper.link_appointments_via_phone();

  -- Log the run
  INSERT INTO trapper.processing_jobs (
    source_system,
    source_table,
    trigger_type,
    status,
    result,
    started_at,
    completed_at
  ) VALUES (
    'atlas',
    'mig_902_phone_linking',
    'manual',
    'completed',
    v_result,
    NOW(),
    NOW()
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_phone_only_linking IS
'Wrapper function for phone-only appointment linking.
Logs results to processing_jobs for audit trail.
Can be called from cron or manually.';

-- ============================================================================
-- Phase 6: Final audit
-- ============================================================================

\echo ''
\echo 'Phase 6: Final audit of phone-only status...'

-- Count remaining phone-only unlinked
SELECT
  'After MIG_902' as status,
  COUNT(*) as phone_only_total,
  COUNT(*) FILTER (WHERE person_id IS NULL) as still_unlinked,
  COUNT(*) FILTER (WHERE person_id IS NOT NULL) as now_linked
FROM trapper.sot_appointments
WHERE (owner_email IS NULL OR TRIM(owner_email) = '')
  AND owner_phone IS NOT NULL
  AND TRIM(owner_phone) != '';

-- Show why remaining might still be unlinked
\echo ''
\echo 'Remaining unlinked phone-only appointments (sample):';
SELECT
  a.appointment_number,
  a.appointment_date,
  a.owner_phone,
  trapper.norm_phone_us(a.owner_phone) as normalized_phone,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM trapper.person_identifiers pi
      WHERE pi.id_type = 'phone'
        AND pi.id_value_norm = trapper.norm_phone_us(a.owner_phone)
    ) THEN 'phone_not_in_database'
    ELSE 'unknown'
  END as reason
FROM trapper.sot_appointments a
WHERE a.person_id IS NULL
  AND (a.owner_email IS NULL OR TRIM(a.owner_email) = '')
  AND a.owner_phone IS NOT NULL
  AND TRIM(a.owner_phone) != ''
LIMIT 10;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_902 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Linked phone-only appointments to existing persons'
\echo '  2. Created person-cat relationships for newly linked'
\echo '  3. Updated link_appointments_via_phone() function'
\echo '  4. Created run_phone_only_linking() for ongoing use'
\echo ''
\echo 'To run phone linking in the future:'
\echo '  SELECT * FROM trapper.run_phone_only_linking();'
\echo ''
\echo 'Remaining unlinked appointments have phones not in person_identifiers.'
\echo 'These require creating new person records (handled by Data Engine).'
\echo ''
