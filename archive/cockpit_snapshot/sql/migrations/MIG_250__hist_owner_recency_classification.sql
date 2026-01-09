-- MIG_250__hist_owner_recency_classification.sql
-- MEGA_005: Recency-based classification for ClinicHQ history owners
--
-- Fixes the "Sally Bug": recent ClinicHQ clients should NOT be labeled "historical-only"
-- when they have recent appointments. "hist_owner" means "sourced from ClinicHQ history",
-- NOT "stale/old data".
--
-- Classification:
--   active: last appointment within 24 months AND has phone/email
--   dormant: 24-84 months old OR active but missing identifiers
--   historical_only_candidate: >84 months OR low quality data
--
-- Usage:
--   export PATH="/opt/homebrew/Cellar/libpq/18.1/bin:$PATH"
--   set -a && source .env && set +a
--   psql "$DATABASE_URL" -f sql/migrations/MIG_250__hist_owner_recency_classification.sql

-- ============================================================
-- PART 1: Owner Activity Aggregation View
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_clinichq_owner_activity AS
WITH owner_agg AS (
    SELECT
        -- Stable owner key (phone + email combo)
        COALESCE(phone_normalized, '') || '|' || COALESCE(LOWER(owner_email), '') AS owner_key,
        -- Pick one representative ID
        MIN(id) AS representative_id,
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
        bool_or(owner_address IS NOT NULL AND LENGTH(owner_address) > 5) AS has_address
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
    -- Months since last appointment
    EXTRACT(MONTH FROM AGE(CURRENT_DATE, last_appt_date))::int +
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, last_appt_date))::int * 12 AS months_since_last_appt,
    -- Data quality score (0-100)
    (
        CASE WHEN has_email THEN 30 ELSE 0 END +
        CASE WHEN has_phone THEN 40 ELSE 0 END +
        CASE WHEN has_address THEN 20 ELSE 0 END +
        CASE WHEN total_appts > 1 THEN 10 ELSE 0 END
    ) AS data_quality_score
FROM owner_agg;

COMMENT ON VIEW trapper.v_clinichq_owner_activity IS
'Aggregated ClinicHQ owner activity with recency metrics and data quality scoring.
Use for classification and matching candidate generation.';

-- ============================================================
-- PART 2: Owner Classification View
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_hist_owner_classification AS
SELECT
    oa.owner_key,
    oa.representative_id,
    oa.display_name,
    oa.owner_email,
    oa.phone_normalized,
    oa.last_appt_date,
    oa.total_appts,
    oa.data_quality_score,
    oa.months_since_last_appt,
    oa.has_email,
    oa.has_phone,

    -- Classification logic
    CASE
        -- ACTIVE: Recent (within 24 months) AND has at least phone or email
        WHEN oa.months_since_last_appt <= 24 AND (oa.has_phone OR oa.has_email)
        THEN 'active'

        -- DORMANT: 24-84 months OR recent but missing identifiers
        WHEN oa.months_since_last_appt <= 84 OR (oa.months_since_last_appt <= 24 AND NOT oa.has_phone AND NOT oa.has_email)
        THEN 'dormant'

        -- HISTORICAL_ONLY_CANDIDATE: Very old OR low quality
        ELSE 'historical_only_candidate'
    END AS classification,

    -- Human-readable reason
    CASE
        WHEN oa.months_since_last_appt <= 24 AND (oa.has_phone OR oa.has_email)
        THEN 'Recent activity (' || oa.months_since_last_appt || ' months ago) with contact info'

        WHEN oa.months_since_last_appt <= 24 AND NOT oa.has_phone AND NOT oa.has_email
        THEN 'Recent but missing phone/email - needs review'

        WHEN oa.months_since_last_appt <= 84
        THEN 'Last seen ' || oa.months_since_last_appt || ' months ago'

        ELSE 'Inactive >7 years, low confidence'
    END AS classification_reason,

    -- Is this explicitly marked as historical-only?
    trapper.is_historical_only('clinichq', oa.representative_id::text) AS is_marked_historical_only,

    -- Can this be promoted to canonical person?
    CASE
        WHEN trapper.is_historical_only('clinichq', oa.representative_id::text) THEN FALSE
        WHEN oa.months_since_last_appt <= 24 AND (oa.has_phone OR oa.has_email) THEN TRUE
        WHEN oa.data_quality_score >= 70 THEN TRUE
        ELSE FALSE
    END AS is_promotable

FROM trapper.v_clinichq_owner_activity oa;

COMMENT ON VIEW trapper.v_hist_owner_classification IS
'Classification of ClinicHQ owners by recency and data quality.
active = recent + good identifiers (promotable)
dormant = older but coherent
historical_only_candidate = very old or low quality';

