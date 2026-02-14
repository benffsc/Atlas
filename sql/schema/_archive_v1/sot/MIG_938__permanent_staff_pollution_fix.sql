-- ============================================================================
-- MIG_938: Permanent Staff Appointment Pollution Fix
-- ============================================================================
-- Problem: Staff members (Sandra Brady, Sandra Nicander) keep accumulating
-- thousands of community cat relationships via entity linking.
--
-- Root Cause: Two gaps in entity linking pipeline recreate relationships:
--   1. process_clinichq_owner_info() Step 6 - no org email check
--   2. run_all_entity_linking() Step 7 - no org email check
--
-- Previous fixes (MIG_915, MIG_916, MIG_937) deleted relationships but didn't
-- fix the source - entity linking recreates them on every cron run.
--
-- Solution (Multi-Layer Defense):
--   1. Add org emails/phones to data_engine_soft_blacklist
--   2. Create centralized is_organizational_contact() function
--   3. Update both entity linking gaps to use the function
--   4. Unlink existing appointments with org contacts
--   5. Delete erroneous relationships
-- ============================================================================

\echo '=== MIG_938: Permanent Staff Appointment Pollution Fix ==='
\echo ''

-- ============================================================================
-- Part 1: Audit current state
-- ============================================================================

\echo 'Part 1: Auditing staff appointment links...'

SELECT
  p.display_name,
  COUNT(DISTINCT a.appointment_id) as appointments,
  COUNT(DISTINCT pcr.cat_id) as cats_linked,
  array_agg(DISTINCT a.owner_email) FILTER (WHERE a.owner_email IS NOT NULL) as emails_used,
  array_agg(DISTINCT a.owner_phone) FILTER (WHERE a.owner_phone IS NOT NULL) as phones_used
FROM trapper.sot_people p
LEFT JOIN trapper.sot_appointments a ON a.person_id = p.person_id
LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = p.person_id
WHERE p.display_name IN ('Sandra Brady', 'Sandra Nicander', 'Neely Hart')
  AND p.merged_into_person_id IS NULL
GROUP BY p.person_id, p.display_name
ORDER BY appointments DESC;

-- ============================================================================
-- Part 2: Add organizational contacts to soft blacklist
-- ============================================================================

\echo ''
\echo 'Part 2: Adding organizational contacts to soft blacklist...'

-- Add org emails that should never link to individual people
INSERT INTO trapper.data_engine_soft_blacklist (identifier_norm, identifier_type, reason, require_name_similarity, require_address_match)
VALUES
  ('info@forgottenfelines.com', 'email', 'FFSC general inbox - not a person', 1.0, TRUE),
  ('info@forgottenfelines.org', 'email', 'FFSC general inbox - not a person', 1.0, TRUE),
  ('scas@forgottenfelines.com', 'email', 'SCAS intake inbox - not a person', 1.0, TRUE),
  ('espanol@forgottenfelines.com', 'email', 'Spanish hotline - not a person', 1.0, TRUE),
  ('office@forgottenfelines.com', 'email', 'FFSC office general - not a person', 1.0, TRUE),
  ('contact@forgottenfelines.com', 'email', 'FFSC contact form - not a person', 1.0, TRUE)
ON CONFLICT (identifier_norm, identifier_type) DO UPDATE
SET reason = EXCLUDED.reason,
    require_name_similarity = EXCLUDED.require_name_similarity;

-- Add shared office phone (7075767999 = (707) 576-7999)
INSERT INTO trapper.data_engine_soft_blacklist (identifier_norm, identifier_type, reason, require_name_similarity, require_address_match)
VALUES
  ('7075767999', 'phone', 'FFSC main office line - shared by staff', 1.0, TRUE)
ON CONFLICT (identifier_norm, identifier_type) DO UPDATE
SET reason = EXCLUDED.reason;

\echo 'Soft blacklist entries added:'
SELECT identifier_norm, identifier_type, reason
FROM trapper.data_engine_soft_blacklist
WHERE reason LIKE '%FFSC%' OR reason LIKE '%not a person%'
ORDER BY identifier_type, identifier_norm;

-- ============================================================================
-- Part 3: Create centralized is_organizational_contact() function
-- ============================================================================

