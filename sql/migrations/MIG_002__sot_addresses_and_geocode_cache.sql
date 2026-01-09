-- MIG_002__sot_addresses_and_geocode_cache.sql
-- Creates the first SoT entity: canonical addresses with geocoding support
--
-- Tables created:
--   - trapper.sot_addresses (canonical address registry)
--   - trapper.geocode_cache (Google API response cache)
--   - trapper.address_review_queue (review queue for failed/uncertain geocodes)
--
-- APPLY MANUALLY:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_002__sot_addresses_and_geocode_cache.sql

\echo '============================================'
\echo 'MIG_002: SoT Addresses and Geocode Cache'
\echo '============================================'

-- ============================================
-- PART 1: Geocode Cache Table
-- Stores Google API responses to avoid redundant calls
-- ============================================
\echo ''
\echo 'Creating geocode_cache table...'

CREATE TABLE IF NOT EXISTS trapper.geocode_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Cache key: normalized address text (trimmed, collapsed whitespace, lowercase)
    normalized_address_text TEXT NOT NULL UNIQUE,

    -- Original input (before normalization)
    original_address_text TEXT NOT NULL,

    -- Google API response data
    google_place_id TEXT,
    formatted_address TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,

    -- Address components from Google
    components JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Expected keys: street_number, route, locality, admin_area_1, admin_area_2,
    --                postal_code, postal_code_suffix, country, neighborhood

    -- Quality indicators
    location_type TEXT,              -- ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE
    partial_match BOOLEAN DEFAULT FALSE,
    result_count INT DEFAULT 0,      -- Number of results returned

    -- Status
    geocode_status TEXT NOT NULL DEFAULT 'pending',
    -- Values: ok, partial, zero_results, failed, rate_limited, invalid_request

    -- Raw response (trimmed - just first result)
    raw_response JSONB,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_geocode_cache_status
    ON trapper.geocode_cache (geocode_status);

-- Index for place_id lookups
CREATE INDEX IF NOT EXISTS idx_geocode_cache_place_id
    ON trapper.geocode_cache (google_place_id)
    WHERE google_place_id IS NOT NULL;

COMMENT ON TABLE trapper.geocode_cache IS
'Cache of Google Geocoding API responses. Key is normalized_address_text (lowercase, trimmed).
Prevents redundant API calls and serves as audit trail for geocoding decisions.';

COMMENT ON COLUMN trapper.geocode_cache.location_type IS
'Google location type: ROOFTOP (best), RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE (worst)';

-- ============================================
-- PART 2: SoT Addresses Table
-- Canonical address registry
-- ============================================
\echo 'Creating sot_addresses table...'

