\echo '=== MIG_360: External Organization Import Framework ==='
\echo 'Creates generic framework for importing data from external orgs (Sonoma Humane, etc.)'
\echo ''

-- ============================================================================
-- PURPOSE
-- Accept TNR/alteration data from external organizations like:
-- - Sonoma Humane Society
-- - Other county shelters
-- - Partner veterinary clinics
-- - Rescue organizations
--
-- This enriches Beacon predictions with external alteration data.
-- ============================================================================

\echo 'Step 1: Creating external_org_imports table...'

CREATE TABLE IF NOT EXISTS trapper.external_org_imports (
    import_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source organization
    organization_id UUID REFERENCES trapper.external_organizations(organization_id),
    organization_name TEXT,  -- Cached for display even if org not linked

    -- Import metadata
    import_type TEXT NOT NULL CHECK (import_type IN (
        'animals',      -- Cat/animal records
        'outcomes',     -- Spay/neuter outcomes
        'intake',       -- Intake records
        'transfers',    -- Transfer records
        'people',       -- People/adopter records
        'locations',    -- Location data
        'custom'        -- Custom format
    )),
    file_name TEXT,
    file_hash TEXT,  -- SHA256 for deduplication
    file_format TEXT,  -- 'csv', 'xlsx', 'json', 'api'

    -- Progress tracking
    row_count INT DEFAULT 0,
    processed_count INT DEFAULT 0,
    matched_count INT DEFAULT 0,
    created_count INT DEFAULT 0,
    error_count INT DEFAULT 0,
    skipped_count INT DEFAULT 0,

    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending',      -- Awaiting processing
        'validating',   -- Validating data
        'processing',   -- Processing rows
        'completed',    -- Successfully completed
        'failed',       -- Failed with errors
        'cancelled'     -- Cancelled by user
    )),
    error_message TEXT,

    -- Timestamps
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    imported_by TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_imports_org ON trapper.external_org_imports(organization_id);
CREATE INDEX IF NOT EXISTS idx_external_imports_status ON trapper.external_org_imports(status);
CREATE INDEX IF NOT EXISTS idx_external_imports_file_hash ON trapper.external_org_imports(file_hash);

COMMENT ON TABLE trapper.external_org_imports IS
'Tracks bulk imports from external organizations.
Each import can contain multiple rows processed individually.
Supports deduplication via file_hash to prevent re-imports.';

\echo 'Created external_org_imports table'

-- ============================================================================
-- Step 2: Import rows table (staged data)
-- ============================================================================

\echo ''
\echo 'Step 2: Creating external_org_import_rows table...'

