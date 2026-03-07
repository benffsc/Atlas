-- MIG_2832: Airtable Full Data Salvage — Schema
-- Creates tables and columns needed for importing remaining Airtable data
-- Covers FFS-186 through FFS-205

BEGIN;

-- ============================================================
-- FFS-188: Trapper Cases
-- Tracks case-level trapping engagements (request + trapper combo)
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.trapper_cases (
    case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES ops.requests(request_id),
    trapper_person_id UUID REFERENCES sot.people(person_id),
    case_status TEXT,
    started_at DATE,
    completed_at DATE,
    total_cats_trapped INT DEFAULT 0,
    total_cats_returned INT DEFAULT 0,
    notes TEXT,
    airtable_fields JSONB,
    source_system TEXT DEFAULT 'airtable',
    source_record_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_system, source_record_id)
);

-- ============================================================
-- FFS-190: Trapper Case Cats
-- Individual cats tracked within a trapper case
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.trapper_case_cats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES ops.trapper_cases(case_id),
    cat_id UUID REFERENCES sot.cats(cat_id),
    cat_name TEXT,
    outcome TEXT,
    trap_date DATE,
    notes TEXT,
    airtable_fields JSONB,
    source_system TEXT DEFAULT 'airtable',
    source_record_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_system, source_record_id)
);

-- ============================================================
-- FFS-197: Call Logs
-- Phone/contact logs associated with requests
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.call_logs (
    call_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES ops.requests(request_id),
    caller_person_id UUID REFERENCES sot.people(person_id),
    staff_person_id UUID REFERENCES sot.people(person_id),
    call_date DATE,
    call_type TEXT,
    notes TEXT,
    outcome TEXT,
    airtable_fields JSONB,
    source_system TEXT DEFAULT 'airtable',
    source_record_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_system, source_record_id)
);

-- ============================================================
-- FFS-196 + FFS-202: Org Events (Calendar + Events merged)
-- Organizational events, fundraisers, trapping events, etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.org_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    event_type TEXT,
    event_date DATE,
    end_date DATE,
    location TEXT,
    description TEXT,
    is_cancelled BOOLEAN DEFAULT FALSE,
    airtable_fields JSONB,
    source_system TEXT DEFAULT 'airtable',
    source_record_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_system, source_record_id)
);

-- ============================================================
-- FFS-198: Kitten Assessments
-- Kitten intake assessments for socialization/foster decisions
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.kitten_assessments (
    assessment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cat_id UUID REFERENCES sot.cats(cat_id),
    assessment_date DATE,
    kitten_age_weeks INT,
    socialization_level TEXT,
    health_notes TEXT,
    outcome TEXT,
    assessor_name TEXT,
    airtable_fields JSONB,
    source_system TEXT DEFAULT 'airtable',
    source_record_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_system, source_record_id)
);

-- ============================================================
-- FFS-203: Surrender Forms
-- Cat surrender intake forms
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.surrender_forms (
    surrender_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    surrenderer_person_id UUID REFERENCES sot.people(person_id),
    cat_id UUID REFERENCES sot.cats(cat_id),
    surrender_date DATE,
    reason TEXT,
    cat_name TEXT,
    cat_description TEXT,
    airtable_fields JSONB,
    source_system TEXT DEFAULT 'airtable',
    source_record_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_system, source_record_id)
);

-- ============================================================
-- FFS-205: Equipment Inventory + Checkouts
-- Trap inventory and checkout tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.equipment (
    equipment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_type TEXT NOT NULL,
    equipment_name TEXT,
    serial_number TEXT,
    condition TEXT,
    notes TEXT,
    is_available BOOLEAN DEFAULT TRUE,
    source_system TEXT DEFAULT 'airtable',
    source_record_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_system, source_record_id)
);

CREATE TABLE IF NOT EXISTS ops.equipment_checkouts (
    checkout_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id UUID REFERENCES ops.equipment(equipment_id),
    person_id UUID REFERENCES sot.people(person_id),
    checked_out_at TIMESTAMPTZ,
    returned_at TIMESTAMPTZ,
    notes TEXT,
    source_system TEXT DEFAULT 'airtable',
    source_record_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Column Additions to Existing Tables
-- ============================================================

-- FFS-193: Do Not Contact flags on people
ALTER TABLE sot.people ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN DEFAULT FALSE;
ALTER TABLE sot.people ADD COLUMN IF NOT EXISTS do_not_contact_reason TEXT;

-- FFS-201: Aliases for people (alternate names)
ALTER TABLE sot.people ADD COLUMN IF NOT EXISTS aliases TEXT[];

-- FFS-200: Cat enrichment fields for Master Cats import
ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sot.cats ADD COLUMN IF NOT EXISTS color_pattern TEXT;

-- ============================================================
-- Indexes for efficient querying
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_trapper_cases_request ON ops.trapper_cases(request_id);
CREATE INDEX IF NOT EXISTS idx_trapper_cases_trapper ON ops.trapper_cases(trapper_person_id);
CREATE INDEX IF NOT EXISTS idx_trapper_case_cats_case ON ops.trapper_case_cats(case_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_request ON ops.call_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_org_events_date ON ops.org_events(event_date);
CREATE INDEX IF NOT EXISTS idx_kitten_assessments_cat ON ops.kitten_assessments(cat_id);
CREATE INDEX IF NOT EXISTS idx_surrender_forms_cat ON ops.surrender_forms(cat_id);
CREATE INDEX IF NOT EXISTS idx_equipment_checkouts_equipment ON ops.equipment_checkouts(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equipment_checkouts_person ON ops.equipment_checkouts(person_id);
CREATE INDEX IF NOT EXISTS idx_people_do_not_contact ON sot.people(do_not_contact) WHERE do_not_contact = TRUE;

COMMIT;