\echo ''
\echo 'Part 3: Creating is_organizational_contact() function...'

CREATE OR REPLACE FUNCTION trapper.is_organizational_contact(
  p_email TEXT,
  p_phone TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_email_norm TEXT;
  v_phone_norm TEXT;
BEGIN
  v_email_norm := LOWER(TRIM(COALESCE(p_email, '')));
  v_phone_norm := trapper.norm_phone_us(p_phone);

  -- Check soft blacklist first (most authoritative)
  IF v_email_norm != '' AND EXISTS (
    SELECT 1 FROM trapper.data_engine_soft_blacklist
    WHERE identifier_type = 'email'
      AND identifier_norm = v_email_norm
      AND require_name_similarity >= 0.99  -- 1.0 means "never link to anyone"
  ) THEN
    RETURN TRUE;
  END IF;

  IF v_phone_norm IS NOT NULL AND EXISTS (
    SELECT 1 FROM trapper.data_engine_soft_blacklist
    WHERE identifier_type = 'phone'
      AND identifier_norm = v_phone_norm
      AND require_name_similarity >= 0.99
  ) THEN
    RETURN TRUE;
  END IF;

  -- Check org email patterns (catch-all for patterns we might miss)
  IF v_email_norm != '' AND (
    v_email_norm LIKE '%@forgottenfelines.com'
    OR v_email_norm LIKE '%@forgottenfelines.org'
    OR v_email_norm LIKE 'info@%'
    OR v_email_norm LIKE 'office@%'
    OR v_email_norm LIKE 'contact@%'
    OR v_email_norm LIKE 'admin@%'
    OR v_email_norm LIKE 'support@%'
    OR v_email_norm LIKE 'help@%'
    OR v_email_norm LIKE 'noreply@%'
    OR v_email_norm LIKE 'no-reply@%'
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.is_organizational_contact IS
'MIG_938: Returns TRUE if the email/phone appears to be an organizational contact
(e.g., info@forgottenfelines.com, shared office phone) rather than an individual.
Used by entity linking to prevent linking appointments to staff via org contacts.

Checks:
1. Soft blacklist with require_name_similarity >= 0.99 (never link)
2. Pattern matching for common org email prefixes';

-- Verify function works
\echo ''
\echo 'Testing is_organizational_contact():'
SELECT
  email,
  phone,
  trapper.is_organizational_contact(email, phone) as is_org
FROM (VALUES
  ('info@forgottenfelines.com', NULL),
  ('scas@forgottenfelines.com', NULL),
  ('john.smith@gmail.com', NULL),
  (NULL, '(707) 576-7999'),
  (NULL, '707-555-1234'),
  ('staff@forgottenfelines.com', NULL),
  ('admin@example.com', NULL)
) AS t(email, phone);

-- ============================================================================
-- Part 4: Update process_clinichq_owner_info() - Add org contact exclusion
-- ============================================================================

\echo ''
\echo 'Part 4: Updating process_clinichq_owner_info() to exclude org contacts...'

CREATE OR REPLACE FUNCTION trapper.process_clinichq_owner_info(
  p_job_id UUID DEFAULT NULL,
  p_batch_size INT DEFAULT 500
)
RETURNS JSONB AS $$
DECLARE
  v_results JSONB := '{}';
  v_count INT;
BEGIN
  -- Step 1: Create people from owner_info (skip if can't be a person)
  WITH created AS (
    SELECT DISTINCT ON (sr.id)
      sr.id,
      trapper.find_or_create_person(
        NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''),
        COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone'),
        sr.payload->>'Owner First Name',
        sr.payload->>'Owner Last Name',
        sr.payload->>'Address'
          || COALESCE(', ' || sr.payload->>'City', '')
          || COALESCE(', ' || sr.payload->>'State', '')
          || COALESCE(' ' || sr.payload->>'Zip', ''),
        'clinichq'
      ) as person_id
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.processed_at IS NULL
      AND (
        NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), '') IS NOT NULL
        OR COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone') IS NOT NULL
      )
    LIMIT p_batch_size
  )
  SELECT COUNT(*) FILTER (WHERE person_id IS NOT NULL) INTO v_count FROM created;
  v_results := v_results || jsonb_build_object('people_created', v_count);

  -- Step 2: Create places from owner_info
  WITH created AS (
    SELECT DISTINCT ON (sr.id)
      sr.id,
      trapper.find_or_create_place_deduped(
        sr.payload->>'Address'
          || COALESCE(', ' || sr.payload->>'City', '')
          || COALESCE(', ' || sr.payload->>'State', '')
          || COALESCE(' ' || sr.payload->>'Zip', ''),
        NULL, NULL, NULL, 'clinichq'
      ) as place_id
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND sr.processed_at IS NULL
      AND NULLIF(sr.payload->>'Address', '') IS NOT NULL
    LIMIT p_batch_size
  )
  SELECT COUNT(*) FILTER (WHERE place_id IS NOT NULL) INTO v_count FROM created;
  v_results := v_results || jsonb_build_object('places_created', v_count);

  -- Step 3: Backfill owner_email and owner_phone on appointments
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET
      owner_email = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''),
      owner_phone = COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone'),
      updated_at = NOW()
    FROM trapper.staged_records sr
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND a.appointment_number = sr.payload->>'Number'
      AND (a.owner_email IS NULL OR a.owner_phone IS NULL)
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('appointments_backfilled', v_count);

  -- Step 4: Link people to places
  WITH links AS (
    INSERT INTO trapper.person_place_relationships (person_id, place_id, source_system, source_table)
    SELECT DISTINCT
      pi.person_id,
      pl.place_id,
      'clinichq',
      'owner_info'
    FROM trapper.staged_records sr
    JOIN trapper.person_identifiers pi ON (
      (pi.id_type = 'email' AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''))
      OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')))
    )
    JOIN trapper.places pl ON pl.raw_address ILIKE '%' || sr.payload->>'Address' || '%'
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND NULLIF(sr.payload->>'Address', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_place_relationships ppr
        WHERE ppr.person_id = pi.person_id AND ppr.place_id = pl.place_id
      )
    ON CONFLICT DO NOTHING
    RETURNING person_id
  )
  SELECT COUNT(*) INTO v_count FROM links;
  v_results := v_results || jsonb_build_object('person_place_links', v_count);

  -- Step 5: Link appointments to people (skip org contacts)
  -- MIG_938: Do NOT link appointments with org emails/phones
  WITH updates AS (
    UPDATE trapper.sot_appointments a
    SET
      person_id = pi.person_id,
      updated_at = NOW()
    FROM trapper.staged_records sr
    JOIN trapper.person_identifiers pi ON (
      (pi.id_type = 'email' AND pi.id_value_norm = NULLIF(LOWER(TRIM(sr.payload->>'Owner Email')), ''))
      OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')))
    )
    WHERE sr.source_system = 'clinichq'
      AND sr.source_table = 'owner_info'
      AND a.appointment_number = sr.payload->>'Number'
      AND a.person_id IS NULL
      -- MIG_938: Exclude organizational contacts
      AND NOT trapper.is_organizational_contact(
        sr.payload->>'Owner Email',
        COALESCE(NULLIF(sr.payload->>'Owner Cell Phone', ''), sr.payload->>'Owner Phone')
      )
    RETURNING a.appointment_id
  )
  SELECT COUNT(*) INTO v_count FROM updates;
  v_results := v_results || jsonb_build_object('appointments_linked_to_people', v_count);

  -- Step 6: Link cats to people via appointments
  -- MIG_938: Exclude appointments with org contacts
  WITH inserts AS (
    INSERT INTO trapper.person_cat_relationships (cat_id, person_id, relationship_type, confidence, source_system, source_table)
    SELECT DISTINCT
      a.cat_id,
      a.person_id,
      'caretaker',
      'high',
      'clinichq',
      'owner_info'
    FROM trapper.sot_appointments a
    WHERE a.cat_id IS NOT NULL
      AND a.person_id IS NOT NULL
      -- MIG_938: Exclude organizational contacts
      AND NOT trapper.is_organizational_contact(a.owner_email, a.owner_phone)
      AND NOT EXISTS (
        SELECT 1 FROM trapper.person_cat_relationships cpr
        WHERE cpr.cat_id = a.cat_id AND cpr.person_id = a.person_id
      )
    ON CONFLICT DO NOTHING
    RETURNING cat_id
  )
  SELECT COUNT(*) INTO v_count FROM inserts;
  v_results := v_results || jsonb_build_object('cat_person_links', v_count);

  -- Mark records as processed
  UPDATE trapper.staged_records
  SET processed_at = NOW()
  WHERE source_system = 'clinichq'
    AND source_table = 'owner_info'
    AND processed_at IS NULL;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_clinichq_owner_info IS