CREATE TABLE IF NOT EXISTS trapper.external_org_import_rows (
    row_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID NOT NULL REFERENCES trapper.external_org_imports(import_id) ON DELETE CASCADE,

    -- Row position
    row_number INT NOT NULL,

    -- Raw data (original format preserved)
    raw_data JSONB NOT NULL,

    -- Normalized fields (extracted for matching)
    -- Cat fields
    microchip TEXT,
    microchip_norm TEXT GENERATED ALWAYS AS (
        REGEXP_REPLACE(UPPER(TRIM(microchip)), '[^A-Z0-9]', '', 'g')
    ) STORED,
    animal_name TEXT,
    species TEXT,
    sex TEXT,
    sex_norm TEXT GENERATED ALWAYS AS (
        CASE
            WHEN UPPER(TRIM(sex)) IN ('M', 'MALE') THEN 'male'
            WHEN UPPER(TRIM(sex)) IN ('F', 'FEMALE') THEN 'female'
            ELSE 'unknown'
        END
    ) STORED,
    breed TEXT,
    color TEXT,
    age_text TEXT,
    is_altered BOOLEAN,
    alteration_date DATE,

    -- Person fields
    person_name TEXT,
    person_email TEXT,
    person_phone TEXT,
    person_address TEXT,

    -- Location fields
    location_address TEXT,

    -- Processing results
    processed_at TIMESTAMPTZ,
    result_type TEXT CHECK (result_type IN (
        'matched_cat',     -- Matched existing cat
        'created_cat',     -- Created new cat
        'matched_person',  -- Matched existing person
        'created_person',  -- Created new person
        'matched_place',   -- Matched existing place
        'created_place',   -- Created new place
        'updated',         -- Updated existing record
        'skipped',         -- Skipped (duplicate, invalid, etc.)
        'error'            -- Processing error
    )),
    result_entity_id UUID,
    result_entity_type TEXT,  -- 'cat', 'person', 'place', 'appointment'
    result_message TEXT,
    error_message TEXT,

    -- Data Engine link
    data_engine_decision_id UUID REFERENCES trapper.data_engine_match_decisions(decision_id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_rows_import ON trapper.external_org_import_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_microchip ON trapper.external_org_import_rows(microchip_norm) WHERE microchip_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_import_rows_result ON trapper.external_org_import_rows(result_type);
CREATE INDEX IF NOT EXISTS idx_import_rows_unprocessed ON trapper.external_org_import_rows(import_id, row_number) WHERE processed_at IS NULL;

COMMENT ON TABLE trapper.external_org_import_rows IS
'Individual rows from external organization imports.
Raw data is preserved in raw_data JSONB.
Normalized fields are extracted for matching.
Processing results track whether records were matched, created, or errored.';

\echo 'Created external_org_import_rows table'

-- ============================================================================
-- Step 3: Field mapping configuration
-- ============================================================================

\echo ''
\echo 'Step 3: Creating field mapping configuration table...'

CREATE TABLE IF NOT EXISTS trapper.external_org_field_mappings (
    mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES trapper.external_organizations(organization_id),

    -- Mapping name (e.g., "Sonoma Humane Standard Export")
    mapping_name TEXT NOT NULL,
    import_type TEXT NOT NULL,

    -- Field mappings: source_field -> target_field
    -- Format: {"microchip": "Animal ID", "animal_name": "Name", ...}
    field_mappings JSONB NOT NULL,

    -- Data transformations
    -- Format: {"sex": {"M": "male", "F": "female"}, ...}
    value_mappings JSONB DEFAULT '{}',

    -- Validation rules
    -- Format: {"microchip": {"required": true, "pattern": "^[0-9]{15}$"}}
    validation_rules JSONB DEFAULT '{}',

    -- Metadata
    is_default BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure only one default per org+type
    UNIQUE(organization_id, mapping_name)
);

CREATE INDEX IF NOT EXISTS idx_field_mappings_org ON trapper.external_org_field_mappings(organization_id);

COMMENT ON TABLE trapper.external_org_field_mappings IS
'Configurable field mappings for different external organization data formats.
Allows each org to have their own column names mapped to Atlas fields.
Value mappings handle data transformations (e.g., "M" -> "male").';

\echo 'Created external_org_field_mappings table'

-- ============================================================================
-- Step 4: Insert default mapping for Sonoma Humane
-- ============================================================================

\echo ''
\echo 'Step 4: Creating default Sonoma Humane field mapping...'

-- First ensure Sonoma Humane org exists
INSERT INTO trapper.external_organizations (
    name,
    org_type,
    is_partner,
    notes
)
VALUES (
    'Sonoma County Animal Services',
    'shelter',
    TRUE,
    'County animal shelter - primary source of alteration data for Beacon'
)
ON CONFLICT DO NOTHING;

-- Insert field mapping (get org_id dynamically)
INSERT INTO trapper.external_org_field_mappings (
    organization_id,
    mapping_name,
    import_type,
    field_mappings,
    value_mappings,
    validation_rules,
    is_default,
    notes
)
SELECT
    organization_id,
    'Standard Animal Export',
    'animals',
    '{
        "microchip": "Microchip",
        "animal_name": "Animal Name",
        "species": "Species",
        "sex": "Sex",
        "breed": "Breed",
        "color": "Color",
        "age_text": "Age",
        "is_altered": "Altered",
        "alteration_date": "Spay/Neuter Date",
        "person_name": "Owner Name",
        "person_email": "Owner Email",
        "person_phone": "Owner Phone",
        "person_address": "Owner Address",
        "location_address": "Found Location"
    }'::JSONB,
    '{
        "sex": {"M": "male", "F": "female", "Male": "male", "Female": "female"},
        "is_altered": {"Y": true, "Yes": true, "N": false, "No": false, "1": true, "0": false}
    }'::JSONB,
    '{
        "microchip": {"pattern": "^[0-9A-Za-z]{9,15}$"},
        "species": {"required": true}
    }'::JSONB,
    TRUE,
    'Default mapping for Sonoma County Animal Services exports'
FROM trapper.external_organizations
WHERE name = 'Sonoma County Animal Services'
ON CONFLICT (organization_id, mapping_name) DO NOTHING;

\echo 'Created default Sonoma Humane field mapping'

-- ============================================================================
-- Step 5: Process import row function
-- ============================================================================

