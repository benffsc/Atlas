-- MIG_050__sot_requests.sql
-- Source-of-Truth Requests Table
--
-- PURPOSE:
--   Store TNR requests created in the Atlas app.
--   Separate from legacy appointment_requests (JotForm) and trapping_requests (Airtable).
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_050__sot_requests.sql

\echo '============================================'
\echo 'MIG_050: SoT Requests Table'
\echo '============================================'

-- ============================================
-- PART 1: Request Status Enum
-- ============================================
\echo ''
\echo 'Creating request_status enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status') THEN
        CREATE TYPE trapper.request_status AS ENUM (
            'new',           -- Just created, needs triage
            'triaged',       -- Reviewed, priority assigned
            'scheduled',     -- Appointment scheduled
            'in_progress',   -- Actively being worked
            'completed',     -- TNR completed
            'cancelled',     -- Request cancelled
            'on_hold'        -- Paused for some reason
        );
    END IF;
END$$;

-- ============================================
-- PART 2: Request Priority Enum
-- ============================================
\echo 'Creating request_priority enum...'

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_priority') THEN
        CREATE TYPE trapper.request_priority AS ENUM (
            'urgent',        -- Needs immediate attention
            'high',          -- Should be addressed soon
            'normal',        -- Standard priority
            'low'            -- Can wait
        );
    END IF;
END$$;

-- ============================================
-- PART 3: Requests Table
-- ============================================
\echo ''
\echo 'Creating sot_requests table...'

CREATE TABLE IF NOT EXISTS trapper.sot_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Status tracking
    status trapper.request_status NOT NULL DEFAULT 'new',
    priority trapper.request_priority DEFAULT 'normal',

    -- Linked entities
    place_id UUID REFERENCES trapper.places(place_id),
    requester_person_id UUID REFERENCES trapper.sot_people(person_id),

    -- Request details
    summary TEXT,                    -- Brief description
    notes TEXT,                      -- Detailed notes
    estimated_cat_count INT,
    has_kittens BOOLEAN DEFAULT false,
    cats_are_friendly BOOLEAN,       -- Can they be handled?

    -- Contact preference
    preferred_contact_method TEXT,   -- 'phone', 'email', 'text'

    -- Assignment
    assigned_to TEXT,                -- Trapper name/ID

    -- Scheduling
    scheduled_date DATE,
    scheduled_time_range TEXT,       -- e.g., "morning", "afternoon", "9am-12pm"

    -- Resolution
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    cats_trapped INT,
    cats_returned INT,

    -- Data provenance
    data_source trapper.data_source NOT NULL DEFAULT 'app',
    source_system TEXT,              -- 'app', 'jotform', 'airtable'
    source_record_id TEXT,           -- ID in source system if imported

    -- Audit
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sot_requests_status ON trapper.sot_requests(status);
CREATE INDEX IF NOT EXISTS idx_sot_requests_priority ON trapper.sot_requests(priority);
CREATE INDEX IF NOT EXISTS idx_sot_requests_place ON trapper.sot_requests(place_id);
CREATE INDEX IF NOT EXISTS idx_sot_requests_requester ON trapper.sot_requests(requester_person_id);
CREATE INDEX IF NOT EXISTS idx_sot_requests_scheduled ON trapper.sot_requests(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_sot_requests_created ON trapper.sot_requests(created_at);

COMMENT ON TABLE trapper.sot_requests IS
'TNR requests created in Atlas app. Links to places and people.
Status workflow: new -> triaged -> scheduled -> in_progress -> completed/cancelled.';

-- ============================================
-- PART 4: Request Cats Link Table
-- ============================================
\echo 'Creating request_cats link table...'

CREATE TABLE IF NOT EXISTS trapper.request_cats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES trapper.sot_requests(request_id) ON DELETE CASCADE,
    cat_id UUID NOT NULL REFERENCES trapper.sot_cats(cat_id),
    relationship TEXT DEFAULT 'subject',  -- 'subject' = cat to be trapped
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, cat_id)
);

CREATE INDEX IF NOT EXISTS idx_request_cats_request ON trapper.request_cats(request_id);
CREATE INDEX IF NOT EXISTS idx_request_cats_cat ON trapper.request_cats(cat_id);

COMMENT ON TABLE trapper.request_cats IS
'Links requests to specific cats. Used when cats are known before trapping.';

-- ============================================
-- PART 5: Request List View
-- ============================================
\echo ''
\echo 'Creating v_request_list view...'

CREATE OR REPLACE VIEW trapper.v_request_list AS
SELECT
    r.request_id,
    r.status::TEXT,
    r.priority::TEXT,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    r.scheduled_date,
    r.assigned_to,
    r.created_at,
    r.updated_at,
    -- Place info
    r.place_id,
    p.display_name AS place_name,
    p.formatted_address AS place_address,
    sa.locality AS place_city,
    -- Requester info
    r.requester_person_id,
    per.display_name AS requester_name,
    -- Cat count
    (SELECT COUNT(*) FROM trapper.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id;

COMMENT ON VIEW trapper.v_request_list IS
'Request list view with place and requester info for UI display.';

-- ============================================
-- PART 6: Request Detail View
-- ============================================
\echo 'Creating v_request_detail view...'

CREATE OR REPLACE VIEW trapper.v_request_detail AS
SELECT
    r.request_id,
    r.status::TEXT,
    r.priority::TEXT,
    r.summary,
    r.notes,
    r.estimated_cat_count,
    r.has_kittens,
    r.cats_are_friendly,
    r.preferred_contact_method,
    r.assigned_to,
    r.scheduled_date,
    r.scheduled_time_range,
    r.resolved_at,
    r.resolution_notes,
    r.cats_trapped,
    r.cats_returned,
    r.data_source::TEXT,
    r.source_system,
    r.created_by,
    r.created_at,
    r.updated_at,
    -- Place info
    r.place_id,
    p.display_name AS place_name,
    p.formatted_address AS place_address,
    p.place_kind::TEXT AS place_kind,
    sa.locality AS place_city,
    sa.postal_code AS place_postal_code,
    CASE WHEN p.location IS NOT NULL THEN
        jsonb_build_object(
            'lat', ST_Y(p.location::geometry),
            'lng', ST_X(p.location::geometry)
        )
    ELSE NULL END AS place_coordinates,
    -- Requester info
    r.requester_person_id,
    per.display_name AS requester_name,
    -- Linked cats
    (SELECT jsonb_agg(jsonb_build_object(
        'cat_id', rc.cat_id,
        'cat_name', c.display_name,
        'relationship', rc.relationship
    ))
     FROM trapper.request_cats rc
     JOIN trapper.sot_cats c ON c.cat_id = rc.cat_id
     WHERE rc.request_id = r.request_id) AS cats
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id;

COMMENT ON VIEW trapper.v_request_detail IS
'Full request detail view with all linked entities for API.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_050 Complete'
\echo '============================================'

\echo ''
\echo 'Tables created:'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
  AND table_name IN ('sot_requests', 'request_cats')
ORDER BY table_name;

\echo ''
\echo 'Views created:'
SELECT table_name FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name IN ('v_request_list', 'v_request_detail')
ORDER BY table_name;

\echo ''
\echo 'Enums created:'
SELECT typname FROM pg_type
WHERE typname IN ('request_status', 'request_priority');

\echo ''
\echo 'MIG_050 applied. Request tables ready.'
\echo ''
