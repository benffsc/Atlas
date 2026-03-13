-- MIG_2925: Create trapper_manual_catches table + fix add_trapper_catch()
--
-- Problem: The trapper detail page (/trappers/[id]) calls:
--   GET /api/people/[id]/trapper-cats → queries ops.trapper_manual_catches (doesn't exist)
--   POST /api/people/[id]/trapper-cats → calls ops.add_trapper_catch() with 7 params (has 4)
--
-- This migration:
--   1. Creates ops.trapper_manual_catches table
--   2. Replaces ops.add_trapper_catch() with correct signature
--
-- Fixes FFS-473 (trapper management page blockers)

-- =========================================================================
-- Step 1: Create trapper_manual_catches table
-- =========================================================================

CREATE TABLE IF NOT EXISTS ops.trapper_manual_catches (
  catch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trapper_person_id UUID NOT NULL REFERENCES sot.people(person_id),
  microchip TEXT,
  cat_id UUID REFERENCES sot.cats(cat_id),
  catch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  catch_location TEXT,
  notes TEXT,
  source TEXT DEFAULT 'web_user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trapper_catches_person ON ops.trapper_manual_catches(trapper_person_id);
CREATE INDEX IF NOT EXISTS idx_trapper_catches_cat ON ops.trapper_manual_catches(cat_id) WHERE cat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trapper_catches_date ON ops.trapper_manual_catches(catch_date DESC);

COMMENT ON TABLE ops.trapper_manual_catches IS
'Manual catch records entered by staff for trappers. Separate from clinic appointment data.';

-- =========================================================================
-- Step 2: Replace add_trapper_catch() with correct signature
--
-- Old: (p_trapper_id UUID, p_cat_id UUID, p_appointment_id UUID, p_notes TEXT)
-- New: (p_trapper_id UUID, p_microchip TEXT, p_cat_id UUID, p_catch_date DATE,
--        p_catch_location TEXT, p_notes TEXT, p_source TEXT)
-- =========================================================================

-- Drop old function first (different signature)
DROP FUNCTION IF EXISTS ops.add_trapper_catch(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION ops.add_trapper_catch(
  p_trapper_id UUID,
  p_microchip TEXT DEFAULT NULL,
  p_cat_id UUID DEFAULT NULL,
  p_catch_date DATE DEFAULT CURRENT_DATE,
  p_catch_location TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'web_user'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_catch_id UUID;
  v_cat_id UUID;
  v_is_trapper BOOLEAN;
BEGIN
  -- Verify person is an active trapper
  SELECT EXISTS(
    SELECT 1 FROM sot.person_roles
    WHERE person_id = p_trapper_id
      AND role = 'trapper'
      AND role_status = 'active'
  ) INTO v_is_trapper;

  IF NOT v_is_trapper THEN
    RAISE EXCEPTION 'Person % is not an active trapper', p_trapper_id;
  END IF;

  -- Resolve cat_id from microchip if not provided
  v_cat_id := p_cat_id;
  IF v_cat_id IS NULL AND p_microchip IS NOT NULL THEN
    SELECT ci.cat_id INTO v_cat_id
    FROM sot.cat_identifiers ci
    WHERE ci.id_type = 'microchip'
      AND ci.id_value = p_microchip
    LIMIT 1;
  END IF;

  -- Create the catch record
  INSERT INTO ops.trapper_manual_catches (
    trapper_person_id, microchip, cat_id, catch_date,
    catch_location, notes, source
  ) VALUES (
    p_trapper_id, p_microchip, v_cat_id, p_catch_date,
    p_catch_location, p_notes, p_source
  )
  RETURNING catch_id INTO v_catch_id;

  -- Also create person_cat relationship if cat found
  IF v_cat_id IS NOT NULL THEN
    INSERT INTO sot.person_cat (
      person_id, cat_id, relationship_type, evidence_type,
      source_system, source_table
    ) VALUES (
      p_trapper_id, v_cat_id, 'trapper', 'manual',
      'atlas_ui', 'trapper_manual_catches'
    ) ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_catch_id;
END;
$$;

-- Verification
DO $$
BEGIN
  RAISE NOTICE 'MIG_2925: Created ops.trapper_manual_catches table and fixed ops.add_trapper_catch() signature';
END $$;
