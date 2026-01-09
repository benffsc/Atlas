-- MIG_132__v_search_sot_unified_namespaced_location_key.sql
-- Fix location_key collisions by namespacing with prefixes
-- Part of UI_ARCH_231: Hardening what UI_ARCH_230 landed
-- SAFE: View recreation only, no data changes

-- ============================================================
-- Problem:
-- v_search_sot_unified used address_key as location_key directly.
-- This caused collision issues because:
--   1. Place records use place.address_key (from linked address)
--   2. Request records use addr.address_key (same source)
--   3. Grouping by location_key would collide unrelated entities
--
-- Solution:
-- Namespace location_key with prefixes:
--   - place:<place_key>  -- for named places
--   - addr:<address_id>  -- for address-based entries
--   - raw:<hash>         -- for raw address text (no canonical)
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
    -- Namespaced location_key: prefer place_key, fallback to address_id
    CASE
        WHEN pl.place_key IS NOT NULL THEN 'place:' || pl.place_key
        WHEN pl.address_id IS NOT NULL THEN 'addr:' || pl.address_id::text
        ELSE 'raw:' || md5(COALESCE(pl.address_display, pl.display_name, ''))
    END AS location_key,
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
    -- Namespaced: address always uses addr: prefix
    'addr:' || a.address_id::text AS location_key,
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
    NULL::text AS location_key,  -- People don't have location_key
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
    -- Namespaced: use place_key if place linked, else addr:, else raw:
    CASE
        WHEN pl.place_key IS NOT NULL THEN 'place:' || pl.place_key
        WHEN addr.id IS NOT NULL THEN 'addr:' || addr.id::text
        WHEN pl.raw_address IS NOT NULL THEN 'raw:' || md5(pl.raw_address)
        ELSE NULL
    END AS location_key,
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

-- Appointment Requests (from JotForm) - raw address only, no canonical yet
SELECT
    'appt_request'::text AS entity_type,
    ar.id::text AS entity_id,
    COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name), 'Form ' || ar.id::text) AS display_label,
    LOWER(COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name), '')) || ' ' ||
        LOWER(COALESCE(ar.cats_address, ar.requester_address, '')) || ' ' || COALESCE(ar.phone, '') AS search_text,
    COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name)) AS name_text,
    COALESCE(ar.cats_address_clean, ar.cats_address, ar.requester_address) AS address_display,
    -- Namespaced: forms always use raw: prefix (no canonical yet)
    CASE
        WHEN ar.cats_address IS NOT NULL OR ar.requester_address IS NOT NULL THEN
            'raw:' || md5(COALESCE(ar.cats_address, ar.requester_address, ''))
        ELSE NULL
    END AS location_key,
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

COMMENT ON VIEW trapper.v_search_sot_unified IS
'Unified search view with namespaced location_key for grouping.
Prefixes: place:<key>, addr:<id>, raw:<hash>
Powers typeahead in /new-request. MIG_132 adds namespacing.';
