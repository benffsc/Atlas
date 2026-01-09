-- MIG_264__place_rollup_complexes.sql
-- REL_013: Place rollup for multi-unit complexes (MHP, apartments, campuses)
--
-- SAFETY: This migration uses ONLY additive operations:
--   - ALTER TABLE ADD COLUMN
--   - CREATE TABLE IF NOT EXISTS
--   - CREATE INDEX IF NOT EXISTS
--   - CREATE OR REPLACE VIEW
--
-- NO DROP, NO TRUNCATE, NO DELETE.
--
-- Purpose:
--   - Add place_kind to distinguish complex places from normal addresses
--   - Create place_address_memberships for rollup relationships
--   - Create candidate detection view for auto-suggesting rollups
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_264__place_rollup_complexes.sql

BEGIN;

-- ============================================================
-- PART A: Add place_kind to places table
-- ============================================================

-- A1) Add place_kind column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'places'
        AND column_name = 'place_kind'
    ) THEN
        ALTER TABLE trapper.places
        ADD COLUMN place_kind TEXT
        CHECK (place_kind IN (
            'complex',       -- Multi-unit: MHP, apartment complex, condo complex
            'campus',        -- Institutional: hospital, university, corporate campus
            'shelter',       -- Animal shelter / rescue
            'business',      -- Business site (single address but trackable)
            'property',      -- Single property / house (default for normal addresses)
            'intersection',  -- Trail intersection, parking lot, corner
            'area'           -- Fuzzy area without exact address
        ));
    END IF;
END $$;

-- A2) Add rollup_radius_m for configurable matching radius
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'places'
        AND column_name = 'rollup_radius_m'
    ) THEN
        ALTER TABLE trapper.places
        ADD COLUMN rollup_radius_m INTEGER DEFAULT 200;
    END IF;
END $$;

-- A3) Add place_center for explicit center point (separate from primary address)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'places'
        AND column_name = 'place_center'
    ) THEN
        ALTER TABLE trapper.places
        ADD COLUMN place_center geography(Point, 4326);
    END IF;
END $$;

COMMENT ON COLUMN trapper.places.place_kind IS
'Type of place: complex (MHP/apartments), campus, shelter, business, property (default), intersection, area';

COMMENT ON COLUMN trapper.places.rollup_radius_m IS
'Radius in meters for address rollup matching. Only used for complex/campus/shelter kinds.';

COMMENT ON COLUMN trapper.places.place_center IS
'Explicit center point for rollup matching. Falls back to primary address location if NULL.';

-- ============================================================
-- PART B: Place-Address Memberships table
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.place_address_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The complex place
    place_id UUID NOT NULL REFERENCES trapper.places(id) ON DELETE CASCADE,

    -- The member address
    address_id UUID NOT NULL REFERENCES trapper.addresses(id) ON DELETE CASCADE,

    -- Match quality
    confidence TEXT NOT NULL DEFAULT 'high'
        CHECK (confidence IN ('high', 'medium', 'low')),
    distance_m INTEGER,  -- Distance from place center when added

    -- How was this membership created?
    source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'auto_accepted', 'migration', 'import')),

    -- Audit trail
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT DEFAULT 'system',
    notes TEXT,

    -- Prevent duplicates
    UNIQUE (place_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_place_address_memberships_place
ON trapper.place_address_memberships(place_id);

CREATE INDEX IF NOT EXISTS idx_place_address_memberships_address
ON trapper.place_address_memberships(address_id);

COMMENT ON TABLE trapper.place_address_memberships IS
'Maps addresses to complex places for rollup. E.g., multiple unit addresses → Valley Village MHP.';

-- ============================================================
-- PART C: Rollup candidate view (suggests new memberships)
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_place_rollup_candidates AS
WITH eligible_places AS (
    -- Only complex-type places can roll up addresses
    SELECT
        p.id AS place_id,
        p.name AS place_name,
        p.place_kind,
        p.rollup_radius_m,
        -- Use explicit center if set, otherwise fall back to address location
        COALESCE(
            p.place_center,
            a.location_geog
        ) AS center_geog
    FROM trapper.places p
    LEFT JOIN trapper.addresses a ON p.address_id = a.id
    WHERE p.place_kind IN ('complex', 'campus', 'shelter')
      AND p.is_active = true
      AND (p.place_center IS NOT NULL OR a.location_geog IS NOT NULL)
),
candidate_addresses AS (
    -- Addresses with geometry that aren't already members of a place
    SELECT
        a.id AS address_id,
        a.display_line AS address_display,
        a.location_geog,
        a.city,
        a.postal_code
    FROM trapper.addresses a
    WHERE a.location_geog IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM trapper.place_address_memberships pam
          WHERE pam.address_id = a.id
      )
)
SELECT
    ep.place_id,
    ep.place_name,
    ep.place_kind,
    ca.address_id,
    ca.address_display,
    ca.city,
    ca.postal_code,
    ROUND(ST_Distance(ep.center_geog, ca.location_geog))::integer AS distance_m,
    CASE
        WHEN ST_Distance(ep.center_geog, ca.location_geog) <= 100 THEN 'high'
        WHEN ST_Distance(ep.center_geog, ca.location_geog) <= 200 THEN 'medium'
        ELSE 'low'
    END AS suggested_confidence,
    ep.rollup_radius_m