CREATE TABLE IF NOT EXISTS trapper.sot_addresses (
    address_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Google identifiers
    google_place_id TEXT,
    formatted_address TEXT NOT NULL,

    -- Unit/apartment preservation (parsed from raw input)
    unit_raw TEXT,                   -- Original unit text: "#5", "Apt 3B", "Unit 12"
    unit_normalized TEXT,            -- Normalized: "5", "3B", "12"

    -- Coordinates
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    location GEOMETRY(Point, 4326),  -- PostGIS point for spatial queries

    -- Parsed components from Google
    street_number TEXT,
    route TEXT,                      -- Street name
    locality TEXT,                   -- City
    admin_area_1 TEXT,               -- State
    admin_area_2 TEXT,               -- County
    postal_code TEXT,
    postal_code_suffix TEXT,
    country TEXT DEFAULT 'US',
    neighborhood TEXT,

    -- Full components JSONB (for any extra fields)
    components JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Quality/status
    geocode_status TEXT NOT NULL DEFAULT 'pending',
    -- Values: ok, partial, failed, needs_review, manual_override
    location_type TEXT,
    confidence_score NUMERIC(3,2),   -- 0.00 to 1.00

    -- Source tracking
    geocode_cache_id UUID REFERENCES trapper.geocode_cache(id),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint on formatted_address + unit
CREATE UNIQUE INDEX IF NOT EXISTS idx_sot_addresses_unique_addr_unit
    ON trapper.sot_addresses (formatted_address, COALESCE(unit_normalized, ''));

-- Spatial index for PostGIS queries
CREATE INDEX IF NOT EXISTS idx_sot_addresses_location_gist
    ON trapper.sot_addresses USING GIST (location);

-- Index for common lookups
CREATE INDEX IF NOT EXISTS idx_sot_addresses_place_id
    ON trapper.sot_addresses (google_place_id)
    WHERE google_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sot_addresses_status
    ON trapper.sot_addresses (geocode_status);

CREATE INDEX IF NOT EXISTS idx_sot_addresses_postal_code
    ON trapper.sot_addresses (postal_code)
    WHERE postal_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sot_addresses_locality
    ON trapper.sot_addresses (locality)
    WHERE locality IS NOT NULL;

-- Trigger to auto-update location geometry from lat/lng
CREATE OR REPLACE FUNCTION trapper.update_address_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
        NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_address_location ON trapper.sot_addresses;
CREATE TRIGGER trg_update_address_location
    BEFORE INSERT OR UPDATE ON trapper.sot_addresses
    FOR EACH ROW
    EXECUTE FUNCTION trapper.update_address_location();

COMMENT ON TABLE trapper.sot_addresses IS
'Canonical address registry (Source of Truth). Each row is a unique geocoded address.
Unit/apt preserved separately for addresses like "123 Main St #5" vs "123 Main St #6".';

-- ============================================
-- PART 3: Address Review Queue
-- For failed/uncertain geocodes requiring human review
-- ============================================
\echo 'Creating address_review_queue table...'

CREATE TABLE IF NOT EXISTS trapper.address_review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source reference (back to staged_records)
    staged_record_id UUID NOT NULL,
    source_row_id TEXT,              -- Original Airtable record ID

    -- Input data
    address_raw TEXT NOT NULL,       -- Original address text
    address_role TEXT DEFAULT 'primary',  -- primary, secondary, alternate

    -- Review status
    reason TEXT NOT NULL,            -- zero_results, partial_match, low_confidence, ambiguous, invalid_format
    reason_details TEXT,             -- Additional context

    -- Suggested fixes (optional)
    suggested_formatted TEXT,
    suggested_lat DOUBLE PRECISION,
    suggested_lng DOUBLE PRECISION,

    -- Resolution
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolution TEXT,                 -- accepted, rejected, manual_entry, merged
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolved_address_id UUID REFERENCES trapper.sot_addresses(address_id),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Prevent duplicate queue entries for same source
    UNIQUE (staged_record_id, address_role)
);

CREATE INDEX IF NOT EXISTS idx_address_review_queue_unresolved
    ON trapper.address_review_queue (reason, created_at)
    WHERE NOT is_resolved;

CREATE INDEX IF NOT EXISTS idx_address_review_queue_staged_record
    ON trapper.address_review_queue (staged_record_id);

COMMENT ON TABLE trapper.address_review_queue IS
'Review queue for addresses that failed geocoding or need human verification.
Linked to staged_records for traceability. Resolution creates/links to sot_addresses.';

-- ============================================
-- PART 4: Link Table - Staged Record to Address
-- Tracks which staged records have been processed to addresses
-- ============================================
\echo 'Creating staged_record_address_link table...'

CREATE TABLE IF NOT EXISTS trapper.staged_record_address_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    staged_record_id UUID NOT NULL,
    address_id UUID NOT NULL REFERENCES trapper.sot_addresses(address_id),

    -- Role this address plays for the record
    address_role TEXT NOT NULL DEFAULT 'primary',  -- primary, secondary, alternate

    -- Match confidence
    confidence_score NUMERIC(3,2) DEFAULT 1.0,
    match_method TEXT,               -- exact, geocoded, manual, fuzzy

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One address per role per staged record
    UNIQUE (staged_record_id, address_role)
);

