-- MIG_088__v_search_unified_v2.sql
-- Enhanced unified search view with canonical address display
--
-- Key improvements:
-- 1. address_display: shows canonical formatted_address (preferred) or raw (marked)
-- 2. address_canonical: boolean flag indicating if address is canonical
-- 3. search_text_normalized: lowercase, trimmed, collapsed whitespace for fast matching
-- 4. Better join logic for canonical addresses
-- 5. phone_normalized included in search_text for phone searches
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_088__v_search_unified_v2.sql

-- ============================================
-- Helper function: normalize search text
-- ============================================

CREATE OR REPLACE FUNCTION trapper.normalize_search_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(TRIM(REGEXP_REPLACE(COALESCE(input, ''), '\s+', ' ', 'g')))
$$;

COMMENT ON FUNCTION trapper.normalize_search_text IS
'Normalizes text for search: lowercase, trim, collapse whitespace.';

-- ============================================
-- VIEW: v_search_unified_v2
-- ============================================

CREATE OR REPLACE VIEW trapper.v_search_unified_v2 AS

-- ============================================
-- PEOPLE
-- Best address from most recent linked request
-- ============================================
SELECT
    'person'::text AS entity_type,
    p.id AS entity_id,
    COALESCE(p.display_name, p.full_name, CONCAT_WS(' ', p.first_name, p.last_name)) AS display_label,
    -- search_text includes all searchable fields
    CONCAT_WS(' ',
        p.full_name,
        p.first_name,
        p.last_name,
        p.email,
        p.phone,
        p.phone_normalized,
        array_to_string(p.other_phones, ' '),
        array_to_string(p.other_emails, ' ')
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ',
            p.full_name, p.first_name, p.last_name,
            p.email, p.phone, p.phone_normalized
        )
    ) AS search_text_normalized,
    COALESCE(p.full_name, CONCAT_WS(' ', p.first_name, p.last_name)) AS name_text,
    -- Best address from most recent request
    COALESCE(
        best_addr.formatted_address,
        CASE WHEN best_place.raw_address IS NOT NULL
             THEN '(raw) ' || best_place.raw_address END
    ) AS address_display,
    best_addr.formatted_address IS NOT NULL AS address_canonical,
    CONCAT_WS(' ', p.phone_normalized, p.phone, array_to_string(p.other_phones, ' ')) AS phone_text,
    CONCAT_WS(' ', p.email, array_to_string(p.other_emails, ' ')) AS email_text,
    best_addr.city,
    best_addr.postal_code,
    best_place.location,
    p.created_at AS relevant_date,
    NULL::text AS status,
    p.phone_normalized,
    p.email::text AS email_normalized
FROM trapper.people p
LEFT JOIN LATERAL (
    SELECT r.id, COALESCE(r.primary_place_id, r.place_id) AS place_id
    FROM trapper.requests r
    WHERE r.person_id = p.id OR r.primary_contact_person_id = p.id
    ORDER BY r.created_at DESC
    LIMIT 1
) best_req ON true
LEFT JOIN trapper.places best_place ON best_place.id = best_req.place_id
LEFT JOIN trapper.addresses best_addr ON best_addr.id = COALESCE(best_place.primary_address_id, best_place.address_id)

UNION ALL

-- ============================================
-- PLACES
-- Prefer canonical address, fall back to raw
-- ============================================
SELECT
    'place'::text AS entity_type,
    pl.id AS entity_id,
    COALESCE(pl.display_name, pl.name, a.formatted_address, pl.raw_address) AS display_label,
    CONCAT_WS(' ',
        pl.name,
        pl.display_name,
        a.formatted_address,
        pl.raw_address,
        a.city,
        a.postal_code
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ', pl.name, pl.display_name, a.formatted_address, pl.raw_address)
    ) AS search_text_normalized,
    COALESCE(pl.name, pl.display_name) AS name_text,
    -- Canonical address preferred, raw marked
    COALESCE(
        a.formatted_address,
        CASE WHEN pl.raw_address IS NOT NULL
             THEN '(raw) ' || pl.raw_address END
    ) AS address_display,
    a.formatted_address IS NOT NULL AS address_canonical,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    a.city,
    a.postal_code,
    pl.location,
    pl.created_at AS relevant_date,
    NULL::text AS status,
    NULL::text AS phone_normalized,
    NULL::text AS email_normalized
FROM trapper.places pl
LEFT JOIN trapper.addresses a ON a.id = COALESCE(pl.primary_address_id, pl.address_id)

UNION ALL

