-- MIG_248__historical_only_markers.sql
-- MEGA_004 E1: Mark historical records that cannot/should not be canonicalized
--
-- Some historical data is too messy or ambiguous to safely map to canonical entities.
-- Rather than lose this data, we mark it as "historical-only" so it:
-- 1. Stays searchable (appears in search results)
-- 2. Never gets auto-linked to canonical people/places
-- 3. Preserves audit trail of why it wasn't linked
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_248__historical_only_markers.sql

-- ============================================================
-- TABLE: historical_only_markers
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.historical_only_markers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What source system and record this refers to
    source_system TEXT NOT NULL CHECK (source_system IN ('clinichq', 'jotform', 'airtable', 'other')),
    source_record_id TEXT NOT NULL,

    -- Entity type from original source
    entity_type TEXT NOT NULL CHECK (entity_type IN ('hist_owner', 'hist_cat', 'appt_request', 'other')),

    -- Why this can't be canonicalized
    reason TEXT NOT NULL CHECK (reason IN (
        'ambiguous_identity',        -- Multiple possible matches, can't safely pick one
        'data_quality_too_low',      -- Missing key fields (name, phone, etc.)
        'duplicate_in_history',      -- Same person appears multiple times in history
        'test_or_invalid',           -- Test record or clearly invalid data
        'refused_by_user',           -- Human reviewer decided not to link
        'other'                      -- See notes
    )),

    -- Human-readable explanation
    notes TEXT,

    -- Audit
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Uniqueness: one marker per source record
    UNIQUE (source_system, source_record_id)
);

COMMENT ON TABLE trapper.historical_only_markers IS
'Records from historical sources that have been explicitly marked as "never canonicalize".
These records remain searchable but will not be auto-linked to canonical people/places.
Preserves data while acknowledging its limitations.';

-- ============================================================
-- INDEX for quick lookups
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_hist_only_markers_source
    ON trapper.historical_only_markers (source_system, source_record_id);

CREATE INDEX IF NOT EXISTS idx_hist_only_markers_reason
    ON trapper.historical_only_markers (reason);

-- ============================================================
-- VIEW: v_historical_only_stats
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_historical_only_stats AS
SELECT
    source_system,
    entity_type,
    reason,
    COUNT(*) AS count
FROM trapper.historical_only_markers
GROUP BY source_system, entity_type, reason
ORDER BY source_system, entity_type, count DESC;

COMMENT ON VIEW trapper.v_historical_only_stats IS
'Statistics on why historical records were marked as non-canonicalizable.';