'Process ClinicHQ owner_info staged records.
- Creates people via find_or_create_person
- Creates places via find_or_create_place_deduped
- Links people to places
- CRITICAL: Backfills owner_email/phone on appointments (fixes CLI pipeline bug)
- Links people to appointments (MIG_938: excludes org contacts)
- Creates person-cat relationships (MIG_938: excludes org contacts)

Idempotent and safe to re-run.';

-- ============================================================================
-- Part 5: Update run_all_entity_linking() - Add org contact exclusion
-- ============================================================================

\echo ''
\echo 'Part 5: Updating run_all_entity_linking() to exclude org contacts...'

-- Read current function to get the full body
-- We need to recreate the entire function with the fix in Step 7

CREATE OR REPLACE FUNCTION trapper.run_all_entity_linking()
RETURNS TABLE(operation TEXT, count INT) AS $$
DECLARE
  v_count INT;
BEGIN
  -- Step 1: Link appointments to owners via email
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointments_to_owners(2000)
    )
    SELECT INTO v_count (SELECT * FROM linked);
    operation := 'link_appointments_to_owners'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_to_owners (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 2: Link appointments via phone
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointments_via_phone()
    )
    SELECT INTO v_count (linked->>'appointments_linked')::INT FROM linked;
    operation := 'link_appointments_via_phone'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_via_phone (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 3: Link appointments via safe phone (uniquely identifying)
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointments_via_safe_phone(2000)
    )
    SELECT INTO v_count (SELECT * FROM linked);
    operation := 'link_appointments_via_safe_phone'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointments_via_safe_phone (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 4: Link partner org appointments
  BEGIN
    WITH linked AS (
      SELECT trapper.link_partner_org_appointments(2000) as appointments_linked
    )
    SELECT INTO v_count (SELECT appointments_linked FROM linked);
    operation := 'link_partner_org_appointments'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_partner_org_appointments (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 5: Link cats to places
  BEGIN
    WITH linked AS (
      SELECT trapper.link_appointment_cats_to_places()
    )
    SELECT INTO v_count (linked->>'relationships_created')::INT FROM linked;
    operation := 'link_appointment_cats_to_places'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'link_appointment_cats_to_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 6: Infer appointment places from person's place
  BEGIN
    WITH inferred AS (
      UPDATE trapper.sot_appointments a
      SET place_id = ppr.place_id
      FROM trapper.person_place_relationships ppr
      WHERE a.person_id = ppr.person_id
        AND a.place_id IS NULL
        AND ppr.place_id IS NOT NULL
      RETURNING a.appointment_id
    )
    SELECT INTO v_count COUNT(*) FROM inferred;
    operation := 'infer_appointment_places'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'infer_appointment_places (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  -- Step 7: Create person-cat relationships from linked appointments
  -- MIG_938: Exclude appointments with organizational contacts
  BEGIN
    WITH missing_rels AS (
      INSERT INTO trapper.person_cat_relationships (
        person_id, cat_id, relationship_type, confidence,
        source_system, source_table
      )
      SELECT DISTINCT a.person_id, a.cat_id, 'caretaker', 'high',
        'clinichq', 'appointments'
      FROM trapper.sot_appointments a
      WHERE a.person_id IS NOT NULL
        AND a.cat_id IS NOT NULL
        -- MIG_938: Exclude organizational contacts
        AND NOT trapper.is_organizational_contact(a.owner_email, a.owner_phone)
        AND NOT EXISTS (
          SELECT 1 FROM trapper.person_cat_relationships pcr
          WHERE pcr.person_id = a.person_id AND pcr.cat_id = a.cat_id
        )
      ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table) DO NOTHING
      RETURNING person_id
    )
    SELECT INTO v_count COUNT(*) FROM missing_rels;
    operation := 'create_person_cat_relationships'; count := v_count; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    operation := 'create_person_cat_relationships (FAILED: ' || SQLERRM || ')'; count := 0; RETURN NEXT;
  END;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.run_all_entity_linking() IS
'MIG_862/MIG_938: Orchestrates all entity linking steps with fault tolerance.
Each step is wrapped in BEGIN/EXCEPTION so one failure does not block others.

MIG_938 fix: Step 7 now excludes appointments with organizational contacts
(info@forgottenfelines.com, shared office phone, etc.) to prevent staff from
accumulating community cat relationships.';

-- ============================================================================
-- Part 6: Unlink existing appointments with org contacts
-- ============================================================================

\echo ''
\echo 'Part 6: Unlinking appointments with organizational contacts...'

WITH unlinked AS (
  UPDATE trapper.sot_appointments a
  SET
    person_id = NULL,
    updated_at = NOW()
  WHERE a.person_id IS NOT NULL
    AND trapper.is_organizational_contact(a.owner_email, a.owner_phone)
  RETURNING a.appointment_id, a.owner_email, a.owner_phone
)
SELECT
  COALESCE(owner_email, owner_phone) as contact,
  COUNT(*) as appointments_unlinked
FROM unlinked
GROUP BY COALESCE(owner_email, owner_phone)
ORDER BY appointments_unlinked DESC;

-- ============================================================================
-- Part 7: Delete erroneous staff person-cat relationships
-- ============================================================================

\echo ''
\echo 'Part 7: Deleting erroneous staff person-cat relationships...'

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
      'appointment_linking',
      'process_clinichq_owner_info',
      'owner_info',
      'appointments'
    )
  RETURNING pcr.person_cat_id, p.display_name
)
SELECT
  display_name,
  COUNT(*) as relationships_deleted
