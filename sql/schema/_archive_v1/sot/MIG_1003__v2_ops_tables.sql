-- MIG_1003: V2 Architecture - OPS (Operational) Tables
-- Phase 1, Part 4: Operational workflow tables
--
-- Creates the Layer 2 OPS tables for:
-- 1. Requests (TNR service requests)
-- 2. Intake submissions (web form submissions)
-- 3. Appointments (clinic procedures)
-- 4. Volunteers (volunteer/staff records)
-- 5. Request assignments (trapper assignments)
-- 6. Journal entries (leave journals)
-- 7. Google Map entries (historical notes)
--
-- DATE PRESERVATION: Same strategy as SOT tables

-- ============================================================================
-- REQUESTS - TNR service requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Status
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
        'new', 'triaged', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'
    )),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    hold_reason TEXT,
    resolution TEXT,

    -- Content
    summary TEXT,
    notes TEXT,
    internal_notes TEXT,

    -- Cat info
    estimated_cat_count INTEGER,
    total_cats_reported INTEGER,
    cat_count_semantic TEXT DEFAULT 'needs_tnr' CHECK (cat_count_semantic IN ('needs_tnr', 'legacy_total')),

    -- Linked entities (references to sot.*)
    place_id UUID REFERENCES sot.places(place_id),
    requester_person_id UUID REFERENCES sot.people(person_id),

    -- Assignment tracking
    assignment_status TEXT DEFAULT 'pending' CHECK (assignment_status IN (
        'pending', 'assigned', 'accepted', 'declined', 'no_trapper_needed'
    )),
    no_trapper_reason TEXT,

    -- Timestamps
    resolved_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,

    -- Provenance
    source_system TEXT,
    source_record_id TEXT,

    -- Date preservation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_created_at TIMESTAMPTZ,
    migrated_at TIMESTAMPTZ,
    original_created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_requests_status ON ops.requests(status);
CREATE INDEX IF NOT EXISTS idx_ops_requests_place ON ops.requests(place_id);
CREATE INDEX IF NOT EXISTS idx_ops_requests_requester ON ops.requests(requester_person_id);
CREATE INDEX IF NOT EXISTS idx_ops_requests_source ON ops.requests(source_system, source_record_id);
CREATE INDEX IF NOT EXISTS idx_ops_requests_active ON ops.requests(status, created_at)
    WHERE status IN ('new', 'triaged', 'scheduled', 'in_progress');

COMMENT ON TABLE ops.requests IS 'Layer 2 OPS: TNR service requests';