-- ============================================
-- ADDRESSES
-- Always canonical (by definition)
-- ============================================
SELECT
    'address'::text AS entity_type,
    a.id AS entity_id,
    COALESCE(a.formatted_address, a.raw_text, a.raw_address) AS display_label,
    CONCAT_WS(' ',
        a.formatted_address,
        a.raw_text,
        a.raw_address,
        a.city,
        a.postal_code
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ', a.formatted_address, a.raw_text, a.raw_address)
    ) AS search_text_normalized,
    NULL::text AS name_text,
    COALESCE(a.formatted_address, '(raw) ' || COALESCE(a.raw_text, a.raw_address)) AS address_display,
    a.formatted_address IS NOT NULL AS address_canonical,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    a.city,
    a.postal_code,
    a.location,
    a.created_at AS relevant_date,
    NULL::text AS status,
    NULL::text AS phone_normalized,
    NULL::text AS email_normalized
FROM trapper.addresses a

UNION ALL

-- ============================================
-- REQUESTS
-- Show linked place's canonical address
-- ============================================
SELECT
    'request'::text AS entity_type,
    r.id AS entity_id,
    COALESCE(r.case_number, 'Request ' || r.id::text) AS display_label,
    CONCAT_WS(' ',
        r.case_number,
        r.summary,
        r.notes,
        addr.formatted_address,
        pl.raw_address,
        addr.city,
        addr.postal_code,
        person.full_name,
        person.phone_normalized
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ', r.case_number, r.summary, addr.formatted_address, pl.raw_address)
    ) AS search_text_normalized,
    person.full_name AS name_text,
    -- Canonical address preferred
    COALESCE(
        addr.formatted_address,
        CASE WHEN pl.raw_address IS NOT NULL
             THEN '(raw) ' || pl.raw_address END
    ) AS address_display,
    addr.formatted_address IS NOT NULL AS address_canonical,
    person.phone_normalized AS phone_text,
    person.email::text AS email_text,
    addr.city,
    addr.postal_code,
    pl.location,
    r.created_at AS relevant_date,
    r.status::text AS status,
    person.phone_normalized,
    person.email::text AS email_normalized
FROM trapper.requests r
LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.addresses addr ON addr.id = COALESCE(pl.primary_address_id, pl.address_id)
LEFT JOIN trapper.people person ON person.id = COALESCE(r.primary_contact_person_id, r.person_id)

UNION ALL

-- ============================================
-- APPOINTMENT REQUESTS (intake/demand)
-- Raw addresses marked as such
-- ============================================
SELECT
    'appt_request'::text AS entity_type,
    ar.id AS entity_id,
    COALESCE(ar.requester_name, CONCAT_WS(' ', ar.first_name, ar.last_name)) ||
        COALESCE(' - ' || ar.cats_address, '') AS display_label,
    CONCAT_WS(' ',
        ar.requester_name,
        ar.first_name,
        ar.last_name,
        ar.cats_address,
        ar.cats_address_clean,
        ar.requester_address,
        ar.email,
        ar.phone,
        ar.phone_normalized,
        ar.requester_city,
        ar.requester_zip
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ',
            ar.requester_name, ar.first_name, ar.last_name,
            ar.cats_address, ar.email, ar.phone
        )
    ) AS search_text_normalized,
    COALESCE(ar.requester_name, CONCAT_WS(' ', ar.first_name, ar.last_name)) AS name_text,
    -- These are always raw (from intake form)
    CASE WHEN ar.cats_address IS NOT NULL OR ar.cats_address_clean IS NOT NULL
         THEN '(raw) ' || COALESCE(ar.cats_address_clean, ar.cats_address)
    END AS address_display,
    false AS address_canonical,
    COALESCE(ar.phone_normalized, ar.phone) AS phone_text,
    ar.email AS email_text,
    ar.requester_city AS city,
    ar.requester_zip AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    COALESCE(ar.submitted_at, ar.created_at) AS relevant_date,
    ar.submission_status AS status,
    ar.phone_normalized,
    ar.email AS email_normalized
FROM trapper.appointment_requests ar

UNION ALL

-- ============================================
-- CLINICHQ UPCOMING APPOINTMENTS
-- Raw addresses from ClinicHQ
-- ============================================
SELECT
    'clinichq_appt'::text AS entity_type,
    ca.id AS entity_id,
    CONCAT_WS(' - ',
        CONCAT_WS(' ', ca.client_first_name, ca.client_last_name),
        ca.appt_date::text,
        ca.animal_name
    ) AS display_label,
    CONCAT_WS(' ',
        ca.client_first_name,
        ca.client_last_name,
        ca.client_address,
        ca.animal_name,
        ca.client_email,
        ca.client_phone,
        ca.phone_normalized,
        ca.client_cell_phone
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ',
            ca.client_first_name, ca.client_last_name,
            ca.client_address, ca.animal_name
        )
    ) AS search_text_normalized,
    CONCAT_WS(' ', ca.client_first_name, ca.client_last_name) AS name_text,
    -- Raw from ClinicHQ
    CASE WHEN ca.client_address IS NOT NULL
         THEN '(raw) ' || ca.client_address
    END AS address_display,
    false AS address_canonical,
    CONCAT_WS(' ', ca.phone_normalized, ca.client_phone, ca.client_cell_phone) AS phone_text,
    ca.client_email AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    ca.appt_date::timestamp with time zone AS relevant_date,
    ca.client_type AS status,
    ca.phone_normalized,
    ca.client_email AS email_normalized
