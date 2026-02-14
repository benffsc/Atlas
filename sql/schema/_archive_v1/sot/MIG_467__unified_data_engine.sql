-- MIG_467: Unified Data Engine - Processor Registry & Dispatch
--
-- Creates a unified architecture where ALL data processing goes through
-- registered processors. This ensures consistent handling of:
-- - People (identity resolution, roles)
-- - Cats (microchip deduplication)
-- - Places (address normalization)
-- - Relationships (person-cat, person-place, etc.)
--
-- MANUAL APPLY:
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_467__unified_data_engine.sql

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_467: Unified Data Engine - Processor Registry & Dispatch        ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''

-- ============================================================================
-- PART 1: Extend person_roles to include 'adopter' and 'caretaker'
-- ============================================================================

\echo 'Extending person_roles CHECK constraint for new roles...'

-- Drop and recreate the CHECK constraint to include new roles
ALTER TABLE trapper.person_roles DROP CONSTRAINT IF EXISTS person_roles_role_check;

ALTER TABLE trapper.person_roles ADD CONSTRAINT person_roles_role_check
  CHECK (role IN (
    'trapper',
    'foster',
    'volunteer',
    'staff',
    'board_member',
    'donor',
    'adopter',      -- NEW: People who have adopted cats
    'caretaker'     -- NEW: People who care for community cats
  ));

\echo 'Added adopter and caretaker to person_roles'

-- ============================================================================
-- PART 2: Add processing metadata to staged_records
-- ============================================================================

\echo 'Adding processing metadata columns to staged_records...'

ALTER TABLE trapper.staged_records
  ADD COLUMN IF NOT EXISTS processor_name TEXT,
  ADD COLUMN IF NOT EXISTS processor_version TEXT,
  ADD COLUMN IF NOT EXISTS resulting_entity_type TEXT,  -- 'person', 'cat', 'place', 'request', 'relationship'
  ADD COLUMN IF NOT EXISTS resulting_entity_id UUID,
  ADD COLUMN IF NOT EXISTS processing_error TEXT;

COMMENT ON COLUMN trapper.staged_records.processor_name IS 'Name of processor that handled this record';
COMMENT ON COLUMN trapper.staged_records.processor_version IS 'Version of processor used';
COMMENT ON COLUMN trapper.staged_records.resulting_entity_type IS 'Type of entity created: person, cat, place, request, relationship';
COMMENT ON COLUMN trapper.staged_records.resulting_entity_id IS 'Primary key of the created/matched entity';
COMMENT ON COLUMN trapper.staged_records.processing_error IS 'Error message if processing failed';

-- ============================================================================
-- PART 3: Create processor registry table
-- ============================================================================

\echo 'Creating data_engine_processors registry table...'

CREATE TABLE IF NOT EXISTS trapper.data_engine_processors (
  processor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processor_name TEXT UNIQUE NOT NULL,
  source_system TEXT NOT NULL,
  source_table TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'cat', 'place', 'request', 'relationship', 'appointment')),
  processor_function TEXT NOT NULL,  -- SQL function name to call
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  priority INT DEFAULT 100,  -- Lower = process first (allows dependency ordering)
  config JSONB DEFAULT '{}',  -- Processor-specific configuration
  stats JSONB DEFAULT '{"processed": 0, "errors": 0, "last_run": null}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_system, source_table)
);

COMMENT ON TABLE trapper.data_engine_processors IS 'Registry of all data processors - ensures ALL data goes through unified pipeline';
COMMENT ON COLUMN trapper.data_engine_processors.priority IS 'Processing order: lower numbers first (e.g., people before cats)';
COMMENT ON COLUMN trapper.data_engine_processors.config IS 'Processor-specific settings like field mappings';

-- Create index for lookup
CREATE INDEX IF NOT EXISTS idx_processors_source
  ON trapper.data_engine_processors(source_system, source_table)
  WHERE is_active = true;

-- ============================================================================
-- PART 4: Register all processors
-- ============================================================================

\echo 'Registering data processors...'

