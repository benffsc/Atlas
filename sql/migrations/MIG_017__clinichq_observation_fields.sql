-- MIG_017__clinichq_observation_fields.sql
-- Add ClinicHQ-specific field names to observation extraction
--
-- Purpose:
--   - The extract_observations_from_staged function needs to recognize
--     ClinicHQ-specific field names like "Owner First Name", "Owner Address", etc.
--   - Also adds fields from other new sources (Shelterluv, PetLink, VolunteerHub)
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/MIG_017__clinichq_observation_fields.sql

\echo '============================================'
\echo 'MIG_017: Extended Observation Field Mappings'
\echo '============================================'

-- ============================================
-- PART 1: Updated extract_observations_from_staged function
-- ============================================
\echo ''
\echo 'Updating extract_observations_from_staged function...'

CREATE OR REPLACE FUNCTION trapper.extract_observations_from_staged(
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
    v_source_table TEXT;
    v_field TEXT;
    v_value TEXT;
    v_classification RECORD;
    -- Extended address fields (including ClinicHQ, Shelterluv, PetLink, etc.)
    v_addr_fields TEXT[] := ARRAY[
        'Address', 'Requester Address', 'Mailing Address', 'Cats Address',
        'Trapping Address', 'Location Address', 'Location',
        -- ClinicHQ
        'Owner Address',
        -- Shelterluv
        'Street', 'Street Address',
        -- PetLink
        'Mailing Address', 'Physical Address'
    ];
    -- Extended name fields
    v_name_fields TEXT[] := ARRAY[
        'First Name', 'Last Name', 'Client Name', 'Owner Name', 'Requester Name',
        'Contact Name', 'Name', 'Full Name',
        -- ClinicHQ
        'Owner First Name', 'Owner Last Name', 'Animal Name',
        -- Shelterluv
        'Firstname', 'Lastname', 'Name',
        -- PetLink
        'Pet Name', 'FirstName', 'LastName',
        -- VolunteerHub
        'First name', 'Last name'
    ];
    -- Extended phone fields
    v_phone_fields TEXT[] := ARRAY[
        'Phone', 'Clean Phone', 'Business Phone', 'Mobile', 'Cell',
        -- ClinicHQ
        'Owner Phone', 'Owner Cell Phone',
        -- Shelterluv/PetLink
        'Phone Number', 'Cell Phone', 'Home Phone', 'Work Phone',
        -- VolunteerHub
        'Cell phone', 'Home phone'
    ];
    -- Extended email fields
    v_email_fields TEXT[] := ARRAY[
        'Email', 'Clean Email', 'Business Email',
        -- ClinicHQ
        'Owner Email',
        -- Shelterluv/PetLink
        'Email Address', 'Primary Email',
        -- VolunteerHub/E-Tapestry
        'Email address', 'email'
    ];
BEGIN
    -- Get the payload
    SELECT sr.payload, sr.source_table INTO v_payload, v_source_table
    FROM trapper.staged_records sr
    WHERE sr.id = p_staged_record_id;

    IF v_payload IS NULL THEN
        RETURN;
    END IF;

    -- Extract address signals
    FOREACH v_field IN ARRAY v_addr_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND TRIM(v_value) <> '' AND LENGTH(TRIM(v_value)) > 3 THEN
            RETURN QUERY SELECT
                'address_signal'::trapper.observation_type,
                v_field,
                v_value,
                NULL::JSONB,
                0.8::NUMERIC(3,2);
        END IF;
    END LOOP;

    -- Extract name signals
    FOREACH v_field IN ARRAY v_name_fields LOOP
        v_value := v_payload->>v_field;
        IF v_value IS NOT NULL AND TRIM(v_value) <> '' THEN
            SELECT * INTO v_classification FROM trapper.classify_name(v_value);
            RETURN QUERY SELECT
                'name_signal'::trapper.observation_type,
                v_field,
                v_value,
                to_jsonb(v_classification),
                v_classification.confidence;
        END IF;
    END LOOP;

    -- Extract phone signals
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

    -- Extract email signals
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

COMMENT ON FUNCTION trapper.extract_observations_from_staged IS
'Extract observations (signals) from a staged record payload.
Supports multiple source systems: Airtable, ClinicHQ, Shelterluv, PetLink, VolunteerHub, E-Tapestry.
Returns name, address, phone, and email signals with confidence scores.';

-- ============================================
-- VERIFICATION
-- ============================================
\echo ''
\echo '============================================'
\echo 'MIG_017 Complete - Testing with ClinicHQ record:'
\echo '============================================'

SELECT * FROM trapper.extract_observations_from_staged(
    (SELECT id FROM trapper.staged_records WHERE source_system = 'clinichq' AND source_table = 'owner_info' LIMIT 1)
);
