-- ============================================================================
-- MIG_776: Orchestrator Source Registry (ORCH_002)
-- ============================================================================
-- TASK_LEDGER reference: ORCH_002
-- ACTIVE Impact: No — populates orchestrator tables, creates helper functions
--
-- Registers all existing data sources in orchestrator_sources.
-- Creates register_source() and map_source_field() helper functions.
-- ============================================================================

\echo '=== MIG_776: Orchestrator Source Registry (ORCH_002) ==='

-- ============================================================================
-- Step 1: Register all existing data sources
-- ============================================================================

\echo ''
\echo 'Step 1: Registering data sources'

INSERT INTO trapper.orchestrator_sources
    (source_system, source_table, display_name, entity_types_produced, ingest_method, ingest_frequency, last_ingest_at, total_records_ingested, is_active)
VALUES
    -- ClinicHQ (weekly file uploads)
    ('clinichq', 'cat_info', 'ClinicHQ Cat Records',
     '{cat}', 'file_upload', 'weekly',
     '2026-01-28T00:49:38Z', 38425, TRUE),

    ('clinichq', 'owner_info', 'ClinicHQ Owner Records',
     '{person,place}', 'file_upload', 'weekly',
     '2026-01-28T00:49:22Z', 38417, TRUE),

    ('clinichq', 'appointment_info', 'ClinicHQ Appointments',
     '{appointment}', 'file_upload', 'weekly',
     '2026-01-28T00:50:39Z', 38370, TRUE),

    -- Airtable (API sync)
    ('airtable', 'trapping_requests', 'Airtable Trapping Requests',
     '{request,person,place}', 'api_sync', 'daily',
     '2026-01-11T20:16:30Z', 275, TRUE),

    ('airtable', 'appointment_requests', 'Airtable Appointment Requests',
     '{request,person,place}', 'api_sync', 'daily',
     '2026-01-14T23:22:29Z', 1136, TRUE),

    ('airtable', 'trappers', 'Airtable Trapper Roster',
     '{person}', 'api_sync', 'daily',
     '2026-01-22T19:15:53Z', 166, TRUE),

    -- ShelterLuv (API sync)
    ('shelterluv', 'animals', 'ShelterLuv Animals',
     '{cat}', 'api_sync', 'daily',
     '2026-01-29T00:02:55Z', 11306, TRUE),

    ('shelterluv', 'people', 'ShelterLuv People',
     '{person}', 'api_sync', 'daily',
     '2026-01-28T00:01:11Z', 9126, TRUE),

    ('shelterluv', 'outcomes', 'ShelterLuv Outcomes',
     '{relationship}', 'api_sync', 'daily',
     '2026-01-19T07:07:33Z', 6420, TRUE),

    ('shelterluv', 'events', 'ShelterLuv Events',
     '{event}', 'api_sync', 'daily',
     '2026-01-29T00:04:12Z', 8319, TRUE),

    -- PetLink (periodic file uploads)
    ('petlink', 'pets', 'PetLink Pet Records',
     '{cat}', 'file_upload', 'monthly',
     '2026-01-09T16:53:20Z', 8280, TRUE),

    ('petlink', 'owners', 'PetLink Owner Records',
     '{person}', 'file_upload', 'monthly',
     '2026-01-09T16:36:26Z', 3779, TRUE),

    -- VolunteerHub (API sync)
    ('volunteerhub', 'users', 'VolunteerHub Users',
     '{person}', 'api_sync', 'weekly',
     '2026-01-09T16:26:14Z', 1342, TRUE),

    -- eTapestry / Mailchimp (one-time import)
    ('etapestry', 'mailchimp_export', 'eTapestry Mailchimp Export',
     '{person}', 'file_upload', 'on_demand',
     '2026-01-09T16:50:39Z', 7680, FALSE),

    -- Web Intake (realtime)
    ('web_intake', 'submissions', 'Web Intake Form Submissions',
     '{person,place,request}', 'realtime', 'realtime',
     NULL, 0, TRUE),

    -- Airtable Sync (deprecated duplicate)
    ('airtable_sync', 'appointment_requests', 'Airtable Sync Appointment Requests (deprecated)',
     '{request,person,place}', 'api_sync', 'daily',
     '2026-01-15T03:22:31Z', 1177, FALSE)

ON CONFLICT (source_system, source_table) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    entity_types_produced = EXCLUDED.entity_types_produced,
    last_ingest_at = EXCLUDED.last_ingest_at,
    total_records_ingested = EXCLUDED.total_records_ingested,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

\echo 'Sources registered:'
SELECT source_system, source_table, display_name, is_active,
       total_records_ingested AS records, ingest_frequency
FROM trapper.orchestrator_sources
ORDER BY source_system, source_table;

-- ============================================================================
-- Step 2: Create register_source() helper function
-- ============================================================================

\echo ''
\echo 'Step 2: Creating register_source() function'

