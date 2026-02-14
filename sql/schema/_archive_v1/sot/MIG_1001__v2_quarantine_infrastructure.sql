-- MIG_1001: V2 Architecture - Quarantine & Pattern Detection Infrastructure
-- Phase 1, Part 2: Data quality infrastructure
--
-- Creates tables for:
-- 1. Pattern definitions (what to detect)
-- 2. Pattern alerts (detected issues)
-- 3. Quarantine records (failed validation)
-- 4. Source drawbacks registry (known issues per source)

-- ============================================================================
-- PATTERN DEFINITIONS - What patterns to detect
-- ============================================================================
CREATE TABLE IF NOT EXISTS atlas.pattern_definitions (
    pattern_id TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN ('identity', 'relationship', 'volume', 'quality')),
    name TEXT NOT NULL,
    description TEXT,
    detection_query TEXT,           -- SQL to detect this pattern (optional)
    action TEXT NOT NULL CHECK (action IN ('AUTO_FIX', 'QUARANTINE', 'ALERT', 'BLOCK')),
    auto_fix_function TEXT,         -- Function name for AUTO_FIX action
    severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE atlas.pattern_definitions IS 'Definitions of data quality patterns to detect';

-- ============================================================================
-- PATTERN ALERTS - Detected pattern instances
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit.pattern_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_id TEXT NOT NULL REFERENCES atlas.pattern_definitions(pattern_id),
    entity_type TEXT,               -- 'person', 'cat', 'place', 'appointment', 'batch'
    entity_id UUID,                 -- ID of affected entity
    batch_id UUID,                  -- Ingest batch if detected during ingest
    source_system TEXT,
    details JSONB,                  -- Pattern-specific details
    action_taken TEXT,              -- What was done
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    resolution TEXT,                -- 'merged', 'corrected', 'false_positive', 'kept_as_historical'
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pattern_alerts_unresolved
    ON audit.pattern_alerts(pattern_id, created_at)
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pattern_alerts_entity
    ON audit.pattern_alerts(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_pattern_alerts_batch
    ON audit.pattern_alerts(batch_id)
    WHERE batch_id IS NOT NULL;

COMMENT ON TABLE audit.pattern_alerts IS 'Log of detected data quality pattern violations';

-- ============================================================================
-- QUARANTINE RECORDS - Failed validation
-- ============================================================================
CREATE TABLE IF NOT EXISTS quarantine.failed_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_schema TEXT NOT NULL,    -- 'source', 'ops', etc.
    source_table TEXT NOT NULL,     -- Table the record was destined for
    source_record_id UUID,          -- Original record ID if available
    original_payload JSONB NOT NULL,-- Complete original data
    failure_reason TEXT NOT NULL,   -- Why it failed validation
    failure_details JSONB,          -- Additional context
    classification TEXT,            -- 'org_as_person', 'address_as_person', 'firstname_only', etc.
    pattern_id TEXT REFERENCES atlas.pattern_definitions(pattern_id),
    source_system TEXT,
    batch_id UUID,
    quarantined_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,
    resolution TEXT,                -- 'merged', 'deleted', 'corrected', 'kept_as_historical', 'released'
    resolution_notes TEXT,
    released_to_id UUID             -- If released, the ID of the created record
);

CREATE INDEX IF NOT EXISTS idx_quarantine_unreviewed
    ON quarantine.failed_records(classification, quarantined_at)
    WHERE reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quarantine_source
    ON quarantine.failed_records(source_system, source_table);

COMMENT ON TABLE quarantine.failed_records IS 'Records that failed validation, awaiting review';

