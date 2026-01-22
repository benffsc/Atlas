-- =====================================================
-- MIG_550: Fix link_appointment_to_person_cat Function
-- =====================================================
-- Problem: The function's duplicate check logic doesn't match the unique constraint.
-- The function checks (person_id, cat_id, relationship_type, appointment_id)
-- but the constraint is (person_id, cat_id, relationship_type, source_system, source_table)
--
-- Solution: Rewrite function to match actual constraint behavior
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_550__fix_person_cat_relationship_function.sql
-- =====================================================

\echo '=== MIG_550: Fix link_appointment_to_person_cat Function ==='
\echo ''

-- ============================================================
-- 1. Drop and recreate the function with corrected logic
-- ============================================================

\echo 'Step 1: Recreating link_appointment_to_person_cat function...'

CREATE OR REPLACE FUNCTION trapper.link_appointment_to_person_cat(
  p_appointment_id UUID
) RETURNS TABLE (
  relationship_id UUID,
  relationship_type TEXT,
  is_new BOOLEAN
) AS $$
DECLARE
  v_cat_id UUID;
  v_person_id UUID;
  v_appointment_date DATE;
  v_existing_owner_person_id UUID;
  v_existing_owner_name TEXT;
  v_relationship_type TEXT;
  v_context_notes TEXT;
  v_result_id UUID;
  v_is_new BOOLEAN;