CREATE INDEX IF NOT EXISTS idx_staged_record_address_link_staged
    ON trapper.staged_record_address_link (staged_record_id);

CREATE INDEX IF NOT EXISTS idx_staged_record_address_link_address
    ON trapper.staged_record_address_link (address_id);

COMMENT ON TABLE trapper.staged_record_address_link IS
'Links staged_records to their resolved sot_addresses. Tracks processing state.';

-- ============================================
-- PART 5: Candidate Extraction View
-- Extracts address candidates from staged trapping requests
-- ============================================
\echo 'Creating v_candidate_addresses_from_trapping_requests view...'

CREATE OR REPLACE VIEW trapper.v_candidate_addresses_from_trapping_requests AS
WITH address_fields AS (
    SELECT
        sr.id AS staged_record_id,
        sr.source_row_id,
        sr.created_at,
        -- Try multiple possible address field names (case-insensitive via payload keys)
        -- Priority: "Address" > "Street Address" > "Cats Address" > "Location"
        COALESCE(
            sr.payload->>'Address',
            sr.payload->>'address',
            sr.payload->>'Street Address',
            sr.payload->>'street_address',
            sr.payload->>'Cats Address',
            sr.payload->>'cats_address',
            sr.payload->>'Trapping Address',
            sr.payload->>'trapping_address',
            sr.payload->>'Location Address',
            sr.payload->>'location_address'
        ) AS primary_address,
        -- Secondary address field (e.g., requester address vs cats address)
        COALESCE(
            sr.payload->>'Requester Address',
            sr.payload->>'requester_address',
            sr.payload->>'Mailing Address',
            sr.payload->>'mailing_address'
        ) AS secondary_address,
        -- City for address augmentation
        COALESCE(
            sr.payload->>'City',
            sr.payload->>'city',
            sr.payload->>'Cats City',
            sr.payload->>'cats_city'
        ) AS city,
        -- State
        COALESCE(
            sr.payload->>'State',
            sr.payload->>'state'
        ) AS state,
        -- Zip
        COALESCE(
            sr.payload->>'Zip',
            sr.payload->>'zip',
            sr.payload->>'ZIP',
            sr.payload->>'Postal Code',
            sr.payload->>'postal_code'
        ) AS zip
    FROM trapper.staged_records sr
    WHERE sr.source_table = 'trapping_requests'
      AND NOT sr.is_processed
)
-- Primary addresses
SELECT
    af.staged_record_id,
    af.source_row_id,
    -- Build full address string
    TRIM(
        COALESCE(af.primary_address, '') ||
        CASE WHEN af.city IS NOT NULL AND af.primary_address NOT ILIKE '%' || af.city || '%'
             THEN ', ' || af.city
             ELSE '' END ||
        CASE WHEN af.state IS NOT NULL AND af.primary_address NOT ILIKE '%' || af.state || '%'
             THEN ', ' || af.state
             ELSE '' END ||
        CASE WHEN af.zip IS NOT NULL AND af.primary_address NOT ILIKE '%' || af.zip || '%'
             THEN ' ' || af.zip
             ELSE '' END
    ) AS address_raw,
    'primary'::TEXT AS address_role,
    af.created_at
FROM address_fields af
WHERE af.primary_address IS NOT NULL
  AND TRIM(af.primary_address) != ''
  -- Exclude already processed
  AND NOT EXISTS (
      SELECT 1 FROM trapper.staged_record_address_link sral
      WHERE sral.staged_record_id = af.staged_record_id
        AND sral.address_role = 'primary'
  )
  -- Exclude already in review queue
  AND NOT EXISTS (
      SELECT 1 FROM trapper.address_review_queue arq
      WHERE arq.staged_record_id = af.staged_record_id
        AND arq.address_role = 'primary'
  )

UNION ALL

