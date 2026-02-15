-- MIG_2309: Add place verification and context type display features
--
-- Purpose: Restore V1 features that enable:
-- 1. Staff verification workflow - mark places as reviewed/trusted
-- 2. Human-readable context labels - "Colony Site" instead of "colony_site"
-- 3. UI sort order - control dropdown ordering in PlaceContextEditor
--
-- V2 Architecture:
-- - Verification is a data quality signal (INV-2: Manual > AI)
-- - Context types are lookup data in sot schema
-- - All changes are additive (no breaking changes)

-- ============================================================
-- PART 1: Place Context Types - Display Labels & Sort Order
-- ============================================================

-- Add display_label and sort_order columns
ALTER TABLE sot.place_context_types
  ADD COLUMN IF NOT EXISTS display_label TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Update existing context types with proper display labels and sort order
-- These are the standard context types used throughout the app
UPDATE sot.place_context_types SET
  display_label = CASE context_type
    WHEN 'colony' THEN 'Colony Site'
    WHEN 'colony_site' THEN 'Colony Site'
    WHEN 'foster_home' THEN 'Foster Home'
    WHEN 'volunteer_location' THEN 'Volunteer Location'
    WHEN 'feeding_station' THEN 'Feeding Station'
    WHEN 'trapping_site' THEN 'Trapping Site'
    WHEN 'clinic' THEN 'Veterinary Clinic'
    WHEN 'shelter' THEN 'Animal Shelter'
    WHEN 'rescue' THEN 'Rescue Organization'
    WHEN 'adopter_residence' THEN 'Adopter Residence'
    WHEN 'trapper_base' THEN 'Trapper Base'
    WHEN 'trap_pickup' THEN 'Trap Pickup Location'
    WHEN 'partner_org' THEN 'Partner Organization'
    ELSE INITCAP(REPLACE(context_type, '_', ' '))
  END,
  sort_order = CASE context_type
    WHEN 'colony' THEN 10
    WHEN 'colony_site' THEN 10
    WHEN 'foster_home' THEN 20
    WHEN 'adopter_residence' THEN 30
    WHEN 'volunteer_location' THEN 40
    WHEN 'trapper_base' THEN 45
    WHEN 'trap_pickup' THEN 50
    WHEN 'trapping_site' THEN 55
    WHEN 'feeding_station' THEN 60
    WHEN 'clinic' THEN 70
    WHEN 'shelter' THEN 80
    WHEN 'rescue' THEN 85
    WHEN 'partner_org' THEN 90
    ELSE 100
  END
WHERE display_label IS NULL;

-- Make display_label NOT NULL with a default for future inserts
ALTER TABLE sot.place_context_types
  ALTER COLUMN display_label SET DEFAULT 'Unknown';

-- Ensure all rows have a display_label
UPDATE sot.place_context_types
SET display_label = INITCAP(REPLACE(context_type, '_', ' '))
WHERE display_label IS NULL;

ALTER TABLE sot.place_context_types
  ALTER COLUMN display_label SET NOT NULL;

-- ============================================================
-- PART 2: Place Verification
-- ============================================================

-- Add verification columns to places
-- verified_at: When a staff member reviewed and approved this place
-- verified_by: Reference to staff who verified (stored as text for flexibility)
ALTER TABLE sot.places
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by TEXT;

-- Create index for finding unverified places
CREATE INDEX IF NOT EXISTS idx_places_unverified
  ON sot.places (verified_at)
  WHERE verified_at IS NULL;

-- ============================================================
-- PART 3: Verification API Support
-- ============================================================

-- Function to verify a place
CREATE OR REPLACE FUNCTION sot.verify_place(
  p_place_id UUID,
  p_verified_by TEXT
)
RETURNS TABLE (
  place_id UUID,
  verified_at TIMESTAMPTZ,
  verified_by TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE sot.places
  SET
    verified_at = NOW(),
    verified_by = p_verified_by
  WHERE places.place_id = p_place_id
  RETURNING
    places.place_id,
    places.verified_at,
    places.verified_by;
END;
$$;

-- Function to unverify a place
CREATE OR REPLACE FUNCTION sot.unverify_place(
  p_place_id UUID
)
RETURNS TABLE (
  place_id UUID,
  verified_at TIMESTAMPTZ,
  verified_by TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE sot.places
  SET
    verified_at = NULL,
    verified_by = NULL
  WHERE places.place_id = p_place_id
  RETURNING
    places.place_id,
    places.verified_at,
    places.verified_by;
END;
$$;

-- ============================================================
-- PART 4: Context Types API View
-- ============================================================

-- View for API to fetch context types with proper ordering
CREATE OR REPLACE VIEW sot.v_place_context_types AS
SELECT
  context_type,
  display_label,
  description,
  sort_order,
  is_active,
  created_at
FROM sot.place_context_types
WHERE is_active = TRUE
ORDER BY sort_order, display_label;

-- ============================================================
-- VERIFICATION
-- ============================================================

DO $$
DECLARE
  v_place_context_types_cols TEXT[];
  v_places_cols TEXT[];
BEGIN
  -- Check place_context_types columns
  SELECT array_agg(column_name) INTO v_place_context_types_cols
  FROM information_schema.columns
  WHERE table_schema = 'sot' AND table_name = 'place_context_types';

  ASSERT 'display_label' = ANY(v_place_context_types_cols),
    'Missing display_label column on place_context_types';
  ASSERT 'sort_order' = ANY(v_place_context_types_cols),
    'Missing sort_order column on place_context_types';
  ASSERT 'is_active' = ANY(v_place_context_types_cols),
    'Missing is_active column on place_context_types';

  -- Check places columns
  SELECT array_agg(column_name) INTO v_places_cols
  FROM information_schema.columns
  WHERE table_schema = 'sot' AND table_name = 'places';

  ASSERT 'verified_at' = ANY(v_places_cols),
    'Missing verified_at column on places';
  ASSERT 'verified_by' = ANY(v_places_cols),
    'Missing verified_by column on places';

  RAISE NOTICE 'MIG_2309: All columns added successfully';
  RAISE NOTICE 'MIG_2309: place_context_types now has display_label, sort_order, is_active';
  RAISE NOTICE 'MIG_2309: places now has verified_at, verified_by';
END;
$$;