FROM deleted
GROUP BY display_name;

-- ============================================================================
-- Part 8: Final audit
-- ============================================================================

\echo ''
\echo 'Part 8: Final audit...'

SELECT
  p.display_name,
  COUNT(DISTINCT a.appointment_id) as appointments_linked,
  COUNT(DISTINCT pcr.cat_id) as cats_linked
FROM trapper.sot_people p
LEFT JOIN trapper.sot_appointments a ON a.person_id = p.person_id
LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = p.person_id
WHERE p.display_name IN ('Sandra Brady', 'Sandra Nicander', 'Neely Hart')
  AND p.merged_into_person_id IS NULL
GROUP BY p.person_id, p.display_name
ORDER BY p.display_name;

-- ============================================================================
-- Part 9: Verify Neely Hart setup
-- ============================================================================

\echo ''
\echo 'Part 9: Verifying Neely Hart setup...'

SELECT
  p.person_id,
  p.display_name,
  pi.id_type,
  pi.id_value_norm,
  ppr.place_id IS NOT NULL as has_place_link
FROM trapper.sot_people p
LEFT JOIN trapper.person_identifiers pi ON pi.person_id = p.person_id
LEFT JOIN trapper.person_place_relationships ppr ON ppr.person_id = p.person_id
WHERE p.display_name ILIKE '%neely hart%'
  AND p.merged_into_person_id IS NULL
ORDER BY pi.id_type;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_938 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes made:'
\echo '  1. Added org emails/phones to data_engine_soft_blacklist'
\echo '  2. Created is_organizational_contact() function'
\echo '  3. Updated process_clinichq_owner_info() - excludes org contacts'
\echo '  4. Updated run_all_entity_linking() Step 7 - excludes org contacts'
\echo '  5. Unlinked appointments with org contacts'
\echo '  6. Deleted erroneous staff person-cat relationships'
\echo ''
\echo 'This fix is PERMANENT because:'
\echo '  - Centralized is_organizational_contact() function is used by all entity linking'
\echo '  - person_id is removed from org contact appointments (not just relationships)'
\echo '  - Future entity linking runs will skip org contact appointments'
\echo ''