INSERT INTO trapper.data_engine_processors (processor_name, source_system, source_table, entity_type, processor_function, description, priority)
VALUES
  -- ClinicHQ processors (priority 10-30 = process first for cat linkage)
  ('clinichq_owner', 'clinichq', 'owner_info', 'person', 'process_clinichq_owner',
   'Creates people from ClinicHQ appointment owners', 10),
  ('clinichq_cat', 'clinichq', 'cat_info', 'cat', 'process_clinichq_cat',
   'Creates cats from ClinicHQ cat records via microchip', 20),
  ('clinichq_appointment', 'clinichq', 'appointment_info', 'appointment', 'process_clinichq_appointment',
   'Creates appointments and links cats to people', 30),

  -- ShelterLuv processors (priority 40-60)
  ('shelterluv_person', 'shelterluv', 'people', 'person', 'process_shelterluv_person',
   'Creates people from ShelterLuv records', 40),
  ('shelterluv_animal', 'shelterluv', 'animals', 'cat', 'process_shelterluv_animal',
   'Creates cats from ShelterLuv animal records', 50),
  ('shelterluv_outcome', 'shelterluv', 'outcomes', 'relationship', 'process_shelterluv_outcome',
   'Creates adoption/foster relationships from outcomes', 60),

  -- PetLink processors (priority 70-80)
  ('petlink_pet', 'petlink', 'pets', 'cat', 'process_petlink_pet',
   'Creates/updates cats from PetLink microchip registry', 70),
  ('petlink_owner', 'petlink', 'owners', 'person', 'process_petlink_owner',
   'Creates people from PetLink registrations', 80),

  -- VolunteerHub processors (priority 90)
  ('volunteerhub_user', 'volunteerhub', 'users', 'person', 'process_volunteerhub_user',
   'Creates people with volunteer/foster roles from VolunteerHub', 90),

  -- Airtable processors (priority 100+ = lower priority, often already processed)
  ('airtable_trapping_request', 'airtable', 'trapping_requests', 'request', 'process_airtable_request',
   'Creates requests from Airtable trapping requests', 100),
  ('airtable_appointment_request', 'airtable', 'appointment_requests', 'request', 'process_airtable_appointment_request',
   'Creates requests from Airtable appointment requests', 110)

ON CONFLICT (source_system, source_table) DO UPDATE SET
  processor_function = EXCLUDED.processor_function,
  description = EXCLUDED.description,
  priority = EXCLUDED.priority,
  updated_at = NOW();

-- ============================================================================
-- PART 5: Create idempotent role assignment helper
-- ============================================================================

\echo 'Creating assign_person_role helper function...'

