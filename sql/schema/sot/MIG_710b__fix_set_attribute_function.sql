\echo '=== MIG_710b: Fix set_entity_attribute function ==='

-- Fix the function to supersede BEFORE inserting to avoid unique constraint violation
CREATE OR REPLACE FUNCTION trapper.set_entity_attribute(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_attribute_key TEXT,
  p_value JSONB,
  p_confidence NUMERIC DEFAULT 0.8,
  p_source_type TEXT DEFAULT 'ai_extracted',
  p_source_text TEXT DEFAULT NULL,
  p_source_system TEXT DEFAULT NULL,
  p_source_record_id TEXT DEFAULT NULL,
  p_extracted_by TEXT DEFAULT 'system'
) RETURNS UUID AS $$
DECLARE
  v_new_id UUID := gen_random_uuid();
  v_old_id UUID;
  v_old_confidence NUMERIC;
BEGIN
  -- Find existing active attribute
  SELECT attribute_id, confidence INTO v_old_id, v_old_confidence
  FROM trapper.entity_attributes
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
    AND attribute_key = p_attribute_key
    AND superseded_at IS NULL;

  -- Only update if new confidence is higher or equal, or if no existing value
  IF v_old_id IS NULL OR p_confidence >= COALESCE(v_old_confidence, 0) THEN
    -- Supersede old value FIRST (before insert to avoid constraint violation)
    IF v_old_id IS NOT NULL THEN
      UPDATE trapper.entity_attributes
      SET superseded_at = NOW(), superseded_by = v_new_id
      WHERE attribute_id = v_old_id;
    END IF;

    -- Then insert new attribute
    INSERT INTO trapper.entity_attributes (
      attribute_id, entity_type, entity_id, attribute_key, attribute_value,
      confidence, source_type, source_text, source_system, source_record_id, extracted_by
    ) VALUES (
      v_new_id, p_entity_type, p_entity_id, p_attribute_key, p_value,
      p_confidence, p_source_type, p_source_text, p_source_system, p_source_record_id, p_extracted_by
    );

    RETURN v_new_id;
  END IF;

  -- Return old ID if we didn't update (new confidence was lower)
  RETURN v_old_id;
END;
$$ LANGUAGE plpgsql;

\echo '=== MIG_710b Complete ==='