-- ============================================================================
-- SOURCE DRAWBACKS REGISTRY - Known issues per source
-- ============================================================================
CREATE TABLE IF NOT EXISTS reference.source_drawbacks (
    id SERIAL PRIMARY KEY,
    source_system TEXT NOT NULL,
    drawback_category TEXT NOT NULL CHECK (drawback_category IN ('data_quality', 'format', 'completeness', 'consistency')),
    description TEXT NOT NULL,
    detection_patterns TEXT[],      -- Pattern IDs that detect this
    workaround TEXT,                -- How we handle it
    examples TEXT[],
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_drawbacks_system
    ON reference.source_drawbacks(source_system);

COMMENT ON TABLE reference.source_drawbacks IS 'Known data quality issues per source system';

-- ============================================================================
-- SEED PATTERN DEFINITIONS
-- ============================================================================
INSERT INTO atlas.pattern_definitions (pattern_id, category, name, description, action, severity) VALUES
-- Identity patterns
('IDENT_001', 'identity', 'Org email as person', 'Email matches @forgottenfelines.com, info@*, office@*, etc.', 'AUTO_FIX', 'high'),
('IDENT_002', 'identity', 'Address as person name', 'classify_owner_name() returns address', 'AUTO_FIX', 'high'),
('IDENT_003', 'identity', 'Organization as person', 'classify_owner_name() returns organization', 'QUARANTINE', 'medium'),
('IDENT_004', 'identity', 'First-name-only (non-SL/VH)', 'Last name NULL/empty, source not ShelterLuv/VolunteerHub', 'QUARANTINE', 'medium'),
('IDENT_005', 'identity', 'Garbage name', 'classify_owner_name() returns garbage', 'AUTO_FIX', 'high'),
('IDENT_006', 'identity', 'Duplicate identifiers', 'Same email/phone on multiple unmerged people', 'ALERT', 'medium'),
('IDENT_007', 'identity', 'Shared household phone', 'Phone appears on 3+ different people', 'ALERT', 'low'),
('IDENT_008', 'identity', 'Fabricated PetLink email', 'classify_petlink_email() returns fabricated', 'AUTO_FIX', 'medium'),
('IDENT_009', 'identity', 'Medical hold name', 'ShelterLuv owner with (dental), (medical) suffix', 'AUTO_FIX', 'low'),

-- Relationship patterns
('REL_001', 'relationship', 'Cat-place pollution', 'Cat has >5 links of same type to different places', 'ALERT', 'high'),
('REL_002', 'relationship', 'Staff home pollution', 'Staff/trapper address has >20 unrelated cats', 'ALERT', 'high'),
('REL_003', 'relationship', 'Orphan person', 'Person has no identifiers AND no relationships', 'ALERT', 'low'),
('REL_004', 'relationship', 'Circular merge', 'Merge chain forms a loop', 'BLOCK', 'critical'),
('REL_005', 'relationship', 'Cross-household link', 'Cat linked to people at different addresses via shared phone', 'ALERT', 'medium'),
('REL_006', 'relationship', 'Missing appointment cat', 'TNR appointment has person but no cat', 'ALERT', 'low'),
('REL_007', 'relationship', 'Orphan cat', 'Cat has no person_cat AND no cat_place relationships', 'ALERT', 'low'),
('REL_008', 'relationship', 'Work address pollution', 'Residential cats appearing at commercial address', 'ALERT', 'high'),

-- Volume patterns
('VOL_001', 'volume', 'Duplicate burst', '>10 similar records in single ingest batch', 'ALERT', 'medium'),
('VOL_002', 'volume', 'Spike anomaly', 'Entity creation rate >3x normal for source', 'ALERT', 'medium'),
('VOL_003', 'volume', 'Missing required field', '>5% of batch missing required field', 'ALERT', 'medium'),
('VOL_004', 'volume', 'Zero matches', 'Entire batch has 0 matches to existing entities', 'ALERT', 'low'),
('VOL_005', 'volume', 'All matches (re-import)', 'Entire batch matches existing entities', 'ALERT', 'low'),

-- Quality patterns
('QUAL_001', 'quality', 'Confidence drift', 'Average match confidence <0.5 for batch', 'ALERT', 'medium'),
('QUAL_002', 'quality', 'Source conflict', 'Same entity, different values from different sources', 'ALERT', 'low'),
('QUAL_003', 'quality', 'Stale data', 'Entity not updated in >1 year but has recent relationships', 'ALERT', 'low'),
('QUAL_004', 'quality', 'Geocode failure rate', '>10% of addresses fail geocoding in batch', 'ALERT', 'medium'),
('QUAL_005', 'quality', 'Review queue overflow', '>100 pending reviews for >7 days', 'ALERT', 'medium')
ON CONFLICT (pattern_id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    action = EXCLUDED.action,
    severity = EXCLUDED.severity,
    updated_at = NOW();

-- ============================================================================
-- SEED SOURCE DRAWBACKS (from original architecture diagram)
-- ============================================================================
INSERT INTO reference.source_drawbacks (source_system, drawback_category, description, detection_patterns, workaround, examples) VALUES
-- ClinicHQ
('clinichq', 'data_quality', 'Messy owner info - orgs stored as people', ARRAY['IDENT_001', 'IDENT_002', 'IDENT_003'], 'classify_owner_name() + should_be_person() gate', ARRAY['info@forgottenfelines.com', '890 Rockwell Rd']),
('clinichq', 'format', 'Microchips stored in animal name field', NULL, 'extract_microchip_from_animal_name()', ARRAY['Tabby 981020000000000', '9.8102E+14']),
('clinichq', 'data_quality', 'Super messy historical data (pre-2024)', NULL, 'Pre-2024 data flagged, use place as source of truth', NULL),
('clinichq', 'consistency', 'Owner fields contain site names instead of people', ARRAY['IDENT_002'], 'Route to clinic_accounts', ARRAY['Silveira Ranch', '5403 San Antonio Road Petaluma']),

-- Airtable
('airtable', 'consistency', 'Old connections, workflow changes over time', NULL, 'Source-dependent validation, migrate only salvageable records', NULL),
('airtable', 'data_quality', 'Messy public submissions', ARRAY['IDENT_004', 'IDENT_005'], 'Quarantine first-name-only unless has valuable linked data', ARRAY['Rosa', 'John']),
('airtable', 'completeness', 'Unknown how historical data was stored', NULL, 'Treat as legacy, dont auto-process', NULL),

-- ShelterLuv
('shelterluv', 'completeness', 'Partial data - separate system with own logic', NULL, 'Allow first-name-only with flag, real adopters/fosters', NULL),
('shelterluv', 'format', 'Medical holds use owner name + reason', ARRAY['IDENT_009'], 'Parse "(dental)", "(medical)" suffixes', ARRAY['Carlos Lopez Dental', 'Jupiter (dental)']),
('shelterluv', 'data_quality', 'Foster data sometimes incomplete', NULL, 'Accept with data_quality=incomplete flag', NULL),

-- VolunteerHub
('volunteerhub', 'data_quality', 'Mix of manual additions and public signups', NULL, 'Allow first-name-only with flag (verified volunteers)', NULL),
('volunteerhub', 'completeness', 'Missing data from public signups', NULL, 'Accept with data_quality=incomplete', NULL),
('volunteerhub', 'consistency', 'Public signup = messy data', ARRAY['IDENT_004'], 'Validate on entry, flag for review', NULL),

-- PetLink
('petlink', 'data_quality', 'Fabricated emails by FFSC staff for registration', ARRAY['IDENT_008'], 'classify_petlink_email() + low confidence score', ARRAY['gordon@lohrmanln.com', 'kathleen@jeffersonst.com']),
('petlink', 'completeness', 'Registry-only data, cats may never have been seen at FFSC', NULL, 'Expected unlinked cats, not a data gap', NULL),

-- Web Intake
('web_intake', 'data_quality', 'Public submissions may have incomplete data', ARRAY['IDENT_004', 'IDENT_005'], 'Quarantine if fails validation', NULL),
('web_intake', 'format', 'Free-text fields can contain anything', NULL, 'Classify and route appropriately', NULL)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- Dashboard view for pattern alerts
CREATE OR REPLACE VIEW audit.v_pattern_dashboard AS
SELECT
    pd.category,
    pd.pattern_id,
    pd.name,
    pd.severity,
    COUNT(pa.id) FILTER (WHERE pa.resolved_at IS NULL) as open_alerts,
    COUNT(pa.id) FILTER (WHERE pa.resolved_at IS NOT NULL) as resolved_alerts,
    MAX(pa.created_at) as last_detected,
    pd.action as default_action
FROM atlas.pattern_definitions pd
LEFT JOIN audit.pattern_alerts pa ON pa.pattern_id = pd.pattern_id
WHERE pd.is_active
GROUP BY pd.category, pd.pattern_id, pd.name, pd.severity, pd.action
ORDER BY
    CASE pd.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
    END,
    open_alerts DESC;

-- Unresolved alerts with entity details
CREATE OR REPLACE VIEW audit.v_unresolved_pattern_alerts AS
SELECT
    pa.id,
    pa.pattern_id,
    pd.name as pattern_name,
    pd.category,
    pd.severity,
    pa.entity_type,
    pa.entity_id,
    pa.source_system,
    pa.details,
    pa.action_taken,
    pa.created_at
FROM audit.pattern_alerts pa
JOIN atlas.pattern_definitions pd ON pd.pattern_id = pa.pattern_id
WHERE pa.resolved_at IS NULL
ORDER BY
    CASE pd.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
    END,
    pa.created_at DESC;

-- Quarantine review queue
CREATE OR REPLACE VIEW quarantine.v_review_queue AS
SELECT
    fr.id,
    fr.classification,
    fr.source_system,
    fr.source_table,
    fr.failure_reason,
    fr.original_payload,
    fr.quarantined_at,
    pd.name as pattern_name,
    pd.severity
FROM quarantine.failed_records fr
LEFT JOIN atlas.pattern_definitions pd ON pd.pattern_id = fr.pattern_id
WHERE fr.reviewed_at IS NULL
ORDER BY
    CASE pd.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
    END NULLS LAST,
    fr.quarantined_at;

COMMENT ON VIEW audit.v_pattern_dashboard IS 'Summary of pattern detection status';
COMMENT ON VIEW audit.v_unresolved_pattern_alerts IS 'Unresolved pattern alerts for review';
COMMENT ON VIEW quarantine.v_review_queue IS 'Quarantined records awaiting review';

-- ============================================================================
-- VERIFY
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'V2 quarantine infrastructure created successfully';
    RAISE NOTICE 'Pattern definitions: %', (SELECT COUNT(*) FROM atlas.pattern_definitions);
    RAISE NOTICE 'Source drawbacks: %', (SELECT COUNT(*) FROM reference.source_drawbacks);
END $$;
