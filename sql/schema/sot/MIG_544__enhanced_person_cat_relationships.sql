-- =====================================================
-- MIG_544: Enhanced Person-Cat Relationships
-- =====================================================
-- Adds context columns to track:
-- 1. Which appointment created the relationship
-- 2. When the relationship was established
-- 3. Context notes explaining the relationship
-- 4. Support for 'brought_in_by' relationship type
-- =====================================================

\echo '=== MIG_544: Enhanced Person-Cat Relationships ==='

-- Add new columns to person_cat_relationships
ALTER TABLE trapper.person_cat_relationships
  ADD COLUMN IF NOT EXISTS context_notes TEXT,
  ADD COLUMN IF NOT EXISTS appointment_id UUID,
  ADD COLUMN IF NOT EXISTS effective_date DATE;

-- Add foreign key constraint for appointment_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_pcr_appointment'
      AND table_schema = 'trapper'
      AND table_name = 'person_cat_relationships'
  ) THEN
    ALTER TABLE trapper.person_cat_relationships
      ADD CONSTRAINT fk_pcr_appointment
      FOREIGN KEY (appointment_id)
      REFERENCES trapper.sot_appointments(appointment_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Add index for appointment lookups
CREATE INDEX IF NOT EXISTS idx_person_cat_rel_appointment
  ON trapper.person_cat_relationships(appointment_id)
  WHERE appointment_id IS NOT NULL;

-- Add index for effective_date queries
CREATE INDEX IF NOT EXISTS idx_person_cat_rel_effective_date
  ON trapper.person_cat_relationships(effective_date)
  WHERE effective_date IS NOT NULL;

-- Update the unique constraint to allow multiple relationships per person-cat
-- when they have different appointment_ids (same person can bring same cat multiple times)
-- Keep existing constraint for backward compatibility - it prevents true duplicates

COMMENT ON COLUMN trapper.person_cat_relationships.context_notes IS
  'Explains the relationship context, e.g., "Brought in on 9/11/2024, cat''s registered owner is Gary Cassasa"';

COMMENT ON COLUMN trapper.person_cat_relationships.appointment_id IS
  'Links to the specific appointment that established this relationship';

COMMENT ON COLUMN trapper.person_cat_relationships.effective_date IS
  'Date when this relationship was established (usually appointment date)';

-- =====================================================
-- Function: link_appointment_to_person_cat
-- Creates person-cat relationship from an appointment
-- =====================================================
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

  -- Check if there's already an 'owner' relationship for this cat
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
    -- Same person, just update existing relationship
    UPDATE trapper.person_cat_relationships
    SET appointment_id = COALESCE(appointment_id, p_appointment_id),
        effective_date = COALESCE(effective_date, v_appointment_date)
    WHERE cat_id = v_cat_id
      AND person_id = v_person_id
      AND relationship_type = 'owner';

    SELECT person_cat_id INTO v_result_id
    FROM trapper.person_cat_relationships
    WHERE cat_id = v_cat_id AND person_id = v_person_id AND relationship_type = 'owner';

    RETURN QUERY SELECT v_result_id, 'owner'::TEXT, FALSE;
    RETURN;
  ELSE
    -- Different person brought the cat in
    v_relationship_type := 'brought_in_by';
    v_context_notes := format(
      'Brought in on %s. Cat''s registered owner is %s.',
      v_appointment_date::TEXT,
      COALESCE(v_existing_owner_name, 'unknown')
    );
  END IF;

  -- Check if relationship already exists
  SELECT person_cat_id INTO v_result_id
  FROM trapper.person_cat_relationships
  WHERE cat_id = v_cat_id
    AND person_id = v_person_id
    AND relationship_type = v_relationship_type
    AND (appointment_id = p_appointment_id OR (appointment_id IS NULL AND v_relationship_type = 'owner'));

  IF v_result_id IS NOT NULL THEN
    -- Already exists
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
  'Creates or updates person-cat relationship from an appointment. Distinguishes owner (first) vs brought_in_by (subsequent different person).';

-- =====================================================
-- View: v_person_cat_relationships_detail
-- Shows all relationships with context
-- =====================================================
CREATE OR REPLACE VIEW trapper.v_person_cat_relationships_detail AS
SELECT
  pcr.person_cat_id,
  pcr.person_id,
  p.display_name AS person_name,
  p.email AS person_email,
  pcr.cat_id,
  c.display_name AS cat_name,
  ci.id_value AS microchip,
  pcr.relationship_type,
  pcr.confidence,
  pcr.context_notes,
  pcr.effective_date,
  pcr.appointment_id,
  a.appointment_date,
  a.appointment_number,
  pcr.source_system,
  pcr.created_at
FROM trapper.person_cat_relationships pcr
JOIN trapper.sot_people p ON p.person_id = pcr.person_id
JOIN trapper.sot_cats c ON c.cat_id = pcr.cat_id
LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
LEFT JOIN trapper.sot_appointments a ON a.appointment_id = pcr.appointment_id
ORDER BY pcr.created_at DESC;

COMMENT ON VIEW trapper.v_person_cat_relationships_detail IS
  'Detailed view of person-cat relationships with person/cat names, microchips, and appointment info.';

\echo '=== MIG_544 Complete: Enhanced person_cat_relationships ==='
\echo 'New columns: context_notes, appointment_id, effective_date'
\echo 'New function: link_appointment_to_person_cat()'
\echo 'New view: v_person_cat_relationships_detail'
