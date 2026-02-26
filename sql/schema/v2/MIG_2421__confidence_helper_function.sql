-- MIG_2421: Centralize confidence filter for person_identifiers
--
-- Problem: Confidence filter (>= 0.5) is duplicated in 50+ places across views and routes.
-- PetLink emails are fabricated and have low confidence (0.1-0.2).
--
-- Solution: Create a helper function that encapsulates the confidence filter logic.
-- This ensures consistent application of INV-19 (PetLink Emails Are Fabricated).
--
-- @see CLAUDE.md invariant 19, 21
-- @see MIG_887 (original PetLink email classification)

-- Function to get the highest-confidence identifier of a given type for a person
CREATE OR REPLACE FUNCTION sot.get_high_confidence_identifier(
  p_person_id UUID,
  p_id_type TEXT,
  p_min_confidence NUMERIC DEFAULT 0.5
) RETURNS TEXT AS $$
  SELECT COALESCE(id_value_raw, id_value_norm)
  FROM sot.person_identifiers
  WHERE person_id = p_person_id
    AND id_type = p_id_type
    AND confidence >= p_min_confidence
  ORDER BY confidence DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION sot.get_high_confidence_identifier IS
'Returns the highest-confidence identifier of a given type for a person.
Default minimum confidence is 0.5, filtering out fabricated PetLink emails.
See CLAUDE.md INV-19, INV-21.';

-- Convenience function for email specifically
CREATE OR REPLACE FUNCTION sot.get_email(
  p_person_id UUID
) RETURNS TEXT AS $$
  SELECT sot.get_high_confidence_identifier(p_person_id, 'email', 0.5);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION sot.get_email IS
'Returns the highest-confidence email for a person, filtering out fabricated PetLink emails (confidence < 0.5).';

-- Convenience function for phone specifically
CREATE OR REPLACE FUNCTION sot.get_phone(
  p_person_id UUID
) RETURNS TEXT AS $$
  SELECT sot.get_high_confidence_identifier(p_person_id, 'phone', 0.5);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION sot.get_phone IS
'Returns the highest-confidence phone for a person.';

-- Function to check if a person has any high-confidence identifier
CREATE OR REPLACE FUNCTION sot.has_high_confidence_identifier(
  p_person_id UUID,
  p_id_type TEXT DEFAULT NULL,
  p_min_confidence NUMERIC DEFAULT 0.5
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM sot.person_identifiers
    WHERE person_id = p_person_id
      AND confidence >= p_min_confidence
      AND (p_id_type IS NULL OR id_type = p_id_type)
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION sot.has_high_confidence_identifier IS
'Returns TRUE if person has at least one identifier above the confidence threshold.
Pass p_id_type to check for a specific type (email, phone), or NULL for any type.';

-- Function to get all high-confidence identifiers for a person as JSONB array
CREATE OR REPLACE FUNCTION sot.get_all_identifiers(
  p_person_id UUID,
  p_min_confidence NUMERIC DEFAULT 0.5
) RETURNS JSONB AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id_type', id_type,
        'id_value', COALESCE(id_value_raw, id_value_norm),
        'confidence', confidence,
        'source_system', source_system
      )
      ORDER BY id_type, confidence DESC
    ),
    '[]'::jsonb
  )
  FROM sot.person_identifiers
  WHERE person_id = p_person_id
    AND confidence >= p_min_confidence;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION sot.get_all_identifiers IS
'Returns all high-confidence identifiers for a person as a JSONB array.
Useful for API responses that need to return all contact info.';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION sot.get_high_confidence_identifier(UUID, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION sot.get_email(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION sot.get_phone(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION sot.has_high_confidence_identifier(UUID, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION sot.get_all_identifiers(UUID, NUMERIC) TO authenticated;
