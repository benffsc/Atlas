-- MIG_1005: V2 Architecture - Historical Data Migration
-- Phase 1, Part 6: Migrate existing V1 data to V2 with date preservation
--
-- This migration copies all existing data from V1 (trapper.*) to V2 (sot.*, ops.*)
-- while preserving original timestamps.
--
-- IMPORTANT: Run this AFTER enabling dual-write triggers (MIG_1004)
-- to ensure new writes don't create duplicates.
--
-- DATE PRESERVATION:
-- - V1 created_at → V2 original_created_at (preserved)
-- - V1 source_created_at → V2 source_created_at (preserved)
-- - NOW() → V2 created_at (migration timestamp)
-- - NOW() → V2 migrated_at (migration timestamp)
--
-- IDEMPOTENT: Uses ON CONFLICT DO NOTHING to allow re-running

-- ============================================================================
-- DISABLE DUAL-WRITE TEMPORARILY
-- ============================================================================
-- Disable dual-write to prevent duplicate writes during migration
SELECT atlas.disable_dual_write();

-- ============================================================================
-- MIGRATE ADDRESSES (sot_addresses → sot.addresses)
-- ============================================================================
\echo ''
\echo '=== Migrating Addresses ==='

INSERT INTO sot.addresses (
    address_id,
    raw_address,
    formatted_address,
    display_line,
    street_number,
    street_name,
    unit_number,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    location,
    geocoding_status,
    geocoded_at,
    address_key,
    quality_score,
    merged_into_address_id,
    created_at,
    updated_at,
    migrated_at,
    original_created_at
)
SELECT
    address_id,
    -- V1 formatted_address → V2 raw_address (original input)
    formatted_address AS raw_address,
    formatted_address,
    -- Compute display_line from components
    COALESCE(
        formatted_address,
        TRIM(CONCAT_WS(', ',
            NULLIF(CONCAT_WS(' ', street_number, route), ''),
            locality,
            CONCAT_WS(' ', admin_area_1, postal_code)
        ))
    ) AS display_line,
    street_number,
    route AS street_name,  -- V1 route → V2 street_name
    unit_normalized AS unit_number,  -- V1 unit_normalized → V2 unit_number
    locality AS city,  -- V1 locality → V2 city
    COALESCE(admin_area_1, 'CA') AS state,  -- V1 admin_area_1 → V2 state
    postal_code,
    COALESCE(country, 'US'),
    lat AS latitude,  -- V1 lat → V2 latitude
    lng AS longitude,  -- V1 lng → V2 longitude
    location::geography AS location,  -- Cast geometry to geography
    -- Map geocode_status to geocoding_status
    CASE geocode_status
        WHEN 'ok' THEN 'success'
        WHEN 'partial' THEN 'success'
        WHEN 'pending' THEN 'pending'
        WHEN 'needs_review' THEN 'pending'
        WHEN 'manual_override' THEN 'manual'
        ELSE 'failed'
    END AS geocoding_status,
    CASE WHEN geocode_status = 'ok' THEN updated_at END AS geocoded_at,
    -- Compute address_key for dedup
    LOWER(CONCAT_WS('|',
        COALESCE(street_number, ''),
        COALESCE(LOWER(route), ''),
        COALESCE(LOWER(locality), ''),
        COALESCE(postal_code, '')
    )) AS address_key,
    confidence_score AS quality_score,  -- V1 confidence_score → V2 quality_score
    NULL::UUID AS merged_into_address_id,  -- V1 didn't have address merging
    NOW(),  -- created_at (V2 migration timestamp)
    NOW(),  -- updated_at
    NOW(),  -- migrated_at
    created_at  -- original_created_at (preserved V1 timestamp)
FROM trapper.sot_addresses
ON CONFLICT (address_id) DO NOTHING;

SELECT 'Addresses migrated: ' || COUNT(*) FROM sot.addresses WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE PLACES (places → sot.places)
-- ============================================================================
\echo ''
\echo '=== Migrating Places ==='