-- ============================================================
-- FUNCTION: mark_historical_only
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.mark_historical_only(
    p_source_system TEXT,
    p_source_record_id TEXT,
    p_entity_type TEXT,
    p_reason TEXT,
    p_notes TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_marker_id UUID;
BEGIN
    INSERT INTO trapper.historical_only_markers (
        source_system, source_record_id, entity_type, reason, notes, created_by
    )
    VALUES (
        p_source_system, p_source_record_id, p_entity_type, p_reason, p_notes, p_created_by
    )
    ON CONFLICT (source_system, source_record_id) DO UPDATE SET
        reason = EXCLUDED.reason,
        notes = EXCLUDED.notes,
        created_by = EXCLUDED.created_by,
        created_at = NOW()
    RETURNING id INTO v_marker_id;

    RETURN v_marker_id;
END;
$$;

COMMENT ON FUNCTION trapper.mark_historical_only IS
'Mark a historical record as "forever historical" (cannot be canonicalized).
Returns the marker ID. Updates existing marker if already exists.';

-- ============================================================
-- FUNCTION: is_historical_only
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.is_historical_only(
    p_source_system TEXT,
    p_source_record_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM trapper.historical_only_markers
        WHERE source_system = p_source_system
        AND source_record_id = p_source_record_id
    );
$$;

COMMENT ON FUNCTION trapper.is_historical_only IS
'Check if a historical record has been marked as non-canonicalizable.';

-- ============================================================
-- UPDATE v_people_unlinked_sources to exclude marked records
-- ============================================================

-- Add historical_only flag to unlinked sources view
CREATE OR REPLACE VIEW trapper.v_people_unlinked_sources AS
WITH clinichq_owners_agg AS (
    -- Aggregate appointments into distinct owners
    SELECT
        -- Use phone_normalized + email as owner key (most stable identifier)
        COALESCE(phone_normalized, '') || '|' || COALESCE(owner_email, '') AS owner_key,
        CONCAT(owner_first_name, ' ', owner_last_name) AS display_name,
        owner_email AS email,
        COALESCE(owner_cell_phone, owner_phone) AS phone,
        phone_normalized,
        owner_address AS address_display,
        COUNT(*) AS visit_count,
        MIN(appt_date) AS first_seen,
        MAX(appt_date) AS last_seen,
        -- Pick one representative ID for linking
        MIN(id::text) AS source_record_id
    FROM trapper.clinichq_hist_owners
    WHERE owner_first_name IS NOT NULL
      AND owner_first_name != ''
    GROUP BY
        COALESCE(phone_normalized, '') || '|' || COALESCE(owner_email, ''),
        CONCAT(owner_first_name, ' ', owner_last_name),
        owner_email,
        COALESCE(owner_cell_phone, owner_phone),
        phone_normalized,
        owner_address
)
-- ClinicHQ owners not linked
SELECT
    'clinichq'::text AS source_system,
    cho.source_record_id,
    cho.display_name,
    cho.email,
    cho.phone,
    cho.phone_normalized,
    cho.address_display,
    cho.visit_count::int,
    cho.first_seen::timestamptz,
    cho.last_seen::timestamptz,
    -- Check if already linked
    NOT EXISTS (
        SELECT 1 FROM trapper.person_source_link psl
        WHERE psl.source_system = 'clinichq' AND psl.source_pk = cho.source_record_id
    ) AS is_unlinked,
    -- Check if has open candidates
    EXISTS (
        SELECT 1 FROM trapper.person_match_candidates pmc
        WHERE pmc.source_system = 'clinichq'
        AND pmc.source_record_id = cho.source_record_id
        AND pmc.status = 'open'
    ) AS has_open_candidates,
    -- MEGA_004 E1: Check if marked as historical-only
    trapper.is_historical_only('clinichq', cho.source_record_id) AS is_historical_only
FROM clinichq_owners_agg cho
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.person_source_link psl
    WHERE psl.source_system = 'clinichq' AND psl.source_pk = cho.source_record_id
)

UNION ALL

-- Appointment requests (JotForm) not linked
SELECT
    'jotform'::text AS source_system,
    ar.id::text AS source_record_id,
    COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name)) AS display_name,
    ar.email,
    ar.phone,
    ar.phone_normalized,
    COALESCE(ar.cats_address, ar.requester_address) AS address_display,
    1 AS visit_count,
    ar.submitted_at AS first_seen,
    ar.submitted_at AS last_seen,
    NOT EXISTS (
        SELECT 1 FROM trapper.person_source_link psl
        WHERE psl.source_system = 'jotform' AND psl.source_pk = ar.id::text
    ) AS is_unlinked,
    EXISTS (
        SELECT 1 FROM trapper.person_match_candidates pmc
        WHERE pmc.source_system = 'jotform'
        AND pmc.source_record_id = ar.id::text
        AND pmc.status = 'open'
    ) AS has_open_candidates,
    -- MEGA_004 E1: Check if marked as historical-only
    trapper.is_historical_only('jotform', ar.id::text) AS is_historical_only
FROM trapper.appointment_requests ar
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.person_source_link psl
    WHERE psl.source_system = 'jotform' AND psl.source_pk = ar.id::text
);

COMMENT ON VIEW trapper.v_people_unlinked_sources IS
'Source records (ClinicHQ owners, JotForm submissions) not yet linked to canonical people.
ClinicHQ owners are aggregated from appointment rows. Use for matching and backlog tracking.
is_historical_only = true means record was explicitly marked as non-canonicalizable.';

-- ============================================================
-- VIEW: v_linkable_candidates (excludes historical-only)
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_linkable_candidates AS
SELECT *
FROM trapper.v_people_unlinked_sources
WHERE is_unlinked = true
  AND is_historical_only = false;

COMMENT ON VIEW trapper.v_linkable_candidates IS
'Unlinked source records that CAN potentially be linked to canonical people.
Excludes records marked as historical-only.';

-- ============================================================
-- Verification
-- ============================================================

\echo ''
\echo 'MIG_248 applied. historical_only_markers table created.'
\echo ''

\echo 'Table structure:'
\d trapper.historical_only_markers

\echo ''
\echo 'Current historical-only markers (should be 0 initially):'
SELECT COUNT(*) AS total_markers FROM trapper.historical_only_markers;

\echo ''
\echo 'Linkable candidates (excludes historical-only):'
SELECT source_system, COUNT(*) AS count
FROM trapper.v_linkable_candidates
GROUP BY source_system;
