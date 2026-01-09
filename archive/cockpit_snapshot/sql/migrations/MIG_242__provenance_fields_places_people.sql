-- MIG_242__provenance_fields_places_people.sql
-- Add provenance and confidence tracking to places and people
-- Part of UI_ARCH_235: Fluid request creation with suggestions
-- SAFE: Additive only, no destructive operations

-- ============================================================
-- PART 1: Add provenance columns to places
-- ============================================================

-- provenance_kind: confirmed (Cockpit UI, verified) vs inferred (ClinicHQ, auto-created)
ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS provenance_kind TEXT NOT NULL DEFAULT 'confirmed'
CHECK (provenance_kind IN ('confirmed', 'inferred', 'semi_confirmed'));

-- provenance_source: where this record came from
ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS provenance_source TEXT NULL
CHECK (provenance_source IN ('cockpit_ui', 'airtable', 'clinichq', 'import', 'manual', 'migration'));

-- confidence_score: 0-100, higher = more trusted
-- Cockpit UI: 100, Airtable: 80-95, ClinicHQ: 30-60
ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS confidence_score SMALLINT NULL
CHECK (confidence_score >= 0 AND confidence_score <= 100);

-- When was this place confirmed (manually verified)?
ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ NULL;

-- Who confirmed it?
ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS confirmed_by TEXT NULL;

-- Place type for categorization (optional)
ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS place_type TEXT NULL
CHECK (place_type IN ('residential', 'business', 'colony_site', 'trail', 'park', 'complex', 'farm', 'unknown'));

-- Is this place currently active (has active requests)?
ALTER TABLE trapper.places
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN trapper.places.provenance_kind IS
'Source reliability: confirmed (Cockpit UI verified), semi_confirmed (Airtable), inferred (ClinicHQ auto-created)';

COMMENT ON COLUMN trapper.places.provenance_source IS
'System that created this record: cockpit_ui, airtable, clinichq, import, manual, migration';

COMMENT ON COLUMN trapper.places.confidence_score IS
'Trust score 0-100. Cockpit UI: 100, Airtable: 80-95, ClinicHQ inferred: 30-60';

-- ============================================================
-- PART 2: Add provenance columns to people
-- ============================================================

ALTER TABLE trapper.people
ADD COLUMN IF NOT EXISTS provenance_kind TEXT NOT NULL DEFAULT 'confirmed'
CHECK (provenance_kind IN ('confirmed', 'inferred', 'semi_confirmed'));

ALTER TABLE trapper.people
ADD COLUMN IF NOT EXISTS provenance_source TEXT NULL
CHECK (provenance_source IN ('cockpit_ui', 'airtable', 'clinichq', 'import', 'manual', 'migration'));

ALTER TABLE trapper.people
ADD COLUMN IF NOT EXISTS confidence_score SMALLINT NULL
CHECK (confidence_score >= 0 AND confidence_score <= 100);

ALTER TABLE trapper.people
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ NULL;

ALTER TABLE trapper.people
ADD COLUMN IF NOT EXISTS confirmed_by TEXT NULL;

COMMENT ON COLUMN trapper.people.provenance_kind IS
'Source reliability: confirmed (Cockpit UI verified), semi_confirmed (Airtable), inferred (ClinicHQ auto-created)';

COMMENT ON COLUMN trapper.people.provenance_source IS
'System that created this record: cockpit_ui, airtable, clinichq, import, manual, migration';

COMMENT ON COLUMN trapper.people.confidence_score IS
'Trust score 0-100. Cockpit UI: 100, Airtable: 80-95, ClinicHQ inferred: 30-60';

-- ============================================================
-- PART 3: Add provenance columns to addresses (for completeness)
-- ============================================================

ALTER TABLE trapper.addresses
ADD COLUMN IF NOT EXISTS provenance_kind TEXT NOT NULL DEFAULT 'confirmed'
CHECK (provenance_kind IN ('confirmed', 'inferred', 'semi_confirmed'));

ALTER TABLE trapper.addresses
ADD COLUMN IF NOT EXISTS provenance_source TEXT NULL
CHECK (provenance_source IN ('cockpit_ui', 'airtable', 'clinichq', 'google', 'import', 'manual', 'migration'));

ALTER TABLE trapper.addresses
ADD COLUMN IF NOT EXISTS confidence_score SMALLINT NULL
CHECK (confidence_score >= 0 AND confidence_score <= 100);