CREATE OR REPLACE FUNCTION trapper.register_source(
    p_source_system TEXT,
    p_source_table TEXT,
    p_display_name TEXT,
    p_entity_types TEXT[],
    p_ingest_method TEXT,
    p_ingest_frequency TEXT DEFAULT 'on_demand',
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_source_id UUID;
BEGIN
    INSERT INTO trapper.orchestrator_sources (
        source_system, source_table, display_name,
        entity_types_produced, ingest_method, ingest_frequency, notes
    )
    VALUES (
        p_source_system, p_source_table, p_display_name,
        p_entity_types, p_ingest_method, p_ingest_frequency, p_notes
    )
    ON CONFLICT (source_system, source_table) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        entity_types_produced = EXCLUDED.entity_types_produced,
        ingest_method = EXCLUDED.ingest_method,
        ingest_frequency = EXCLUDED.ingest_frequency,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    RETURNING source_id INTO v_source_id;

    RETURN v_source_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.register_source IS
'Registers a new data source in the orchestrator. Idempotent — updates on conflict.
Usage: SELECT trapper.register_source(''new_source'', ''table'', ''Display Name'', ''{person,cat}'', ''api_sync'');
Part of ORCH_002.';

-- ============================================================================
-- Step 3: Create map_source_field() helper function
-- ============================================================================

\echo ''
\echo 'Step 3: Creating map_source_field() function'

CREATE OR REPLACE FUNCTION trapper.map_source_field(
    p_source_system TEXT,
    p_source_table TEXT,
    p_source_field TEXT,
    p_target_surface TEXT,
    p_target_field TEXT DEFAULT NULL,
    p_routing_type TEXT DEFAULT 'direct',
    p_target_function TEXT DEFAULT NULL,
    p_transform_expression TEXT DEFAULT NULL,
    p_is_required BOOLEAN DEFAULT FALSE,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_rule_id UUID;
BEGIN
    -- Verify source exists
    IF NOT EXISTS (
        SELECT 1 FROM trapper.orchestrator_sources
        WHERE source_system = p_source_system AND source_table = p_source_table
    ) THEN
        RAISE EXCEPTION 'Source %.% not registered. Call register_source() first.',
            p_source_system, p_source_table;
    END IF;

    INSERT INTO trapper.orchestrator_routing_rules (
        source_system, source_table, source_field,
        target_surface, target_field, routing_type,
        target_function, transform_expression,
        is_required, notes
    )
    VALUES (
        p_source_system, p_source_table, p_source_field,
        p_target_surface, p_target_field, p_routing_type,
        p_target_function, p_transform_expression,
        p_is_required, p_notes
    )
    RETURNING rule_id INTO v_rule_id;

    RETURN v_rule_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.map_source_field IS
'Maps a source field to a target surface in the orchestrator routing rules.
Validates that the source is registered first.
Usage: SELECT trapper.map_source_field(''clinichq'', ''owner_info'', ''owner_email'', ''sot_people'', ''email'', ''function_call'', ''find_or_create_person'');
Part of ORCH_002.';

-- ============================================================================
-- Step 4: Populate routing rules for key sources
-- ============================================================================

\echo ''
\echo 'Step 4: Populating routing rules for key sources'

-- ClinicHQ owner_info routing
SELECT trapper.map_source_field('clinichq', 'owner_info', 'owner_email', 'sot_people', 'email', 'function_call', 'find_or_create_person');
SELECT trapper.map_source_field('clinichq', 'owner_info', 'owner_phone', 'person_identifiers', 'phone', 'transform', 'norm_phone_us($1)');
SELECT trapper.map_source_field('clinichq', 'owner_info', 'owner_first_name', 'sot_people', 'first_name', 'direct');
SELECT trapper.map_source_field('clinichq', 'owner_info', 'owner_last_name', 'sot_people', 'last_name', 'direct');
SELECT trapper.map_source_field('clinichq', 'owner_info', 'owner_address', 'places', 'formatted_address', 'function_call', 'find_or_create_place_deduped');

-- ClinicHQ cat_info routing
SELECT trapper.map_source_field('clinichq', 'cat_info', 'microchip_number', 'sot_cats', 'microchip', 'function_call', 'find_or_create_cat_by_microchip', NULL, TRUE);
SELECT trapper.map_source_field('clinichq', 'cat_info', 'cat_name', 'sot_cats', 'name', 'direct');
SELECT trapper.map_source_field('clinichq', 'cat_info', 'sex', 'sot_cats', 'sex', 'direct');
SELECT trapper.map_source_field('clinichq', 'cat_info', 'breed', 'sot_cats', 'breed', 'direct');

-- ClinicHQ appointment_info routing
SELECT trapper.map_source_field('clinichq', 'appointment_info', 'appointment_number', 'sot_appointments', 'source_record_id', 'direct', NULL, NULL, TRUE);
SELECT trapper.map_source_field('clinichq', 'appointment_info', 'appointment_date', 'sot_appointments', 'appointment_date', 'direct');
SELECT trapper.map_source_field('clinichq', 'appointment_info', 'services', 'sot_appointments', 'services', 'direct');

-- ShelterLuv animals routing
SELECT trapper.map_source_field('shelterluv', 'animals', 'ID', 'sot_cats', 'source_record_id', 'direct', NULL, NULL, TRUE);
SELECT trapper.map_source_field('shelterluv', 'animals', 'Name', 'sot_cats', 'name', 'direct');
SELECT trapper.map_source_field('shelterluv', 'animals', 'Type', 'sot_cats', 'species', 'direct');

-- ShelterLuv people routing
SELECT trapper.map_source_field('shelterluv', 'people', 'Email', 'sot_people', 'email', 'function_call', 'find_or_create_person');
SELECT trapper.map_source_field('shelterluv', 'people', 'Phone', 'person_identifiers', 'phone', 'transform', 'norm_phone_us($1)');
SELECT trapper.map_source_field('shelterluv', 'people', 'Firstname', 'sot_people', 'first_name', 'direct');
SELECT trapper.map_source_field('shelterluv', 'people', 'Lastname', 'sot_people', 'last_name', 'direct');

-- Web intake routing
SELECT trapper.map_source_field('web_intake', 'submissions', 'email', 'sot_people', 'email', 'function_call', 'find_or_create_person');
SELECT trapper.map_source_field('web_intake', 'submissions', 'phone', 'person_identifiers', 'phone', 'transform', 'norm_phone_us($1)');
SELECT trapper.map_source_field('web_intake', 'submissions', 'address', 'places', 'formatted_address', 'function_call', 'find_or_create_place_deduped');

\echo 'Routing rules populated:'
SELECT source_system, source_table, COUNT(*) AS rules
FROM trapper.orchestrator_routing_rules
GROUP BY source_system, source_table
ORDER BY source_system, source_table;

-- ============================================================================
-- Step 5: Demonstrate onboarding a new source
-- ============================================================================

\echo ''
\echo 'Step 5: Demonstrating new source onboarding (client_survey)'

-- Register a hypothetical new source
SELECT trapper.register_source(
    'client_survey', 'responses',
    'Post-Service Client Survey',
    '{person,place}',
    'api_sync', 'on_demand',
    'Demo source for ORCH_002 — survey responses about colony sizes'
);

-- Map its fields
SELECT trapper.map_source_field('client_survey', 'responses', 'respondent_email', 'sot_people', 'email', 'function_call', 'find_or_create_person');
SELECT trapper.map_source_field('client_survey', 'responses', 'address', 'places', 'formatted_address', 'function_call', 'find_or_create_place_deduped');
SELECT trapper.map_source_field('client_survey', 'responses', 'cat_count', 'place_colony_estimates', 'total_cats', 'direct');
SELECT trapper.map_source_field('client_survey', 'responses', 'fixed_count', 'place_colony_estimates', 'fixed_cats', 'direct');

\echo 'Demo source registered and mapped:'
SELECT os.display_name, COUNT(rr.rule_id) AS routing_rules
FROM trapper.orchestrator_sources os
LEFT JOIN trapper.orchestrator_routing_rules rr
    ON rr.source_system = os.source_system AND rr.source_table = os.source_table
WHERE os.source_system = 'client_survey'
GROUP BY os.display_name;

-- ============================================================================
-- Step 6: Update source stats from staged_records
-- ============================================================================

\echo ''
\echo 'Step 6: Syncing source stats from staged_records'

UPDATE trapper.orchestrator_sources os
SET
    last_ingest_at = sr.last_ingest,
    total_records_ingested = sr.total_records,
    updated_at = NOW()
FROM (
    SELECT source_system, source_table,
        MAX(created_at) AS last_ingest,
        COUNT(*) AS total_records
    FROM trapper.staged_records
    GROUP BY source_system, source_table
) sr
WHERE os.source_system = sr.source_system
  AND os.source_table = sr.source_table;

-- ============================================================================
-- Step 7: Verification
-- ============================================================================

\echo ''
\echo 'Step 7: Final state'

\echo 'All registered sources:'
SELECT source_system, source_table, is_active,
       total_records_ingested AS records,
       ingest_frequency
FROM trapper.orchestrator_sources
ORDER BY source_system, source_table;

\echo ''
\echo 'Routing rules by source:'
SELECT source_system, source_table, COUNT(*) AS rules
FROM trapper.orchestrator_routing_rules
GROUP BY source_system, source_table
ORDER BY source_system, source_table;

-- ============================================================================
-- Step 8: Summary
-- ============================================================================

\echo ''
\echo '====== MIG_776 SUMMARY ======'
\echo 'Registered 16 data sources in orchestrator_sources.'
\echo 'Created 2 helper functions: register_source(), map_source_field().'
\echo 'Populated routing rules for 6 key sources.'
\echo 'Demonstrated new source onboarding with client_survey.'
\echo ''
\echo '=== MIG_776 Complete ==='