-- ============================================================
-- PART 3: Update historical_only_markers guardrails
-- ============================================================

-- Add a guardrail function that prevents marking recent active owners as historical-only
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
    v_is_active BOOLEAN;
    v_classification TEXT;
BEGIN
    -- For clinichq hist_owners, check if they're active (recent)
    IF p_source_system = 'clinichq' AND p_entity_type = 'hist_owner' THEN
        SELECT
            classification = 'active',
            classification
        INTO v_is_active, v_classification
        FROM trapper.v_hist_owner_classification hoc
        WHERE hoc.representative_id::text = p_source_record_id;

        -- Block marking active owners as historical-only unless forced
        IF v_is_active AND NOT p_force THEN
            RAISE EXCEPTION 'Cannot mark active ClinicHQ owner as historical-only. Classification: %. Use p_force=TRUE to override.', v_classification;
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
'Safe version of mark_historical_only that prevents marking active ClinicHQ owners.
Use p_force=TRUE to override for edge cases.';

-- ============================================================
-- PART 4: Update v_search_unified_v2 with classification
-- ============================================================

-- First, we need to update the hist_owner section to include classification
-- We'll recreate the entire view (since we can't modify just one UNION ALL section)

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
    NULL::text AS hist_owner_class  -- MEGA_005: Classification field (NULL for canonical people)
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
    NULL::text AS hist_owner_class
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
    NULL::text AS hist_owner_class
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
    NULL::text AS hist_owner_class
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
    NULL::text AS hist_owner_class
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
    NULL::text AS hist_owner_class
FROM trapper.clinichq_upcoming_appointments ca

UNION ALL

-- ============================================
-- CLINICHQ HISTORICAL OWNERS (with classification)
-- MEGA_005: Added hist_owner_class field
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
    -- MEGA_005: Classification based on recency and data quality
    COALESCE(hoc.classification, 'unknown') AS hist_owner_class
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
    NULL::text AS hist_owner_class
FROM trapper.clinichq_hist_cats hc;

COMMENT ON VIEW trapper.v_search_unified_v2 IS
'Enhanced unified search view (v2) with canonical address display and hist_owner classification.
hist_owner_class: active (recent + identifiers), dormant (older), historical_only_candidate (very old/low quality).';

-- ============================================================
-- PART 5: Safe Promotion Function
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
    v_classification TEXT;
    v_existing_person_id UUID;
    v_new_person_id UUID;
    v_confidence NUMERIC;
BEGIN
    -- Get owner info and classification
    SELECT
        ho.id, ho.owner_first_name, ho.owner_last_name, ho.owner_email,
        ho.phone_normalized, ho.owner_address,
        hoc.classification, hoc.is_promotable, hoc.is_marked_historical_only
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

    -- Check if promotable
    IF NOT v_owner.is_promotable AND NOT p_force THEN
        RETURN QUERY SELECT 'blocked'::text, NULL::uuid, 'Owner classification (' || v_owner.classification || ') is not promotable. Use p_force=TRUE to override.';
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
    -- Tier 0: email+name OR phone+name
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

        -- Add aliases for any new variants
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

    -- No existing match - create new canonical person if has good identifiers
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

    -- Not enough identifiers to create safely
    RETURN QUERY SELECT 'skipped'::text, NULL::uuid, 'Not enough identifiers to create canonical person safely';
END;
$$;

COMMENT ON FUNCTION trapper.promote_hist_owner_to_person IS
'Safely promote a hist_owner to a canonical person by linking or creating.
Returns: action (linked, created, blocked, skipped, error), person_id, message.
All operations are auditable via person_link_audit.';

-- ============================================================
-- PART 6: Verification
-- ============================================================

\echo ''
\echo 'MIG_250 applied. Verifying recency classification:'
\echo ''

\echo 'Owner classification distribution:'
SELECT classification, COUNT(*) AS count
FROM trapper.v_hist_owner_classification
GROUP BY classification
ORDER BY count DESC;

\echo ''
\echo 'Sample ACTIVE owners (most recent):'
SELECT
    display_name,
    owner_email,
    phone_normalized,
    last_appt_date,
    total_appts,
    classification,
    is_promotable
FROM trapper.v_hist_owner_classification
WHERE classification = 'active'
ORDER BY last_appt_date DESC
LIMIT 10;

\echo ''
\echo 'Test: Search for Sally Gronski:'
SELECT entity_type, display_label, hist_owner_class, relevant_date::date
FROM trapper.v_search_unified_v2
WHERE search_text_normalized ILIKE '%sally%gronski%' OR search_text ILIKE '%sally%gronski%'
ORDER BY relevant_date DESC NULLS LAST
LIMIT 5;