CREATE OR REPLACE FUNCTION trapper.assign_person_role(
  p_person_id UUID,
  p_role TEXT,
  p_source_system TEXT DEFAULT 'atlas',
  p_role_status TEXT DEFAULT 'active',
  p_trapper_type TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_role_id UUID;
BEGIN
  -- Validate role
  IF p_role NOT IN ('trapper', 'foster', 'volunteer', 'staff', 'board_member', 'donor', 'adopter', 'caretaker') THEN
    RAISE EXCEPTION 'Invalid role: %. Valid roles: trapper, foster, volunteer, staff, board_member, donor, adopter, caretaker', p_role;
  END IF;

  -- Insert or update role
  INSERT INTO trapper.person_roles (
    person_id,
    role,
    role_status,
    trapper_type,
    source_system,
    notes,
    created_at,
    updated_at
  )
  VALUES (
    p_person_id,
    p_role,
    p_role_status,
    p_trapper_type,
    p_source_system,
    p_notes,
    NOW(),
    NOW()
  )
  ON CONFLICT (person_id, role) DO UPDATE SET
    role_status = COALESCE(EXCLUDED.role_status, person_roles.role_status),
    trapper_type = COALESCE(EXCLUDED.trapper_type, person_roles.trapper_type),
    notes = COALESCE(EXCLUDED.notes, person_roles.notes),
    updated_at = NOW()
  RETURNING role_id INTO v_role_id;

  RETURN v_role_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.assign_person_role IS 'Idempotent role assignment - creates or updates a person role';

-- ============================================================================
-- PART 6: Create unified processor dispatch function
-- ============================================================================

\echo 'Creating data_engine_process_record dispatch function...'

CREATE OR REPLACE FUNCTION trapper.data_engine_process_record(p_staged_record_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_record RECORD;
  v_processor RECORD;
  v_result JSONB;
  v_start_time TIMESTAMPTZ;
  v_sql TEXT;
BEGIN
  v_start_time := clock_timestamp();

  -- Get the staged record
  SELECT * INTO v_record
  FROM trapper.staged_records
  WHERE id = p_staged_record_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Staged record not found',
      'staged_record_id', p_staged_record_id
    );
  END IF;

  -- Find the processor for this source
  SELECT * INTO v_processor
  FROM trapper.data_engine_processors
  WHERE source_system = v_record.source_system
    AND source_table = v_record.source_table
    AND is_active = true;

  IF v_processor IS NULL THEN
    -- No processor registered - mark as processed with warning
    UPDATE trapper.staged_records
    SET is_processed = true,
        processed_at = NOW(),
        processing_error = 'No processor registered for ' || v_record.source_system || '/' || v_record.source_table
    WHERE id = p_staged_record_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'No processor registered',
      'source_system', v_record.source_system,
      'source_table', v_record.source_table,
      'staged_record_id', p_staged_record_id
    );
  END IF;

  -- Call the processor function dynamically
  BEGIN
    v_sql := format('SELECT trapper.%I($1)', v_processor.processor_function);
    EXECUTE v_sql INTO v_result USING p_staged_record_id;

    -- Update stats
    UPDATE trapper.data_engine_processors
    SET stats = jsonb_set(
      jsonb_set(stats, '{processed}', to_jsonb((stats->>'processed')::int + 1)),
      '{last_run}', to_jsonb(NOW()::text)
    )
    WHERE processor_id = v_processor.processor_id;

    RETURN jsonb_build_object(
      'success', true,
      'processor', v_processor.processor_name,
      'entity_type', v_processor.entity_type,
      'result', v_result,
      'processing_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::int
    );

  EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail
    UPDATE trapper.staged_records
    SET processing_error = SQLERRM
    WHERE id = p_staged_record_id;

    -- Update error stats
    UPDATE trapper.data_engine_processors
    SET stats = jsonb_set(stats, '{errors}', to_jsonb((stats->>'errors')::int + 1))
    WHERE processor_id = v_processor.processor_id;

    RETURN jsonb_build_object(
      'success', false,
      'processor', v_processor.processor_name,
      'error', SQLERRM,
      'staged_record_id', p_staged_record_id
    );
  END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_process_record IS 'Unified dispatch: routes staged record to appropriate processor based on source';

-- ============================================================================
-- PART 7: Create unified batch processor
-- ============================================================================

\echo 'Creating data_engine_process_batch_unified function...'

