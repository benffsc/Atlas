-- MIG_130__sot_layer_link_tables.sql
-- Source-of-Truth (SoT) layer: link tables connecting canonical entities to source records
-- Part of UI_ARCH_230: Silo sources + SoT approach
-- SAFE: Additive only, no destructive operations

-- ============================================================
-- 1. Person Source Link Table
-- Links canonical people to source system records (Airtable, ClinicHQ, forms)
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.person_source_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES trapper.people(id) ON DELETE CASCADE,
    source_system TEXT NOT NULL CHECK (source_system IN ('airtable', 'clinichq', 'jotform', 'manual')),
    source_pk TEXT NOT NULL,  -- Primary key in source system
    confidence NUMERIC(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    matched_on TEXT[],  -- Array of fields used for matching: ['email', 'phone', 'name']
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_system, source_pk)
);

CREATE INDEX IF NOT EXISTS idx_person_source_link_person_id ON trapper.person_source_link(person_id);
CREATE INDEX IF NOT EXISTS idx_person_source_link_source ON trapper.person_source_link(source_system, source_pk);

COMMENT ON TABLE trapper.person_source_link IS 'Links canonical people to source records (Airtable, ClinicHQ, forms). Preserves source lineage.';

-- ============================================================
-- 2. Cat Source Link Table
-- Links canonical cats to source system records
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.cat_source_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID NOT NULL,  -- Would reference cats table when it exists
    source_system TEXT NOT NULL CHECK (source_system IN ('airtable', 'clinichq', 'manual')),
    source_pk TEXT NOT NULL,
    confidence NUMERIC(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    matched_on TEXT[],  -- e.g., ['microchip']
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_system, source_pk)
);

