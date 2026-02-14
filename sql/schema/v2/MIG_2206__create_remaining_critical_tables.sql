-- MIG_2206: Create Remaining Critical Tables
-- Date: 2026-02-14
--
-- Purpose: Create all remaining tables referenced by code but don't exist
-- This completes the V2 schema so all routes work

\echo ''
\echo '=============================================='
\echo '  MIG_2206: Create Remaining Critical Tables'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. CLINIC OPERATIONS
-- ============================================================================

\echo '1. Creating Clinic operations tables...'

-- Clinic days (scheduling)
CREATE TABLE IF NOT EXISTS ops.clinic_days (
    clinic_day_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_date DATE NOT NULL UNIQUE,
    location TEXT DEFAULT 'FFSC Clinic',
    max_appointments INT DEFAULT 30,
    notes TEXT,
    is_cancelled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinic_days_date ON ops.clinic_days(clinic_date);

COMMENT ON TABLE ops.clinic_days IS 'Clinic day scheduling';

-- Clinic day entries (attendance/procedures)
CREATE TABLE IF NOT EXISTS ops.clinic_day_entries (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_day_id UUID REFERENCES ops.clinic_days(clinic_day_id) ON DELETE CASCADE,
    cat_id UUID REFERENCES sot.cats(cat_id),
    appointment_id UUID REFERENCES ops.appointments(appointment_id),
    trap_number TEXT,
    cage_number TEXT,
    check_in_time TIME,
    surgery_time TIME,
    recovery_time TIME,
    release_time TIME,
    notes TEXT,
    status TEXT DEFAULT 'checked_in' CHECK (status IN ('checked_in', 'in_surgery', 'recovering', 'released', 'held')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_day ON ops.clinic_day_entries(clinic_day_id);
CREATE INDEX IF NOT EXISTS idx_clinic_day_entries_cat ON ops.clinic_day_entries(cat_id);

COMMENT ON TABLE ops.clinic_day_entries IS 'Individual cat entries for clinic days';

\echo '   Created ops.clinic_days, ops.clinic_day_entries'

-- ============================================================================
-- 2. INTAKE SYSTEM
-- ============================================================================

\echo ''
\echo '2. Creating Intake system tables...'

-- Intake questions (form builder)
CREATE TABLE IF NOT EXISTS ops.intake_questions (
    question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_key TEXT NOT NULL UNIQUE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL CHECK (question_type IN ('text', 'textarea', 'select', 'multiselect', 'checkbox', 'radio', 'number', 'date', 'phone', 'email', 'address')),
    category TEXT DEFAULT 'general',
    is_required BOOLEAN DEFAULT false,
    display_order INT DEFAULT 0,
    options JSONB DEFAULT '[]',
    validation_rules JSONB DEFAULT '{}',
    help_text TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_questions_category ON ops.intake_questions(category);
CREATE INDEX IF NOT EXISTS idx_intake_questions_order ON ops.intake_questions(display_order);

COMMENT ON TABLE ops.intake_questions IS 'Configurable intake form questions';

-- Intake question options (for select/radio types)
CREATE TABLE IF NOT EXISTS ops.intake_question_options (
    option_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID REFERENCES ops.intake_questions(question_id) ON DELETE CASCADE,
    option_value TEXT NOT NULL,
    option_label TEXT NOT NULL,
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_intake_question_options_question ON ops.intake_question_options(question_id);

COMMENT ON TABLE ops.intake_question_options IS 'Options for select/radio intake questions';

-- Intake custom fields (field definitions)
CREATE TABLE IF NOT EXISTS ops.intake_custom_fields (
    field_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_key TEXT NOT NULL UNIQUE,
    field_label TEXT NOT NULL,
    field_type TEXT NOT NULL,
    default_value TEXT,
    is_required BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    airtable_field_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.intake_custom_fields IS 'Custom field definitions for intake forms';

\echo '   Created ops.intake_questions, ops.intake_question_options, ops.intake_custom_fields'

-- ============================================================================
-- 3. ECOLOGY/BEACON CONFIG
-- ============================================================================

\echo ''
\echo '3. Creating Ecology/Beacon configuration tables...'

-- Ecology config (Beacon parameters)
CREATE TABLE IF NOT EXISTS ops.ecology_config (
    config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key TEXT NOT NULL UNIQUE,
    config_value JSONB NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general',
    updated_by UUID REFERENCES ops.staff(staff_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default ecology parameters
INSERT INTO ops.ecology_config (config_key, config_value, description, category) VALUES
    ('alteration_threshold', '0.70', 'Target alteration rate for population stabilization', 'colony'),
    ('kitten_season_start', '"2025-03-01"', 'Start of kitten season', 'seasonal'),
    ('kitten_season_end', '"2025-10-31"', 'End of kitten season', 'seasonal'),
    ('decay_window_months', '24', 'Months before historical data decays', 'time'),
    ('cluster_radius_meters', '500', 'Radius for colony clustering', 'spatial'),
    ('min_cluster_size', '3', 'Minimum places to form a cluster', 'spatial')
ON CONFLICT (config_key) DO NOTHING;

COMMENT ON TABLE ops.ecology_config IS 'Beacon ecology configuration parameters';

-- Ecology config audit (change history)
CREATE TABLE IF NOT EXISTS ops.ecology_config_audit (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB,
    changed_by UUID REFERENCES ops.staff(staff_id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_ecology_config_audit_key ON ops.ecology_config_audit(config_key);

COMMENT ON TABLE ops.ecology_config_audit IS 'Audit trail for ecology config changes';

-- Count precision factors (colony estimation)
CREATE TABLE IF NOT EXISTS ops.count_precision_factors (
    factor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factor_name TEXT NOT NULL UNIQUE,
    factor_value NUMERIC(5,3) NOT NULL DEFAULT 1.0,
    description TEXT,
    applies_to TEXT DEFAULT 'all',
    is_active BOOLEAN DEFAULT true
);

INSERT INTO ops.count_precision_factors (factor_name, factor_value, description) VALUES
    ('visual_count', 0.85, 'Precision for visual cat counts'),
    ('feeder_estimate', 0.70, 'Precision for feeder-reported estimates'),
    ('trap_count', 0.95, 'Precision for actual trap counts'),
    ('microchip_scan', 1.00, 'Precision for microchip-verified counts')
ON CONFLICT (factor_name) DO NOTHING;

COMMENT ON TABLE ops.count_precision_factors IS 'Precision factors for colony count estimation';

\echo '   Created ops.ecology_config, ops.ecology_config_audit, ops.count_precision_factors'

-- ============================================================================
-- 4. DATA ENGINE ADVANCED
-- ============================================================================

\echo ''
\echo '4. Creating Data Engine advanced tables...'

-- Households (person grouping)
CREATE TABLE IF NOT EXISTS sot.households (
    household_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_address_id UUID REFERENCES sot.addresses(address_id),
    household_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_households_address ON sot.households(primary_address_id);

COMMENT ON TABLE sot.households IS 'Household groupings for people at same address';

-- Household members
CREATE TABLE IF NOT EXISTS sot.household_members (
    member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID REFERENCES sot.households(household_id) ON DELETE CASCADE,
    person_id UUID REFERENCES sot.people(person_id) ON DELETE CASCADE,
    relationship TEXT DEFAULT 'member',
    is_primary BOOLEAN DEFAULT false,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (household_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_household_members_person ON sot.household_members(person_id);

COMMENT ON TABLE sot.household_members IS 'People belonging to households';

-- Fellegi-Sunter matching parameters
CREATE TABLE IF NOT EXISTS sot.fellegi_sunter_parameters (
    param_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_name TEXT NOT NULL UNIQUE,
    m_probability NUMERIC(5,4) NOT NULL DEFAULT 0.9,
    u_probability NUMERIC(5,4) NOT NULL DEFAULT 0.1,
    weight NUMERIC(8,4),
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sot.fellegi_sunter_parameters (field_name, m_probability, u_probability, description) VALUES
    ('email_exact', 0.98, 0.001, 'Exact email match'),
    ('phone_exact', 0.95, 0.005, 'Exact phone match'),
    ('name_exact', 0.80, 0.02, 'Exact name match'),
    ('name_fuzzy', 0.60, 0.10, 'Fuzzy name match'),
    ('address_exact', 0.70, 0.05, 'Exact address match')
ON CONFLICT (field_name) DO NOTHING;

COMMENT ON TABLE sot.fellegi_sunter_parameters IS 'Fellegi-Sunter probabilistic matching parameters';

-- Fellegi-Sunter thresholds
CREATE TABLE IF NOT EXISTS sot.fellegi_sunter_thresholds (
    threshold_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    threshold_name TEXT NOT NULL UNIQUE,
    match_threshold NUMERIC(8,4) NOT NULL,
    non_match_threshold NUMERIC(8,4) NOT NULL,
    entity_type TEXT DEFAULT 'person',
    is_active BOOLEAN DEFAULT true
);

INSERT INTO sot.fellegi_sunter_thresholds (threshold_name, match_threshold, non_match_threshold, entity_type) VALUES
    ('person_default', 10.0, -5.0, 'person'),
    ('person_strict', 15.0, -3.0, 'person'),
    ('place_default', 8.0, -4.0, 'place')
ON CONFLICT (threshold_name) DO NOTHING;

COMMENT ON TABLE sot.fellegi_sunter_thresholds IS 'Thresholds for Fellegi-Sunter matching';

\echo '   Created sot.households, sot.household_members, sot.fellegi_sunter_*'

-- ============================================================================
-- 5. PROCESSING & AUTOMATION
-- ============================================================================

\echo ''
\echo '5. Creating Processing & Automation tables...'

-- Processing jobs
CREATE TABLE IF NOT EXISTS ops.processing_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    input_data JSONB DEFAULT '{}',
    output_data JSONB DEFAULT '{}',
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES ops.staff(staff_id)
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON ops.processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_type ON ops.processing_jobs(job_type);

COMMENT ON TABLE ops.processing_jobs IS 'Background processing job tracking';

-- Orchestrator run logs
CREATE TABLE IF NOT EXISTS ops.orchestrator_run_logs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    orchestrator_name TEXT NOT NULL,
    run_type TEXT DEFAULT 'scheduled',
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    steps_completed JSONB DEFAULT '[]',
    error_details JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_orchestrator_logs_name ON ops.orchestrator_run_logs(orchestrator_name);
CREATE INDEX IF NOT EXISTS idx_orchestrator_logs_started ON ops.orchestrator_run_logs(started_at DESC);

COMMENT ON TABLE ops.orchestrator_run_logs IS 'Pipeline orchestrator run history';

-- Extraction queue (AI extraction)
CREATE TABLE IF NOT EXISTS ops.extraction_queue (
    queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    source_text TEXT,
    extraction_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
    result JSONB,
    error_message TEXT,
    priority INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_extraction_queue_status ON ops.extraction_queue(status);
CREATE INDEX IF NOT EXISTS idx_extraction_queue_priority ON ops.extraction_queue(priority DESC, created_at);

COMMENT ON TABLE ops.extraction_queue IS 'Queue for AI text extraction jobs';

-- Automation rules
CREATE TABLE IF NOT EXISTS ops.automation_rules (
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('email', 'notification', 'assignment', 'escalation')),
    trigger_event TEXT NOT NULL,
    conditions JSONB DEFAULT '{}',
    actions JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    priority INT DEFAULT 0,
    created_by UUID REFERENCES ops.staff(staff_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_type ON ops.automation_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON ops.automation_rules(trigger_event);

COMMENT ON TABLE ops.automation_rules IS 'Configurable automation rules for workflows';

\echo '   Created ops.processing_jobs, ops.orchestrator_run_logs, ops.extraction_queue, ops.automation_rules'

-- ============================================================================
-- 6. MISC OPERATIONAL TABLES
-- ============================================================================

\echo ''
\echo '6. Creating miscellaneous operational tables...'

-- Test mode state
CREATE TABLE IF NOT EXISTS ops.test_mode_state (
    state_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_enabled BOOLEAN DEFAULT false,
    enabled_by UUID REFERENCES ops.staff(staff_id),
    enabled_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    test_data_prefix TEXT DEFAULT 'TEST_',
    notes TEXT
);

-- Insert default state
INSERT INTO ops.test_mode_state (is_enabled) VALUES (false)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE ops.test_mode_state IS 'Test mode configuration';

-- Source confidence scores
CREATE TABLE IF NOT EXISTS ops.source_confidence (
    source_system TEXT PRIMARY KEY,
    confidence_score NUMERIC(3,2) NOT NULL DEFAULT 0.80,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ops.source_confidence (source_system, confidence_score, description) VALUES
    ('clinichq', 0.95, 'ClinicHQ verified clinic data'),
    ('shelterluv', 0.90, 'ShelterLuv shelter management'),
    ('airtable', 0.75, 'Airtable legacy data'),
    ('web_intake', 0.70, 'Public web intake form'),
    ('petlink', 0.60, 'PetLink microchip registry'),
    ('atlas_ui', 0.85, 'Staff-entered via Atlas')
ON CONFLICT (source_system) DO NOTHING;

COMMENT ON TABLE ops.source_confidence IS 'Confidence scores by data source';

-- Data freshness tracking
CREATE TABLE IF NOT EXISTS ops.data_freshness_tracking (
    tracking_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_system TEXT NOT NULL,
    last_sync_at TIMESTAMPTZ,
    records_synced INT DEFAULT 0,
    sync_status TEXT DEFAULT 'unknown',
    error_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_data_freshness_source ON ops.data_freshness_tracking(source_system);

COMMENT ON TABLE ops.data_freshness_tracking IS 'Tracks data freshness by source';

-- Request resolution reasons
CREATE TABLE IF NOT EXISTS ops.request_resolution_reasons (
    reason_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reason_key TEXT NOT NULL UNIQUE,
    reason_label TEXT NOT NULL,
    applies_to_status TEXT[] DEFAULT '{completed,cancelled}',
    requires_notes BOOLEAN DEFAULT false,
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true
);

INSERT INTO ops.request_resolution_reasons (reason_key, reason_label, applies_to_status) VALUES
    ('all_cats_fixed', 'All cats fixed', '{completed}'),
    ('colony_relocated', 'Colony relocated', '{completed}'),
    ('no_cats_found', 'No cats found', '{completed}'),
    ('requester_unresponsive', 'Requester unresponsive', '{cancelled}'),
    ('duplicate_request', 'Duplicate request', '{cancelled}'),
    ('outside_service_area', 'Outside service area', '{cancelled}')
ON CONFLICT (reason_key) DO NOTHING;

COMMENT ON TABLE ops.request_resolution_reasons IS 'Reasons for request resolution';

-- Education materials (trapper training)
CREATE TABLE IF NOT EXISTS ops.education_materials (
    material_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    material_type TEXT CHECK (material_type IN ('video', 'document', 'quiz', 'checklist')),
    content_url TEXT,
    content_data JSONB,
    category TEXT DEFAULT 'general',
    required_for_certification BOOLEAN DEFAULT false,
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.education_materials IS 'Trapper training and education materials';

\echo '   Created ops.test_mode_state, ops.source_confidence, ops.data_freshness_tracking, etc.'

-- ============================================================================
-- 7. DEDUPLICATION TABLES
-- ============================================================================

\echo ''
\echo '7. Creating Deduplication tables...'

-- Place dedup candidates
CREATE TABLE IF NOT EXISTS sot.place_dedup_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id_1 UUID REFERENCES sot.places(place_id),
    place_id_2 UUID REFERENCES sot.places(place_id),
    similarity_score NUMERIC(5,4),
    match_reasons JSONB DEFAULT '[]',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'merged')),
    reviewed_by UUID REFERENCES ops.staff(staff_id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (place_id_1, place_id_2)
);

CREATE INDEX IF NOT EXISTS idx_place_dedup_status ON sot.place_dedup_candidates(status);

COMMENT ON TABLE sot.place_dedup_candidates IS 'Potential place duplicate pairs';

-- Cat duplicate candidates
CREATE TABLE IF NOT EXISTS sot.cat_dedup_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id_1 UUID REFERENCES sot.cats(cat_id),
    cat_id_2 UUID REFERENCES sot.cats(cat_id),
    similarity_score NUMERIC(5,4),
    match_reasons JSONB DEFAULT '[]',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'merged')),
    reviewed_by UUID REFERENCES ops.staff(staff_id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cat_id_1, cat_id_2)
);

CREATE INDEX IF NOT EXISTS idx_cat_dedup_status ON sot.cat_dedup_candidates(status);

COMMENT ON TABLE sot.cat_dedup_candidates IS 'Potential cat duplicate pairs';

-- Person duplicate candidates (use existing view or create table)
CREATE TABLE IF NOT EXISTS sot.person_dedup_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id_1 UUID REFERENCES sot.people(person_id),
    person_id_2 UUID REFERENCES sot.people(person_id),
    similarity_score NUMERIC(5,4),
    match_reasons JSONB DEFAULT '[]',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'merged')),
    reviewed_by UUID REFERENCES ops.staff(staff_id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (person_id_1, person_id_2)
);

CREATE INDEX IF NOT EXISTS idx_person_dedup_status ON sot.person_dedup_candidates(status);

COMMENT ON TABLE sot.person_dedup_candidates IS 'Potential person duplicate pairs';

\echo '   Created sot.*_dedup_candidates tables'

-- ============================================================================
-- 8. PLACE/CAT RELATIONSHIP TABLES
-- ============================================================================

\echo ''
\echo '8. Creating Place/Cat relationship tables...'

-- Place-place edges (graph relationships)
CREATE TABLE IF NOT EXISTS sot.place_place_edges (
    edge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id_from UUID REFERENCES sot.places(place_id) ON DELETE CASCADE,
    place_id_to UUID REFERENCES sot.places(place_id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    evidence_type TEXT DEFAULT 'inferred',
    confidence NUMERIC(3,2) DEFAULT 0.8,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (place_id_from, place_id_to, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_place_edges_from ON sot.place_place_edges(place_id_from);
CREATE INDEX IF NOT EXISTS idx_place_edges_to ON sot.place_place_edges(place_id_to);

COMMENT ON TABLE sot.place_place_edges IS 'Graph edges between places (parent/child, nearby, etc.)';

-- Relationship types taxonomy
CREATE TABLE IF NOT EXISTS sot.relationship_types (
    type_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_key TEXT NOT NULL UNIQUE,
    type_label TEXT NOT NULL,
    applies_to TEXT NOT NULL CHECK (applies_to IN ('person_person', 'person_place', 'person_cat', 'cat_place', 'place_place')),
    is_symmetric BOOLEAN DEFAULT false,
    inverse_type_key TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT true
);

INSERT INTO sot.relationship_types (type_key, type_label, applies_to, is_symmetric) VALUES
    ('parent_child', 'Parent/Child', 'place_place', false),
    ('adjacent', 'Adjacent', 'place_place', true),
    ('same_property', 'Same Property', 'place_place', true),
    ('owner', 'Owner', 'person_cat', false),
    ('caretaker', 'Caretaker', 'person_cat', false),
    ('resident', 'Resident', 'person_place', false),
    ('colony_member', 'Colony Member', 'cat_place', false)
ON CONFLICT (type_key) DO NOTHING;

COMMENT ON TABLE sot.relationship_types IS 'Taxonomy of relationship types';

-- Cat movement events
CREATE TABLE IF NOT EXISTS sot.cat_movement_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID REFERENCES sot.cats(cat_id) ON DELETE CASCADE,
    from_place_id UUID REFERENCES sot.places(place_id),
    to_place_id UUID REFERENCES sot.places(place_id),
    movement_type TEXT CHECK (movement_type IN ('relocation', 'adoption', 'foster', 'return', 'escape', 'unknown')),
    movement_date DATE,
    notes TEXT,
    source_system TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_movements_cat ON sot.cat_movement_events(cat_id);
CREATE INDEX IF NOT EXISTS idx_cat_movements_date ON sot.cat_movement_events(movement_date);

COMMENT ON TABLE sot.cat_movement_events IS 'Cat location movement history';

-- Cat reunifications
CREATE TABLE IF NOT EXISTS sot.cat_reunifications (
    reunification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID REFERENCES sot.cats(cat_id) ON DELETE CASCADE,
    person_id UUID REFERENCES sot.people(person_id),
    reunification_type TEXT CHECK (reunification_type IN ('owner_claim', 'shelter_transfer', 'foster_return', 'other')),
    reunification_date DATE NOT NULL,
    location TEXT,
    notes TEXT,
    verified_by UUID REFERENCES ops.staff(staff_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_reunifications_cat ON sot.cat_reunifications(cat_id);

COMMENT ON TABLE sot.cat_reunifications IS 'Cat reunification with owners/caretakers';

\echo '   Created sot.place_place_edges, sot.relationship_types, sot.cat_movement_events, sot.cat_reunifications'

-- ============================================================================
-- 9. ADDITIONAL VIEWS/TABLES
-- ============================================================================

\echo ''
\echo '9. Creating additional tables...'

-- Known organizations (for name matching)
CREATE TABLE IF NOT EXISTS sot.known_organizations (
    org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_name TEXT NOT NULL,
    org_type TEXT,
    aliases TEXT[] DEFAULT '{}',
    is_soft_blacklisted BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_known_orgs_name ON sot.known_organizations(org_name);

INSERT INTO sot.known_organizations (org_name, org_type, is_soft_blacklisted) VALUES
    ('Marin Ferals', 'rescue', true),
    ('SCAS', 'shelter', false),
    ('Petaluma Animal Services', 'municipal', false)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sot.known_organizations IS 'Known organizations for name classification';

-- Sonoma ZIP demographics (for Beacon)
CREATE TABLE IF NOT EXISTS ops.sonoma_zip_demographics (
    zip_code TEXT PRIMARY KEY,
    city TEXT,
    population INT,
    housing_units INT,
    median_income NUMERIC(10,2),
    land_area_sq_miles NUMERIC(8,2),
    density_per_sq_mile NUMERIC(8,2),
    rural_classification TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert Sonoma County ZIPs
INSERT INTO ops.sonoma_zip_demographics (zip_code, city, rural_classification) VALUES
    ('95401', 'Santa Rosa', 'urban'),
    ('95403', 'Santa Rosa', 'urban'),
    ('95404', 'Santa Rosa', 'suburban'),
    ('95405', 'Santa Rosa', 'suburban'),
    ('95407', 'Santa Rosa', 'urban'),
    ('95409', 'Santa Rosa', 'suburban'),
    ('94928', 'Rohnert Park', 'urban'),
    ('94952', 'Petaluma', 'urban'),
    ('94954', 'Petaluma', 'suburban'),
    ('95472', 'Sebastopol', 'suburban'),
    ('95476', 'Sonoma', 'suburban'),
    ('95448', 'Healdsburg', 'rural')
ON CONFLICT (zip_code) DO NOTHING;

COMMENT ON TABLE ops.sonoma_zip_demographics IS 'Sonoma County ZIP code demographics for Beacon';

\echo '   Created sot.known_organizations, ops.sonoma_zip_demographics'

-- ============================================================================
-- 10. TRAPPER COMPATIBILITY VIEWS
-- ============================================================================

\echo ''
\echo '10. Creating trapper compatibility views...'

-- Create views for all new tables
CREATE OR REPLACE VIEW trapper.clinic_days AS SELECT * FROM ops.clinic_days;
CREATE OR REPLACE VIEW trapper.clinic_day_entries AS SELECT * FROM ops.clinic_day_entries;
CREATE OR REPLACE VIEW trapper.intake_questions AS SELECT * FROM ops.intake_questions;
CREATE OR REPLACE VIEW trapper.intake_question_options AS SELECT * FROM ops.intake_question_options;
CREATE OR REPLACE VIEW trapper.intake_custom_fields AS SELECT * FROM ops.intake_custom_fields;
CREATE OR REPLACE VIEW trapper.ecology_config AS SELECT * FROM ops.ecology_config;
CREATE OR REPLACE VIEW trapper.ecology_config_audit AS SELECT * FROM ops.ecology_config_audit;
CREATE OR REPLACE VIEW trapper.count_precision_factors AS SELECT * FROM ops.count_precision_factors;
CREATE OR REPLACE VIEW trapper.households AS SELECT * FROM sot.households;
CREATE OR REPLACE VIEW trapper.household_members AS SELECT * FROM sot.household_members;
CREATE OR REPLACE VIEW trapper.fellegi_sunter_parameters AS SELECT * FROM sot.fellegi_sunter_parameters;
CREATE OR REPLACE VIEW trapper.fellegi_sunter_thresholds AS SELECT * FROM sot.fellegi_sunter_thresholds;
CREATE OR REPLACE VIEW trapper.processing_jobs AS SELECT * FROM ops.processing_jobs;
CREATE OR REPLACE VIEW trapper.orchestrator_run_logs AS SELECT * FROM ops.orchestrator_run_logs;
CREATE OR REPLACE VIEW trapper.extraction_queue AS SELECT * FROM ops.extraction_queue;
CREATE OR REPLACE VIEW trapper.automation_rules AS SELECT * FROM ops.automation_rules;
CREATE OR REPLACE VIEW trapper.test_mode_state AS SELECT * FROM ops.test_mode_state;
CREATE OR REPLACE VIEW trapper.source_confidence AS SELECT * FROM ops.source_confidence;
CREATE OR REPLACE VIEW trapper.data_freshness_tracking AS SELECT * FROM ops.data_freshness_tracking;
CREATE OR REPLACE VIEW trapper.request_resolution_reasons AS SELECT * FROM ops.request_resolution_reasons;
CREATE OR REPLACE VIEW trapper.education_materials AS SELECT * FROM ops.education_materials;
CREATE OR REPLACE VIEW trapper.place_dedup_candidates AS SELECT * FROM sot.place_dedup_candidates;
CREATE OR REPLACE VIEW trapper.cat_duplicate_candidates AS SELECT * FROM sot.cat_dedup_candidates;
CREATE OR REPLACE VIEW trapper.potential_person_duplicates AS SELECT * FROM sot.person_dedup_candidates;
CREATE OR REPLACE VIEW trapper.place_place_edges AS SELECT * FROM sot.place_place_edges;
CREATE OR REPLACE VIEW trapper.relationship_types AS SELECT * FROM sot.relationship_types;
CREATE OR REPLACE VIEW trapper.cat_movement_events AS SELECT * FROM sot.cat_movement_events;
CREATE OR REPLACE VIEW trapper.cat_reunifications AS SELECT * FROM sot.cat_reunifications;
CREATE OR REPLACE VIEW trapper.known_organizations AS SELECT * FROM sot.known_organizations;
CREATE OR REPLACE VIEW trapper.sonoma_zip_demographics AS SELECT * FROM ops.sonoma_zip_demographics;

\echo '   Created all trapper.* compatibility views'

-- ============================================================================
-- 11. VERIFICATION
-- ============================================================================

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

DO $$
DECLARE
    v_ops_count INT;
    v_sot_count INT;
    v_trapper_count INT;
BEGIN
    SELECT COUNT(*) INTO v_ops_count
    FROM information_schema.tables
    WHERE table_schema = 'ops' AND table_type = 'BASE TABLE';

    SELECT COUNT(*) INTO v_sot_count
    FROM information_schema.tables
    WHERE table_schema = 'sot' AND table_type = 'BASE TABLE';

    SELECT COUNT(*) INTO v_trapper_count
    FROM information_schema.tables
    WHERE table_schema = 'trapper' AND table_type = 'VIEW';

    RAISE NOTICE 'Table counts:';
    RAISE NOTICE '  ops.* base tables: %', v_ops_count;
    RAISE NOTICE '  sot.* base tables: %', v_sot_count;
    RAISE NOTICE '  trapper.* views: %', v_trapper_count;
END $$;

\echo ''
\echo '=============================================='
\echo '  MIG_2206 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created tables in ops.*:'
\echo '  - clinic_days, clinic_day_entries'
\echo '  - intake_questions, intake_question_options, intake_custom_fields'
\echo '  - ecology_config, ecology_config_audit, count_precision_factors'
\echo '  - processing_jobs, orchestrator_run_logs, extraction_queue'
\echo '  - automation_rules, test_mode_state, source_confidence'
\echo '  - data_freshness_tracking, request_resolution_reasons'
\echo '  - education_materials, sonoma_zip_demographics'
\echo ''
\echo 'Created tables in sot.*:'
\echo '  - households, household_members'
\echo '  - fellegi_sunter_parameters, fellegi_sunter_thresholds'
\echo '  - place_dedup_candidates, cat_dedup_candidates, person_dedup_candidates'
\echo '  - place_place_edges, relationship_types'
\echo '  - cat_movement_events, cat_reunifications'
\echo '  - known_organizations'
\echo ''
\echo 'All trapper.* compatibility views created.'
\echo ''