CREATE OR REPLACE FUNCTION trapper.data_engine_process_batch_unified(
  p_source_system TEXT DEFAULT NULL,
  p_source_table TEXT DEFAULT NULL,
  p_batch_size INT DEFAULT 500,
  p_job_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_processed INT := 0;
  v_success INT := 0;
  v_errors INT := 0;
  v_rec RECORD;
  v_result JSONB;
  v_start_time TIMESTAMPTZ;
  v_results JSONB := '[]'::JSONB;
BEGIN
  v_start_time := clock_timestamp();

  -- Process unprocessed staged records
  FOR v_rec IN
    SELECT sr.id AS staged_record_id
    FROM trapper.staged_records sr
    WHERE (p_source_system IS NULL OR sr.source_system = p_source_system)
      AND (p_source_table IS NULL OR sr.source_table = p_source_table)
      AND sr.is_processed = false
      AND sr.processing_error IS NULL  -- Skip previously errored records
      -- Has processor registered
      AND EXISTS (
        SELECT 1 FROM trapper.data_engine_processors p
        WHERE p.source_system = sr.source_system
          AND p.source_table = sr.source_table
          AND p.is_active = true
      )
    ORDER BY sr.created_at ASC
    LIMIT p_batch_size
  LOOP
    v_processed := v_processed + 1;

    -- Process through unified dispatch
    v_result := trapper.data_engine_process_record(v_rec.staged_record_id);

    IF (v_result->>'success')::boolean THEN
      v_success := v_success + 1;
    ELSE
      v_errors := v_errors + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'success', v_success,
    'errors', v_errors,
    'source_system', p_source_system,
    'source_table', p_source_table,
    'batch_size', p_batch_size,
    'job_id', p_job_id,
    'processing_time_ms', EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::int
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.data_engine_process_batch_unified IS 'Process a batch of staged records through the unified data engine';

-- ============================================================================
-- PART 8: Create view for processor status
-- ============================================================================

\echo 'Creating v_data_engine_status view...'

CREATE OR REPLACE VIEW trapper.v_data_engine_status AS
SELECT
  p.processor_name,
  p.source_system,
  p.source_table,
  p.entity_type,
  p.is_active,
  p.priority,
  (p.stats->>'processed')::int AS total_processed,
  (p.stats->>'errors')::int AS total_errors,
  (p.stats->>'last_run')::timestamptz AS last_run,
  COALESCE(pending.count, 0) AS pending_records,
  COALESCE(errored.count, 0) AS errored_records
FROM trapper.data_engine_processors p
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS count
  FROM trapper.staged_records sr
  WHERE sr.source_system = p.source_system
    AND sr.source_table = p.source_table
    AND sr.is_processed = false
    AND sr.processing_error IS NULL
) pending ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS count
  FROM trapper.staged_records sr
  WHERE sr.source_system = p.source_system
    AND sr.source_table = p.source_table
    AND sr.processing_error IS NOT NULL
) errored ON true
ORDER BY p.priority, p.source_system, p.source_table;

COMMENT ON VIEW trapper.v_data_engine_status IS 'Shows status of all data engine processors with pending/error counts';

-- ============================================================================
-- PART 9: Create view for role distribution
-- ============================================================================

\echo 'Creating v_person_role_distribution view...'

CREATE OR REPLACE VIEW trapper.v_person_role_distribution AS
SELECT
  role,
  role_status,
  source_system,
  COUNT(*) AS count,
  COUNT(DISTINCT person_id) AS unique_people
FROM trapper.person_roles
GROUP BY role, role_status, source_system
ORDER BY role, role_status, source_system;

COMMENT ON VIEW trapper.v_person_role_distribution IS 'Distribution of person roles by type, status, and source';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo 'Checking registered processors...'
SELECT processor_name, source_system, source_table, entity_type, is_active, priority
FROM trapper.data_engine_processors
ORDER BY priority, source_system, source_table;

\echo ''
\echo 'Current role distribution...'
SELECT role, COUNT(*) AS count
FROM trapper.person_roles
GROUP BY role
ORDER BY count DESC;

\echo ''
\echo '╔══════════════════════════════════════════════════════════════════════╗'
\echo '║  MIG_467 COMPLETE - Unified Data Engine Core Installed               ║'
\echo '╠══════════════════════════════════════════════════════════════════════╣'
\echo '║  New tables:                                                         ║'
\echo '║    - data_engine_processors: Registry of all processors              ║'
\echo '║                                                                      ║'
\echo '║  New functions:                                                      ║'
\echo '║    - assign_person_role(): Idempotent role assignment                ║'
\echo '║    - data_engine_process_record(): Unified dispatch                  ║'
\echo '║    - data_engine_process_batch_unified(): Batch processor            ║'
\echo '║                                                                      ║'
\echo '║  New views:                                                          ║'
\echo '║    - v_data_engine_status: Processor health & pending counts         ║'
\echo '║    - v_person_role_distribution: Role distribution stats             ║'
\echo '║                                                                      ║'
\echo '║  Extended person_roles to include: adopter, caretaker                ║'
\echo '╚══════════════════════════════════════════════════════════════════════╝'
\echo ''