CREATE INDEX IF NOT EXISTS idx_cat_source_link_cat_id ON trapper.cat_source_link(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_source_link_source ON trapper.cat_source_link(source_system, source_pk);

COMMENT ON TABLE trapper.cat_source_link IS 'Links canonical cats to source records. Microchip is the strong key.';

-- ============================================================
-- 3. Extended Role Type for request_parties
-- Add more roles beyond 'reporter'
-- ============================================================

-- The enum is called 'party_role', try to add new values
DO $$
BEGIN
    -- Try to add new values to the existing role enum
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'ffsc_trapper';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'community_trapper';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'client_contact';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'feeder';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'property_owner';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'transport';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE trapper.party_role ADD VALUE IF NOT EXISTS 'other';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ============================================================
-- 4. SoT Views
-- ============================================================

-- v_people_sot: Canonical people with source rollups and flags
CREATE OR REPLACE VIEW trapper.v_people_sot AS
SELECT
    p.id AS person_id,
    p.person_key,
    COALESCE(p.display_name, p.full_name, CONCAT(p.first_name, ' ', p.last_name)) AS display_name,
    p.first_name,
    p.last_name,
    p.email,
    p.phone,
    p.phone_normalized,
    p.notes,
    p.created_at,
    p.updated_at,
    -- Source rollups
    (SELECT COUNT(*) FROM trapper.person_source_link psl WHERE psl.person_id = p.id) AS source_count,
    (SELECT array_agg(DISTINCT source_system) FROM trapper.person_source_link psl WHERE psl.person_id = p.id) AS sources,
    -- ClinicHQ history link (if any)
    EXISTS (
        SELECT 1 FROM trapper.clinichq_hist_owners cho
        WHERE cho.phone_normalized = p.phone_normalized
           OR LOWER(cho.owner_email) = LOWER(p.email)
    ) AS has_clinichq_history,
    -- Request counts
    (SELECT COUNT(DISTINCT request_id) FROM trapper.request_parties rp WHERE rp.person_id = p.id) AS request_count,
    -- Flags for quarantine
    CASE
        WHEN LOWER(p.email) LIKE '%ffsc%' OR LOWER(p.email) LIKE '%forgottenfelines%' THEN TRUE
        ELSE FALSE
    END AS is_system_email,
    CASE
        WHEN (SELECT COUNT(*) FROM trapper.people p2 WHERE p2.phone_normalized = p.phone_normalized AND p2.id != p.id) > 0 THEN TRUE
        ELSE FALSE
    END AS is_shared_phone
FROM trapper.people p;

COMMENT ON VIEW trapper.v_people_sot IS 'Source-of-Truth view for people with source rollups and flags.';

-- v_places_sot: Canonical places with address info and request counts
CREATE OR REPLACE VIEW trapper.v_places_sot AS
SELECT
    pl.id AS place_id,
    pl.place_key,
    COALESCE(pl.display_name, pl.name) AS display_name,
    pl.name AS place_name,
    pl.raw_address,
    pl.notes,
    pl.flags,
    pl.address_id,
    -- Address info
    addr.address_key,
    COALESCE(addr.display_line, addr.formatted_address, addr.raw_address) AS address_display,
    addr.city,
    addr.postal_code,
    addr.latitude,
    addr.longitude,
    -- Geo status
    CASE
        WHEN addr.latitude IS NOT NULL AND addr.longitude IS NOT NULL THEN 'geocoded'
        WHEN addr.id IS NOT NULL THEN 'address_no_coords'
        WHEN pl.raw_address IS NOT NULL THEN 'raw_only'
        ELSE 'no_address'
    END AS geo_status,
    -- Request counts
    (
        SELECT COUNT(*)
        FROM trapper.requests r
        WHERE r.primary_place_id = pl.id OR r.place_id = pl.id
    ) AS request_count,
    pl.created_at,
    pl.updated_at
FROM trapper.places pl
LEFT JOIN trapper.addresses addr ON addr.id = pl.address_id;

COMMENT ON VIEW trapper.v_places_sot IS 'Source-of-Truth view for places with address info and geo status.';

-- v_addresses_sot: Canonical addresses with place counts
CREATE OR REPLACE VIEW trapper.v_addresses_sot AS
SELECT
    a.id AS address_id,
    a.address_key,
    COALESCE(a.display_line, a.formatted_address, a.raw_address, a.raw_text) AS address_display,
    a.formatted_address,
    a.raw_address,
    a.city,
    a.postal_code,
    a.latitude,
    a.longitude,
    a.quality_score,
    -- Geo status
    CASE
        WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL THEN 'geocoded'
        ELSE 'needs_geocoding'
    END AS geo_status,
    -- Place count at this address
    (SELECT COUNT(*) FROM trapper.places pl WHERE pl.address_id = a.id) AS place_count,
    -- Request count via places
    (
        SELECT COUNT(DISTINCT r.id)
        FROM trapper.requests r
        JOIN trapper.places pl ON (pl.id = r.primary_place_id OR pl.id = r.place_id)
        WHERE pl.address_id = a.id
    ) AS request_count,
    a.created_at,
    a.updated_at
FROM trapper.addresses a;

COMMENT ON VIEW trapper.v_addresses_sot IS 'Source-of-Truth view for addresses with place and request counts.';

-- ============================================================
-- 5. Search SoT Unified View (v_search_sot_unified)
-- Single search view with stable location keys for grouping
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_search_sot_unified AS
-- Places (named sites)
SELECT
    'place'::text AS entity_type,
    pl.place_id::text AS entity_id,
    pl.display_name AS display_label,
    LOWER(COALESCE(pl.display_name, '')) || ' ' || LOWER(COALESCE(pl.address_display, '')) AS search_text,
    pl.display_name AS name_text,
    pl.address_display,
    pl.address_key AS location_key,  -- Stable key for grouping
    pl.address_id::text AS address_id,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    pl.city,
    pl.postal_code,
    pl.latitude,
    pl.longitude,
    pl.updated_at AS relevant_date,
    pl.geo_status AS status
FROM trapper.v_places_sot pl

UNION ALL

-- Addresses (geocoded locations without named place)
SELECT
    'address'::text AS entity_type,
    a.address_id::text AS entity_id,
    a.address_display AS display_label,
    LOWER(COALESCE(a.address_display, '')) AS search_text,
    NULL::text AS name_text,
    a.address_display,
    a.address_key AS location_key,
    a.address_id::text AS address_id,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    a.city,
    a.postal_code,
    a.latitude,
    a.longitude,
    a.updated_at AS relevant_date,
    a.geo_status AS status
FROM trapper.v_addresses_sot a
WHERE a.place_count = 0  -- Only show addresses without named places

UNION ALL

-- People (canonical)
SELECT
    'person'::text AS entity_type,
    p.person_id::text AS entity_id,
    p.display_name AS display_label,
    LOWER(COALESCE(p.display_name, '')) || ' ' || LOWER(COALESCE(p.email, '')) || ' ' || COALESCE(p.phone_normalized, '') AS search_text,
    p.display_name AS name_text,
    NULL::text AS address_display,
    NULL::text AS location_key,
    NULL::text AS address_id,
    p.phone AS phone_text,
    p.email AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::numeric AS latitude,
    NULL::numeric AS longitude,
    p.updated_at AS relevant_date,
    CASE WHEN p.has_clinichq_history THEN 'has_history' ELSE NULL END AS status
FROM trapper.v_people_sot p
WHERE NOT p.is_system_email  -- Exclude system emails from search

UNION ALL

-- Requests (from Airtable)
SELECT
    'request'::text AS entity_type,
    r.id::text AS entity_id,
    COALESCE(pl.display_name, pl.name, r.case_number) AS display_label,
    LOWER(COALESCE(r.case_number, '')) || ' ' || LOWER(COALESCE(r.summary, '')) || ' ' || LOWER(COALESCE(r.notes, '')) AS search_text,
    COALESCE(contact.display_name, contact.full_name) AS name_text,
    COALESCE(addr.display_line, addr.formatted_address, pl.raw_address) AS address_display,
    addr.address_key AS location_key,
    addr.id::text AS address_id,
    contact.phone AS phone_text,
    contact.email AS email_text,
    addr.city,
    addr.postal_code,
    addr.latitude,
    addr.longitude,
    r.created_at AS relevant_date,
    r.status::text AS status
FROM trapper.requests r
LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.addresses addr ON addr.id = pl.address_id
LEFT JOIN trapper.people contact ON contact.id = COALESCE(r.primary_contact_person_id, r.person_id)

UNION ALL

-- Appointment Requests (from JotForm) - using correct column names
SELECT
    'appt_request'::text AS entity_type,
    ar.id::text AS entity_id,
    COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name), 'Form ' || ar.id::text) AS display_label,
    LOWER(COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name), '')) || ' ' ||
        LOWER(COALESCE(ar.cats_address, ar.requester_address, '')) || ' ' || COALESCE(ar.phone, '') AS search_text,
    COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name)) AS name_text,
    COALESCE(ar.cats_address_clean, ar.cats_address, ar.requester_address) AS address_display,
    NULL::text AS location_key,  -- Forms don't have canonical address yet
    NULL::text AS address_id,
    ar.phone AS phone_text,
    ar.email AS email_text,
    COALESCE(ar.county, ar.requester_city) AS city,
    ar.requester_zip AS postal_code,
    NULL::numeric AS latitude,
    NULL::numeric AS longitude,
    ar.submitted_at AS relevant_date,
    ar.submission_status AS status