-- ============================================================
-- PART 4: Create v_address_context view for suggestions
-- Returns context for a given address: places, people, requests
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_address_context AS
WITH address_places AS (
    -- Places at this address, ranked by provenance and activity
    SELECT
        p.id AS place_id,
        p.name AS place_name,
        p.display_name AS place_display_name,
        p.place_type,
        p.provenance_kind,
        p.provenance_source,
        p.confidence_score,
        p.is_active,
        p.address_id,
        a.formatted_address AS address_display,
        a.location,
        -- Count active requests at this place
        (SELECT COUNT(*) FROM trapper.requests r
         WHERE r.primary_place_id = p.id
         AND r.status NOT IN ('closed', 'resolved')) AS active_request_count,
        -- Ranking: confirmed + active first, then by confidence
        CASE
            WHEN p.provenance_kind = 'confirmed' AND p.is_active THEN 1
            WHEN p.provenance_kind = 'confirmed' THEN 2
            WHEN p.provenance_kind = 'semi_confirmed' AND p.is_active THEN 3
            WHEN p.provenance_kind = 'semi_confirmed' THEN 4
            ELSE 5
        END AS rank_order
    FROM trapper.places p
    LEFT JOIN trapper.addresses a ON a.id = p.address_id
    WHERE p.address_id IS NOT NULL
),
address_people AS (
    -- People linked to requests at addresses via request_parties
    SELECT DISTINCT
        per.id AS person_id,
        per.display_name AS person_name,
        per.phone,
        per.email,
        per.provenance_kind,
        per.provenance_source,
        per.confidence_score,
        rp.role,
        pl.address_id,
        CASE
            WHEN per.provenance_kind = 'confirmed' THEN 1
            WHEN per.provenance_kind = 'semi_confirmed' THEN 2
            ELSE 3
        END AS rank_order
    FROM trapper.request_parties rp
    JOIN trapper.people per ON per.id = rp.person_id
    JOIN trapper.requests req ON req.id = rp.request_id
    JOIN trapper.places pl ON pl.id = req.primary_place_id
    WHERE pl.address_id IS NOT NULL
),
recent_requests AS (
    -- Recent requests at addresses
    SELECT
        r.id AS request_id,
        r.case_number,
        r.status,
        r.created_at,
        r.summary,
        pl.address_id,
        CASE
            WHEN r.status IN ('active', 'in_progress') THEN 1
            WHEN r.status = 'needs_review' THEN 2
            WHEN r.status = 'paused' THEN 3
            ELSE 4
        END AS rank_order
    FROM trapper.requests r
    JOIN trapper.places pl ON pl.id = r.primary_place_id
    WHERE pl.address_id IS NOT NULL
    AND r.created_at > NOW() - INTERVAL '1 year'
)
-- Return all context elements with their address_id for filtering
SELECT
    'place' AS context_type,
    ap.address_id::text,
    ap.place_id::text AS entity_id,
    ap.place_display_name AS entity_name,
    ap.place_type AS entity_subtype,
    ap.provenance_kind,
    ap.provenance_source,
    ap.confidence_score,
    ap.is_active AS is_active,
    ap.active_request_count::int AS related_count,
    ap.rank_order,
    ap.address_display,
    NULL::text AS extra_info
FROM address_places ap

UNION ALL

SELECT
    'person' AS context_type,
    appl.address_id::text,
    appl.person_id::text AS entity_id,
    appl.person_name AS entity_name,
    appl.role AS entity_subtype,
    appl.provenance_kind,
    appl.provenance_source,
    appl.confidence_score,
    TRUE AS is_active,
    NULL AS related_count,
    appl.rank_order,
    NULL AS address_display,
    COALESCE(appl.phone, appl.email) AS extra_info
FROM address_people appl

UNION ALL

SELECT
    'request' AS context_type,
    rr.address_id::text,
    rr.request_id::text AS entity_id,
    rr.case_number AS entity_name,
    rr.status AS entity_subtype,
    'confirmed' AS provenance_kind,
    NULL AS provenance_source,
    100 AS confidence_score,
    rr.status IN ('active', 'in_progress', 'needs_review') AS is_active,
    NULL AS related_count,
    rr.rank_order,
    NULL AS address_display,
    rr.summary AS extra_info
FROM recent_requests rr;

COMMENT ON VIEW trapper.v_address_context IS
'Context for address-based suggestions: places, people, and recent requests at an address.
Use: SELECT * FROM trapper.v_address_context WHERE address_id = $1 ORDER BY rank_order, confidence_score DESC';

-- ============================================================
-- PART 5: Index for address context lookups
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_places_address_id ON trapper.places(address_id)
WHERE address_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_places_provenance ON trapper.places(provenance_kind, is_active);

CREATE INDEX IF NOT EXISTS idx_people_provenance ON trapper.people(provenance_kind);

-- ============================================================
-- PART 6: Set defaults for existing records
-- Existing Airtable-derived records get semi_confirmed, confidence 85
-- ============================================================

UPDATE trapper.places
SET provenance_kind = 'semi_confirmed',
    provenance_source = 'airtable',
    confidence_score = 85
WHERE provenance_source IS NULL
AND legacy_source IS NOT NULL;

UPDATE trapper.people
SET provenance_kind = 'semi_confirmed',
    provenance_source = 'airtable',
    confidence_score = 85
WHERE provenance_source IS NULL;

UPDATE trapper.addresses
SET provenance_kind = 'semi_confirmed',
    provenance_source = 'airtable',
    confidence_score = 85
WHERE provenance_source IS NULL
AND source_system = 'airtable';

-- ============================================================
-- Verification
-- ============================================================

\echo ''
\echo 'MIG_242 applied. Verifying provenance fields:'
\echo ''

\echo 'Places provenance distribution:'
SELECT provenance_kind, provenance_source, COUNT(*)
FROM trapper.places
GROUP BY provenance_kind, provenance_source
ORDER BY COUNT(*) DESC;

\echo ''
\echo 'People provenance distribution:'
SELECT provenance_kind, provenance_source, COUNT(*)
FROM trapper.people
GROUP BY provenance_kind, provenance_source
ORDER BY COUNT(*) DESC;

\echo ''
\echo 'v_address_context sample (first address with places):'
SELECT context_type, entity_name, provenance_kind, confidence_score, is_active
FROM trapper.v_address_context
LIMIT 10;
