-- MIG_2115: Sync Coordinates from sot.addresses to sot.places (V2 Native)
-- Date: 2026-02-14
--
-- Purpose: Derive place coordinates from V2 addresses (no V1 dependency)
--
-- Source: sot.addresses (already geocoded by geocoding cron)
-- Target: sot.places.location
--
-- Pipeline integration:
--   geocoding cron → sot.addresses (lat/lng) → MIG_2115 → sot.places.location

\echo ''
\echo '=============================================='
\echo '  MIG_2115: Sync Coords from Addresses (V2)'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. ONE-TIME BACKFILL: Places with addresses but no location
-- ============================================================================

\echo '1. Backfilling places without coordinates...'

DO $$
DECLARE
    v_updated INT;
BEGIN
    -- Update places that have a linked address with coordinates but no location
    UPDATE sot.places p
    SET location = a.location,
        updated_at = NOW()
    FROM sot.addresses a
    WHERE p.sot_address_id = a.address_id
      AND p.location IS NULL
      AND a.location IS NOT NULL
      AND p.merged_into_place_id IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE 'Updated % places with coordinates from sot.addresses', v_updated;
END $$;

-- ============================================================================
-- 2. TRIGGER: Auto-sync when addresses get geocoded
-- ============================================================================

\echo ''
\echo '2. Creating auto-sync trigger...'

CREATE OR REPLACE FUNCTION sot.sync_place_location_from_address()
RETURNS TRIGGER AS $$
BEGIN
    -- When an address gets geocoded, update linked places
    IF NEW.location IS NOT NULL AND (OLD.location IS NULL OR OLD.location != NEW.location) THEN
        UPDATE sot.places
        SET location = NEW.location,
            updated_at = NOW()
        WHERE sot_address_id = NEW.address_id
          AND location IS NULL;  -- Only fill if empty (don't overwrite manual)
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_place_location ON sot.addresses;

CREATE TRIGGER trg_sync_place_location
AFTER UPDATE OF location
ON sot.addresses
FOR EACH ROW
EXECUTE FUNCTION sot.sync_place_location_from_address();

\echo '   Created trigger sot.trg_sync_place_location'

-- ============================================================================
-- 3. ALSO: Sync places that have lat/lng but no geography location
-- ============================================================================

\echo ''
\echo '3. Syncing addresses with lat/lng but no geography...'

DO $$
DECLARE
    v_fixed INT;
BEGIN
    -- Fix addresses that have lat/lng but no geography location
    UPDATE sot.addresses
    SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
        updated_at = NOW()
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND location IS NULL;

    GET DIAGNOSTICS v_fixed = ROW_COUNT;
    RAISE NOTICE 'Fixed % addresses with lat/lng but no geography', v_fixed;
END $$;

-- ============================================================================
-- 4. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

DO $$
DECLARE
    v_places_total INT;
    v_places_with_loc INT;
    v_places_without_loc INT;
    v_places_with_addr_no_loc INT;
    v_addrs_with_loc INT;
BEGIN
    -- Count places
    SELECT COUNT(*) INTO v_places_total
    FROM sot.places WHERE merged_into_place_id IS NULL;

    SELECT COUNT(*) INTO v_places_with_loc
    FROM sot.places
    WHERE merged_into_place_id IS NULL AND location IS NOT NULL;

    SELECT COUNT(*) INTO v_places_without_loc
    FROM sot.places
    WHERE merged_into_place_id IS NULL AND location IS NULL;

    -- Places with addresses but still no location
    SELECT COUNT(*) INTO v_places_with_addr_no_loc
    FROM sot.places p
    JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE p.merged_into_place_id IS NULL
      AND p.location IS NULL
      AND a.location IS NOT NULL;

    -- Addresses with geocoding
    SELECT COUNT(*) INTO v_addrs_with_loc
    FROM sot.addresses WHERE location IS NOT NULL;

    RAISE NOTICE 'Places total: %', v_places_total;
    RAISE NOTICE 'Places with coords: % (%.1f%%)', v_places_with_loc,
        CASE WHEN v_places_total > 0 THEN v_places_with_loc * 100.0 / v_places_total ELSE 0 END;
    RAISE NOTICE 'Places without coords: %', v_places_without_loc;
    RAISE NOTICE 'Places with addr but no coords: % (should be 0)', v_places_with_addr_no_loc;
    RAISE NOTICE 'Addresses geocoded: %', v_addrs_with_loc;

    IF v_places_with_addr_no_loc > 0 THEN
        RAISE WARNING 'Some places have addresses with coords but no location - needs investigation';
    END IF;
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2115 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created:'
\echo '  - Backfilled places from sot.addresses'
\echo '  - sot.sync_place_location_from_address() trigger function'
\echo '  - sot.trg_sync_place_location trigger'
\echo ''
\echo 'Pipeline: geocoding cron → sot.addresses → trigger → sot.places'
\echo ''