FROM trapper.appointment_requests ar;

COMMENT ON VIEW trapper.v_search_sot_unified IS 'Unified search view with stable location_key for grouping. Powers typeahead in /new-request.';

-- ============================================================
-- 6. Quarantine and Match Candidates Views
-- ============================================================

-- v_people_quarantine: People that need review before trusting
CREATE OR REPLACE VIEW trapper.v_people_quarantine AS
SELECT
    p.person_id,
    p.display_name,
    p.email,
    p.phone,
    p.phone_normalized,
    p.source_count,
    p.sources,
    p.request_count,
    -- Quarantine reasons
    ARRAY_REMOVE(ARRAY[
        CASE WHEN p.is_system_email THEN 'system_email' END,
        CASE WHEN p.is_shared_phone THEN 'shared_phone' END,
        CASE WHEN p.display_name IS NULL OR p.display_name = '' THEN 'missing_name' END,
        CASE WHEN p.email IS NULL AND p.phone IS NULL THEN 'no_contact_info' END
    ], NULL) AS quarantine_reasons
FROM trapper.v_people_sot p
WHERE p.is_system_email
   OR p.is_shared_phone
   OR p.display_name IS NULL
   OR p.display_name = ''
   OR (p.email IS NULL AND p.phone IS NULL);

COMMENT ON VIEW trapper.v_people_quarantine IS 'People that need review before trusting: system emails, shared phones, missing info.';