FROM trapper.clinichq_upcoming_appointments ca

UNION ALL

-- ============================================
-- CLINICHQ HISTORICAL OWNERS
-- Raw addresses from historical data
-- ============================================
SELECT
    'hist_owner'::text AS entity_type,
    ho.id AS entity_id,
    CONCAT_WS(' - ',
        CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name),
        ho.appt_date::text
    ) AS display_label,
    CONCAT_WS(' ',
        ho.owner_first_name,
        ho.owner_last_name,
        ho.owner_address,
        ho.owner_email,
        ho.owner_phone,
        ho.phone_normalized,
        ho.owner_cell_phone,
        ho.appt_number
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ',
            ho.owner_first_name, ho.owner_last_name,
            ho.owner_address, ho.appt_number
        )
    ) AS search_text_normalized,
    CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name) AS name_text,
    -- Raw from historical
    CASE WHEN ho.owner_address IS NOT NULL
         THEN '(raw) ' || ho.owner_address
    END AS address_display,
    false AS address_canonical,
    CONCAT_WS(' ', ho.phone_normalized, ho.owner_phone, ho.owner_cell_phone) AS phone_text,
    ho.owner_email AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    ho.appt_date::timestamp with time zone AS relevant_date,
    ho.client_type AS status,
    ho.phone_normalized,
    ho.owner_email AS email_normalized
FROM trapper.clinichq_hist_owners ho

UNION ALL

-- ============================================
-- CLINICHQ HISTORICAL CATS
-- Searchable by microchip, animal name
-- ============================================
SELECT
    'hist_cat'::text AS entity_type,
    hc.id AS entity_id,
    CONCAT_WS(' - ',
        COALESCE(hc.animal_name, 'Unknown'),
        hc.appt_date::text,
        hc.microchip_number
    ) AS display_label,
    CONCAT_WS(' ',
        hc.animal_name,
        hc.microchip_number,
        hc.appt_number,
        hc.breed,
        hc.primary_color,
        hc.secondary_color
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ', hc.animal_name, hc.microchip_number, hc.appt_number, hc.breed)
    ) AS search_text_normalized,
    hc.animal_name AS name_text,
    NULL::text AS address_display,
    NULL::boolean AS address_canonical,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    hc.appt_date::timestamp with time zone AS relevant_date,
    hc.spay_neuter_status AS status,
    NULL::text AS phone_normalized,
    NULL::text AS email_normalized
FROM trapper.clinichq_hist_cats hc;

-- ============================================
-- Add comment
-- ============================================

COMMENT ON VIEW trapper.v_search_unified_v2 IS
'Enhanced unified search view (v2) with canonical address display.
Columns: entity_type, entity_id, display_label, search_text, search_text_normalized,
         name_text, address_display, address_canonical, phone_text, email_text,
         city, postal_code, location, relevant_date, status, phone_normalized, email_normalized.
address_display: shows canonical formatted_address (preferred) or raw address marked with (raw).
address_canonical: boolean indicating if the address is canonical/verified.
search_text_normalized: lowercase, trimmed for fast fuzzy matching.';

-- ============================================
-- Create index for fast text search
-- ============================================

-- Note: We can't create indexes on views directly.
-- For materialized view approach, uncomment below:
-- CREATE INDEX IF NOT EXISTS idx_search_v2_search_text_trgm
--   ON trapper.mv_search_unified_v2 USING gin (search_text_normalized gin_trgm_ops);

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'v_search_unified_v2 created. Verifying address_display coverage:'

SELECT
    entity_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE address_display IS NOT NULL) AS with_address,
    COUNT(*) FILTER (WHERE address_canonical = true) AS canonical,
    COUNT(*) FILTER (WHERE address_canonical = false OR address_canonical IS NULL) AS raw_or_none
FROM trapper.v_search_unified_v2
GROUP BY entity_type
ORDER BY total DESC;

\echo ''
\echo 'Sample address_display values:'

SELECT entity_type, display_label, address_display, address_canonical
FROM trapper.v_search_unified_v2
WHERE address_display IS NOT NULL
ORDER BY entity_type, relevant_date DESC NULLS LAST
LIMIT 10;
