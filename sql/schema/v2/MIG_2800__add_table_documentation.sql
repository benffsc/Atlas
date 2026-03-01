-- MIG_2800: Add Documentation to Undocumented Tables
-- Date: 2026-03-01
-- Purpose: Add COMMENT ON TABLE statements to 32 previously undocumented tables
-- Coverage: ops (19), sot (8), source (4), beacon (1)
--
-- This migration brings table documentation from 78% to 100% coverage.
-- All comments follow the pattern: Brief description of table purpose and contents.

-- =============================================================================
-- OPS SCHEMA (19 tables)
-- =============================================================================

-- Core audit and workflow tables
COMMENT ON TABLE ops.entity_edits IS 'Audit trail of manual entity changes made via Atlas UI. Tracks field-level changes with before/after values, change reason, and user attribution.';

COMMENT ON TABLE ops.review_queue IS 'Data quality issues pending human review. Supports multiple review types: owner_change, owner_transfer, owner_household, identity_merge. Status: pending, approved, rejected.';

COMMENT ON TABLE ops.staged_records IS 'Temporary staging area for external data before processing. Records are validated and transformed before insertion into SOT tables.';

COMMENT ON TABLE ops.ingest_runs IS 'Data ingestion pipeline execution tracking. Records source system, start/end times, record counts, error details, and processing status for each ingest run.';

-- Medical records tables
COMMENT ON TABLE ops.cat_conditions IS 'Medical conditions diagnosed for cats. Links to cats table with condition type, severity, diagnosis date, and resolution status.';

COMMENT ON TABLE ops.cat_medications IS 'Medications prescribed or administered to cats. Tracks medication name, dosage, frequency, start/end dates, and prescribing context.';

COMMENT ON TABLE ops.cat_procedures IS 'Medical procedures performed on cats. Records procedure type, date, outcome, veterinarian, and associated appointment.';

COMMENT ON TABLE ops.cat_vitals IS 'Vital sign measurements for cats. Captures weight, temperature, heart rate, respiratory rate, and measurement timestamp.';

-- Archive tables (historical cleanup)
COMMENT ON TABLE ops.archived_clinic_cat_place IS 'Archive of cat-place relationships removed during clinic address pollution cleanup. Preserved for audit trail and potential restoration.';

COMMENT ON TABLE ops.archived_invalid_cat_place IS 'Archive of invalid cat-place relationships identified and removed during data quality remediation.';

COMMENT ON TABLE ops.archived_org_misclassifications IS 'Archive of organization records that were incorrectly classified as people. Contains original data for reference during deduplication.';

COMMENT ON TABLE ops.archived_people IS 'Archive of person records removed during deduplication or data quality cleanup. Preserves original data for audit purposes.';

COMMENT ON TABLE ops.archived_person_place IS 'Archive of person-place relationships removed during cleanup. Maintains historical record of address associations.';

-- Processing and extraction tables
COMMENT ON TABLE ops.attribute_extraction_jobs IS 'Tracks AI-powered attribute extraction jobs. Records job type, target entity, extraction results, confidence scores, and verification status.';

COMMENT ON TABLE ops.communication_logs IS 'Log of communications sent to people (email, SMS). Tracks recipient, template used, send status, and delivery confirmation.';

COMMENT ON TABLE ops.data_quality_snapshots IS 'Point-in-time snapshots of data quality metrics. Used for tracking improvement trends and regression detection.';

COMMENT ON TABLE ops.extraction_status IS 'Status tracking for data extraction processes. Records extraction type, last run time, records processed, and error counts.';

-- Reference and mapping tables
COMMENT ON TABLE ops.org_types IS 'Reference table of organization types (shelter, rescue, veterinary clinic, etc.). Used for organization classification.';

-- Note: person_roles exists in sot schema only (documented below)

COMMENT ON TABLE ops.request_status_mapping IS 'Maps external system status values to Atlas request statuses. Used during data import to normalize status terminology.';

COMMENT ON TABLE ops.test_type_disease_mapping IS 'Maps medical test types to disease categories. Used for disease status computation from test results.';

COMMENT ON TABLE ops.tippy_view_catalog IS 'Catalog of database views available to Tippy (AI assistant). Documents view purpose, columns, and usage patterns for natural language queries.';

-- =============================================================================
-- SOT SCHEMA (8 tables)
-- =============================================================================

-- Ecological and event tracking
COMMENT ON TABLE sot.cat_intake_events IS 'Cat intake events from ShelterLuv and other sources. Records intake type (stray, surrender, transfer), date, location, and initial condition.';

COMMENT ON TABLE sot.cat_mortality_events IS 'Deceased cat records with cause tracking. Records death date, cause category (natural, euthanasia, accident, unknown), and location. Used for Beacon mortality analysis.';

COMMENT ON TABLE sot.place_colony_estimates IS 'Colony size estimates by place over time. Stores estimate value, estimation method (observation, Chapman, AI), confidence level, and observation date. Core data for Beacon visualization.';

-- Place tagging system
COMMENT ON TABLE sot.place_context_types IS 'Reference table defining available place context types (feeding_site, colony_location, shelter_site, etc.). Controls valid context assignments.';

COMMENT ON TABLE sot.place_contexts IS 'Context tags assigned to places. Links places to context types with assignment date, source, and optional notes. Used for filtering and categorization.';

-- Identity and role management
COMMENT ON TABLE sot.person_roles IS 'Canonical person role assignments in SOT schema. Mirrors ops.person_roles for entity-linking purposes.';

COMMENT ON TABLE sot.role_reconciliation_log IS 'Log of role reconciliation operations between source systems. Tracks merge decisions, conflicts resolved, and data lineage.';

COMMENT ON TABLE sot.trusted_person_sources IS 'Defines which source systems are authoritative for specific person data types. Used by Data Engine for conflict resolution and survivorship.';

-- =============================================================================
-- SOURCE SCHEMA (4 tables)
-- =============================================================================

COMMENT ON TABLE source.shelterluv_unmatched_fosters IS 'Foster records from ShelterLuv that could not be matched to existing people. Pending manual review or identity resolution.';

COMMENT ON TABLE source.volunteerhub_group_memberships IS 'VolunteerHub group membership records. Links volunteers to groups (Approved Trappers, Clinic Volunteers, etc.) with join date and status.';

COMMENT ON TABLE source.volunteerhub_user_groups IS 'VolunteerHub user group definitions. Stores group ID, name, parent group, and sync metadata. Hierarchy: Approved Volunteer > Approved Trappers, etc.';

COMMENT ON TABLE source.volunteerhub_volunteers IS 'Raw volunteer records from VolunteerHub sync. Contains name, email, phone, status, and custom field data before identity resolution.';

-- =============================================================================
-- BEACON SCHEMA (1 table)
-- =============================================================================

COMMENT ON TABLE beacon.place_chapman_estimates IS 'Chapman mark-recapture population estimates by place. Stores estimate calculation inputs (M, C, R), resulting N estimate, confidence interval, and calculation date. Formula: N = ((M+1)(C+1)/(R+1)) - 1';

-- =============================================================================
-- Verification query (run after applying):
-- SELECT schemaname, tablename, obj_description((schemaname || '.' || tablename)::regclass) as comment
-- FROM pg_tables
-- WHERE schemaname IN ('ops', 'sot', 'source', 'beacon')
-- AND obj_description((schemaname || '.' || tablename)::regclass) IS NULL;
-- Expected result: 0 rows (all tables documented)
-- =============================================================================