BEGIN
  -- Get appointment details
  SELECT a.cat_id, a.person_id, a.appointment_date
  INTO v_cat_id, v_person_id, v_appointment_date
  FROM trapper.sot_appointments a
  WHERE a.appointment_id = p_appointment_id;

  -- Skip if no cat or person linked
  IF v_cat_id IS NULL OR v_person_id IS NULL THEN
    RETURN;
  END IF;

  -- Check if there's already an 'owner' relationship for this cat (from any source)
  SELECT pcr.person_id, p.display_name
  INTO v_existing_owner_person_id, v_existing_owner_name
  FROM trapper.person_cat_relationships pcr
  JOIN trapper.sot_people p ON p.person_id = pcr.person_id
  WHERE pcr.cat_id = v_cat_id
    AND pcr.relationship_type = 'owner'
  ORDER BY pcr.created_at ASC
  LIMIT 1;

  -- Determine relationship type
  IF v_existing_owner_person_id IS NULL THEN
    -- No existing owner, this person becomes the owner
    v_relationship_type := 'owner';
    v_context_notes := NULL;
  ELSIF v_existing_owner_person_id = v_person_id THEN
    -- Same person as existing owner - check if we have a clinichq record to update
    SELECT pcr.person_cat_id INTO v_result_id
    FROM trapper.person_cat_relationships pcr
    WHERE pcr.cat_id = v_cat_id
      AND pcr.person_id = v_person_id
      AND pcr.relationship_type = 'owner'
      AND pcr.source_system = 'clinichq'
      AND pcr.source_table = 'sot_appointments';

    IF v_result_id IS NOT NULL THEN
      -- Update existing clinichq owner record with appointment context
      UPDATE trapper.person_cat_relationships pcr
      SET appointment_id = COALESCE(pcr.appointment_id, p_appointment_id),
          effective_date = COALESCE(pcr.effective_date, v_appointment_date)
      WHERE pcr.person_cat_id = v_result_id;

      RETURN QUERY SELECT v_result_id, 'owner'::TEXT, FALSE;
      RETURN;
    ELSE
      -- No clinichq record exists, check for any owner record
      SELECT pcr.person_cat_id INTO v_result_id
      FROM trapper.person_cat_relationships pcr
      WHERE pcr.cat_id = v_cat_id
        AND pcr.person_id = v_person_id
        AND pcr.relationship_type = 'owner'
      LIMIT 1;

      IF v_result_id IS NOT NULL THEN
        -- Update existing owner record (from other source)
        UPDATE trapper.person_cat_relationships pcr
        SET appointment_id = COALESCE(pcr.appointment_id, p_appointment_id),
            effective_date = COALESCE(pcr.effective_date, v_appointment_date)
        WHERE pcr.person_cat_id = v_result_id;

        RETURN QUERY SELECT v_result_id, 'owner'::TEXT, FALSE;
        RETURN;
      END IF;
    END IF;

    -- No existing owner record for this person - create one
    v_relationship_type := 'owner';
    v_context_notes := NULL;
  ELSE
    -- Different person brought the cat in
    v_relationship_type := 'brought_in_by';
    v_context_notes := format(
      'Brought in on %s. Cat''s registered owner is %s.',
      v_appointment_date::TEXT,
      COALESCE(v_existing_owner_name, 'unknown')
    );
  END IF;

  -- Check if this exact relationship already exists (matching the 5-column constraint)
  SELECT pcr.person_cat_id INTO v_result_id
  FROM trapper.person_cat_relationships pcr
  WHERE pcr.cat_id = v_cat_id
    AND pcr.person_id = v_person_id
    AND pcr.relationship_type = v_relationship_type
    AND pcr.source_system = 'clinichq'
    AND pcr.source_table = 'sot_appointments';

  IF v_result_id IS NOT NULL THEN
    -- Already exists - update appointment context if missing
    UPDATE trapper.person_cat_relationships pcr
    SET context_notes = COALESCE(pcr.context_notes, v_context_notes),
        appointment_id = COALESCE(pcr.appointment_id, p_appointment_id),
        effective_date = COALESCE(pcr.effective_date, v_appointment_date)
    WHERE pcr.person_cat_id = v_result_id;

    RETURN QUERY SELECT v_result_id, v_relationship_type, FALSE;
    RETURN;
  END IF;

  -- Insert new relationship
  INSERT INTO trapper.person_cat_relationships (
    person_cat_id,
    person_id,
    cat_id,
    relationship_type,
    confidence,
    source_system,
    source_table,
    context_notes,
    appointment_id,
    effective_date,
    created_at
  ) VALUES (
    gen_random_uuid(),
    v_person_id,
    v_cat_id,
    v_relationship_type,
    'high',
    'clinichq',
    'sot_appointments',
    v_context_notes,
    p_appointment_id,
    v_appointment_date,
    NOW()
  )
  ON CONFLICT (person_id, cat_id, relationship_type, source_system, source_table)
  DO UPDATE SET
    context_notes = COALESCE(EXCLUDED.context_notes, trapper.person_cat_relationships.context_notes),
    appointment_id = COALESCE(trapper.person_cat_relationships.appointment_id, EXCLUDED.appointment_id),
    effective_date = COALESCE(trapper.person_cat_relationships.effective_date, EXCLUDED.effective_date)
  RETURNING person_cat_id INTO v_result_id;

  v_is_new := TRUE;

  RETURN QUERY SELECT v_result_id, v_relationship_type, v_is_new;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.link_appointment_to_person_cat(UUID) IS
'Creates or updates person-cat relationship from an appointment.
Distinguishes owner (first person) vs brought_in_by (subsequent different person).
Fixed in MIG_550 to properly match the 5-column unique constraint:
(person_id, cat_id, relationship_type, source_system, source_table)';

-- ============================================================
-- 2. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Function recreated successfully:'
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name = 'link_appointment_to_person_cat';

\echo ''
\echo 'Testing function on sample appointment...'
DO $$
DECLARE
  v_test_appointment_id UUID;
  v_result RECORD;
BEGIN
  SELECT appointment_id INTO v_test_appointment_id
  FROM trapper.sot_appointments
  WHERE cat_id IS NOT NULL AND person_id IS NOT NULL
  LIMIT 1;

  IF v_test_appointment_id IS NOT NULL THEN
    FOR v_result IN SELECT * FROM trapper.link_appointment_to_person_cat(v_test_appointment_id)
    LOOP
      RAISE NOTICE 'Test result: relationship_id=%, type=%, is_new=%',
        v_result.relationship_id, v_result.relationship_type, v_result.is_new;
    END LOOP;
  ELSE
    RAISE NOTICE 'No suitable test appointment found';
  END IF;
END $$;

\echo ''
\echo '=== MIG_550 Complete ==='