FROM eligible_places ep
CROSS JOIN candidate_addresses ca
WHERE ST_DWithin(ep.center_geog, ca.location_geog, ep.rollup_radius_m)
ORDER BY ep.place_name, distance_m;

COMMENT ON VIEW trapper.v_place_rollup_candidates IS
'Suggests addresses that could be added to complex places based on distance. Only complex/campus/shelter places are eligible.';

-- ============================================================
-- PART D: View to resolve address → rollup place
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_address_to_rollup_place AS
SELECT
    a.id AS address_id,
    a.display_line AS address_display,
    p.id AS rollup_place_id,
    p.name AS rollup_place_name,
    p.place_kind,
    pam.confidence,
    pam.distance_m
FROM trapper.addresses a
JOIN trapper.place_address_memberships pam ON pam.address_id = a.id
JOIN trapper.places p ON p.id = pam.place_id
WHERE p.is_active = true;

COMMENT ON VIEW trapper.v_address_to_rollup_place IS
'Resolves an address to its parent rollup place (if any). Used for appointment → place attribution.';

-- ============================================================
-- PART E: Extend upcoming appointments current view with rollup
-- ============================================================

-- Note: We don't modify the existing view, just create a new extended one
CREATE OR REPLACE VIEW trapper.v_clinichq_upcoming_appointments_with_rollup AS
SELECT
    ua.id,
    ua.source_file,
    ua.source_system,
    ua.source_pk,
    ua.appt_date,
    ua.appt_number,
    ua.client_first_name,
    ua.client_last_name,
    ua.client_address,
    ua.client_cell_phone,
    ua.client_phone,
    ua.client_email,
    ua.client_type,
    ua.animal_name,
    ua.ownership_type,
    ua.is_current,
    ua.stale_at,
    ua.first_seen_at,
    ua.last_seen_at,
    -- Rollup place info (if address matches a complex place)
    rp.rollup_place_id,
    rp.rollup_place_name,
    rp.place_kind AS rollup_place_kind,
    rp.confidence AS rollup_confidence
FROM trapper.clinichq_upcoming_appointments ua
LEFT JOIN trapper.addresses a
    ON LOWER(TRIM(ua.client_address)) = LOWER(TRIM(a.raw_address))
    OR LOWER(TRIM(ua.client_address)) = LOWER(TRIM(a.display_line))
LEFT JOIN trapper.v_address_to_rollup_place rp
    ON rp.address_id = a.id
WHERE ua.is_current = true
  AND ua.appt_date >= (CURRENT_DATE - INTERVAL '1 day');

COMMENT ON VIEW trapper.v_clinichq_upcoming_appointments_with_rollup IS
'Current upcoming appointments with rollup place attribution. Shows which appointments belong to complex places like MHPs.';

COMMIT;
