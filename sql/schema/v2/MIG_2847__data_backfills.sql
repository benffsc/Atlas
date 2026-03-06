-- MIG_2847: Data backfills for audit findings
--
-- 1. Backfill sot_address_id for 526 places with formatted_address but no address link (FFS-238)
-- 2. Cancel test requests (FFS-243)
-- 3. Backfill colony estimates for places with cats but no estimate (FFS-244)
--
-- MUST run after MIG_2844 (merge integrity) and MIG_2846 (dedup performance)

BEGIN;

-- =============================================================================
-- 1. Backfill sot_address_id for places missing address links
-- =============================================================================

-- Step 1: Match places to existing addresses by formatted_address
UPDATE sot.places p
SET sot_address_id = a.address_id, updated_at = NOW()
FROM sot.addresses a
WHERE p.sot_address_id IS NULL
  AND p.formatted_address IS NOT NULL
  AND a.formatted_address = p.formatted_address
  AND a.merged_into_address_id IS NULL
  AND p.merged_into_place_id IS NULL;

-- Step 2: For remaining places with formatted_address but no matching address,
-- create addresses via find_or_create_address()
DO $$
DECLARE
    r RECORD;
    v_address_id UUID;
BEGIN
    FOR r IN
        SELECT place_id, formatted_address, display_name,
               ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
        FROM sot.places
        WHERE sot_address_id IS NULL
          AND formatted_address IS NOT NULL
          AND merged_into_place_id IS NULL
    LOOP
        v_address_id := sot.find_or_create_address(
            r.formatted_address, -- p_raw_input
            r.formatted_address, -- p_formatted_address
            r.lat,               -- p_lat
            r.lng,               -- p_lng
            'atlas_backfill'     -- p_source_system
        );

        IF v_address_id IS NOT NULL THEN
            UPDATE sot.places
            SET sot_address_id = v_address_id, updated_at = NOW()
            WHERE place_id = r.place_id;
        END IF;
    END LOOP;
END $$;

-- =============================================================================
-- 2. Cancel test requests
-- =============================================================================

UPDATE ops.requests
SET request_status = 'cancelled',
    resolved_at = NOW(),
    updated_at = NOW()
WHERE source_system = 'test'
  AND request_status NOT IN ('cancelled', 'completed')
  AND merged_into_request_id IS NULL;

-- =============================================================================
-- 3. Backfill colony estimates for places with cats but no estimate
-- =============================================================================

INSERT INTO sot.place_colony_estimates (
    place_id, estimated_count, estimation_method, source_system, confidence
)
SELECT
    cp.place_id,
    COUNT(DISTINCT cp.cat_id),
    'cat_count',
    'atlas_backfill',
    0.5
FROM sot.cat_place cp
JOIN sot.places p ON p.place_id = cp.place_id AND p.merged_into_place_id IS NULL
JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
LEFT JOIN sot.place_colony_estimates pce ON pce.place_id = cp.place_id
WHERE pce.place_id IS NULL
GROUP BY cp.place_id
HAVING COUNT(DISTINCT cp.cat_id) >= 1
ON CONFLICT (place_id) DO NOTHING;

COMMIT;