INSERT INTO sot.places (
    place_id,
    display_name,
    formatted_address,
    sot_address_id,
    is_address_backed,
    location,
    service_zone,
    place_kind,
    place_origin,
    parent_place_id,
    unit_identifier,
    disease_risk,
    disease_risk_notes,
    watch_list,
    watch_list_reason,
    has_cat_activity,
    data_source,
    location_type,
    quality_tier,
    merged_into_place_id,
    last_activity_at,
    created_at,
    updated_at,
    migrated_at,
    original_created_at
)
SELECT
    place_id,
    display_name,
    formatted_address,
    sot_address_id,
    COALESCE(sot_address_id IS NOT NULL, FALSE) AS is_address_backed,
    location,
    NULL AS service_zone,  -- V1 doesn't have service_zone
    -- Map V1 place_type ENUM to V2 place_kind TEXT
    CASE COALESCE(confirmed_type, inferred_type)::TEXT
        WHEN 'residence' THEN 'single_family'
        WHEN 'apartment_building' THEN 'apartment_building'
        WHEN 'business' THEN 'business'
        WHEN 'shelter' THEN 'shelter'
        WHEN 'veterinary' THEN 'clinic'
        WHEN 'park' THEN 'outdoor_site'
        WHEN 'trail' THEN 'outdoor_site'
        WHEN 'public_space' THEN 'outdoor_site'
        WHEN 'school' THEN 'business'
        WHEN 'church' THEN 'business'
        ELSE 'unknown'
    END AS place_kind,
    NULL AS place_origin,  -- V1 doesn't have place_origin
    NULL::UUID AS parent_place_id,  -- V1 doesn't have hierarchy
    NULL AS unit_identifier,  -- V1 doesn't have unit_identifier
    FALSE AS disease_risk,  -- V1 doesn't have disease_risk
    NULL AS disease_risk_notes,
    FALSE AS watch_list,  -- V1 doesn't have watch_list
    NULL AS watch_list_reason,
    COALESCE(has_cat_activity, FALSE),
    NULL AS data_source,  -- V1 doesn't have data_source
    -- Convert UPPERCASE location_type ENUM to lowercase TEXT for V2 constraint
    CASE LOWER(location_type::TEXT)
        WHEN 'rooftop' THEN 'rooftop'
        WHEN 'range_interpolated' THEN 'range_interpolated'
        WHEN 'geometric_center' THEN 'geometric_center'
        WHEN 'approximate' THEN 'approximate'
        ELSE NULL
    END AS location_type,
    NULL AS quality_tier,  -- V1 doesn't have quality_tier
    NULL::UUID AS merged_into_place_id,  -- V1 doesn't have place merging
    last_activity_at,
    NOW(),
    NOW(),
    NOW(),
    created_at
FROM trapper.places
ON CONFLICT (place_id) DO NOTHING;

SELECT 'Places migrated: ' || COUNT(*) FROM sot.places WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE PEOPLE (sot_people → sot.people)
-- ============================================================================
\echo ''
\echo '=== Migrating People ==='

INSERT INTO sot.people (
    person_id,
    display_name,
    first_name,
    last_name,
    primary_email,
    primary_phone,
    primary_address_id,
    primary_place_id,
    entity_type,
    is_organization,
    is_system_account,
    is_verified,
    data_quality,
    data_source,
    merged_into_person_id,
    source_system,
    source_record_id,
    created_at,
    updated_at,
    source_created_at,
    migrated_at,
    original_created_at
)
SELECT
    person_id,
    display_name,
    -- V1 doesn't have first_name/last_name - try to parse from display_name
    SPLIT_PART(display_name, ' ', 1) AS first_name,
    CASE
        WHEN POSITION(' ' IN display_name) > 0
        THEN TRIM(SUBSTRING(display_name FROM POSITION(' ' IN display_name) + 1))
        ELSE NULL
    END AS last_name,
    -- Get primary email from person_identifiers
    (SELECT pi.id_value_norm FROM trapper.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.id_type = 'email'
     ORDER BY pi.confidence DESC NULLS LAST, pi.created_at ASC LIMIT 1) AS primary_email,
    -- Get primary phone from person_identifiers
    (SELECT pi.id_value_norm FROM trapper.person_identifiers pi
     WHERE pi.person_id = p.person_id AND pi.id_type = 'phone'
     ORDER BY pi.confidence DESC NULLS LAST, pi.created_at ASC LIMIT 1) AS primary_phone,
    -- V1 doesn't have primary_address_id
    NULL::UUID AS primary_address_id,
    -- Get primary place from person_place_relationships
    (SELECT ppr.place_id FROM trapper.person_place_relationships ppr
     WHERE ppr.person_id = p.person_id
     ORDER BY ppr.confidence DESC NULLS LAST, ppr.created_at ASC LIMIT 1) AS primary_place_id,
    -- Map V1 account_type to V2 entity_type ('person', 'organization', 'unknown')
    CASE COALESCE(p.account_type, 'person')
        WHEN 'person' THEN 'person'
        WHEN 'organization' THEN 'organization'
        WHEN 'org' THEN 'organization'
        WHEN 'migrated_to_account' THEN 'unknown'  -- Migrated to clinic_owner_accounts
        WHEN 'system' THEN 'unknown'  -- System accounts
        ELSE 'person'
    END AS entity_type,
    COALESCE(p.account_type IN ('organization', 'org'), FALSE) AS is_organization,
    FALSE AS is_system_account,  -- V1 doesn't track this
    FALSE AS is_verified,  -- V1 doesn't track this
    -- Map V1 data_quality to V2 values ('verified', 'normal', 'incomplete', 'needs_review', 'garbage')
    CASE COALESCE(p.data_quality, 'normal')
        WHEN 'verified' THEN 'verified'
        WHEN 'normal' THEN 'normal'
        WHEN 'low' THEN 'incomplete'
        WHEN 'needs_review' THEN 'needs_review'
        WHEN 'garbage' THEN 'garbage'
        ELSE 'normal'
    END AS data_quality,
    NULL AS data_source,  -- V1 doesn't have data_source
    merged_into_person_id,
    NULL AS source_system,  -- V1 doesn't track this
    NULL AS source_record_id,  -- V1 doesn't track this
    NOW(),
    NOW(),
    NULL AS source_created_at,  -- V1 doesn't have this
    NOW(),
    created_at