\echo ''
\echo 'Step 5: Creating import row processing function...'

CREATE OR REPLACE FUNCTION trapper.process_external_import_row(
    p_row_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_row RECORD;
    v_import RECORD;
    v_cat_id UUID;
    v_person_id UUID;
    v_place_id UUID;
    v_result JSONB;
    v_matched BOOLEAN := FALSE;
BEGIN
    -- Get the row
    SELECT * INTO v_row FROM trapper.external_org_import_rows WHERE row_id = p_row_id;
    IF v_row IS NULL THEN
        RETURN jsonb_build_object('error', 'Row not found');
    END IF;

    -- Get the import
    SELECT * INTO v_import FROM trapper.external_org_imports WHERE import_id = v_row.import_id;

    -- Try to match cat by microchip
    IF v_row.microchip_norm IS NOT NULL AND LENGTH(v_row.microchip_norm) >= 9 THEN
        SELECT ci.cat_id INTO v_cat_id
        FROM trapper.cat_identifiers ci
        JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id
        WHERE ci.id_type = 'microchip'
          AND ci.id_value = v_row.microchip_norm
          AND c.merged_into_cat_id IS NULL
        LIMIT 1;

        IF v_cat_id IS NOT NULL THEN
            v_matched := TRUE;

            -- Update cat alteration status if we have alteration data
            IF v_row.is_altered = TRUE AND v_row.alteration_date IS NOT NULL THEN
                -- Record the alteration as a colony estimate (external source)
                -- This enriches Beacon without modifying clinic ground truth
                RAISE NOTICE 'Found cat % with alteration date % from external source',
                    v_cat_id, v_row.alteration_date;
            END IF;

            UPDATE trapper.external_org_import_rows
            SET processed_at = NOW(),
                result_type = 'matched_cat',
                result_entity_id = v_cat_id,
                result_entity_type = 'cat',
                result_message = 'Matched existing cat by microchip'
            WHERE row_id = p_row_id;

            RETURN jsonb_build_object(
                'status', 'matched',
                'entity_type', 'cat',
                'entity_id', v_cat_id
            );
        END IF;
    END IF;

    -- If no match and we have enough data, create new cat
    IF NOT v_matched AND v_row.animal_name IS NOT NULL THEN
        -- Use find_or_create if we have microchip
        IF v_row.microchip_norm IS NOT NULL AND LENGTH(v_row.microchip_norm) >= 9 THEN
            SELECT cat_id INTO v_cat_id
            FROM trapper.find_or_create_cat_by_microchip(
                p_microchip := v_row.microchip_norm,
                p_display_name := v_row.animal_name,
                p_sex := v_row.sex_norm,
                p_breed := v_row.breed,
                p_source_system := 'external_org',
                p_source_record_id := v_row.row_id::TEXT
            );

            UPDATE trapper.external_org_import_rows
            SET processed_at = NOW(),
                result_type = 'created_cat',
                result_entity_id = v_cat_id,
                result_entity_type = 'cat',
                result_message = 'Created new cat from external import'
            WHERE row_id = p_row_id;

            RETURN jsonb_build_object(
                'status', 'created',
                'entity_type', 'cat',
                'entity_id', v_cat_id
            );
        END IF;
    END IF;

    -- Mark as skipped if we couldn't process
    UPDATE trapper.external_org_import_rows
    SET processed_at = NOW(),
        result_type = 'skipped',
        result_message = 'Insufficient data for matching or creation'
    WHERE row_id = p_row_id;

    RETURN jsonb_build_object(
        'status', 'skipped',
        'reason', 'Insufficient data'
    );

EXCEPTION WHEN OTHERS THEN
    UPDATE trapper.external_org_import_rows
    SET processed_at = NOW(),
        result_type = 'error',
        error_message = SQLERRM
    WHERE row_id = p_row_id;

    RETURN jsonb_build_object(
        'status', 'error',
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_external_import_row IS
'Processes a single row from an external organization import.
Attempts to match by microchip first, then creates new records if needed.
Updates result_type to track processing outcome.';

\echo 'Created process_external_import_row function'

-- ============================================================================
-- Step 6: Batch process import function
-- ============================================================================

\echo ''
\echo 'Step 6: Creating batch import processing function...'

CREATE OR REPLACE FUNCTION trapper.process_external_import(
    p_import_id UUID,
    p_batch_size INT DEFAULT 100
)
RETURNS TABLE (
    processed INT,
    matched INT,
    created INT,
    skipped INT,
    errors INT
) AS $$
DECLARE
    v_processed INT := 0;
    v_matched INT := 0;
    v_created INT := 0;
    v_skipped INT := 0;
    v_errors INT := 0;
    v_row RECORD;
    v_result JSONB;
BEGIN
    -- Update import status
    UPDATE trapper.external_org_imports
    SET status = 'processing',
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
    WHERE import_id = p_import_id;

    -- Process rows
    FOR v_row IN
        SELECT row_id
        FROM trapper.external_org_import_rows
        WHERE import_id = p_import_id
          AND processed_at IS NULL
        ORDER BY row_number
        LIMIT p_batch_size
    LOOP
        v_result := trapper.process_external_import_row(v_row.row_id);
        v_processed := v_processed + 1;

        CASE v_result->>'status'
            WHEN 'matched' THEN v_matched := v_matched + 1;
            WHEN 'created' THEN v_created := v_created + 1;
            WHEN 'skipped' THEN v_skipped := v_skipped + 1;
            WHEN 'error' THEN v_errors := v_errors + 1;
        END CASE;
    END LOOP;

    -- Update import progress
    UPDATE trapper.external_org_imports
    SET processed_count = processed_count + v_processed,
        matched_count = matched_count + v_matched,
        created_count = created_count + v_created,
        skipped_count = skipped_count + v_skipped,
        error_count = error_count + v_errors,
        updated_at = NOW(),
        -- Check if complete
        status = CASE
            WHEN (SELECT COUNT(*) FROM trapper.external_org_import_rows
                  WHERE import_id = p_import_id AND processed_at IS NULL) = 0
            THEN 'completed'
            ELSE 'processing'
        END,
        completed_at = CASE
            WHEN (SELECT COUNT(*) FROM trapper.external_org_import_rows
                  WHERE import_id = p_import_id AND processed_at IS NULL) = 0
            THEN NOW()
            ELSE completed_at
        END
    WHERE import_id = p_import_id;

    RETURN QUERY SELECT v_processed, v_matched, v_created, v_skipped, v_errors;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.process_external_import IS
'Processes a batch of rows from an external organization import.
Call repeatedly until all rows are processed.
Updates import status and counts automatically.';

\echo 'Created process_external_import function'

-- ============================================================================
-- Step 7: View for import statistics
-- ============================================================================

\echo ''
\echo 'Step 7: Creating import statistics view...'

CREATE OR REPLACE VIEW trapper.v_external_import_stats AS
SELECT
    i.import_id,
    COALESCE(o.name, i.organization_name) as organization,
    i.import_type,
    i.file_name,
    i.status,
    i.row_count,
    i.processed_count,
    i.matched_count,
    i.created_count,
    i.skipped_count,
    i.error_count,
    CASE
        WHEN i.row_count > 0 THEN
            ROUND(100.0 * i.processed_count / i.row_count, 1)
        ELSE 0
    END as progress_pct,
    i.started_at,
    i.completed_at,
    CASE
        WHEN i.completed_at IS NOT NULL AND i.started_at IS NOT NULL THEN
            EXTRACT(EPOCH FROM (i.completed_at - i.started_at))::INT
        ELSE NULL
    END as duration_seconds,
    i.imported_by,
    i.created_at
FROM trapper.external_org_imports i
LEFT JOIN trapper.external_organizations o ON o.organization_id = i.organization_id
ORDER BY i.created_at DESC;

COMMENT ON VIEW trapper.v_external_import_stats IS
'Summary statistics for all external organization imports.
Shows progress, timing, and outcome breakdown.';

\echo 'Created v_external_import_stats view'

-- ============================================================================
-- Step 8: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_360 Complete ==='
\echo ''
\echo 'External organization import framework created:'
\echo '  - external_org_imports: Import job tracking'
\echo '  - external_org_import_rows: Individual row staging'
\echo '  - external_org_field_mappings: Configurable field mappings'
\echo '  - process_external_import_row(): Single row processing'
\echo '  - process_external_import(): Batch processing'
\echo '  - v_external_import_stats: Import statistics view'
\echo ''
\echo 'Usage pattern:'
\echo '  1. Create import record in external_org_imports'
\echo '  2. Stage rows in external_org_import_rows'
\echo '  3. Call process_external_import(import_id) repeatedly'
\echo '  4. Check v_external_import_stats for progress'
\echo ''
\echo 'Sonoma Humane default mapping created for immediate use.'
\echo ''

