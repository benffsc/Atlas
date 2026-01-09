-- MIG_251__recency_buckets_and_entity_kind.sql
-- MEGA_006: Refined recency buckets + entity kind classification
--
-- Updates from MEGA_005:
-- - New recency buckets: active (≤24mo), resurgence (24-36mo), fade (36-48mo), archival (>48mo)
-- - Adds owner_entity_kind: person_like, place_like, colony_like, unknown
-- - Protects ACTIVE and RESURGENCE from auto-demotion
-- - Adds place_like detection heuristics
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_251__recency_buckets_and_entity_kind.sql

-- ============================================================
-- PART 1: Place-like Detection Patterns
-- ============================================================

-- Business/org keywords that suggest place_like
CREATE OR REPLACE FUNCTION trapper.is_place_like_name(name_text TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(name_text, '') ~* ANY(ARRAY[
        -- Business suffixes
        '\y(LLC|Inc|Corp|Co|Ltd|Company)\y',
        '\y(Fitness|Gym|Studio|Salon|Shop|Store|Market|Restaurant|Cafe|Bar|Hotel|Motel|Inn)\y',
        '\y(School|District|University|College|Academy|Institute)\y',
        '\y(Church|Temple|Mosque|Synagogue|Chapel)\y',
        '\y(Hospital|Clinic|Medical|Health|Dental|Veterinary|Vet)\y',
        '\y(Farm|Ranch|Vineyard|Winery|Dairy)\y',
        '\y(Park|Plaza|Center|Centre|Mall|Building|Tower|Complex)\y',
        '\y(Association|Foundation|Society|Organization|Club)\y',
        '\y(County|City|Town|Village|Municipal|Government)\y',
        -- Address patterns (name looks like an address)
        '^\d+\s+[A-Za-z]',  -- Starts with number + word (like "111 Sebastopol Rd")
        '\y(Rd|Road|St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Hwy|Highway)\y$',
        -- Intersection/road segment patterns
        '\y(and|&|/)\y.*\y(Rd|Road|St|Street|Ave|Avenue)\y',
        '^(Joe Rodota|Laguna|Santa Rosa Creek|Prince Memorial)',  -- Known trail/area patterns
        -- Generic/nonsense patterns
        '^(Unknown|None|N/A|NA|Test|Sample|Feral|Stray|Colony|Community|TNR)\y',
        '^\s*$'  -- Empty or whitespace
    ]);
$$;

COMMENT ON FUNCTION trapper.is_place_like_name IS
'Detect if a name looks like a business/place/address rather than a person name.';

-- Colony-like detection (specific patterns for feral cat colonies)
CREATE OR REPLACE FUNCTION trapper.is_colony_like_name(name_text TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(name_text, '') ~* ANY(ARRAY[
        '\y(Colony|Feral|Stray|Community Cat|TNR|Barn Cat)\y',
        '\y(Caretaker|Feeder|Colony Manager)\y',
        '^(Behind|Near|At|By)\s+',  -- "Behind the store", "Near the park"
        '\y(Trail|Creek|River|Lake|Pond|Field|Lot|Parking|Dumpster)\y'
    ]);
$$;

COMMENT ON FUNCTION trapper.is_colony_like_name IS
'Detect if a name suggests a feral cat colony rather than an individual owner.';

-- ============================================================
-- PART 2: Updated Owner Activity View (with entity kind hints)
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_clinichq_owner_activity AS
WITH owner_agg AS (
    SELECT
        -- Stable owner key (phone + email combo)
        COALESCE(phone_normalized, '') || '|' || COALESCE(LOWER(owner_email), '') AS owner_key,
        -- Pick one representative ID (most recent appointment's owner)
        (ARRAY_AGG(id ORDER BY appt_date DESC NULLS LAST))[1] AS representative_id,
        -- Name (from most recent appt)
        (ARRAY_AGG(owner_first_name ORDER BY appt_date DESC NULLS LAST))[1] AS owner_first_name,
        (ARRAY_AGG(owner_last_name ORDER BY appt_date DESC NULLS LAST))[1] AS owner_last_name,
        -- Best identifiers
        MAX(owner_email) AS owner_email,
        MAX(phone_normalized) AS phone_normalized,
        MAX(COALESCE(owner_cell_phone, owner_phone)) AS owner_phone,
        MAX(owner_address) AS owner_address,
        -- Activity metrics
        MAX(appt_date) AS last_appt_date,
        MIN(appt_date) AS first_appt_date,
        COUNT(*) AS total_appts,
        COUNT(*) FILTER (WHERE appt_date >= CURRENT_DATE - INTERVAL '12 months') AS appts_last_12mo,
        COUNT(*) FILTER (WHERE appt_date >= CURRENT_DATE - INTERVAL '24 months') AS appts_last_24mo,
        -- Data quality flags
        bool_or(owner_email IS NOT NULL AND owner_email != '' AND owner_email LIKE '%@%') AS has_email,
        bool_or(phone_normalized IS NOT NULL AND LENGTH(phone_normalized) >= 10) AS has_phone,
        bool_or(owner_address IS NOT NULL AND LENGTH(owner_address) > 5) AS has_address,
        -- Aggregate all distinct names for entity kind detection
        string_agg(DISTINCT CONCAT_WS(' ', owner_first_name, owner_last_name), ' | ') AS all_names
    FROM trapper.clinichq_hist_owners
    WHERE owner_first_name IS NOT NULL AND owner_first_name != ''
    GROUP BY
        COALESCE(phone_normalized, '') || '|' || COALESCE(LOWER(owner_email), '')
)
SELECT
    owner_key,
    representative_id,
    CONCAT_WS(' ', owner_first_name, owner_last_name) AS display_name,
    owner_first_name,
    owner_last_name,
    owner_email,
    phone_normalized,
    owner_phone,
    owner_address,
    last_appt_date,
    first_appt_date,
    total_appts,
    appts_last_12mo,
    appts_last_24mo,
    has_email,
    has_phone,
    has_address,
    all_names,
    -- Months since last appointment
    EXTRACT(MONTH FROM AGE(CURRENT_DATE, last_appt_date))::int +
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, last_appt_date))::int * 12 AS months_since_last_appt,
    -- Data quality score (0-100)
    (
        CASE WHEN has_email THEN 30 ELSE 0 END +
        CASE WHEN has_phone THEN 40 ELSE 0 END +
        CASE WHEN has_address THEN 20 ELSE 0 END +
        CASE WHEN total_appts > 1 THEN 10 ELSE 0 END
    ) AS data_quality_score,
    -- MEGA_006: Entity kind hints
    trapper.is_place_like_name(CONCAT_WS(' ', owner_first_name, owner_last_name)) AS name_is_place_like,
    trapper.is_colony_like_name(CONCAT_WS(' ', owner_first_name, owner_last_name)) AS name_is_colony_like,
    trapper.is_place_like_name(owner_address) AS address_is_place_like
FROM owner_agg;

COMMENT ON VIEW trapper.v_clinichq_owner_activity IS
'Aggregated ClinicHQ owner activity with recency metrics, data quality scoring, and entity kind hints.
MEGA_006: Added name_is_place_like, name_is_colony_like, address_is_place_like flags.';

-- ============================================================
-- PART 3: Updated Classification View with new buckets + entity kind
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_hist_owner_classification AS
SELECT
    oa.owner_key,
    oa.representative_id,
    oa.display_name,
    oa.owner_first_name,
    oa.owner_last_name,
    oa.owner_email,
    oa.phone_normalized,
    oa.owner_address,
    oa.last_appt_date,
    oa.first_appt_date,
    oa.total_appts,
    oa.data_quality_score,
    oa.months_since_last_appt,
    oa.has_email,
    oa.has_phone,
    oa.has_address,
    oa.name_is_place_like,
    oa.name_is_colony_like,
    oa.address_is_place_like,

    -- MEGA_006: Recency bucket (active/resurgence/fade/archival)
    CASE
        WHEN oa.months_since_last_appt <= 24 THEN 'active'
        WHEN oa.months_since_last_appt <= 36 THEN 'resurgence'
        WHEN oa.months_since_last_appt <= 48 THEN 'fade'
        ELSE 'archival'
    END AS recency_bucket,

    -- MEGA_006: Owner entity kind (person_like/place_like/colony_like/unknown)
    CASE
        WHEN oa.name_is_colony_like THEN 'colony_like'
        WHEN oa.name_is_place_like THEN 'place_like'
        WHEN oa.address_is_place_like AND NOT oa.has_email AND oa.display_name ~* '^\d' THEN 'place_like'
        WHEN oa.has_email OR oa.has_phone THEN 'person_like'
        WHEN oa.data_quality_score >= 50 THEN 'person_like'
        ELSE 'unknown'
    END AS owner_entity_kind,

    -- Combined classification for backwards compatibility
    CASE
        WHEN oa.months_since_last_appt <= 24 AND (oa.has_phone OR oa.has_email) THEN 'active'
        WHEN oa.months_since_last_appt <= 36 THEN 'resurgence'
        WHEN oa.months_since_last_appt <= 48 THEN 'fade'
        ELSE 'archival'
    END AS classification,

    -- Human-readable recency reason
    CASE
        WHEN oa.months_since_last_appt <= 24 THEN 'Active client (' || oa.months_since_last_appt || ' months ago)'
        WHEN oa.months_since_last_appt <= 36 THEN 'Resurgence window (' || oa.months_since_last_appt || ' months)'
        WHEN oa.months_since_last_appt <= 48 THEN 'Fading (' || oa.months_since_last_appt || ' months)'
        ELSE 'Archival (>' || oa.months_since_last_appt || ' months)'
    END AS recency_reason,

    -- Human-readable entity kind reason
    CASE
        WHEN oa.name_is_colony_like THEN 'Name suggests feral colony/community cats'
        WHEN oa.name_is_place_like THEN 'Name looks like business/place/address'
        WHEN oa.address_is_place_like AND NOT oa.has_email THEN 'Address-based account without personal email'
        WHEN oa.has_email AND oa.has_phone THEN 'Has email and phone - likely person'
        WHEN oa.has_email OR oa.has_phone THEN 'Has contact info - likely person'
        ELSE 'Unknown - needs review'
    END AS entity_kind_reason,

    -- Is this explicitly marked as historical-only?
    trapper.is_historical_only('clinichq', oa.representative_id::text) AS is_marked_historical_only,

    -- MEGA_006: Can this be promoted to canonical person?
    -- Only person_like entities that are not archival
    CASE
        WHEN trapper.is_historical_only('clinichq', oa.representative_id::text) THEN FALSE
        WHEN oa.name_is_place_like OR oa.name_is_colony_like THEN FALSE
        WHEN oa.months_since_last_appt <= 36 AND (oa.has_phone OR oa.has_email) THEN TRUE
        WHEN oa.data_quality_score >= 70 THEN TRUE
        ELSE FALSE
    END AS is_promotable_to_person,

    -- MEGA_006: Can this be promoted to canonical place?
    CASE
        WHEN trapper.is_historical_only('clinichq', oa.representative_id::text) THEN FALSE
        WHEN oa.name_is_place_like OR oa.name_is_colony_like THEN TRUE
        WHEN oa.address_is_place_like AND oa.has_address THEN TRUE
        ELSE FALSE
    END AS is_promotable_to_place,

    -- MEGA_006: Is demotion allowed? (only archival + low quality)
    CASE
        WHEN oa.months_since_last_appt <= 36 THEN FALSE  -- Never demote ACTIVE or RESURGENCE
        WHEN oa.months_since_last_appt <= 48 AND oa.data_quality_score >= 50 THEN FALSE  -- Don't demote decent FADE
        ELSE TRUE  -- ARCHIVAL or very low quality FADE can be demoted
    END AS is_demotable

FROM trapper.v_clinichq_owner_activity oa;

COMMENT ON VIEW trapper.v_hist_owner_classification IS
'MEGA_006: Classification of ClinicHQ owners by recency bucket and entity kind.
recency_bucket: active (≤24mo), resurgence (24-36mo), fade (36-48mo), archival (>48mo)
owner_entity_kind: person_like, place_like, colony_like, unknown
Protects ACTIVE and RESURGENCE from auto-demotion.';

-- ============================================================
-- PART 4: Updated Guardrails for Historical-Only Markers
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.mark_historical_only_safe(
    p_source_system TEXT,
    p_source_record_id TEXT,
    p_entity_type TEXT,
    p_reason TEXT,
    p_notes TEXT DEFAULT NULL,
    p_created_by TEXT DEFAULT NULL,
    p_force BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_marker_id UUID;
    v_recency_bucket TEXT;
    v_is_demotable BOOLEAN;
    v_display_name TEXT;
BEGIN
    -- For clinichq hist_owners, check recency and demotability
    IF p_source_system = 'clinichq' AND p_entity_type = 'hist_owner' THEN
        SELECT
            recency_bucket,
            is_demotable,
            display_name
        INTO v_recency_bucket, v_is_demotable, v_display_name
        FROM trapper.v_hist_owner_classification hoc
        WHERE hoc.representative_id::text = p_source_record_id;

        -- MEGA_006: Block marking ACTIVE or RESURGENCE as historical-only unless forced
        IF v_recency_bucket IN ('active', 'resurgence') AND NOT p_force THEN
            RAISE EXCEPTION 'Cannot mark % owner "%" as historical-only. Recency: %. Use p_force=TRUE to override.',
                v_recency_bucket, v_display_name, v_recency_bucket;
        END IF;

        -- Also warn if not demotable (decent FADE)
        IF NOT v_is_demotable AND NOT p_force THEN
            RAISE EXCEPTION 'Owner "%" is not eligible for demotion (recency: %, good data quality). Use p_force=TRUE to override.',
                v_display_name, v_recency_bucket;
        END IF;
    END IF;

    -- Proceed with marking
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

COMMENT ON FUNCTION trapper.mark_historical_only_safe IS
'MEGA_006: Safe version of mark_historical_only that prevents marking ACTIVE/RESURGENCE owners.
Use p_force=TRUE to override for edge cases.';

-- ============================================================
-- PART 5: Update v_search_unified_v2 with recency_bucket + entity_kind
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_search_unified_v2 AS

-- ============================================
-- PEOPLE
-- ============================================
SELECT
    'person'::text AS entity_type,
    p.id AS entity_id,
    COALESCE(p.display_name, p.full_name, CONCAT_WS(' ', p.first_name, p.last_name)) AS display_label,
    CONCAT_WS(' ',
        p.full_name, p.first_name, p.last_name,
        p.email, p.phone, p.phone_normalized,
        array_to_string(p.other_phones, ' '),
        array_to_string(p.other_emails, ' ')
    ) AS search_text,
    trapper.normalize_search_text(
        CONCAT_WS(' ', p.full_name, p.first_name, p.last_name, p.email, p.phone, p.phone_normalized)
    ) AS search_text_normalized,
    COALESCE(p.full_name, CONCAT_WS(' ', p.first_name, p.last_name)) AS name_text,
    COALESCE(
        best_addr.formatted_address,
        CASE WHEN best_place.raw_address IS NOT NULL THEN '(raw) ' || best_place.raw_address END
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
    NULL::text AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name,
    NULL::text AS hist_owner_class,
    NULL::text AS hist_owner_recency,
    NULL::text AS hist_owner_entity_kind
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
-- ============================================
SELECT
    'place'::text AS entity_type,
    pl.id AS entity_id,
    COALESCE(pl.display_name, pl.name, a.formatted_address, pl.raw_address) AS display_label,
    CONCAT_WS(' ', pl.name, pl.display_name, a.formatted_address, pl.raw_address, a.city, a.postal_code) AS search_text,
    trapper.normalize_search_text(CONCAT_WS(' ', pl.name, pl.display_name, a.formatted_address, pl.raw_address)) AS search_text_normalized,
    COALESCE(pl.name, pl.display_name) AS name_text,
    COALESCE(a.formatted_address, CASE WHEN pl.raw_address IS NOT NULL THEN '(raw) ' || pl.raw_address END) AS address_display,
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
    NULL::text AS owner_name,
    NULL::text AS hist_owner_class,
    NULL::text AS hist_owner_recency,
    NULL::text AS hist_owner_entity_kind
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
    CONCAT_WS(' ', a.formatted_address, a.raw_text, a.raw_address, a.city, a.postal_code) AS search_text,
    trapper.normalize_search_text(CONCAT_WS(' ', a.formatted_address, a.raw_text, a.raw_address)) AS search_text_normalized,
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
    NULL::text AS email_normalized,
    NULL::text AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name,
    NULL::text AS hist_owner_class,
    NULL::text AS hist_owner_recency,
    NULL::text AS hist_owner_entity_kind
FROM trapper.addresses a

UNION ALL

-- ============================================
-- REQUESTS
-- ============================================
SELECT
    'request'::text AS entity_type,
    r.id AS entity_id,
    COALESCE(r.case_number, 'Request ' || r.id::text) AS display_label,
    CONCAT_WS(' ',
        r.case_number, r.summary, r.notes,
        addr.formatted_address, pl.raw_address, addr.city, addr.postal_code,
        person.full_name, person.phone_normalized
    ) AS search_text,
    trapper.normalize_search_text(CONCAT_WS(' ', r.case_number, r.summary, addr.formatted_address, pl.raw_address)) AS search_text_normalized,
    person.full_name AS name_text,
    COALESCE(addr.formatted_address, CASE WHEN pl.raw_address IS NOT NULL THEN '(raw) ' || pl.raw_address END) AS address_display,
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
    NULL::text AS owner_name,
    NULL::text AS hist_owner_class,
    NULL::text AS hist_owner_recency,
    NULL::text AS hist_owner_entity_kind
FROM trapper.requests r
LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.addresses addr ON addr.id = COALESCE(pl.primary_address_id, pl.address_id)
LEFT JOIN trapper.people person ON person.id = COALESCE(r.primary_contact_person_id, r.person_id)

UNION ALL

-- ============================================
-- APPOINTMENT REQUESTS (intake/demand)
-- ============================================
SELECT
    'appt_request'::text AS entity_type,
    ar.id AS entity_id,
    COALESCE(ar.requester_name, CONCAT_WS(' ', ar.first_name, ar.last_name)) || COALESCE(' - ' || ar.cats_address, '') AS display_label,
    CONCAT_WS(' ',
        ar.requester_name, ar.first_name, ar.last_name,
        ar.cats_address, ar.cats_address_clean, ar.requester_address,
        ar.email, ar.phone, ar.phone_normalized, ar.requester_city, ar.requester_zip
    ) AS search_text,
    trapper.normalize_search_text(CONCAT_WS(' ', ar.requester_name, ar.first_name, ar.last_name, ar.cats_address, ar.email, ar.phone)) AS search_text_normalized,
    COALESCE(ar.requester_name, CONCAT_WS(' ', ar.first_name, ar.last_name)) AS name_text,
    CASE WHEN ar.cats_address IS NOT NULL OR ar.cats_address_clean IS NOT NULL
         THEN '(raw) ' || COALESCE(ar.cats_address_clean, ar.cats_address) END AS address_display,
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
    NULL::text AS owner_name,
    NULL::text AS hist_owner_class,
    NULL::text AS hist_owner_recency,
    NULL::text AS hist_owner_entity_kind
FROM trapper.appointment_requests ar

UNION ALL

-- ============================================
-- CLINICHQ UPCOMING APPOINTMENTS
-- ============================================
SELECT
    'clinichq_appt'::text AS entity_type,
    ca.id AS entity_id,
    CONCAT_WS(' - ', CONCAT_WS(' ', ca.client_first_name, ca.client_last_name), ca.appt_date::text, ca.animal_name) AS display_label,
    CONCAT_WS(' ',
        ca.client_first_name, ca.client_last_name, ca.client_address,
        ca.animal_name, ca.client_email, ca.client_phone, ca.phone_normalized, ca.client_cell_phone
    ) AS search_text,
    trapper.normalize_search_text(CONCAT_WS(' ', ca.client_first_name, ca.client_last_name, ca.client_address, ca.animal_name)) AS search_text_normalized,
    CONCAT_WS(' ', ca.client_first_name, ca.client_last_name) AS name_text,
    CASE WHEN ca.client_address IS NOT NULL THEN '(raw) ' || ca.client_address END AS address_display,
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
    NULL::text AS owner_name,
    NULL::text AS hist_owner_class,
    NULL::text AS hist_owner_recency,
    NULL::text AS hist_owner_entity_kind
FROM trapper.clinichq_upcoming_appointments ca

UNION ALL

-- ============================================
-- CLINICHQ HISTORICAL OWNERS (with classification + entity kind)
-- MEGA_006: Added recency_bucket + owner_entity_kind
-- ============================================
SELECT
    'hist_owner'::text AS entity_type,
    ho.id AS entity_id,
    CONCAT_WS(' - ', CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name), ho.appt_date::text) AS display_label,
    CONCAT_WS(' ',
        ho.owner_first_name, ho.owner_last_name, ho.owner_address,
        ho.owner_email, ho.owner_phone, ho.phone_normalized, ho.owner_cell_phone, ho.appt_number::text
    ) AS search_text,
    trapper.normalize_search_text(CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name, ho.owner_address, ho.appt_number::text)) AS search_text_normalized,
    CONCAT_WS(' ', ho.owner_first_name, ho.owner_last_name) AS name_text,
    CASE WHEN ho.owner_address IS NOT NULL THEN '(raw) ' || ho.owner_address END AS address_display,
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
    NULL::text AS microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name,
    -- MEGA_006: Classification based on recency (backwards compat)
    COALESCE(hoc.classification, 'unknown') AS hist_owner_class,
    -- MEGA_006: New recency bucket field
    COALESCE(hoc.recency_bucket, 'unknown') AS hist_owner_recency,
    -- MEGA_006: Entity kind (person_like, place_like, colony_like, unknown)
    COALESCE(hoc.owner_entity_kind, 'unknown') AS hist_owner_entity_kind
FROM trapper.clinichq_hist_owners ho
LEFT JOIN trapper.v_hist_owner_classification hoc
    ON hoc.representative_id = ho.id

UNION ALL

-- ============================================
-- CLINICHQ HISTORICAL CATS
-- ============================================
SELECT
    'hist_cat'::text AS entity_type,
    hc.id AS entity_id,
    CONCAT_WS(' - ', COALESCE(hc.animal_name, 'Unknown'), hc.appt_date::text, hc.microchip_number) AS display_label,
    CONCAT_WS(' ', hc.animal_name, hc.microchip_number, hc.appt_number::text, hc.breed, hc.primary_color, hc.secondary_color) AS search_text,
    trapper.normalize_search_text(CONCAT_WS(' ', hc.animal_name, hc.microchip_number, hc.appt_number::text, hc.breed)) AS search_text_normalized,
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
    NULL::text AS email_normalized,
    hc.microchip_number,
    NULL::text AS surgery_info,
    NULL::text AS owner_name,
    NULL::text AS hist_owner_class,
    NULL::text AS hist_owner_recency,
    NULL::text AS hist_owner_entity_kind
FROM trapper.clinichq_hist_cats hc;

COMMENT ON VIEW trapper.v_search_unified_v2 IS
'MEGA_006: Enhanced unified search view with recency_bucket + owner_entity_kind for hist_owner.
hist_owner_recency: active, resurgence, fade, archival
hist_owner_entity_kind: person_like, place_like, colony_like, unknown';

-- ============================================================
-- PART 6: Place-like Candidates Report View
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_place_like_candidates AS
SELECT
    hoc.representative_id,
    hoc.display_name,
    hoc.owner_first_name,
    hoc.owner_last_name,
    hoc.owner_email,
    hoc.phone_normalized,
    hoc.owner_address,
    hoc.last_appt_date,
    hoc.total_appts,
    hoc.recency_bucket,
    hoc.owner_entity_kind,
    hoc.entity_kind_reason,
    hoc.is_promotable_to_place,
    -- Ranking: most recent and most appointments first
    ROW_NUMBER() OVER (ORDER BY hoc.last_appt_date DESC, hoc.total_appts DESC) AS review_rank
FROM trapper.v_hist_owner_classification hoc
WHERE hoc.owner_entity_kind IN ('place_like', 'colony_like')
  AND NOT hoc.is_marked_historical_only
ORDER BY hoc.last_appt_date DESC, hoc.total_appts DESC;

COMMENT ON VIEW trapper.v_place_like_candidates IS
'MEGA_006: Candidates for "promote to place" workflow. These hist_owner records look like businesses/places/colonies rather than people.';

-- ============================================================
-- PART 7: Safe Promote-to-Place Function
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.promote_hist_owner_to_place(
    p_hist_owner_id UUID,
    p_place_name TEXT DEFAULT NULL,
    p_force BOOLEAN DEFAULT FALSE,
    p_created_by TEXT DEFAULT 'system'
)
RETURNS TABLE (
    action TEXT,
    place_id UUID,
    message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_owner RECORD;
    v_entity_kind TEXT;
    v_existing_place_id UUID;
    v_new_place_id UUID;
    v_final_name TEXT;
BEGIN
    -- Get owner info and classification
    SELECT
        ho.id, ho.owner_first_name, ho.owner_last_name, ho.owner_email,
        ho.phone_normalized, ho.owner_address,
        hoc.owner_entity_kind, hoc.is_promotable_to_place, hoc.is_marked_historical_only
    INTO v_owner
    FROM trapper.clinichq_hist_owners ho
    LEFT JOIN trapper.v_hist_owner_classification hoc ON hoc.representative_id = ho.id
    WHERE ho.id = p_hist_owner_id;

    IF v_owner IS NULL THEN
        RETURN QUERY SELECT 'error'::text, NULL::uuid, 'hist_owner not found';
        RETURN;
    END IF;

    -- Check if marked as historical-only
    IF v_owner.is_marked_historical_only AND NOT p_force THEN
        RETURN QUERY SELECT 'blocked'::text, NULL::uuid, 'Owner is marked historical-only. Use p_force=TRUE to override.';
        RETURN;
    END IF;

    -- Check if promotable to place
    IF NOT v_owner.is_promotable_to_place AND NOT p_force THEN
        RETURN QUERY SELECT 'blocked'::text, NULL::uuid, 'Owner entity_kind (' || v_owner.owner_entity_kind || ') is not promotable to place. Use p_force=TRUE to override.';
        RETURN;
    END IF;

    -- Determine place name
    v_final_name := COALESCE(p_place_name, CONCAT_WS(' ', v_owner.owner_first_name, v_owner.owner_last_name));

    -- Check if already linked to a canonical place via entity_links
    SELECT el.canonical_entity_id INTO v_existing_place_id
    FROM trapper.entity_links el
    WHERE el.source_system = 'clinichq_hist_owners'
      AND el.source_record_id = p_hist_owner_id::text
      AND el.canonical_entity_type = 'place'
      AND el.is_active = TRUE;

    IF v_existing_place_id IS NOT NULL THEN
        RETURN QUERY SELECT 'already_linked'::text, v_existing_place_id, 'Already linked to canonical place';
        RETURN;
    END IF;

    -- Look for existing place with same address (if we have one)
    IF v_owner.owner_address IS NOT NULL AND LENGTH(v_owner.owner_address) > 5 THEN
        SELECT pl.id INTO v_existing_place_id
        FROM trapper.places pl
        WHERE pl.raw_address ILIKE '%' || v_owner.owner_address || '%'
           OR pl.name ILIKE '%' || v_final_name || '%'
        LIMIT 1;

        IF v_existing_place_id IS NOT NULL THEN
            -- Link to existing place
            INSERT INTO trapper.entity_links (
                source_system, source_table, source_record_id,
                canonical_entity_type, canonical_entity_id,
                link_method, link_confidence, created_by
            ) VALUES (
                'clinichq_hist_owners', 'clinichq_hist_owners', p_hist_owner_id::text,
                'place', v_existing_place_id,
                'manual_link', 80, p_created_by
            );

            -- Add alias for the owner name
            INSERT INTO trapper.place_aliases (
                place_id, alias_type, alias_value, alias_raw,
                source_system, source_record_id, created_by
            ) VALUES (
                v_existing_place_id, 'name', LOWER(v_final_name), v_final_name,
                'clinichq', p_hist_owner_id::text, p_created_by
            )
            ON CONFLICT DO NOTHING;

            RETURN QUERY SELECT 'linked'::text, v_existing_place_id, 'Linked to existing place "' || v_final_name || '"';
            RETURN;
        END IF;
    END IF;

    -- No existing place - create new one
    INSERT INTO trapper.places (
        name, display_name, raw_address, created_by
    ) VALUES (
        v_final_name, v_final_name, v_owner.owner_address, p_created_by
    )
    RETURNING id INTO v_new_place_id;

    -- Link source to new place
    INSERT INTO trapper.entity_links (
        source_system, source_table, source_record_id,
        canonical_entity_type, canonical_entity_id,
        link_method, link_confidence, created_by
    ) VALUES (
        'clinichq_hist_owners', 'clinichq_hist_owners', p_hist_owner_id::text,
        'place', v_new_place_id,
        'migration', 100, p_created_by
    );

    -- Add the owner name as an alias
    INSERT INTO trapper.place_aliases (
        place_id, alias_type, alias_value, alias_raw,
        source_system, source_record_id, is_primary, created_by
    ) VALUES (
        v_new_place_id, 'name', LOWER(v_final_name), v_final_name,
        'clinichq', p_hist_owner_id::text, TRUE, p_created_by
    );

    RETURN QUERY SELECT 'created'::text, v_new_place_id, 'Created new place "' || v_final_name || '" from ClinicHQ data';
END;
$$;

COMMENT ON FUNCTION trapper.promote_hist_owner_to_place IS
'MEGA_006: Safely promote a place_like/colony_like hist_owner to a canonical place.
Creates place, links source, and preserves owner name as place alias.';

-- ============================================================
-- PART 8: Update promote_hist_owner_to_person to check entity kind
-- ============================================================

CREATE OR REPLACE FUNCTION trapper.promote_hist_owner_to_person(
    p_hist_owner_id UUID,
    p_force BOOLEAN DEFAULT FALSE,
    p_created_by TEXT DEFAULT 'system'
)
RETURNS TABLE (
    action TEXT,
    person_id UUID,
    message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_owner RECORD;
    v_entity_kind TEXT;
    v_existing_person_id UUID;
    v_new_person_id UUID;
BEGIN
    -- Get owner info and classification
    SELECT
        ho.id, ho.owner_first_name, ho.owner_last_name, ho.owner_email,
        ho.phone_normalized, ho.owner_address,
        hoc.owner_entity_kind, hoc.is_promotable_to_person, hoc.is_marked_historical_only
    INTO v_owner
    FROM trapper.clinichq_hist_owners ho
    LEFT JOIN trapper.v_hist_owner_classification hoc ON hoc.representative_id = ho.id
    WHERE ho.id = p_hist_owner_id;

    IF v_owner IS NULL THEN
        RETURN QUERY SELECT 'error'::text, NULL::uuid, 'hist_owner not found';
        RETURN;
    END IF;

    -- Check if marked as historical-only
    IF v_owner.is_marked_historical_only AND NOT p_force THEN
        RETURN QUERY SELECT 'blocked'::text, NULL::uuid, 'Owner is marked historical-only. Use p_force=TRUE to override.';
        RETURN;
    END IF;

    -- MEGA_006: Block if entity_kind is place_like or colony_like
    IF v_owner.owner_entity_kind IN ('place_like', 'colony_like') AND NOT p_force THEN
        RETURN QUERY SELECT 'blocked'::text, NULL::uuid,
            'Owner looks like a ' || v_owner.owner_entity_kind || '. Use promote_hist_owner_to_place() instead, or p_force=TRUE to override.';
        RETURN;
    END IF;

    -- Check if promotable
    IF NOT v_owner.is_promotable_to_person AND NOT p_force THEN
        RETURN QUERY SELECT 'blocked'::text, NULL::uuid, 'Owner is not promotable to person. Use p_force=TRUE to override.';
        RETURN;
    END IF;

    -- Check if already linked to a canonical person
    SELECT psl.person_id INTO v_existing_person_id
    FROM trapper.person_source_link psl
    WHERE psl.source_system = 'clinichq' AND psl.source_pk = p_hist_owner_id::text;

    IF v_existing_person_id IS NOT NULL THEN
        RETURN QUERY SELECT 'already_linked'::text, v_existing_person_id, 'Already linked to canonical person';
        RETURN;
    END IF;

    -- Look for existing canonical person match (using conservative tiers)
    SELECT p.id INTO v_existing_person_id
    FROM trapper.people p
    WHERE (
        -- Email + name match
        (LOWER(p.email) = LOWER(v_owner.owner_email) AND v_owner.owner_email IS NOT NULL AND v_owner.owner_email LIKE '%@%'
         AND trapper.calculate_name_similarity(CONCAT(v_owner.owner_first_name, ' ', v_owner.owner_last_name), COALESCE(p.display_name, p.full_name)) >= 0.8)
        OR
        -- Phone + name match
        (p.phone_normalized = v_owner.phone_normalized AND v_owner.phone_normalized IS NOT NULL AND LENGTH(v_owner.phone_normalized) >= 10
         AND trapper.calculate_name_similarity(CONCAT(v_owner.owner_first_name, ' ', v_owner.owner_last_name), COALESCE(p.display_name, p.full_name)) >= 0.8)
    )
    LIMIT 1;

    IF v_existing_person_id IS NOT NULL THEN
        -- Link to existing person
        INSERT INTO trapper.person_source_link (
            person_id, source_system, source_pk, confidence, matched_on
        ) VALUES (
            v_existing_person_id, 'clinichq', p_hist_owner_id::text, 0.95,
            ARRAY['phone_or_email', 'name']::text[]
        );

        -- Add aliases
        IF v_owner.owner_email IS NOT NULL THEN
            PERFORM trapper.add_person_alias(v_existing_person_id, 'email', v_owner.owner_email, 'clinichq', p_hist_owner_id::text);
        END IF;
        IF v_owner.phone_normalized IS NOT NULL THEN
            PERFORM trapper.add_person_alias(v_existing_person_id, 'phone', v_owner.phone_normalized, 'clinichq', p_hist_owner_id::text);
        END IF;
        PERFORM trapper.add_person_alias(v_existing_person_id, 'name', CONCAT(v_owner.owner_first_name, ' ', v_owner.owner_last_name), 'clinichq', p_hist_owner_id::text);

        -- Log to audit
        INSERT INTO trapper.person_link_audit (
            action, performed_by, person_id, source_system, source_record_id, reason
        ) VALUES (
            'link_created', p_created_by, v_existing_person_id, 'clinichq', p_hist_owner_id::text,
            'Promoted hist_owner via matching'
        );

        RETURN QUERY SELECT 'linked'::text, v_existing_person_id, 'Linked to existing canonical person (Tier 0 match)';
        RETURN;
    END IF;

    -- No existing match - create new canonical person
    IF v_owner.phone_normalized IS NOT NULL OR (v_owner.owner_email IS NOT NULL AND v_owner.owner_email LIKE '%@%') THEN
        INSERT INTO trapper.people (
            first_name, last_name, full_name, display_name,
            email, phone, phone_normalized, created_by
        ) VALUES (
            v_owner.owner_first_name, v_owner.owner_last_name,
            CONCAT(v_owner.owner_first_name, ' ', v_owner.owner_last_name),
            CONCAT(v_owner.owner_first_name, ' ', v_owner.owner_last_name),
            v_owner.owner_email, v_owner.phone_normalized, v_owner.phone_normalized,
            p_created_by
        )
        RETURNING id INTO v_new_person_id;

        -- Link the source
        INSERT INTO trapper.person_source_link (
            person_id, source_system, source_pk, confidence, matched_on
        ) VALUES (
            v_new_person_id, 'clinichq', p_hist_owner_id::text, 1.0,
            ARRAY['created_from_source']::text[]
        );

        -- Add aliases
        IF v_owner.owner_email IS NOT NULL THEN
            PERFORM trapper.add_person_alias(v_new_person_id, 'email', v_owner.owner_email, 'clinichq', p_hist_owner_id::text, TRUE);
        END IF;
        IF v_owner.phone_normalized IS NOT NULL THEN
            PERFORM trapper.add_person_alias(v_new_person_id, 'phone', v_owner.phone_normalized, 'clinichq', p_hist_owner_id::text, TRUE);
        END IF;
        PERFORM trapper.add_person_alias(v_new_person_id, 'name', CONCAT(v_owner.owner_first_name, ' ', v_owner.owner_last_name), 'clinichq', p_hist_owner_id::text, TRUE);

        -- Log to audit
        INSERT INTO trapper.person_link_audit (
            action, performed_by, person_id, source_system, source_record_id, reason
        ) VALUES (
            'person_created', p_created_by, v_new_person_id, 'clinichq', p_hist_owner_id::text,
            'Created canonical person from hist_owner promotion'
        );

        RETURN QUERY SELECT 'created'::text, v_new_person_id, 'Created new canonical person from ClinicHQ data';
        RETURN;
    END IF;

    -- Not enough identifiers
    RETURN QUERY SELECT 'skipped'::text, NULL::uuid, 'Not enough identifiers to create canonical person safely';
END;
$$;

COMMENT ON FUNCTION trapper.promote_hist_owner_to_person IS
'MEGA_006: Safely promote a person_like hist_owner to a canonical person.
Blocks place_like/colony_like entities - use promote_hist_owner_to_place() instead.';

-- ============================================================
-- PART 9: Verification
-- ============================================================

\echo ''
\echo 'MIG_251 applied. MEGA_006 recency buckets and entity kind classification.'
\echo ''

\echo 'Recency bucket distribution:'
SELECT recency_bucket, COUNT(*) AS count
FROM trapper.v_hist_owner_classification
GROUP BY recency_bucket
ORDER BY
    CASE recency_bucket
        WHEN 'active' THEN 1
        WHEN 'resurgence' THEN 2
        WHEN 'fade' THEN 3
        WHEN 'archival' THEN 4
    END;

\echo ''
\echo 'Entity kind distribution:'
SELECT owner_entity_kind, COUNT(*) AS count
FROM trapper.v_hist_owner_classification
GROUP BY owner_entity_kind
ORDER BY count DESC;

\echo ''
\echo 'Place-like candidates (top 20):'
SELECT display_name, owner_address, recency_bucket, entity_kind_reason
FROM trapper.v_place_like_candidates
LIMIT 20;

\echo ''
\echo 'Sally test - should show ACTIVE:'
SELECT display_name, recency_bucket, owner_entity_kind, last_appt_date
FROM trapper.v_hist_owner_classification
WHERE display_name ILIKE '%sally%gronski%'
ORDER BY last_appt_date DESC
LIMIT 5;
