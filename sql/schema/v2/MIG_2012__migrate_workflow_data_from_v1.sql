-- MIG_2012: Migrate Workflow Data from V1 (East) to V2 (West)
--
-- Purpose: Copy WORKFLOW data (not entity data) from V1 trapper schema to V2 ops schema
-- This preserves operational history while V2 gets fresh entity data from source systems.
--
-- What we copy:
-- 1. web_intake_submissions - Original form submissions (source data)
-- 2. sot_requests - Staff-created work items
-- 3. request_trapper_assignments - Trapper assignments to requests
-- 4. journal_entries - Staff notes and history
--
-- What we DON'T copy:
-- - People, cats, places (reprocessed from fresh ClinicHQ/ShelterLuv/VolunteerHub)
-- - Relationships (rebuilt by entity linking pipeline)
--
-- Prerequisites:
-- - V2 has been populated with fresh entity data (ClinicHQ ingest complete)
-- - VolunteerHub ingest complete (for trapper people)
-- - ID mapping tables exist to link V1 IDs to V2 IDs
--
-- DEPENDENCY ORDER:
-- 1. Run MIG_2007-2011 (V2 functions + staff users + soft blacklist)
-- 2. Ingest fresh ClinicHQ exports (creates people, cats, places)
-- 3. Ingest VolunteerHub (creates volunteers/trappers)
-- 4. THEN run this migration (workflow data can map to V2 entities)
--
-- If run too early: workflow data copies but with NULL entity references.
-- This is recoverable - re-run Step 2-5 after entities exist.
--
-- Created: 2026-02-12

\echo ''
\echo '=============================================='
\echo '  MIG_2012: Migrate Workflow Data from V1'
\echo '=============================================='
\echo ''

-- ============================================================================
-- PRE-CHECK: Verify V2 has entities to map to
-- ============================================================================

\echo 'Pre-check: Verifying V2 entity counts...'

DO $$
DECLARE
    v_people_count INT;
    v_places_count INT;
BEGIN
    SELECT COUNT(*) INTO v_people_count FROM sot.people WHERE merged_into_person_id IS NULL;
    SELECT COUNT(*) INTO v_places_count FROM sot.places WHERE merged_into_place_id IS NULL;

    IF v_people_count < 100 THEN
        RAISE WARNING 'V2 has only % people. Run ClinicHQ + VolunteerHub ingest first for better ID mapping.', v_people_count;
        RAISE WARNING 'Continuing anyway - workflow data will be copied with NULL entity references where no match exists.';
    ELSE
        RAISE NOTICE 'V2 has % people - good for ID mapping', v_people_count;
    END IF;

    IF v_places_count < 100 THEN
        RAISE WARNING 'V2 has only % places. Run ClinicHQ ingest first for better ID mapping.', v_places_count;
    ELSE
        RAISE NOTICE 'V2 has % places - good for ID mapping', v_places_count;
    END IF;
END $$;

-- ============================================================================
-- STEP 0: Create ID Mapping Schema (if not exists)
-- ============================================================================

\echo 'Step 0: Creating v2_migration schema...'

CREATE SCHEMA IF NOT EXISTS v2_migration;

-- Person ID mapping (V1 → V2 via email/phone match)
CREATE TABLE IF NOT EXISTS v2_migration.person_id_map (
    v1_person_id UUID NOT NULL,
    v2_person_id UUID,
    matched_by TEXT,  -- 'email', 'phone', 'name_address', 'unmatched'
    match_confidence NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (v1_person_id)
);

-- Place ID mapping (V1 → V2 via normalized address)
CREATE TABLE IF NOT EXISTS v2_migration.place_id_map (
    v1_place_id UUID NOT NULL,
    v2_place_id UUID,
    matched_by TEXT,  -- 'normalized_address', 'coordinates', 'unmatched'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (v1_place_id)
);

\echo '   Created v2_migration schema and mapping tables'

