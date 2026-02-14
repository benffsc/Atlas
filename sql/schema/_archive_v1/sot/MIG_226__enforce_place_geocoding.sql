-- MIG_226: Enforce Place Geocoding
--
-- Problem:
--   MIG_056 created places without geocoding, violating the design principle
--   that places (addresses) should always have coordinates.
--
-- Solution:
--   1. Add trigger that validates places have location before request linking
--   2. Add function to queue places for background geocoding
--   3. Update geocode_status when location is set
--
-- Design Principles (from user):
--   - Places = addresses, always geocoded
--   - People = real people only
--   - Cats = always linked to places via relationships
--   - Requests = always linked to a place (with coordinates)

\echo ''
\echo '=============================================='
\echo 'MIG_226: Enforce Place Geocoding'
\echo '=============================================='
\echo ''

-- ============================================
-- PART 1: Function to check if place is geocoded
-- ============================================

CREATE OR REPLACE FUNCTION trapper.place_has_location(p_place_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM trapper.places
    WHERE place_id = p_place_id
      AND location IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.place_has_location IS
'Returns true if the place has geocoded coordinates (location IS NOT NULL).
Used to enforce that requests should link to geocoded places.';

-- ============================================
-- PART 2: Trigger to validate request->place link
-- ============================================

CREATE OR REPLACE FUNCTION trapper.validate_request_place_link()
RETURNS TRIGGER AS $$
DECLARE
  v_has_location BOOLEAN;
  v_formatted_address TEXT;
BEGIN
  -- Only check if place_id is being set or changed
  IF NEW.place_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip check if place_id unchanged on UPDATE
  IF TG_OP = 'UPDATE' AND OLD.place_id = NEW.place_id THEN
    RETURN NEW;
  END IF;

  -- Check if place has coordinates
  SELECT
    location IS NOT NULL,
    formatted_address
  INTO v_has_location, v_formatted_address
  FROM trapper.places
  WHERE place_id = NEW.place_id;

  -- Warn but don't block (soft enforcement for now)
  -- This logs a warning but allows the request to be created
  IF NOT v_has_location THEN
    RAISE WARNING 'Request % linked to place % which has no coordinates. Address: %',
      NEW.request_id, NEW.place_id, v_formatted_address;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on sot_requests
DROP TRIGGER IF EXISTS trg_validate_request_place_link ON trapper.sot_requests;
CREATE TRIGGER trg_validate_request_place_link
  BEFORE INSERT OR UPDATE OF place_id ON trapper.sot_requests
  FOR EACH ROW
  EXECUTE FUNCTION trapper.validate_request_place_link();

COMMENT ON FUNCTION trapper.validate_request_place_link IS
'Trigger function that validates requests link to geocoded places.
Currently logs a warning; can be upgraded to RAISE EXCEPTION for hard enforcement.';

-- ============================================
-- PART 3: Auto-update geocode_status when location is set
-- ============================================

CREATE OR REPLACE FUNCTION trapper.update_geocode_status_on_location()
RETURNS TRIGGER AS $$
BEGIN
  -- If location is being set and was previously NULL
  IF NEW.location IS NOT NULL AND OLD.location IS NULL THEN
    -- Update the linked sot_address if it exists
    IF NEW.sot_address_id IS NOT NULL THEN
      UPDATE trapper.sot_addresses
      SET geocode_status = 'ok'
      WHERE address_id = NEW.sot_address_id
        AND geocode_status = 'pending';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_geocode_status ON trapper.places;
CREATE TRIGGER trg_update_geocode_status
  AFTER UPDATE OF location ON trapper.places
  FOR EACH ROW
  EXECUTE FUNCTION trapper.update_geocode_status_on_location();

-- ============================================
-- PART 4: View to show places needing geocoding
-- ============================================

CREATE OR REPLACE VIEW trapper.v_places_pending_geocode AS
SELECT
  p.place_id,
  p.display_name,
  p.formatted_address,
  p.created_at,
  sa.geocode_status,
  -- Priority: places linked to active requests should be geocoded first
  EXISTS (
    SELECT 1 FROM trapper.sot_requests r
    WHERE r.place_id = p.place_id
      AND r.status NOT IN ('completed', 'cancelled')
  ) AS has_active_request,
  (
    SELECT COUNT(*) FROM trapper.sot_requests r
    WHERE r.place_id = p.place_id
  ) AS request_count
FROM trapper.places p
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
WHERE p.location IS NULL
  AND p.formatted_address IS NOT NULL
  AND p.formatted_address != ''
ORDER BY
  -- Prioritize places with active requests
  EXISTS (
    SELECT 1 FROM trapper.sot_requests r
    WHERE r.place_id = p.place_id
      AND r.status NOT IN ('completed', 'cancelled')
  ) DESC,
  p.created_at DESC;

COMMENT ON VIEW trapper.v_places_pending_geocode IS
'Places that have addresses but no coordinates. Used to identify and prioritize
places needing geocoding. Places with active requests are prioritized.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Verification:'

SELECT
  (SELECT COUNT(*) FROM trapper.places WHERE location IS NOT NULL) as geocoded_places,
  (SELECT COUNT(*) FROM trapper.places WHERE location IS NULL AND formatted_address IS NOT NULL) as pending_places,
  (SELECT COUNT(*) FROM trapper.v_places_pending_geocode WHERE has_active_request) as pending_with_active_requests;

\echo ''
\echo 'MIG_226 complete!'
\echo ''
\echo 'New features:'
\echo '  - trapper.place_has_location(place_id): Check if place is geocoded'
\echo '  - trg_validate_request_place_link: Warns when request links to un-geocoded place'
\echo '  - trg_update_geocode_status: Auto-updates geocode_status when location is set'
\echo '  - v_places_pending_geocode: View of places needing geocoding'
\echo ''
\echo 'To enforce hard blocking (future), change RAISE WARNING to RAISE EXCEPTION'
\echo 'in trapper.validate_request_place_link()'
\echo ''