FROM trapper.sot_people p
ON CONFLICT (person_id) DO NOTHING;

SELECT 'People migrated: ' || COUNT(*) FROM sot.people WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE PERSON IDENTIFIERS
-- ============================================================================
\echo ''
\echo '=== Migrating Person Identifiers ==='

INSERT INTO sot.person_identifiers (
    id,
    person_id,
    id_type,
    id_value_raw,
    id_value_norm,
    confidence,
    source_system,
    source_table,
    source_row_id,
    created_at
)
SELECT
    identifier_id AS id,  -- V1 uses identifier_id, V2 uses id
    person_id,
    -- Map V1 id_type to V2 values ('email', 'phone', 'external_id')
    CASE id_type::TEXT
        WHEN 'email' THEN 'email'
        WHEN 'phone' THEN 'phone'
        WHEN 'atlas_id' THEN 'external_id'  -- Atlas internal IDs become external_id
        WHEN 'external_id' THEN 'external_id'
        ELSE 'external_id'  -- Default any unknown to external_id
    END AS id_type,
    COALESCE(id_value_raw, id_value_norm) AS id_value_raw,  -- V1 id_value_raw may be NULL
    id_value_norm,
    COALESCE(confidence, 1.0),
    source_system,
    source_table,
    -- V1 source_row_id is TEXT, V2 is UUID - try to cast if valid UUID
    CASE
        WHEN source_row_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN source_row_id::UUID
        ELSE NULL
    END AS source_row_id,
    COALESCE(created_at, NOW())
FROM trapper.person_identifiers
WHERE person_id IN (SELECT person_id FROM sot.people)
ON CONFLICT (id_type, id_value_norm) DO NOTHING;

SELECT 'Person identifiers migrated: ' || COUNT(*) FROM sot.person_identifiers;

-- ============================================================================
-- MIGRATE CATS (sot_cats → sot.cats)
-- ============================================================================
\echo ''
\echo '=== Migrating Cats ==='

