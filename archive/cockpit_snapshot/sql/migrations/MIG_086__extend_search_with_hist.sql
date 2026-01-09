-- MIG_086__extend_search_with_hist.sql
-- Extends v_search_unified to include ClinicHQ historical data
-- Adds: hist_owner (owner records) and hist_cat (cat/animal records)
--
-- This enables searching for historical owners by name/phone/email/address
-- and historical cats by name/microchip.
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_086__extend_search_with_hist.sql

-- Use CREATE OR REPLACE to avoid dropping (safer for dependent objects)
-- Column shape (13 cols) preserved for backward compatibility:
--   entity_type, entity_id, display_label, search_text,
--   name_text, address_text, phone_text, email_text, city, postal_code,
--   location, relevant_date, status

CREATE OR REPLACE VIEW trapper.v_search_unified AS

-- ============================================
-- PEOPLE
-- ============================================
SELECT
    'person'::text AS entity_type,
    p.id AS entity_id,
    COALESCE(p.display_name, p.full_name, p.first_name || ' ' || p.last_name) AS display_label,
    COALESCE(p.full_name, '') || ' ' || COALESCE(p.email::text, '') || ' ' || COALESCE(p.phone, '') AS search_text,
    COALESCE(p.full_name, p.first_name || ' ' || p.last_name) AS name_text,
    NULL::text AS address_text,
    COALESCE(p.phone_normalized, p.phone, '') || ' ' || COALESCE(array_to_string(p.other_phones, ' '), '') AS phone_text,
    COALESCE(p.email::text, '') || ' ' || COALESCE(array_to_string(p.other_emails::text[], ' '), '') AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    p.created_at AS relevant_date,
    NULL::text AS status
FROM trapper.people p

UNION ALL

-- ============================================
-- PLACES
-- ============================================
SELECT
    'place'::text AS entity_type,
    pl.id AS entity_id,
    COALESCE(pl.display_name, pl.name, pl.raw_address) AS display_label,
    COALESCE(pl.name, '') || ' ' || COALESCE(pl.display_name, '') || ' ' || COALESCE(pl.raw_address, '') AS search_text,
    COALESCE(pl.name, pl.display_name) AS name_text,
    pl.raw_address AS address_text,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    a.city AS city,
    a.postal_code AS postal_code,
    pl.location AS location,
    pl.created_at AS relevant_date,
    NULL::text AS status
FROM trapper.places pl
LEFT JOIN trapper.addresses a ON a.id = COALESCE(pl.primary_address_id, pl.address_id)

UNION ALL

-- ============================================
-- ADDRESSES
-- ============================================
SELECT
    'address'::text AS entity_type,
    a.id AS entity_id,
    COALESCE(a.formatted_address, a.raw_text, a.raw_address) AS display_label,
    COALESCE(a.formatted_address, '') || ' ' || COALESCE(a.raw_text, '') || ' ' || COALESCE(a.raw_address, '') AS search_text,
    NULL::text AS name_text,
    COALESCE(a.formatted_address, a.raw_text, a.raw_address) AS address_text,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    a.city AS city,
    a.postal_code AS postal_code,
    a.location AS location,
    a.created_at AS relevant_date,
    NULL::text AS status
FROM trapper.addresses a

UNION ALL

-- ============================================
-- REQUESTS
-- ============================================
SELECT
    'request'::text AS entity_type,
    r.id AS entity_id,
    COALESCE(r.case_number, 'Request ' || r.id::text) AS display_label,
    COALESCE(r.case_number, '') || ' ' || COALESCE(r.summary, '') || ' ' || COALESCE(r.notes, '') AS search_text,
    NULL::text AS name_text,
    NULL::text AS address_text,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    addr.city AS city,
    addr.postal_code AS postal_code,
    pl.location AS location,
    r.created_at AS relevant_date,
    r.status::text AS status
FROM trapper.requests r
LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.addresses addr ON addr.id = COALESCE(pl.primary_address_id, pl.address_id)

UNION ALL

-- ============================================
-- APPOINTMENT REQUESTS (intake/demand)
-- ============================================
SELECT
    'appt_request'::text AS entity_type,
    ar.id AS entity_id,
    COALESCE(ar.requester_name, ar.first_name || ' ' || ar.last_name) || ' - ' || COALESCE(ar.cats_address, '') AS display_label,
    COALESCE(ar.requester_name, '') || ' ' || COALESCE(ar.first_name, '') || ' ' || COALESCE(ar.last_name, '') || ' ' ||
    COALESCE(ar.cats_address, '') || ' ' || COALESCE(ar.cats_address_clean, '') || ' ' ||
    COALESCE(ar.requester_address, '') || ' ' || COALESCE(ar.email, '') || ' ' || COALESCE(ar.phone, '') AS search_text,
    COALESCE(ar.requester_name, ar.first_name || ' ' || ar.last_name) AS name_text,
    COALESCE(ar.cats_address, ar.cats_address_clean, ar.requester_address) AS address_text,
    COALESCE(ar.phone_normalized, ar.phone, '') AS phone_text,
    COALESCE(ar.email, '') AS email_text,
    ar.requester_city AS city,
    ar.requester_zip AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    COALESCE(ar.submitted_at, ar.created_at) AS relevant_date,
    ar.submission_status AS status