-- ============================================================================
-- STEP 1: Copy Web Intake Submissions (Original Source Data)
-- ============================================================================

\echo ''
\echo 'Step 1: Copying web intake submissions...'

-- Web intakes are ORIGINAL source data - they don't reference V2 entities
-- They have their own requester info (name, email, phone, address) stored inline
INSERT INTO ops.intake_submissions (
    submission_id,
    source_system,
    source_record_id,
    submission_date,
    requester_name,
    requester_email,
    requester_phone,
    requester_address,
    cat_count,
    situation_description,
    urgency,
    raw_payload,
    processing_status,
    processed_at,
    resulting_request_id,
    created_at,
    updated_at
)
SELECT
    -- Use existing ID or generate new one
    COALESCE(w.submission_id, gen_random_uuid()) as submission_id,
    w.source_system,
    w.source_record_id,
    w.submission_date,
    -- Inline requester data (not referencing people table)
    w.requester_name,
    w.requester_email,
    w.requester_phone,
    w.requester_address,
    w.cat_count,
    w.situation_description,
    w.urgency,
    w.raw_payload,
    w.processing_status,
    w.processed_at,
    w.resulting_request_id,  -- Will need to map if request was created
    w.created_at,
    w.updated_at
FROM dblink(
    'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
    'SELECT
        submission_id, source_system, source_record_id, submission_date,
        requester_name, requester_email, requester_phone, requester_address,
        cat_count, situation_description, urgency, raw_payload,
        processing_status, processed_at, resulting_request_id,
        created_at, updated_at
     FROM trapper.web_intake_submissions'
) AS w(
    submission_id UUID,
    source_system TEXT,
    source_record_id TEXT,
    submission_date TIMESTAMPTZ,
    requester_name TEXT,
    requester_email TEXT,
    requester_phone TEXT,
    requester_address TEXT,
    cat_count INTEGER,
    situation_description TEXT,
    urgency TEXT,
    raw_payload JSONB,
    processing_status TEXT,
    processed_at TIMESTAMPTZ,
    resulting_request_id UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
ON CONFLICT (submission_id) DO NOTHING;

\echo '   Copied web intake submissions'

-- ============================================================================
-- STEP 2: Build Person ID Map (V1 → V2)
-- ============================================================================

\echo ''
\echo 'Step 2: Building person ID mapping...'

-- This requires V2 to have people already (from ClinicHQ/VolunteerHub ingest)
-- Match by email first (most reliable)
INSERT INTO v2_migration.person_id_map (v1_person_id, v2_person_id, matched_by, match_confidence)
SELECT DISTINCT ON (v1.person_id)
    v1.person_id as v1_person_id,
    v2.person_id as v2_person_id,
    'email' as matched_by,
    1.0 as match_confidence
FROM dblink(
    'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
    'SELECT person_id, id_value_norm FROM trapper.person_identifiers WHERE id_type = ''email'''
) AS v1(person_id UUID, id_value_norm TEXT)
JOIN sot.person_identifiers v2_pi ON v2_pi.id_value_norm = v1.id_value_norm AND v2_pi.id_type = 'email'
JOIN sot.people v2 ON v2.person_id = v2_pi.person_id AND v2.merged_into_person_id IS NULL
ON CONFLICT (v1_person_id) DO NOTHING;

-- Match by phone for those not matched by email
INSERT INTO v2_migration.person_id_map (v1_person_id, v2_person_id, matched_by, match_confidence)
SELECT DISTINCT ON (v1.person_id)
    v1.person_id as v1_person_id,
    v2.person_id as v2_person_id,
    'phone' as matched_by,
    0.9 as match_confidence
FROM dblink(
    'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
    'SELECT person_id, id_value_norm FROM trapper.person_identifiers WHERE id_type = ''phone'''
) AS v1(person_id UUID, id_value_norm TEXT)
JOIN sot.person_identifiers v2_pi ON v2_pi.id_value_norm = v1.id_value_norm AND v2_pi.id_type = 'phone'
JOIN sot.people v2 ON v2.person_id = v2_pi.person_id AND v2.merged_into_person_id IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM v2_migration.person_id_map pm WHERE pm.v1_person_id = v1.person_id
)
ON CONFLICT (v1_person_id) DO NOTHING;

