-- MIG_147__person_primary_address.sql
-- Add primary address field to sot_people
--
-- Problem:
--   People don't have an easily editable address on their profile.
--   Staff need to see/update where a person lives.
--
-- Solution:
--   Add primary_address_id linking to sot_addresses.
--   Update API to support address changes via Google Places autocomplete.
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_147__person_primary_address.sql

-- ============================================================
-- 1. Add primary_address_id to sot_people
-- ============================================================

\echo ''
\echo 'Adding primary_address_id to sot_people...'

ALTER TABLE trapper.sot_people
ADD COLUMN IF NOT EXISTS primary_address_id UUID REFERENCES trapper.sot_addresses(address_id);

CREATE INDEX IF NOT EXISTS idx_sot_people_primary_address
ON trapper.sot_people(primary_address_id)
WHERE primary_address_id IS NOT NULL;

COMMENT ON COLUMN trapper.sot_people.primary_address_id IS
'Link to the person''s current primary address in sot_addresses. Updated via Google autocomplete.';

-- ============================================================
-- 2. Create helper function to upsert address from Google Place
-- ============================================================

\echo 'Creating upsert_address_from_google_place function...'

CREATE OR REPLACE FUNCTION trapper.upsert_address_from_google_place(
    p_google_place_id TEXT,
    p_formatted_address TEXT,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_street_number TEXT DEFAULT NULL,
    p_route TEXT DEFAULT NULL,
    p_locality TEXT DEFAULT NULL,
    p_admin_area_1 TEXT DEFAULT NULL,
    p_admin_area_2 TEXT DEFAULT NULL,
    p_postal_code TEXT DEFAULT NULL,
    p_country TEXT DEFAULT 'US'
)
RETURNS UUID AS $$
DECLARE
    v_address_id UUID;
BEGIN
    -- Try to find existing address by google_place_id
    SELECT address_id INTO v_address_id
    FROM trapper.sot_addresses
    WHERE google_place_id = p_google_place_id
    LIMIT 1;

    IF v_address_id IS NOT NULL THEN
        -- Update last_seen_at
        UPDATE trapper.sot_addresses
        SET last_seen_at = NOW()
        WHERE address_id = v_address_id;
        RETURN v_address_id;
    END IF;

    -- Try to find by formatted_address (fallback)
    SELECT address_id INTO v_address_id
    FROM trapper.sot_addresses
    WHERE formatted_address = p_formatted_address
      AND COALESCE(unit_normalized, '') = ''
    LIMIT 1;

    IF v_address_id IS NOT NULL THEN
        -- Update with google_place_id if we didn't have it
        UPDATE trapper.sot_addresses
        SET
            google_place_id = COALESCE(google_place_id, p_google_place_id),
            lat = COALESCE(lat, p_lat),
            lng = COALESCE(lng, p_lng),
            last_seen_at = NOW()
        WHERE address_id = v_address_id;
        RETURN v_address_id;
    END IF;

    -- Insert new address
    INSERT INTO trapper.sot_addresses (
        google_place_id,
        formatted_address,
        lat,
        lng,
        street_number,
        route,
        locality,
        admin_area_1,
        admin_area_2,
        postal_code,
        country,
        geocode_status,
        location_type,
        confidence_score
    )
    VALUES (
        p_google_place_id,
        p_formatted_address,
        p_lat,
        p_lng,
        p_street_number,
        p_route,
        p_locality,
        p_admin_area_1,
        p_admin_area_2,
        p_postal_code,
        p_country,
        'ok',
        'ROOFTOP',  -- Google Places typically provides rooftop accuracy
        1.0
    )
    RETURNING address_id INTO v_address_id;

    RETURN v_address_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.upsert_address_from_google_place IS
'Upsert an address from Google Places data. Returns existing address_id if found, creates new if not.';

-- ============================================================
-- 3. Update v_person_detail to include primary address
-- ============================================================

\echo 'Checking if v_person_detail needs update...'

-- Note: The view update will be handled by the API returning address data
-- directly. We'll add the address info in the API response.

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo 'Column added:'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'trapper'
  AND table_name = 'sot_people'
  AND column_name = 'primary_address_id';

\echo ''
\echo 'Function created:'
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name = 'upsert_address_from_google_place';

SELECT 'MIG_147 Complete' AS status;