INSERT INTO sot.cats (
    cat_id,
    name,
    microchip,
    clinichq_animal_id,
    shelterluv_animal_id,
    sex,
    breed,
    primary_color,
    secondary_color,
    ear_tip,
    altered_status,
    ownership_type,
    is_deceased,
    deceased_at,
    data_quality,
    data_source,
    merged_into_cat_id,
    source_system,
    source_record_id,
    created_at,
    updated_at,
    source_created_at,
    migrated_at,
    original_created_at
)
SELECT
    cat_id,
    display_name AS name,  -- V1 uses display_name, V2 uses name
    -- Get microchip from cat_identifiers
    (SELECT ci.id_value FROM trapper.cat_identifiers ci
     WHERE ci.cat_id = c.cat_id AND ci.id_type = 'microchip' LIMIT 1) AS microchip,
    -- Get clinichq_animal_id from cat_identifiers
    (SELECT ci.id_value FROM trapper.cat_identifiers ci
     WHERE ci.cat_id = c.cat_id AND ci.id_type = 'clinichq_animal_id' LIMIT 1) AS clinichq_animal_id,
    -- Get shelterluv_animal_id from cat_identifiers
    (SELECT ci.id_value FROM trapper.cat_identifiers ci
     WHERE ci.cat_id = c.cat_id AND ci.id_type = 'shelterluv_animal_id' LIMIT 1) AS shelterluv_animal_id,
    -- Map sex to lowercase (V2 constraint: 'male', 'female', 'unknown')
    CASE LOWER(sex::TEXT)
        WHEN 'male' THEN 'male'
        WHEN 'female' THEN 'female'
        WHEN 'm' THEN 'male'
        WHEN 'f' THEN 'female'
        ELSE 'unknown'
    END AS sex,
    breed,
    primary_color,
    secondary_color,  -- Added in MIG_165
    NULL AS ear_tip,  -- V1 doesn't have ear_tip
    -- Map altered_status to lowercase (V2 constraint: 'spayed', 'neutered', 'intact', 'unknown')
    CASE LOWER(altered_status::TEXT)
        WHEN 'spayed' THEN 'spayed'
        WHEN 'neutered' THEN 'neutered'
        WHEN 'intact' THEN 'intact'
        ELSE 'unknown'
    END AS altered_status,
    NULL AS ownership_type,  -- V1 doesn't have ownership_type
    COALESCE(is_deceased, FALSE),  -- Added in MIG_290
    deceased_date::TIMESTAMPTZ AS deceased_at,  -- V1 uses deceased_date (DATE), V2 uses deceased_at (TIMESTAMPTZ)
    'normal' AS data_quality,  -- V1 doesn't have data_quality
    NULL AS data_source,  -- V1 doesn't have data_source
    NULL::UUID AS merged_into_cat_id,  -- V1 doesn't have cat merging
    NULL AS source_system,  -- V1 doesn't have source_system
    NULL AS source_record_id,  -- V1 doesn't have source_record_id
    NOW(),
    NOW(),
    NULL AS source_created_at,  -- V1 doesn't have source_created_at
    NOW(),
    created_at
FROM trapper.sot_cats c
ON CONFLICT (cat_id) DO NOTHING;

SELECT 'Cats migrated: ' || COUNT(*) FROM sot.cats WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE CAT IDENTIFIERS
-- ============================================================================
\echo ''
\echo '=== Migrating Cat Identifiers ==='

INSERT INTO sot.cat_identifiers (
    id,
    cat_id,
    id_type,
    id_value,
    source_system,
    created_at
)
SELECT
    cat_identifier_id AS id,  -- V1 uses cat_identifier_id, V2 uses id
    cat_id,
    -- Map V1 id_type to V2 valid values
    CASE id_type
        WHEN 'petlink_pet_id' THEN 'petlink_id'  -- V2 uses petlink_id
        ELSE id_type
    END AS id_type,
    id_value,
    source_system,
    COALESCE(created_at, NOW())
FROM trapper.cat_identifiers
WHERE cat_id IN (SELECT cat_id FROM sot.cats)
  -- Filter to only valid V2 id_types
  AND id_type IN ('microchip', 'clinichq_animal_id', 'shelterluv_animal_id', 'airtable_id', 'petlink_pet_id')
ON CONFLICT (id_type, id_value) DO NOTHING;

SELECT 'Cat identifiers migrated: ' || COUNT(*) FROM sot.cat_identifiers;

-- ============================================================================
-- MIGRATE REQUESTS (sot_requests → ops.requests)
-- ============================================================================
\echo ''
\echo '=== Migrating Requests ==='