\echo '   Built person ID mapping'

-- ============================================================================
-- STEP 3: Build Place ID Map (V1 → V2)
-- ============================================================================

\echo ''
\echo 'Step 3: Building place ID mapping...'

-- Match by normalized address
INSERT INTO v2_migration.place_id_map (v1_place_id, v2_place_id, matched_by)
SELECT DISTINCT ON (v1.place_id)
    v1.place_id as v1_place_id,
    v2.place_id as v2_place_id,
    'normalized_address' as matched_by
FROM dblink(
    'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
    'SELECT place_id, normalized_address FROM trapper.places WHERE merged_into_place_id IS NULL AND normalized_address IS NOT NULL'
) AS v1(place_id UUID, normalized_address TEXT)
JOIN sot.places v2 ON v2.normalized_address = v1.normalized_address AND v2.merged_into_place_id IS NULL
ON CONFLICT (v1_place_id) DO NOTHING;

\echo '   Built place ID mapping'

-- ============================================================================
-- STEP 4: Copy Requests with ID Remapping
-- ============================================================================

\echo ''
\echo 'Step 4: Copying requests with ID remapping...'

INSERT INTO ops.requests (
    request_id,
    requester_person_id,
    place_id,
    status,
    priority,
    cat_count_estimate,
    request_type,
    source_system,
    source_record_id,
    notes,
    created_at,
    updated_at,
    resolved_at
)
SELECT
    r.request_id,
    pm.v2_person_id,  -- Remapped to V2 person
    plm.v2_place_id,  -- Remapped to V2 place
    r.status,
    r.priority,
    r.estimated_cat_count,
    r.request_type,
    r.source_system,
    r.source_record_id,
    r.notes,
    r.created_at,
    r.updated_at,
    r.resolved_at
FROM dblink(
    'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
    'SELECT
        request_id, requester_person_id, place_id, status, priority,
        estimated_cat_count, request_type, source_system, source_record_id,
        notes, created_at, updated_at, resolved_at
     FROM trapper.sot_requests
     WHERE merged_into_request_id IS NULL'
) AS r(
    request_id UUID,
    requester_person_id UUID,
    place_id UUID,
    status TEXT,
    priority TEXT,
    estimated_cat_count INTEGER,
    request_type TEXT,
    source_system TEXT,
    source_record_id TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
)
LEFT JOIN v2_migration.person_id_map pm ON pm.v1_person_id = r.requester_person_id
LEFT JOIN v2_migration.place_id_map plm ON plm.v1_place_id = r.place_id
ON CONFLICT (request_id) DO NOTHING;

\echo '   Copied requests with remapped IDs'

-- ============================================================================
-- STEP 5: Copy Trapper Assignments
-- ============================================================================

\echo ''
\echo 'Step 5: Copying trapper assignments...'

INSERT INTO ops.request_trapper_assignments (
    assignment_id,
    request_id,
    trapper_person_id,
    assigned_by_person_id,
    assigned_at,
    status,
    notes,
    created_at
)
SELECT
    a.assignment_id,
    a.request_id,
    pm_trapper.v2_person_id,  -- Remapped trapper
    pm_assigner.v2_person_id,  -- Remapped assigner
    a.assigned_at,
    a.status,
    a.notes,
    a.created_at
