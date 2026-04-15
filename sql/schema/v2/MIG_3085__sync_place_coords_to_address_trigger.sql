-- MIG_3085: Unidirectional coord sync trigger — place geometry → address lat/lng
--
-- DATA_GAP_067 / FFS-1251
--
-- Problem: No mechanism syncs coordinates between sot.places.location (geometry)
-- and sot.addresses.latitude/longitude. When a place gets geocoded after creation,
-- its address record stays coord-less.
--
-- Fix: Unidirectional trigger (place → address, gap-fill only).
-- Industry pattern: place geometry is authoritative, address lat/lng is derived.
-- Never overwrite manually-set coords. One direction prevents infinite loops.

CREATE OR REPLACE FUNCTION sot.sync_place_coords_to_address()
RETURNS TRIGGER AS $$
BEGIN
  -- Only propagate if place has geometry and a linked address
  IF NEW.location IS NOT NULL AND COALESCE(NEW.sot_address_id, NEW.address_id) IS NOT NULL THEN
    UPDATE sot.addresses SET
      latitude = ST_Y(NEW.location::geometry),
      longitude = ST_X(NEW.location::geometry),
      location = NEW.location,
      updated_at = NOW()
    WHERE address_id = COALESCE(NEW.sot_address_id, NEW.address_id)
      AND latitude IS NULL;  -- gap-fill only, never overwrite existing coords
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to avoid duplicate trigger
DROP TRIGGER IF EXISTS trg_sync_place_coords_to_address ON sot.places;

CREATE TRIGGER trg_sync_place_coords_to_address
  AFTER INSERT OR UPDATE OF location, sot_address_id, address_id
  ON sot.places
  FOR EACH ROW
  WHEN (NEW.location IS NOT NULL)
  EXECUTE FUNCTION sot.sync_place_coords_to_address();

COMMENT ON FUNCTION sot.sync_place_coords_to_address IS 'FFS-1251: Propagates place geometry to address lat/lng (gap-fill only, never overwrites). Unidirectional to prevent infinite loops.';
