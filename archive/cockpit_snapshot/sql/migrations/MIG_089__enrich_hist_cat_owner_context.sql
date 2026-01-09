-- MIG_089__enrich_hist_cat_owner_context.sql
-- Enriches hist_cat search results with owner context (name, phone, email, address)
--
-- Key changes from MIG_088:
-- 1. hist_cat now JOINs to hist_owners via appt_number
-- 2. hist_cat rows include: owner_name, owner_phone, owner_email, owner_address
-- 3. address_display for hist_cat shows owner address (raw/unverified)
-- 4. Added extra columns for UI enrichment: microchip_number, surgery_info
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_089__enrich_hist_cat_owner_context.sql

-- ============================================
-- Drop and recreate the view (adds new columns)
-- ============================================

DROP VIEW IF EXISTS trapper.v_search_unified_v2;

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
             THEN best_place.raw_address END
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
    p.email::text AS email_normalized,
    -- Extra context columns (NULL for person)
    NULL::text AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name
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
             THEN pl.raw_address END
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
    NULL::text AS email_normalized,
    NULL::text AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name
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
    COALESCE(a.formatted_address, COALESCE(a.raw_text, a.raw_address)) AS address_display,
    a.formatted_address IS NOT NULL AS address_canonical,
    NULL::text AS phone_text,
    NULL::text AS email_text,
    a.city,
    a.postal_code,
    a.location,
    a.created_at AS relevant_date,
    NULL::text AS status,
    NULL::text AS phone_normalized,
    NULL::text AS email_normalized,
    NULL::text AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name
FROM trapper.addresses a

UNION ALL

-- ============================================
-- REQUESTS
-- Human-first labeling: name_text = person/place name
-- display_label = case_number (for search matching)
-- ============================================
SELECT
    'request'::text AS entity_type,
    r.id AS entity_id,
    r.case_number AS display_label,
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
    -- name_text: prefer person name, then place name (for human-first display)
    COALESCE(
        person.full_name,
        CONCAT_WS(' ', person.first_name, person.last_name),
        pl.name,
        pl.display_name
    ) AS name_text,
    -- Canonical address preferred
    COALESCE(
        addr.formatted_address,
        CASE WHEN pl.raw_address IS NOT NULL
             THEN pl.raw_address END
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
    person.email::text AS email_normalized,
    NULL::text AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name
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
    COALESCE(ar.cats_address_clean, ar.cats_address) AS address_display,
    false AS address_canonical,
    COALESCE(ar.phone_normalized, ar.phone) AS phone_text,
    ar.email AS email_text,
    ar.requester_city AS city,
    ar.requester_zip AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    COALESCE(ar.submitted_at, ar.created_at) AS relevant_date,
    ar.submission_status AS status,
    ar.phone_normalized,
    ar.email AS email_normalized,
    NULL::text AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name
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
    ca.client_address AS address_display,
    false AS address_canonical,
    CONCAT_WS(' ', ca.phone_normalized, ca.client_phone, ca.client_cell_phone) AS phone_text,
    ca.client_email AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    ca.appt_date::timestamp with time zone AS relevant_date,
    ca.client_type AS status,
    ca.phone_normalized,
    ca.client_email AS email_normalized,
    NULL::text AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name
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
    ho.owner_address AS address_display,
    false AS address_canonical,
    CONCAT_WS(' ', ho.phone_normalized, ho.owner_phone, ho.owner_cell_phone) AS phone_text,
    ho.owner_email AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    ho.appt_date::timestamp with time zone AS relevant_date,
    ho.client_type AS status,
    ho.phone_normalized,
    ho.owner_email AS email_normalized,
    ho.microchip_number AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name
FROM trapper.clinichq_hist_owners ho

UNION ALL

-- ============================================
-- CLINICHQ HISTORICAL CATS
-- NOW ENRICHED with owner context!
-- Searchable by microchip, animal name
-- ============================================
SELECT
    'hist_cat'::text AS entity_type,
    hc.id AS entity_id,
    -- Display label: cat name + microchip (for recognition)
    CASE
        WHEN hc.animal_name IS NOT NULL AND hc.microchip_number IS NOT NULL
        THEN hc.animal_name || ' - ' || hc.microchip_number
        WHEN hc.microchip_number IS NOT NULL
        THEN 'Unknown - ' || hc.microchip_number
        ELSE COALESCE(hc.animal_name, 'Unknown cat') || ' - ' || hc.appt_date::text
    END AS display_label,
    -- Search text now includes owner info for cross-search
    CONCAT_WS(' ',
        hc.animal_name,
        hc.microchip_number,
        hc.appt_number,
        hc.breed,
        hc.primary_color,
        hc.secondary_color,
        ho.owner_first_name,
        ho.owner_last_name,
        ho.owner_email,
        ho.owner_phone,
        ho.phone_normalized,
        ho.owner_address
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ', hc.animal_name, hc.microchip_number, hc.appt_number, hc.breed,
                       ho.owner_first_name, ho.owner_last_name)
    ) AS search_text_normalized,
    hc.animal_name AS name_text,
    -- Owner address (raw/unverified) - now populated!
    ho.owner_address AS address_display,
    false AS address_canonical,  -- Historical addresses are always raw
    -- Owner phone
    CONCAT_WS(' ', ho.phone_normalized, ho.owner_phone, ho.owner_cell_phone) AS phone_text,
    -- Owner email
    ho.owner_email AS email_text,
    NULL::text AS city,
    NULL::text AS postal_code,
    NULL::geometry(Point, 4326) AS location,
    hc.appt_date::timestamp with time zone AS relevant_date,
    hc.spay_neuter_status AS status,
    ho.phone_normalized,
    ho.owner_email AS email_normalized,
    -- Extra context for hist_cat
    hc.microchip_number AS microchip_number,
    -- Surgery info from linked appt
    CASE
        WHEN ha.spay THEN 'Spay'
        WHEN ha.neuter THEN 'Neuter'
        WHEN ha.pregnant THEN 'Pregnant'
        WHEN ha.pyometra THEN 'Pyometra'
        WHEN ha.cryptorchid THEN 'Cryptorchid'
        ELSE hc.spay_neuter_status
    END AS surgery_info,
    -- Owner name for display
    CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name) AS owner_name
