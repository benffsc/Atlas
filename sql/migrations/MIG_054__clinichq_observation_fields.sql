-- MIG_054__clinichq_observation_fields.sql
-- Fix observation extraction to include ClinicHQ field names
--
-- Problem:
--   ClinicHQ owner_info uses "Owner Phone", "Owner Cell Phone", "Owner Email", "Owner Address"
--   The extraction function only looks for generic field names like "Phone", "Email", etc.
--   This causes phone/email observations to not be extracted, which breaks the people pipeline.
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_054__clinichq_observation_fields.sql

\echo '============================================'
\echo 'MIG_054: ClinicHQ Observation Fields'
\echo '============================================'

\echo ''
\echo 'Updating extract_observations_from_staged_v2 with ClinicHQ fields...'

CREATE OR REPLACE FUNCTION trapper.extract_observations_from_staged_v2(
    p_staged_record_id UUID
)
RETURNS TABLE (
    observation_type trapper.observation_type,
    field_name TEXT,
    value_text TEXT,
    value_json JSONB,
    confidence NUMERIC(3,2)
) AS $$
DECLARE
    v_payload JSONB;
    v_source_system TEXT;
    v_source_table TEXT;
    v_field TEXT;
    v_value TEXT;
    v_full_name TEXT;
    v_classification RECORD;
    v_emitted_name BOOLEAN := FALSE;

    -- Address fields to extract (order matters - prefer cleaner fields first)
    v_addr_fields TEXT[] := ARRAY[
        'Address', 'Requester Address', 'Mailing Address', 'Cats Address',
        'Trapping Address', 'Location Address',
        'Street Address  - Address1',  -- VolunteerHub
        'Owner Address'                -- ClinicHQ
    ];

    -- Phone fields to extract
    v_phone_fields TEXT[] := ARRAY[
        'Phone', 'Clean Phone', 'Business Phone', 'Mobile', 'Cell',
        'Home Phone', 'Mobile Phone',  -- VolunteerHub
        'Owner Phone', 'Owner Cell Phone'  -- ClinicHQ
    ];

    -- Email fields to extract
    v_email_fields TEXT[] := ARRAY[
        'Email', 'Clean Email', 'Business Email',
        'Owner Email'  -- ClinicHQ
    ];

    v_single_name_fields TEXT[] := ARRAY['Client Name', 'Owner Name', 'Requester Name', 'Contact Name', 'Name'];
BEGIN
    SELECT sr.payload, sr.source_system, sr.source_table INTO v_payload, v_source_system, v_source_table
    FROM trapper.staged_records sr
    WHERE sr.id = p_staged_record_id;

    IF v_payload IS NULL THEN
        RETURN;
    END IF;

    -- ============================================
    -- STEP 1: Try to combine first/last name fields
    -- ============================================

    -- VolunteerHub: Name - FirstName / Name - LastName
    IF v_source_system = 'volunteerhub' THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'Name - FirstName', 'Name - LastName');
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Volunteer Full Name'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                v_classification.confidence;
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- Airtable Trapping Requests: First Name / Last Name
    IF v_source_table = 'trapping_requests' AND NOT v_emitted_name THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'First Name', 'Last Name');
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Full Name (First + Last)'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                v_classification.confidence;
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- ClinicHQ: Owner First Name / Owner Last Name
    IF v_source_system = 'clinichq' AND NOT v_emitted_name THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'Owner First Name', 'Owner Last Name');
        IF v_full_name IS NULL THEN
            v_full_name := trapper.combine_first_last_name(v_payload, 'owner_first_name', 'owner_last_name');
        END IF;
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Owner Full Name'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                v_classification.confidence;
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- Shelterluv/PetLink: Firstname / Lastname
    IF (v_source_system ILIKE '%shelterluv%' OR v_source_system ILIKE '%petlink%') AND NOT v_emitted_name THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'Firstname', 'Lastname');
        IF v_full_name IS NULL THEN
            v_full_name := trapper.combine_first_last_name(v_payload, 'FirstName', 'LastName');
        END IF;
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Person Full Name'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                v_classification.confidence;
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- Generic fallback: First Name / Last Name
    IF NOT v_emitted_name THEN
        v_full_name := trapper.combine_first_last_name(v_payload, 'First Name', 'Last Name');
        IF v_full_name IS NOT NULL AND LENGTH(v_full_name) > 0 THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_full_name);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                'Full Name (First + Last)'::TEXT,
                v_full_name,
                to_jsonb(v_classification),
                v_classification.confidence;
            v_emitted_name := TRUE;
        END IF;
    END IF;

    -- Single-value name fields (only if no combined name yet)
    IF NOT v_emitted_name THEN
        FOREACH v_field IN ARRAY v_single_name_fields LOOP
            v_value := v_payload->>v_field;
            IF v_value IS NOT NULL AND TRIM(v_value) <> '' THEN
                SELECT * INTO v_classification FROM trapper.classify_name(v_value);
                RETURN QUERY SELECT
                    'name_signal'::trapper.observation_type,
                    v_field,
                    v_value,
                    to_jsonb(v_classification),
                    v_classification.confidence;
                v_emitted_name := TRUE;
                EXIT;  -- Only emit one name
            END IF;
        END LOOP;
    END IF;

    -- ============================================
    -- STEP 2: Extract other signals
    -- ============================================

    -- Address signals
    FOREACH v_field IN ARRAY v_addr_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND TRIM(v_value) <> '' THEN
            RETURN QUERY SELECT
                'address_signal'::trapper.observation_type,
                v_field,
                v_value,
                NULL::JSONB,
                0.8::NUMERIC(3,2);
        END IF;
    END LOOP;

    -- Phone signals
    FOREACH v_field IN ARRAY v_phone_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND TRIM(v_value) <> '' AND v_value ~ '[0-9]' THEN
            RETURN QUERY SELECT
                'phone_signal'::trapper.observation_type,
                v_field,
                v_value,
                NULL::JSONB,
                0.9::NUMERIC(3,2);
        END IF;
    END LOOP;

    -- Email signals
    FOREACH v_field IN ARRAY v_email_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND v_value LIKE '%@%' THEN
            RETURN QUERY SELECT
                'email_signal'::trapper.observation_type,
                v_field,
                v_value,
                NULL::JSONB,
                0.95::NUMERIC(3,2);
        END IF;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.extract_observations_from_staged_v2 IS
'Smart observation extraction that combines first/last name fields.
Supports: Airtable, ClinicHQ, VolunteerHub, Shelterluv, PetLink.
ClinicHQ fields: Owner Phone, Owner Cell Phone, Owner Email, Owner Address.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo 'Testing ClinicHQ extraction with Gary Feldman record:'
SELECT observation_type, field_name, value_text
FROM trapper.extract_observations_from_staged_v2('5e26b7aa-aea5-4a2f-bb3d-a96ad32f5b71'::uuid);

\echo ''
\echo '============================================'
\echo 'MIG_054 Complete'
\echo '============================================'
\echo ''
\echo 'Next steps:'
\echo '  1. Re-extract observations for owner_info records missing phone/email'
\echo '  2. Run upsert_people_from_observations to create people'
\echo ''