-- ============================================================================
-- REQUEST TRAPPER ASSIGNMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.request_trapper_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES ops.requests(request_id) ON DELETE CASCADE,
    trapper_person_id UUID NOT NULL REFERENCES sot.people(person_id),

    -- Assignment details
    assignment_type TEXT DEFAULT 'primary' CHECK (assignment_type IN ('primary', 'backup', 'helper')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'completed')),
    assigned_by TEXT,

    -- Timestamps
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Notes
    notes TEXT,

    -- Provenance
    source_system TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,

    UNIQUE (request_id, trapper_person_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_rta_request ON ops.request_trapper_assignments(request_id);
CREATE INDEX IF NOT EXISTS idx_ops_rta_trapper ON ops.request_trapper_assignments(trapper_person_id);

COMMENT ON TABLE ops.request_trapper_assignments IS 'Layer 2 OPS: Trapper assignments to requests';

-- ============================================================================
-- REQUEST CATS - Cats linked to requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.request_cats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES ops.requests(request_id) ON DELETE CASCADE,
    cat_id UUID NOT NULL REFERENCES sot.cats(cat_id),

    -- Link details
    link_type TEXT DEFAULT 'attributed' CHECK (link_type IN (
        'attributed', 'reported', 'treated', 'trapped'
    )),
    evidence_type TEXT DEFAULT 'inferred',

    -- Provenance
    source_system TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,

    UNIQUE (request_id, cat_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_request_cats_request ON ops.request_cats(request_id);
CREATE INDEX IF NOT EXISTS idx_ops_request_cats_cat ON ops.request_cats(cat_id);

COMMENT ON TABLE ops.request_cats IS 'Layer 2 OPS: Cats linked to requests via attribution';

-- ============================================================================
-- INTAKE SUBMISSIONS - Web form submissions
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.intake_submissions (
    submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Submission metadata
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,

    -- Contact Information
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    requester_address TEXT,
    requester_city TEXT,
    requester_zip TEXT,

    -- Location of Cats
    cats_address TEXT NOT NULL,
    cats_city TEXT,
    cats_zip TEXT,
    county TEXT,

    -- Questionnaire responses
    ownership_status TEXT CHECK (ownership_status IN (
        'unknown_stray', 'community_colony', 'my_cat', 'neighbors_cat', 'unsure'
    )),
    cat_count_estimate INTEGER,
    cat_count_text TEXT,
    fixed_status TEXT CHECK (fixed_status IN (
        'none_fixed', 'some_fixed', 'most_fixed', 'all_fixed', 'unknown'
    )),
    has_kittens BOOLEAN,
    kitten_count INTEGER,
    kitten_age_estimate TEXT,
    awareness_duration TEXT,
    has_medical_concerns BOOLEAN,
    medical_description TEXT,
    is_emergency BOOLEAN DEFAULT FALSE,
    cats_being_fed BOOLEAN,
    feeder_info TEXT,
    has_property_access BOOLEAN,
    access_notes TEXT,
    is_property_owner BOOLEAN,
    situation_description TEXT,
    referral_source TEXT,
    media_urls TEXT[],

    -- Triage
    triage_category TEXT CHECK (triage_category IN (
        'high_priority_tnr', 'standard_tnr', 'wellness_only',
        'owned_cat_low', 'out_of_county', 'needs_review'
    )),
    triage_score INTEGER,
    triage_reasons JSONB,
    triage_computed_at TIMESTAMPTZ,

    -- Review
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    final_category TEXT,

    -- Linking
    person_id UUID REFERENCES sot.people(person_id),
    place_id UUID REFERENCES sot.places(place_id),
    request_id UUID REFERENCES ops.requests(request_id),

    -- Status
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
        'new', 'triaged', 'reviewed', 'request_created', 'redirected', 'spam', 'closed'
    )),

    -- Date preservation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,
    original_created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_intake_status ON ops.intake_submissions(status);
CREATE INDEX IF NOT EXISTS idx_ops_intake_email ON ops.intake_submissions(email);
CREATE INDEX IF NOT EXISTS idx_ops_intake_submitted ON ops.intake_submissions(submitted_at);
CREATE INDEX IF NOT EXISTS idx_ops_intake_place ON ops.intake_submissions(place_id);

COMMENT ON TABLE ops.intake_submissions IS 'Layer 2 OPS: Web intake form submissions';

-- ============================================================================
-- APPOINTMENTS - Clinic procedures
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.appointments (
    appointment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Linked entities
    cat_id UUID REFERENCES sot.cats(cat_id),
    person_id UUID REFERENCES sot.people(person_id),
    place_id UUID REFERENCES sot.places(place_id),
    inferred_place_id UUID REFERENCES sot.places(place_id),

    -- Appointment details
    appointment_date DATE NOT NULL,
    appointment_number TEXT,

    -- Service info
    service_type TEXT,
    is_spay BOOLEAN DEFAULT FALSE,
    is_neuter BOOLEAN DEFAULT FALSE,
    is_alteration BOOLEAN DEFAULT FALSE,

    -- Staff
    vet_name TEXT,
    technician TEXT,

    -- Medical
    temperature NUMERIC(4,1),
    medical_notes TEXT,
    is_lactating BOOLEAN,
    is_pregnant BOOLEAN,
    is_in_heat BOOLEAN,

    -- Owner info (denormalized from source)
    owner_email TEXT,
    owner_phone TEXT,
    owner_first_name TEXT,
    owner_last_name TEXT,
    owner_address TEXT,

    -- Provenance
    source_system TEXT NOT NULL DEFAULT 'clinichq',
    source_record_id TEXT,
    source_row_hash TEXT,

    -- Date preservation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,
    original_created_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_appointments_cat ON ops.appointments(cat_id);
CREATE INDEX IF NOT EXISTS idx_ops_appointments_person ON ops.appointments(person_id);
CREATE INDEX IF NOT EXISTS idx_ops_appointments_place ON ops.appointments(place_id);
CREATE INDEX IF NOT EXISTS idx_ops_appointments_date ON ops.appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_ops_appointments_source ON ops.appointments(source_system, source_record_id);

COMMENT ON TABLE ops.appointments IS 'Layer 2 OPS: Clinic appointments/procedures from ClinicHQ';

-- ============================================================================
-- JOURNAL ENTRIES - Leave journals for places
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.journal_entries (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Linked entities
    place_id UUID NOT NULL REFERENCES sot.places(place_id),
    author_person_id UUID REFERENCES sot.people(person_id),

    -- Entry content
    entry_type TEXT NOT NULL CHECK (entry_type IN (
        'visit', 'observation', 'feeding', 'trap_attempt', 'note', 'followup'
    )),
    content TEXT NOT NULL,
    visibility TEXT DEFAULT 'internal' CHECK (visibility IN ('internal', 'public', 'staff_only')),

    -- Cat observations
    cats_seen INTEGER,
    cats_fed INTEGER,
    cats_trapped INTEGER,

    -- Media
    media_urls TEXT[],

    -- Provenance
    source_system TEXT DEFAULT 'atlas_ui',

    -- Timestamps
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_journal_place ON ops.journal_entries(place_id);
CREATE INDEX IF NOT EXISTS idx_ops_journal_author ON ops.journal_entries(author_person_id);
CREATE INDEX IF NOT EXISTS idx_ops_journal_date ON ops.journal_entries(entry_date);

COMMENT ON TABLE ops.journal_entries IS 'Layer 2 OPS: Journal/note entries for places';

-- ============================================================================
-- GOOGLE MAP ENTRIES - Historical notes from Google Maps
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.google_map_entries (
    entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Location
    kml_name TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,

    -- Content
    original_content TEXT,
    ai_summary TEXT,
    ai_meaning TEXT,
    parsed_date DATE,

    -- Links
    place_id UUID REFERENCES sot.places(place_id),
    linked_place_id UUID REFERENCES sot.places(place_id),
    nearest_place_id UUID REFERENCES sot.places(place_id),
    nearest_place_distance_m DOUBLE PRECISION,

    -- Provenance
    source_file TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW(),

    -- Date preservation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_gme_place ON ops.google_map_entries(place_id);
CREATE INDEX IF NOT EXISTS idx_ops_gme_linked ON ops.google_map_entries(linked_place_id);
CREATE INDEX IF NOT EXISTS idx_ops_gme_meaning ON ops.google_map_entries(ai_meaning);

COMMENT ON TABLE ops.google_map_entries IS 'Layer 2 OPS: Historical notes from Google Maps KML imports';

-- ============================================================================
-- VOLUNTEERS - Volunteer and staff records
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.volunteers (
    volunteer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to canonical person
    person_id UUID NOT NULL REFERENCES sot.people(person_id),

    -- Volunteer info
    volunteerhub_id TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending', 'suspended')),

    -- Roles
    is_trapper BOOLEAN DEFAULT FALSE,
    is_foster BOOLEAN DEFAULT FALSE,
    is_clinic_volunteer BOOLEAN DEFAULT FALSE,
    is_coordinator BOOLEAN DEFAULT FALSE,
    trapper_type TEXT CHECK (trapper_type IN (
        'ffsc_trapper', 'community_trapper', 'head_trapper', 'coordinator'
    )),
    trapping_skill TEXT CHECK (trapping_skill IN ('beginner', 'intermediate', 'advanced', 'expert')),

    -- Groups (from VolunteerHub)
    groups TEXT[],

    -- Provenance
    source_system TEXT DEFAULT 'volunteerhub',

    -- Timestamps
    joined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,

    UNIQUE (person_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_volunteers_person ON ops.volunteers(person_id);
CREATE INDEX IF NOT EXISTS idx_ops_volunteers_vhub ON ops.volunteers(volunteerhub_id);
CREATE INDEX IF NOT EXISTS idx_ops_volunteers_trapper ON ops.volunteers(is_trapper) WHERE is_trapper = TRUE;

COMMENT ON TABLE ops.volunteers IS 'Layer 2 OPS: Volunteer and staff records';

-- ============================================================================
-- PERSON ROLES - Role assignments for people
-- ============================================================================
CREATE TABLE IF NOT EXISTS ops.person_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES sot.people(person_id) ON DELETE CASCADE,

    role TEXT NOT NULL CHECK (role IN (
        'volunteer', 'trapper', 'ffsc_trapper', 'community_trapper',
        'head_trapper', 'coordinator', 'foster', 'clinic_volunteer', 'staff'
    )),
    role_status TEXT DEFAULT 'active' CHECK (role_status IN ('active', 'inactive', 'pending')),

    -- Provenance
    source_system TEXT,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    migrated_at TIMESTAMPTZ,

    UNIQUE (person_id, role)
);

CREATE INDEX IF NOT EXISTS idx_ops_person_roles_person ON ops.person_roles(person_id);
CREATE INDEX IF NOT EXISTS idx_ops_person_roles_role ON ops.person_roles(role, role_status);

COMMENT ON TABLE ops.person_roles IS 'Layer 2 OPS: Role assignments for people';

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER set_ops_requests_updated_at
    BEFORE UPDATE ON ops.requests
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

CREATE TRIGGER set_ops_appointments_updated_at
    BEFORE UPDATE ON ops.appointments
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

CREATE TRIGGER set_ops_journal_updated_at
    BEFORE UPDATE ON ops.journal_entries
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

CREATE TRIGGER set_ops_volunteers_updated_at
    BEFORE UPDATE ON ops.volunteers
    FOR EACH ROW EXECUTE FUNCTION sot.trigger_set_updated_at();

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- Active requests
CREATE OR REPLACE VIEW ops.v_active_requests AS
SELECT r.*
FROM ops.requests r
WHERE r.status IN ('new', 'triaged', 'scheduled', 'in_progress');

-- Pending intake submissions
CREATE OR REPLACE VIEW ops.v_pending_intakes AS
SELECT i.*
FROM ops.intake_submissions i
WHERE i.status IN ('new', 'triaged');

-- Active trappers
CREATE OR REPLACE VIEW ops.v_active_trappers AS
SELECT v.*, p.display_name, p.primary_email, p.primary_phone
FROM ops.volunteers v
JOIN sot.people p ON p.person_id = v.person_id
WHERE v.is_trapper = TRUE AND v.status = 'active';

COMMENT ON VIEW ops.v_active_requests IS 'Requests in active status';
COMMENT ON VIEW ops.v_pending_intakes IS 'Intake submissions awaiting processing';
COMMENT ON VIEW ops.v_active_trappers IS 'Active trappers with contact info';

-- ============================================================================
-- VERIFY
-- ============================================================================
DO $$
DECLARE
    v_tables TEXT[] := ARRAY[
        'ops.requests', 'ops.request_trapper_assignments', 'ops.request_cats',
        'ops.intake_submissions', 'ops.appointments', 'ops.journal_entries',
        'ops.google_map_entries', 'ops.volunteers', 'ops.person_roles'
    ];
    v_table TEXT;
    v_missing TEXT[];
BEGIN
    FOREACH v_table IN ARRAY v_tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema || '.' || table_name = v_table
        ) THEN
            v_missing := array_append(v_missing, v_table);
        END IF;
    END LOOP;

    IF array_length(v_missing, 1) > 0 THEN
        RAISE EXCEPTION 'Failed to create OPS tables: %', array_to_string(v_missing, ', ');
    END IF;

    RAISE NOTICE 'V2 OPS tables created successfully';
    RAISE NOTICE 'Tables: %', array_to_string(v_tables, ', ');
END $$;