FROM dblink(
    'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
    'SELECT
        assignment_id, request_id, trapper_person_id, assigned_by_person_id,
        assigned_at, status, notes, created_at
     FROM trapper.request_trapper_assignments'
) AS a(
    assignment_id UUID,
    request_id UUID,
    trapper_person_id UUID,
    assigned_by_person_id UUID,
    assigned_at TIMESTAMPTZ,
    status TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ
)
LEFT JOIN v2_migration.person_id_map pm_trapper ON pm_trapper.v1_person_id = a.trapper_person_id
LEFT JOIN v2_migration.person_id_map pm_assigner ON pm_assigner.v1_person_id = a.assigned_by_person_id
ON CONFLICT (assignment_id) DO NOTHING;

\echo '   Copied trapper assignments'

-- ============================================================================
-- STEP 6: Copy Journal Entries
-- ============================================================================

\echo ''
\echo 'Step 6: Copying journal entries...'

INSERT INTO ops.journal_entries (
    entry_id,
    entity_type,
    entity_id,
    author_person_id,
    entry_type,
    content,
    metadata,
    created_at
)
SELECT
    j.entry_id,
    j.entity_type,
    -- Remap entity_id based on entity_type
    CASE
        WHEN j.entity_type = 'person' THEN pm.v2_person_id
        WHEN j.entity_type = 'place' THEN plm.v2_place_id
        ELSE j.entity_id  -- Keep original for cats/requests (mapped later)
    END as entity_id,
    pm_author.v2_person_id as author_person_id,
    j.entry_type,
    j.content,
    j.metadata,
    j.created_at
FROM dblink(
    'dbname=postgres host=aws-1-us-east-2.pooler.supabase.com port=5432 user=postgres.tpjllrfpdlkenbapvpko password=''vfh0xba!ujx!gwz!UGJ'' sslmode=require',
    'SELECT
        entry_id, entity_type, entity_id, author_person_id,
        entry_type, content, metadata, created_at
     FROM trapper.journal_entries'
) AS j(
    entry_id UUID,
    entity_type TEXT,
    entity_id UUID,
    author_person_id UUID,
    entry_type TEXT,
    content TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ
)
LEFT JOIN v2_migration.person_id_map pm ON pm.v1_person_id = j.entity_id AND j.entity_type = 'person'
LEFT JOIN v2_migration.place_id_map plm ON plm.v1_place_id = j.entity_id AND j.entity_type = 'place'
LEFT JOIN v2_migration.person_id_map pm_author ON pm_author.v1_person_id = j.author_person_id
ON CONFLICT (entry_id) DO NOTHING;

\echo '   Copied journal entries'

-- ============================================================================
-- VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='

\echo ''
\echo 'ID Mapping Stats:'
SELECT
    'person_id_map' as mapping,
    COUNT(*) as total,
    COUNT(v2_person_id) as matched,
    COUNT(*) - COUNT(v2_person_id) as unmatched
FROM v2_migration.person_id_map
UNION ALL
SELECT
    'place_id_map',
    COUNT(*),
    COUNT(v2_place_id),
    COUNT(*) - COUNT(v2_place_id)
FROM v2_migration.place_id_map;

\echo ''
\echo 'Workflow Data Copied:'
SELECT 'ops.intake_submissions' as table_name, COUNT(*) as count FROM ops.intake_submissions
UNION ALL SELECT 'ops.requests', COUNT(*) FROM ops.requests
UNION ALL SELECT 'ops.request_trapper_assignments', COUNT(*) FROM ops.request_trapper_assignments
UNION ALL SELECT 'ops.journal_entries', COUNT(*) FROM ops.journal_entries;

\echo ''
\echo '=============================================='
\echo '  MIG_2012 Complete!'
\echo '=============================================='
\echo ''
\echo 'Workflow data migrated from V1 East to V2 West:'
\echo '  - Web intake submissions (original source data)'
\echo '  - Requests (with remapped person/place IDs)'
\echo '  - Trapper assignments (with remapped person IDs)'
\echo '  - Journal entries (with remapped entity IDs)'
\echo ''
\echo 'IMPORTANT: Run this AFTER ClinicHQ/VolunteerHub ingest'
\echo 'so V2 has entities to map V1 IDs to.'
\echo ''