-- Secondary addresses (if different from primary)
SELECT
    af.staged_record_id,
    af.source_row_id,
    TRIM(
        COALESCE(af.secondary_address, '') ||
        CASE WHEN af.city IS NOT NULL AND af.secondary_address NOT ILIKE '%' || af.city || '%'
             THEN ', ' || af.city
             ELSE '' END ||
        CASE WHEN af.state IS NOT NULL AND af.secondary_address NOT ILIKE '%' || af.state || '%'
             THEN ', ' || af.state
             ELSE '' END ||
        CASE WHEN af.zip IS NOT NULL AND af.secondary_address NOT ILIKE '%' || af.zip || '%'
             THEN ' ' || af.zip
             ELSE '' END
    ) AS address_raw,
    'secondary'::TEXT AS address_role,
    af.created_at
FROM address_fields af
WHERE af.secondary_address IS NOT NULL
  AND TRIM(af.secondary_address) != ''
  AND af.secondary_address != af.primary_address  -- Don't duplicate
  AND NOT EXISTS (
      SELECT 1 FROM trapper.staged_record_address_link sral
      WHERE sral.staged_record_id = af.staged_record_id
        AND sral.address_role = 'secondary'
  )
  AND NOT EXISTS (
      SELECT 1 FROM trapper.address_review_queue arq
      WHERE arq.staged_record_id = af.staged_record_id
        AND arq.address_role = 'secondary'
  );

COMMENT ON VIEW trapper.v_candidate_addresses_from_trapping_requests IS
'Extracts unprocessed address candidates from staged trapping requests.
Excludes records already linked to sot_addresses or in review queue.
Use for batch geocoding input.';

-- ============================================
-- PART 6: Stats View
-- Quick overview of geocoding pipeline status
-- ============================================
\echo 'Creating v_geocode_pipeline_stats view...'

CREATE OR REPLACE VIEW trapper.v_geocode_pipeline_stats AS
SELECT
    'staged_trapping_requests' AS stage,
    (SELECT COUNT(*) FROM trapper.staged_records WHERE source_table = 'trapping_requests') AS total,
    (SELECT COUNT(*) FROM trapper.staged_records WHERE source_table = 'trapping_requests' AND is_processed) AS processed
UNION ALL
SELECT
    'candidate_addresses',
    (SELECT COUNT(*) FROM trapper.v_candidate_addresses_from_trapping_requests),
    0
UNION ALL
SELECT
    'geocode_cache',
    (SELECT COUNT(*) FROM trapper.geocode_cache),
    (SELECT COUNT(*) FROM trapper.geocode_cache WHERE geocode_status = 'ok')
UNION ALL
SELECT
    'sot_addresses',
    (SELECT COUNT(*) FROM trapper.sot_addresses),
    (SELECT COUNT(*) FROM trapper.sot_addresses WHERE geocode_status = 'ok')
UNION ALL
SELECT
    'review_queue',
    (SELECT COUNT(*) FROM trapper.address_review_queue),
    (SELECT COUNT(*) FROM trapper.address_review_queue WHERE is_resolved);

COMMENT ON VIEW trapper.v_geocode_pipeline_stats IS
'Quick stats for geocoding pipeline progress.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_002 Complete - Verification:'
\echo '============================================'

\echo ''
\echo 'Tables created:'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('geocode_cache', 'sot_addresses', 'address_review_queue', 'staged_record_address_link')
ORDER BY table_name;

\echo ''
\echo 'Views created:'
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name LIKE 'v_%address%' OR table_name LIKE 'v_geocode%'
ORDER BY table_name;

\echo ''
\echo 'Triggers created:'
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'trapper'
  AND trigger_name LIKE '%address%';

\echo ''
\echo 'Pipeline stats:'
SELECT * FROM trapper.v_geocode_pipeline_stats;

\echo ''
\echo 'Next steps:'
\echo '  1. Run address field discovery: psql "$DATABASE_URL" -f sql/queries/QRY_001__discover_address_fields.sql'
\echo '  2. Geocode candidates: node scripts/normalize/geocode_candidates.mjs --limit 25'
\echo '  3. Check review queue: SELECT * FROM trapper.address_review_queue WHERE NOT is_resolved;'
\echo ''