FROM trapper.clinichq_hist_cats hc
LEFT JOIN trapper.clinichq_hist_owners ho ON ho.appt_number = hc.appt_number
LEFT JOIN trapper.clinichq_hist_appts ha ON ha.appt_number = hc.appt_number;

-- ============================================
-- Add comment
-- ============================================

COMMENT ON VIEW trapper.v_search_unified_v2 IS
'Enhanced unified search view (v2.1) with:
- Canonical address display (address_display, address_canonical)
- Normalized search text for fast fuzzy matching
- Human-first request labeling (name_text = person/place name)
- Enriched hist_cat with owner context (owner_name, phone, email, address)
- Extra columns: microchip_number, surgery_info, owner_name

Entity types: person, place, address, request, appt_request, clinichq_appt, hist_owner, hist_cat

For hist_cat results, owner context comes from joining to hist_owners via appt_number.
Addresses from historical sources are always address_canonical=false (raw/unverified).';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'v_search_unified_v2 recreated with owner context for hist_cat.'
\echo ''
\echo 'Checking hist_cat enrichment:'

SELECT
    'hist_cat rows' AS metric,
    COUNT(*) AS value
FROM trapper.v_search_unified_v2
WHERE entity_type = 'hist_cat'
UNION ALL
SELECT
    'hist_cat with owner_name',
    COUNT(*)
FROM trapper.v_search_unified_v2
WHERE entity_type = 'hist_cat' AND owner_name IS NOT NULL AND owner_name != ''
UNION ALL
SELECT
    'hist_cat with address_display',
    COUNT(*)
FROM trapper.v_search_unified_v2
WHERE entity_type = 'hist_cat' AND address_display IS NOT NULL AND address_display != ''
UNION ALL
SELECT
    'hist_cat with phone_text',
    COUNT(*)
FROM trapper.v_search_unified_v2
WHERE entity_type = 'hist_cat' AND phone_text IS NOT NULL AND phone_text != ''
UNION ALL
SELECT
    'hist_cat with microchip_number',
    COUNT(*)
FROM trapper.v_search_unified_v2
WHERE entity_type = 'hist_cat' AND microchip_number IS NOT NULL;

\echo ''
\echo 'Sample enriched hist_cat rows:'

SELECT
    display_label,
    owner_name,
    LEFT(address_display, 40) AS address_short,
    phone_text,
    microchip_number,
    surgery_info,
    relevant_date::date
FROM trapper.v_search_unified_v2
WHERE entity_type = 'hist_cat'
  AND owner_name IS NOT NULL
ORDER BY relevant_date DESC NULLS LAST
LIMIT 5;