-- v_people_match_candidates: Possible duplicate people for review
CREATE OR REPLACE VIEW trapper.v_people_match_candidates AS
WITH phone_matches AS (
    SELECT
        p1.person_id AS person_a_id,
        p2.person_id AS person_b_id,
        'phone_match' AS match_type,
        0.9 AS confidence
    FROM trapper.v_people_sot p1
    JOIN trapper.v_people_sot p2 ON p1.phone_normalized = p2.phone_normalized
    WHERE p1.person_id < p2.person_id  -- Avoid duplicates
      AND p1.phone_normalized IS NOT NULL
      AND p1.phone_normalized != ''
),
email_matches AS (
    SELECT
        p1.person_id AS person_a_id,
        p2.person_id AS person_b_id,
        'email_match' AS match_type,
        0.95 AS confidence
    FROM trapper.v_people_sot p1
    JOIN trapper.v_people_sot p2 ON LOWER(p1.email) = LOWER(p2.email)
    WHERE p1.person_id < p2.person_id
      AND p1.email IS NOT NULL
      AND p1.email != ''
)
SELECT
    person_a_id,
    person_b_id,
    match_type,
    confidence,
    pa.display_name AS person_a_name,
    pb.display_name AS person_b_name,
    pa.email AS person_a_email,
    pb.email AS person_b_email,
    pa.phone AS person_a_phone,
    pb.phone AS person_b_phone
FROM (
    SELECT * FROM phone_matches
    UNION
    SELECT * FROM email_matches
) matches
JOIN trapper.v_people_sot pa ON pa.person_id = matches.person_a_id
JOIN trapper.v_people_sot pb ON pb.person_id = matches.person_b_id
ORDER BY confidence DESC;

COMMENT ON VIEW trapper.v_people_match_candidates IS 'Possible duplicate people for manual review. No auto-merge - review only.';

-- ============================================================
-- 7. Location Groups View (for typeahead grouping)
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_location_groups AS
SELECT
    COALESCE(a.address_key, 'unknown-' || a.id::text) AS location_key,
    COALESCE(a.display_line, a.formatted_address, a.raw_address) AS location_display,
    a.id AS address_id,
    a.latitude,
    a.longitude,
    a.city,
    a.postal_code,
    -- Counts
    (SELECT COUNT(*) FROM trapper.places pl WHERE pl.address_id = a.id) AS place_count,
    (SELECT COUNT(*) FROM trapper.v_people_sot p
     JOIN trapper.request_parties rp ON rp.person_id = p.person_id
     JOIN trapper.requests r ON r.id = rp.request_id
     JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
     WHERE pl.address_id = a.id) AS people_count,
    (SELECT COUNT(*) FROM trapper.requests r
     JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
     WHERE pl.address_id = a.id) AS request_count
FROM trapper.addresses a
WHERE a.address_key IS NOT NULL OR a.id IS NOT NULL;

COMMENT ON VIEW trapper.v_location_groups IS 'Location groups for typeahead grouping by canonical address.';

-- Create indexes to support the views
CREATE INDEX IF NOT EXISTS idx_people_phone_normalized ON trapper.people(phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_people_email_lower ON trapper.people(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_places_address_id ON trapper.places(address_id) WHERE address_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_addresses_address_key ON trapper.addresses(address_key) WHERE address_key IS NOT NULL;
