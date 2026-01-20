-- =====================================================
-- MIG_516: SCAS Data Quality Flags
-- =====================================================
-- Creates views and flags for SCAS records that need
-- data quality attention (missing microchips, data entry
-- errors, etc.)
-- =====================================================

\echo '=========================================='
\echo 'MIG_516: SCAS Data Quality Flags'
\echo '=========================================='

-- -----------------------------------------------------
-- PART 1: Create data quality issues table
-- -----------------------------------------------------

\echo ''
\echo '1. Creating data quality issues table...'

CREATE TABLE IF NOT EXISTS trapper.data_quality_issues (
    issue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL, -- 'cat', 'person', 'place', 'appointment'
    entity_id UUID,
    staged_record_id UUID REFERENCES trapper.staged_records(id),
    issue_type TEXT NOT NULL, -- 'missing_microchip', 'data_entry_error', 'duplicate_suspect', etc.
    severity TEXT NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    description TEXT NOT NULL,
    suggested_fix TEXT,
    source_system TEXT,
    source_data JSONB,
    status TEXT NOT NULL DEFAULT 'open', -- 'open', 'in_progress', 'resolved', 'wont_fix'
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dq_issues_status ON trapper.data_quality_issues(status);
CREATE INDEX IF NOT EXISTS idx_dq_issues_type ON trapper.data_quality_issues(issue_type);
CREATE INDEX IF NOT EXISTS idx_dq_issues_entity ON trapper.data_quality_issues(entity_type, entity_id);

COMMENT ON TABLE trapper.data_quality_issues IS 'Tracks data quality issues across all entity types for review and resolution';

-- -----------------------------------------------------
-- PART 2: Create function to flag SCAS data quality issues
-- -----------------------------------------------------

\echo ''
\echo '2. Creating SCAS data quality flagging function...'

CREATE OR REPLACE FUNCTION trapper.flag_scas_data_quality_issues()
RETURNS JSONB AS $$
DECLARE
    v_missing_microchip INT := 0;
    v_data_entry_error INT := 0;
    v_already_flagged INT := 0;
    v_record RECORD;
BEGIN
    -- Flag SCAS cats without microchips
    FOR v_record IN
        SELECT DISTINCT ON (ci.cat_id)
            ci.cat_id,
            ci.id_value as scas_animal_id,
            c.display_name,
            sr.id as staged_record_id,
            sr.payload->>'Date' as first_date
        FROM trapper.cat_identifiers ci
        JOIN trapper.sot_cats c ON c.cat_id = ci.cat_id AND c.merged_into_cat_id IS NULL
        LEFT JOIN trapper.staged_records sr ON sr.source_system = 'clinichq'
            AND sr.source_table = 'owner_info'
            AND sr.payload->>'Owner First Name' = ci.id_value
            AND sr.payload->>'Owner Last Name' = 'SCAS'
        WHERE ci.id_type = 'scas_animal_id'
          AND NOT EXISTS (
              SELECT 1 FROM trapper.cat_identifiers chip
              WHERE chip.cat_id = ci.cat_id AND chip.id_type = 'microchip'
          )
          AND NOT EXISTS (
              SELECT 1 FROM trapper.data_quality_issues dq
              WHERE dq.entity_id = ci.cat_id
                AND dq.issue_type = 'missing_microchip'
                AND dq.status = 'open'
          )
        ORDER BY ci.cat_id, (sr.payload->>'Date')::date
    LOOP
        INSERT INTO trapper.data_quality_issues (
            entity_type,
            entity_id,
            staged_record_id,
            issue_type,
            severity,
            description,
            suggested_fix,
            source_system,
            source_data
        ) VALUES (
            'cat',
            v_record.cat_id,
            v_record.staged_record_id,
            'missing_microchip',
            'medium',
            format('SCAS cat %s (%s) has no microchip on record',
                   v_record.scas_animal_id,
                   COALESCE(v_record.display_name, 'unnamed')),
            'Add microchip number from SCAS records or during next clinic visit',
            'clinichq',
            jsonb_build_object(
                'scas_animal_id', v_record.scas_animal_id,
                'cat_name', v_record.display_name,
                'first_visit', v_record.first_date
            )
        );
        v_missing_microchip := v_missing_microchip + 1;
    END LOOP;

    -- Flag data entry errors (addresses in Animal ID field)
    FOR v_record IN
        SELECT
            sr.id as staged_record_id,
            sr.payload->>'Owner First Name' as animal_id,
            sr.payload->>'Date' as date
        FROM trapper.staged_records sr
        WHERE sr.source_system = 'clinichq'
          AND sr.source_table = 'owner_info'
          AND sr.payload->>'Owner Last Name' = 'SCAS'
          AND (
              -- Looks like an address (has numbers and common street suffixes)
              sr.payload->>'Owner First Name' ~* '(ave|st|dr|ln|rd|blvd|way|ct|cir|hwy|lane|drive|street|avenue|road|boulevard)'
              -- Or doesn't match SCAS animal ID pattern
              OR (sr.payload->>'Owner First Name' !~ '^A[0-9]+'
                  AND sr.payload->>'Owner First Name' !~ '^[0-9]+$'
                  AND LENGTH(sr.payload->>'Owner First Name') > 3)
          )
          AND NOT EXISTS (
              SELECT 1 FROM trapper.data_quality_issues dq
              WHERE dq.staged_record_id = sr.id
                AND dq.issue_type = 'data_entry_error'
                AND dq.status = 'open'
          )
    LOOP
        INSERT INTO trapper.data_quality_issues (
            entity_type,
            staged_record_id,
            issue_type,
            severity,
            description,
            suggested_fix,
            source_system,
            source_data
        ) VALUES (
            'staged_record',
            v_record.staged_record_id,
            'data_entry_error',
            'low',
            format('SCAS record has unusual Animal ID: "%s" (may be address in wrong field)',
                   v_record.animal_id),
            'Review ClinicHQ record and correct the Animal ID field',
            'clinichq',
            jsonb_build_object(
                'animal_id', v_record.animal_id,
                'date', v_record.date
            )
        );
        v_data_entry_error := v_data_entry_error + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'missing_microchip_flags', v_missing_microchip,
        'data_entry_error_flags', v_data_entry_error,
        'total_new_flags', v_missing_microchip + v_data_entry_error
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.flag_scas_data_quality_issues IS
'Identifies and flags SCAS data quality issues: missing microchips, data entry errors';

-- -----------------------------------------------------
-- PART 3: Create view for data quality dashboard
-- -----------------------------------------------------

\echo ''
\echo '3. Creating data quality view...'

CREATE OR REPLACE VIEW trapper.v_data_quality_summary AS
SELECT
    issue_type,
    severity,
    status,
    COUNT(*) as issue_count,
    MIN(created_at) as oldest_issue,
    MAX(created_at) as newest_issue
FROM trapper.data_quality_issues
GROUP BY issue_type, severity, status
ORDER BY
    CASE status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
    CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
    issue_count DESC;

COMMENT ON VIEW trapper.v_data_quality_summary IS 'Summary of data quality issues by type, severity, and status';

-- Create view for SCAS-specific issues
CREATE OR REPLACE VIEW trapper.v_scas_data_quality AS
SELECT
    dq.issue_id,
    dq.issue_type,
    dq.severity,
    dq.description,
    dq.suggested_fix,
    dq.status,
    dq.source_data->>'scas_animal_id' as scas_animal_id,
    dq.source_data->>'cat_name' as cat_name,
    c.cat_id,
    chip.id_value as current_microchip,
    dq.created_at
FROM trapper.data_quality_issues dq
LEFT JOIN trapper.sot_cats c ON c.cat_id = dq.entity_id
LEFT JOIN trapper.cat_identifiers chip ON chip.cat_id = c.cat_id AND chip.id_type = 'microchip'
WHERE dq.source_system = 'clinichq'
  AND (dq.source_data->>'scas_animal_id' IS NOT NULL OR dq.issue_type = 'data_entry_error')
ORDER BY
    CASE dq.status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
    dq.created_at DESC;

COMMENT ON VIEW trapper.v_scas_data_quality IS 'SCAS-specific data quality issues for review';

-- -----------------------------------------------------
-- PART 4: Run the flagging
-- -----------------------------------------------------

\echo ''
\echo '4. Flagging SCAS data quality issues...'

SELECT trapper.flag_scas_data_quality_issues();

-- -----------------------------------------------------
-- PART 5: Verification
-- -----------------------------------------------------

\echo ''
\echo '5. Data quality summary...'

SELECT * FROM trapper.v_data_quality_summary;

\echo ''
\echo 'SCAS issues needing attention:'
SELECT
    issue_type,
    COUNT(*) as count
FROM trapper.v_scas_data_quality
WHERE status = 'open'
GROUP BY issue_type;

\echo ''
\echo '=== MIG_516 Complete ==='
\echo ''

SELECT trapper.record_migration(516, 'MIG_516__scas_data_quality_flags');
