-- MIG_131__request_people_roles.sql
-- Extend party_role enum with FFSC-specific roles and create SoT view
-- Part of UI_ARCH_230: request_people with roles
-- SAFE: Additive only, no destructive operations
--
-- ============================================================
-- NAMING CLARIFICATION (UI_ARCH_231):
-- ============================================================
-- The underlying table is `request_parties` (plural, role-based).
-- The view `v_request_people_sot` provides a "request_people" interface
-- by rolling up party rows into a single row per request.
--
-- Why not rename?
--   - request_parties is the correct model: one request can have
--     multiple people in different roles (reporter, trapper, feeder).
--   - The view abstracts this into a simpler "who's on this request" answer.
--
-- Usage:
--   - Write to: trapper.request_parties (with role)
--   - Read from: trapper.v_request_people_sot (rolled up)
-- ============================================================

-- ============================================================
-- 1. Add new roles to party_role enum
-- ============================================================

-- FFSC_TRAPPER: Staff trapper (Crystal, etc.)
DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'ffsc_trapper';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- COMMUNITY_TRAPPER: Volunteer/community trappers
DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'community_trapper';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CLIENT_CONTACT: Primary contact for the request
DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'client_contact';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- FEEDER: Person who feeds the cats
DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'feeder';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- TRANSPORT: Person handling transport
DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'transport';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. Add source provenance columns (if not exist)
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'trapper'
        AND table_name = 'request_parties'
        AND column_name = 'source_system'
    ) THEN
        ALTER TABLE trapper.request_parties ADD COLUMN source_system TEXT;
        ALTER TABLE trapper.request_parties ADD COLUMN source_record_id TEXT;
        COMMENT ON COLUMN trapper.request_parties.source_system IS 'Source system: airtable, clinichq, jotform, manual';
        COMMENT ON COLUMN trapper.request_parties.source_record_id IS 'Record ID in source system';
    END IF;
END $$;

-- ============================================================
-- 3. v_request_people_sot: Roll up roles per request
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_request_people_sot AS
WITH role_rollup AS (
    SELECT
        rp.request_id,
        array_agg(DISTINCT rp.role::text ORDER BY rp.role::text) AS roles,
        array_agg(DISTINCT p.id ORDER BY p.id) FILTER (WHERE rp.role::text IN ('ffsc_trapper', 'trapper', 'staff')) AS trapper_ids,
        array_agg(DISTINCT p.id ORDER BY p.id) FILTER (WHERE rp.role::text IN ('client_contact', 'reporter')) AS contact_ids,
        array_agg(DISTINCT p.id ORDER BY p.id) FILTER (WHERE rp.role::text = 'feeder') AS feeder_ids,
        COUNT(DISTINCT rp.person_id) AS party_count,
        bool_or(rp.role::text IN ('ffsc_trapper', 'trapper', 'staff')) AS has_trapper,
        bool_or(rp.role::text IN ('client_contact', 'reporter')) AS has_contact,
        bool_or(rp.role::text = 'feeder') AS has_feeder
    FROM trapper.request_parties rp
    JOIN trapper.people p ON p.id = rp.person_id
    GROUP BY rp.request_id
)
SELECT
    r.id AS request_id,
    r.case_number,
    r.status::text,
    -- People rollups
    COALESCE(rr.roles, ARRAY[]::text[]) AS roles,
    COALESCE(rr.party_count, 0) AS party_count,
    COALESCE(rr.has_trapper, false) AS has_trapper,
    COALESCE(rr.has_contact, false) AS has_contact,
    COALESCE(rr.has_feeder, false) AS has_feeder,
    -- Trapper info (first one if multiple)
    (SELECT COALESCE(p.display_name, p.full_name)
     FROM trapper.people p
     WHERE p.id = ANY(rr.trapper_ids)
     LIMIT 1) AS primary_trapper_name,
    (SELECT p.id FROM trapper.people p WHERE p.id = ANY(rr.trapper_ids) LIMIT 1) AS primary_trapper_id,
    -- Contact info (first one if multiple)
    (SELECT COALESCE(p.display_name, p.full_name)
     FROM trapper.people p
     WHERE p.id = ANY(rr.contact_ids)
     LIMIT 1) AS primary_contact_name,
    (SELECT p.id FROM trapper.people p WHERE p.id = ANY(rr.contact_ids) LIMIT 1) AS primary_contact_id,
    -- Assignment status for diagnostics
    CASE
        WHEN rr.has_trapper THEN 'assigned_via_role'
        WHEN r.assigned_trapper_person_id IS NOT NULL THEN 'assigned_via_field'
        ELSE 'unassigned'
    END AS assignment_status
FROM trapper.requests r
LEFT JOIN role_rollup rr ON rr.request_id = r.id;

COMMENT ON VIEW trapper.v_request_people_sot IS 'SoT view rolling up request_parties roles per request. Shows assignment status.';

-- ============================================================
-- 4. Index for role-based lookups
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_request_parties_role ON trapper.request_parties(role);