INSERT INTO ops.requests (
    request_id,
    status,
    priority,
    hold_reason,
    summary,
    notes,
    estimated_cat_count,
    total_cats_reported,
    cat_count_semantic,
    place_id,
    requester_person_id,
    assignment_status,
    no_trapper_reason,
    resolved_at,
    last_activity_at,
    source_system,
    source_record_id,
    created_at,
    updated_at,
    source_created_at,
    migrated_at,
    original_created_at
)
SELECT
    request_id,
    -- Map V1 status to V2 values ('new', 'triaged', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled')
    CASE status::TEXT
        WHEN 'new' THEN 'new'
        WHEN 'triaged' THEN 'triaged'
        WHEN 'scheduled' THEN 'scheduled'
        WHEN 'in_progress' THEN 'in_progress'
        WHEN 'on_hold' THEN 'on_hold'
        WHEN 'completed' THEN 'completed'
        WHEN 'cancelled' THEN 'cancelled'
        WHEN 'redirected' THEN 'cancelled'  -- V1 'redirected' maps to V2 'cancelled'
        WHEN 'closed' THEN 'completed'  -- V1 'closed' maps to V2 'completed'
        ELSE 'new'
    END AS status,
    COALESCE(priority::TEXT, 'normal'),
    hold_reason::TEXT,
    summary,
    notes,
    estimated_cat_count,
    total_cats_reported,
    COALESCE(cat_count_semantic, 'needs_tnr'),
    -- Map to new place table
    (SELECT pl.place_id FROM sot.places pl WHERE pl.place_id = r.place_id),
    -- Map to new person table
    (SELECT p.person_id FROM sot.people p WHERE p.person_id = r.requester_person_id),
    -- Map V1 assignment_status to V2 values ('pending', 'assigned', 'accepted', 'declined', 'no_trapper_needed')
    CASE COALESCE(assignment_status, 'pending')
        WHEN 'pending' THEN 'pending'
        WHEN 'assigned' THEN 'assigned'
        WHEN 'accepted' THEN 'accepted'
        WHEN 'declined' THEN 'declined'
        WHEN 'no_trapper_needed' THEN 'no_trapper_needed'
        WHEN 'client_trapping' THEN 'no_trapper_needed'  -- Client does their own trapping
        WHEN 'self_trapping' THEN 'no_trapper_needed'  -- Same as client_trapping
        ELSE 'pending'
    END AS assignment_status,
    no_trapper_reason,
    resolved_at,
    last_activity_at,
    source_system,
    source_record_id,
    NOW(),
    NOW(),
    source_created_at,  -- CRITICAL: Preserve original request date for attribution
    NOW(),
    created_at
FROM trapper.sot_requests r
ON CONFLICT (request_id) DO NOTHING;

SELECT 'Requests migrated: ' || COUNT(*) FROM ops.requests WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE REQUEST TRAPPER ASSIGNMENTS
-- ============================================================================
\echo ''
\echo '=== Migrating Request Trapper Assignments ==='

INSERT INTO ops.request_trapper_assignments (
    id,
    request_id,
    trapper_person_id,
    assignment_type,
    status,
    assigned_by,
    assigned_at,
    responded_at,
    completed_at,
    notes,
    source_system,
    created_at,
    migrated_at
)
SELECT
    assignment_id AS id,  -- V1 uses assignment_id, V2 uses id
    request_id,
    trapper_person_id,  -- V1 uses trapper_person_id (correct)
    -- V1 uses is_primary (BOOLEAN), V2 uses assignment_type (TEXT)
    CASE WHEN is_primary THEN 'primary' ELSE 'helper' END AS assignment_type,
    -- V1 doesn't have status - derive from unassigned_at
    CASE WHEN unassigned_at IS NOT NULL THEN 'completed' ELSE 'pending' END AS status,
    NULL AS assigned_by,  -- V1 doesn't have assigned_by
    assigned_at,
    NULL AS responded_at,  -- V1 doesn't have responded_at
    unassigned_at AS completed_at,  -- V1 unassigned_at -> V2 completed_at
    assignment_reason AS notes,  -- V1 assignment_reason -> V2 notes
    NULL AS source_system,  -- V1 doesn't have source_system
    NOW(),
    NOW()
FROM trapper.request_trapper_assignments
WHERE request_id IN (SELECT request_id FROM ops.requests)
  AND trapper_person_id IN (SELECT person_id FROM sot.people)
ON CONFLICT (request_id, trapper_person_id) DO NOTHING;

SELECT 'Request trapper assignments migrated: ' || COUNT(*) FROM ops.request_trapper_assignments WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE REQUEST CATS
-- ============================================================================
\echo ''
\echo '=== Migrating Request Cats ==='

INSERT INTO ops.request_cats (
    id,
    request_id,
    cat_id,
    link_type,
    evidence_type,
    source_system,
    created_at,
    migrated_at
)
SELECT
    id,
    request_id,
    cat_id,
    -- V1 uses 'relationship' with value 'subject', map to V2 link_type
    CASE relationship
        WHEN 'subject' THEN 'attributed'
        ELSE 'attributed'
    END AS link_type,
    'inferred' AS evidence_type,  -- V1 doesn't have evidence_type
    NULL AS source_system,  -- V1 doesn't have source_system
    added_at AS created_at,  -- V1 uses added_at, V2 uses created_at
    NOW()
FROM trapper.request_cats
WHERE request_id IN (SELECT request_id FROM ops.requests)
  AND cat_id IN (SELECT cat_id FROM sot.cats)
ON CONFLICT (request_id, cat_id) DO NOTHING;

SELECT 'Request cats migrated: ' || COUNT(*) FROM ops.request_cats WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE INTAKE SUBMISSIONS
-- ============================================================================
\echo ''
\echo '=== Migrating Intake Submissions ==='

INSERT INTO ops.intake_submissions (
    submission_id,
    submitted_at,
    ip_address,
    user_agent,
    first_name,
    last_name,
    email,
    phone,
    requester_address,
    requester_city,
    requester_zip,
    cats_address,
    cats_city,
    cats_zip,
    county,
    ownership_status,
    cat_count_estimate,
    cat_count_text,
    fixed_status,
    has_kittens,
    kitten_count,
    kitten_age_estimate,
    awareness_duration,
    has_medical_concerns,
    medical_description,
    is_emergency,
    cats_being_fed,
    feeder_info,
    has_property_access,
    access_notes,
    is_property_owner,
    situation_description,
    referral_source,
    media_urls,
    triage_category,
    triage_score,
    triage_reasons,
    triage_computed_at,
    reviewed_by,
    reviewed_at,
    review_notes,
    final_category,
    person_id,
    place_id,
    request_id,
    status,
    created_at,
    migrated_at,
    original_created_at
)
SELECT
    submission_id,
    submitted_at,
    ip_address,
    user_agent,
    first_name,
    last_name,
    email,
    phone,
    requester_address,
    requester_city,
    requester_zip,
    cats_address,
    cats_city,
    cats_zip,
    county,
    ownership_status,
    cat_count_estimate,
    cat_count_text,
    fixed_status,
    has_kittens,
    kitten_count,
    kitten_age_estimate,
    awareness_duration,
    has_medical_concerns,
    medical_description,
    is_emergency,
    cats_being_fed,
    feeder_info,
    has_property_access,
    access_notes,
    is_property_owner,
    situation_description,
    referral_source,
    media_urls,
    triage_category::TEXT,
    triage_score,
    triage_reasons,
    triage_computed_at,
    reviewed_by,
    reviewed_at,
    review_notes,
    final_category::TEXT,
    matched_person_id,
    matched_place_id,
    created_request_id,
    -- Map V1 status to V2 values ('new', 'triaged', 'reviewed', 'request_created', 'redirected', 'spam', 'closed')
    CASE status::TEXT
        WHEN 'new' THEN 'new'
        WHEN 'triaged' THEN 'triaged'
        WHEN 'reviewed' THEN 'reviewed'
        WHEN 'request_created' THEN 'request_created'
        WHEN 'redirected' THEN 'redirected'
        WHEN 'spam' THEN 'spam'
        WHEN 'closed' THEN 'closed'
        WHEN 'archived' THEN 'closed'  -- V1 'archived' maps to V2 'closed'
        WHEN 'converted' THEN 'request_created'  -- V1 'converted' maps to V2 'request_created'
        ELSE 'new'
    END AS status,
    NOW(),
    NOW(),
    submitted_at  -- Original submission timestamp
FROM trapper.web_intake_submissions
ON CONFLICT (submission_id) DO NOTHING;

SELECT 'Intake submissions migrated: ' || COUNT(*) FROM ops.intake_submissions WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE APPOINTMENTS
-- ============================================================================
\echo ''
\echo '=== Migrating Appointments ==='

INSERT INTO ops.appointments (
    appointment_id,
    cat_id,
    person_id,
    place_id,
    inferred_place_id,
    appointment_date,
    appointment_number,
    service_type,
    is_spay,
    is_neuter,
    is_alteration,
    vet_name,
    technician,
    temperature,
    medical_notes,
    is_lactating,
    is_pregnant,
    is_in_heat,
    owner_email,
    owner_phone,
    owner_first_name,
    owner_last_name,
    owner_address,
    source_system,
    source_record_id,
    source_row_hash,
    created_at,
    updated_at,
    migrated_at,
    original_created_at
)
SELECT
    appointment_id,
    cat_id,
    person_id,
    place_id,
    inferred_place_id,  -- V1 has this column
    appointment_date,
    appointment_number,
    service_type,
    COALESCE(is_spay, FALSE),
    COALESCE(is_neuter, FALSE),
    COALESCE(is_spay, FALSE) OR COALESCE(is_neuter, FALSE),
    vet_name,
    technician,
    temperature,
    medical_notes,
    is_lactating,
    is_pregnant,
    is_in_heat,
    owner_email,  -- V1 has this
    owner_phone,  -- V1 has this
    NULL::TEXT AS owner_first_name,  -- V1 doesn't have this
    NULL::TEXT AS owner_last_name,   -- V1 doesn't have this
    NULL::TEXT AS owner_address,     -- V1 doesn't have this
    COALESCE(source_system, 'clinichq'),
    source_record_id,
    source_row_hash,
    NOW(),
    NOW(),
    NOW(),
    created_at
FROM trapper.sot_appointments
ON CONFLICT (appointment_id) DO NOTHING;

SELECT 'Appointments migrated: ' || COUNT(*) FROM ops.appointments WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE RELATIONSHIP TABLES
-- ============================================================================
\echo ''
\echo '=== Migrating Relationships ==='

-- Person-Cat relationships
INSERT INTO sot.person_cat (
    id,
    person_id,
    cat_id,
    relationship_type,
    evidence_type,
    confidence,
    source_system,
    source_table,
    created_at,
    migrated_at
)
SELECT
    person_cat_id AS id,  -- V1 uses person_cat_id, V2 uses id
    person_id,
    cat_id,
    -- Map V1 relationship_type to V2 values ('owner', 'adopter', 'foster', 'caretaker', 'colony_caretaker', 'rescuer', 'finder', 'trapper')
    CASE relationship_type
        WHEN 'owner' THEN 'owner'
        WHEN 'adopter' THEN 'adopter'
        WHEN 'foster' THEN 'foster'
        WHEN 'caretaker' THEN 'caretaker'
        WHEN 'colony_caretaker' THEN 'colony_caretaker'
        WHEN 'rescuer' THEN 'rescuer'
        WHEN 'finder' THEN 'finder'
        WHEN 'trapper' THEN 'trapper'
        WHEN 'brought_by' THEN 'trapper'  -- V1 'brought_by' = who brought the cat to clinic = trapper
        ELSE 'caretaker'  -- Default unknown to caretaker
    END AS relationship_type,
    'inferred' AS evidence_type,  -- V1 doesn't have evidence_type
    -- V1 confidence is TEXT ('high', 'medium', 'low'), V2 is NUMERIC
    CASE confidence
        WHEN 'high' THEN 0.9
        WHEN 'medium' THEN 0.7
        WHEN 'low' THEN 0.5
        ELSE 0.8
    END AS confidence,
    source_system,
    source_table,
    created_at,  -- Preserve original created_at
    NOW()
FROM trapper.person_cat_relationships
WHERE person_id IN (SELECT person_id FROM sot.people)
  AND cat_id IN (SELECT cat_id FROM sot.cats)
ON CONFLICT (person_id, cat_id, relationship_type) DO NOTHING;

SELECT 'Person-Cat relationships migrated: ' || COUNT(*) FROM sot.person_cat WHERE migrated_at IS NOT NULL;

-- Cat-Place relationships
INSERT INTO sot.cat_place (
    id,
    cat_id,
    place_id,
    relationship_type,
    evidence_type,
    confidence,
    source_system,
    source_table,
    created_at,
    migrated_at
)
SELECT
    cat_place_id AS id,  -- V1 uses cat_place_id, V2 uses id
    cat_id,
    place_id,
    -- Map V1 relationship_type to V2 valid values
    CASE relationship_type
        WHEN 'appointment_site' THEN 'treated_at'
        WHEN 'trapped_at' THEN 'trapped_at'
        WHEN 'home' THEN 'home'
        ELSE 'residence'
    END AS relationship_type,
    'inferred' AS evidence_type,  -- V1 doesn't have evidence_type
    -- V1 confidence is TEXT, V2 is NUMERIC
    CASE confidence
        WHEN 'high' THEN 0.9
        WHEN 'medium' THEN 0.7
        WHEN 'low' THEN 0.5
        ELSE 0.8
    END AS confidence,
    source_system,
    source_table,
    created_at,  -- Preserve original created_at
    NOW()
FROM trapper.cat_place_relationships
WHERE cat_id IN (SELECT cat_id FROM sot.cats)
  AND place_id IN (SELECT place_id FROM sot.places)
ON CONFLICT (cat_id, place_id, relationship_type) DO NOTHING;

SELECT 'Cat-Place relationships migrated: ' || COUNT(*) FROM sot.cat_place WHERE migrated_at IS NOT NULL;

-- Person-Place relationships
INSERT INTO sot.person_place (
    id,
    person_id,
    place_id,
    relationship_type,
    evidence_type,
    confidence,
    is_primary,
    source_system,
    source_table,
    created_at,
    migrated_at
)
SELECT
    relationship_id AS id,  -- V1 uses relationship_id, V2 uses id
    person_id,
    place_id,
    -- Map V1 role to V2 relationship_type ('resident', 'owner', 'manager', 'caretaker', 'works_at', 'volunteers_at')
    CASE COALESCE(role::TEXT, 'resident')
        WHEN 'resident' THEN 'resident'
        WHEN 'owner' THEN 'owner'
        WHEN 'manager' THEN 'manager'
        WHEN 'caretaker' THEN 'caretaker'
        WHEN 'works_at' THEN 'works_at'
        WHEN 'volunteers_at' THEN 'volunteers_at'
        WHEN 'requester' THEN 'caretaker'  -- V1 'requester' = person who requested help = caretaker of cats at location
        WHEN 'home' THEN 'resident'
        ELSE 'resident'  -- Default to resident
    END AS relationship_type,
    'inferred' AS evidence_type,  -- V1 doesn't have evidence_type
    0.8 AS confidence,  -- V1 doesn't have confidence
    FALSE AS is_primary,  -- V1 doesn't have is_primary
    source_system,
    source_table,
    created_at,  -- Preserve original created_at
    NOW()
FROM trapper.person_place_relationships
WHERE person_id IN (SELECT person_id FROM sot.people)
  AND place_id IN (SELECT place_id FROM sot.places)
ON CONFLICT (person_id, place_id, relationship_type) DO NOTHING;

SELECT 'Person-Place relationships migrated: ' || COUNT(*) FROM sot.person_place WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- MIGRATE GOOGLE MAP ENTRIES
-- ============================================================================
\echo ''
\echo '=== Migrating Google Map Entries ==='

INSERT INTO ops.google_map_entries (
    entry_id,
    kml_name,
    lat,
    lng,
    original_content,
    ai_summary,
    ai_meaning,
    parsed_date,
    place_id,
    linked_place_id,
    nearest_place_id,
    nearest_place_distance_m,
    source_file,
    imported_at,
    created_at,
    migrated_at
)
SELECT
    entry_id,
    kml_name,
    lat,
    lng,
    original_content,
    ai_summary,
    ai_meaning,
    parsed_date,
    place_id,
    linked_place_id,
    nearest_place_id,
    nearest_place_distance_m,
    source_file,
    imported_at,
    NOW(),
    NOW()
FROM trapper.google_map_entries
ON CONFLICT (entry_id) DO NOTHING;

SELECT 'Google Map entries migrated: ' || COUNT(*) FROM ops.google_map_entries WHERE migrated_at IS NOT NULL;

-- ============================================================================
-- RE-ENABLE DUAL-WRITE
-- ============================================================================
SELECT atlas.enable_dual_write();

-- ============================================================================
-- VERIFICATION SUMMARY
-- ============================================================================
\echo ''
\echo '=== Migration Summary ==='

SELECT 'V1 → V2 Migration Counts' AS metric, '' AS count
UNION ALL
SELECT '─────────────────────────', '─────────'
UNION ALL
SELECT 'Addresses', (SELECT COUNT(*)::TEXT FROM sot.addresses WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'Places', (SELECT COUNT(*)::TEXT FROM sot.places WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'People', (SELECT COUNT(*)::TEXT FROM sot.people WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'Person Identifiers', (SELECT COUNT(*)::TEXT FROM sot.person_identifiers)
UNION ALL
SELECT 'Cats', (SELECT COUNT(*)::TEXT FROM sot.cats WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'Cat Identifiers', (SELECT COUNT(*)::TEXT FROM sot.cat_identifiers)
UNION ALL
SELECT 'Requests', (SELECT COUNT(*)::TEXT FROM ops.requests WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'Intake Submissions', (SELECT COUNT(*)::TEXT FROM ops.intake_submissions WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'Appointments', (SELECT COUNT(*)::TEXT FROM ops.appointments WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'Person-Cat Links', (SELECT COUNT(*)::TEXT FROM sot.person_cat WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'Cat-Place Links', (SELECT COUNT(*)::TEXT FROM sot.cat_place WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'Person-Place Links', (SELECT COUNT(*)::TEXT FROM sot.person_place WHERE migrated_at IS NOT NULL)
UNION ALL
SELECT 'Google Map Entries', (SELECT COUNT(*)::TEXT FROM ops.google_map_entries WHERE migrated_at IS NOT NULL);

\echo ''
\echo '=== Date Preservation Check ==='

-- Verify dates were preserved
SELECT
    'Requests with preserved source_created_at' AS check,
    COUNT(*) FILTER (WHERE source_created_at IS NOT NULL) AS with_source_date,
    COUNT(*) FILTER (WHERE original_created_at IS NOT NULL) AS with_original_date,
    COUNT(*) AS total
FROM ops.requests
WHERE migrated_at IS NOT NULL;

SELECT
    'People with preserved dates' AS check,
    COUNT(*) FILTER (WHERE source_created_at IS NOT NULL) AS with_source_date,
    COUNT(*) FILTER (WHERE original_created_at IS NOT NULL) AS with_original_date,
    COUNT(*) AS total
FROM sot.people
WHERE migrated_at IS NOT NULL;

\echo ''
\echo 'MIG_1005 Complete: Historical data migrated with date preservation'
\echo 'Dual-write is now ENABLED: new V1 writes will be mirrored to V2'