FROM trapper.appointment_requests ar

UNION ALL

-- ============================================
-- CLINICHQ UPCOMING APPOINTMENTS
-- ============================================
SELECT
    'clinichq_appt'::text AS entity_type,
    ca.id AS entity_id,
    COALESCE(ca.client_first_name, '') || ' ' || COALESCE(ca.client_last_name, '') ||
    ' - ' || ca.appt_date::text || ' - ' || COALESCE(ca.animal_name, '') AS display_label,
    COALESCE(ca.client_first_name, '') || ' ' || COALESCE(ca.client_last_name, '') || ' ' ||
    COALESCE(ca.client_address, '') || ' ' || COALESCE(ca.animal_name, '') || ' ' ||
    COALESCE(ca.client_email, '') || ' ' || COALESCE(ca.client_phone, '') || ' ' || COALESCE(ca.client_cell_phone, '') AS search_text,
    COALESCE(ca.client_first_name, '') || ' ' || COALESCE(ca.client_last_name, '') AS name_text,
    ca.client_address AS address_text,
    COALESCE(ca.phone_normalized, ca.client_phone, '') || ' ' || COALESCE(ca.client_cell_phone, '') AS phone_text,
    COALESCE(ca.client_email, '') AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    ca.appt_date::timestamp with time zone AS relevant_date,
    ca.client_type AS status
FROM trapper.clinichq_upcoming_appointments ca

UNION ALL

-- ============================================
-- CLINICHQ HISTORICAL OWNERS (NEW)
-- Searchable by: owner name, phone, email, address
-- ============================================
SELECT
    'hist_owner'::text AS entity_type,
    ho.id AS entity_id,
    CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name) || ' - ' || ho.appt_date::text AS display_label,
    COALESCE(ho.owner_first_name, '') || ' ' || COALESCE(ho.owner_last_name, '') || ' ' ||
    COALESCE(ho.owner_address, '') || ' ' || COALESCE(ho.owner_email, '') || ' ' ||
    COALESCE(ho.phone_normalized, '') || ' ' || COALESCE(ho.owner_phone, '') || ' ' ||
    COALESCE(ho.owner_cell_phone, '') || ' ' || COALESCE(ho.appt_number, '') AS search_text,
    CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name) AS name_text,
    ho.owner_address AS address_text,
    COALESCE(ho.phone_normalized, ho.owner_phone, '') || ' ' || COALESCE(ho.owner_cell_phone, '') AS phone_text,
    COALESCE(ho.owner_email, '') AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    ho.appt_date::timestamp with time zone AS relevant_date,
    ho.client_type AS status
FROM trapper.clinichq_hist_owners ho

UNION ALL

-- ============================================
-- CLINICHQ HISTORICAL CATS (NEW)
-- Searchable by: animal name, microchip number, appt_number
-- ============================================
SELECT
    'hist_cat'::text AS entity_type,
    hc.id AS entity_id,
    COALESCE(hc.animal_name, 'Unknown') || ' - ' || hc.appt_date::text ||
    CASE WHEN hc.microchip_number IS NOT NULL THEN ' - ' || hc.microchip_number ELSE '' END AS display_label,
    COALESCE(hc.animal_name, '') || ' ' || COALESCE(hc.microchip_number, '') || ' ' ||
    COALESCE(hc.appt_number, '') || ' ' || COALESCE(hc.breed, '') || ' ' ||
    COALESCE(hc.primary_color, '') || ' ' || COALESCE(hc.secondary_color, '') AS search_text,
    hc.animal_name AS name_text,
    NULL::text AS address_text,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    hc.appt_date::timestamp with time zone AS relevant_date,
    hc.spay_neuter_status AS status
FROM trapper.clinichq_hist_cats hc;

-- Add comment
COMMENT ON VIEW trapper.v_search_unified IS
'Unified search view across all searchable entities.
Updated in MIG_086 to include ClinicHQ historical owners (hist_owner) and cats (hist_cat).
Entity types: person, place, address, request, appt_request, clinichq_appt, hist_owner, hist_cat.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Search unified view updated with historical data:'

SELECT entity_type, COUNT(*) AS rows
FROM trapper.v_search_unified
GROUP BY entity_type
ORDER BY rows DESC;

\echo ''
\echo 'Sample hist_owner search results:'
SELECT entity_type, display_label, phone_text, email_text
FROM trapper.v_search_unified
WHERE entity_type = 'hist_owner'
ORDER BY relevant_date DESC NULLS LAST
LIMIT 3;

\echo ''
\echo 'Sample hist_cat search results:'
SELECT entity_type, display_label, name_text
FROM trapper.v_search_unified
WHERE entity_type = 'hist_cat'
ORDER BY relevant_date DESC NULLS LAST
LIMIT 3;
