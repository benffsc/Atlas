-- MIG_183: Raw Intake Layer for Native Data Collection
--
-- PURPOSE: Implements the Raw → Normalize → SoT pipeline for native data collection
--
-- KEY INVARIANTS (from Concept Pack):
-- 1. No UI route writes directly to SoT tables
-- 2. All data goes: UI Form → Raw tables (append-only) → Validation → SoT (upsert)
-- 3. Stable keys + idempotency
-- 4. Valid microchips always preserved
-- 5. Garbage names don't become People
-- 6. Merges are safe (soft-merge with audit trail)
-- 7. Every SoT upsert generates an audit event
--
-- ARCHITECTURE:
-- UI Form → raw_intake_* (append-only) → normalize_pending_intake() → sot_* tables
--                                      ↘ review_queue (if ambiguous)

BEGIN;

-- ============================================================================
-- 1. INTAKE STATUS ENUM
-- ============================================================================
-- Tracks the promotion lifecycle of raw intake records

DO $$ BEGIN
    CREATE TYPE trapper.intake_status AS ENUM (
        'pending',        -- Just saved, not yet validated
        'validating',     -- Currently being processed
        'validated',      -- Passed validation, ready for promotion
        'promoted',       -- Successfully written to SoT
        'needs_review',   -- Ambiguous, needs human review
        'rejected',       -- Failed validation, won't promote
        'superseded'      -- Replaced by newer intake record
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. RAW INTAKE: REQUESTS
-- ============================================================================
-- Append-only table for request intake from UI

CREATE TABLE IF NOT EXISTS trapper.raw_intake_request (
    raw_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Lifecycle
    intake_status trapper.intake_status NOT NULL DEFAULT 'pending',
    supersedes_raw_id UUID REFERENCES trapper.raw_intake_request(raw_id),

    -- Promotion tracking
    promoted_request_id UUID,  -- Will reference sot_requests after promotion
    promoted_at TIMESTAMPTZ,
    promotion_notes TEXT,

    -- Review tracking
    review_reason TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_decision TEXT,  -- 'approve', 'reject', 'merge', 'split'

    -- Source tracking
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_system TEXT NOT NULL DEFAULT 'atlas_ui',

    -- =========================================================================
    -- RAW FORM DATA (stored as-is from UI, no validation applied yet)
    -- =========================================================================

    -- Location (may reference existing or be new)
    place_id UUID,                    -- If selecting existing place
    raw_address TEXT,                 -- If entering new address
    raw_property_type TEXT,
    raw_location_description TEXT,

    -- Contact (may reference existing or be new)
    requester_person_id UUID,         -- If selecting existing person
    raw_requester_name TEXT,          -- If entering new person
    raw_requester_phone TEXT,
    raw_requester_email TEXT,
    raw_property_owner_contact TEXT,
    raw_best_contact_times TEXT,

    -- Permission & Access
    raw_permission_status TEXT,
    raw_access_notes TEXT,
    raw_traps_overnight_safe BOOLEAN,
    raw_access_without_contact BOOLEAN,

    -- About the Cats
    raw_estimated_cat_count INTEGER,
    raw_count_confidence TEXT,
    raw_colony_duration TEXT,
    raw_eartip_count INTEGER,
    raw_eartip_estimate TEXT,
    raw_cats_are_friendly BOOLEAN,

    -- Kittens
    raw_has_kittens BOOLEAN,
    raw_kitten_count INTEGER,
    raw_kitten_age_weeks INTEGER,

    -- Feeding
    raw_is_being_fed BOOLEAN,
    raw_feeder_name TEXT,
    raw_feeding_schedule TEXT,
    raw_best_times_seen TEXT,

    -- Urgency
    raw_urgency_reasons TEXT[],
    raw_urgency_deadline DATE,
    raw_urgency_notes TEXT,
    raw_priority TEXT,

    -- Additional
    raw_summary TEXT,
    raw_notes TEXT,

    -- Validation results (populated by normalizer)
    validation_errors JSONB,
    validation_warnings JSONB,
    validated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_raw_intake_request_status ON trapper.raw_intake_request(intake_status);
CREATE INDEX IF NOT EXISTS idx_raw_intake_request_created ON trapper.raw_intake_request(created_at);
CREATE INDEX IF NOT EXISTS idx_raw_intake_request_promoted ON trapper.raw_intake_request(promoted_request_id) WHERE promoted_request_id IS NOT NULL;

COMMENT ON TABLE trapper.raw_intake_request IS
'Append-only raw intake for requests from Atlas UI. Updates create new rows with supersedes_raw_id.
Normalizer validates and promotes to sot_requests.';

-- ============================================================================
-- 3. RAW INTAKE: PEOPLE
-- ============================================================================
-- For new people entered via forms (not selecting existing)

CREATE TABLE IF NOT EXISTS trapper.raw_intake_person (
    raw_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Lifecycle
    intake_status trapper.intake_status NOT NULL DEFAULT 'pending',
    supersedes_raw_id UUID REFERENCES trapper.raw_intake_person(raw_id),

    -- Promotion tracking
    promoted_person_id UUID,  -- Will reference sot_people after promotion
    promoted_at TIMESTAMPTZ,
    promotion_notes TEXT,

    -- Review tracking
    review_reason TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_decision TEXT,

    -- Source tracking
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_system TEXT NOT NULL DEFAULT 'atlas_ui',
    linked_raw_request_id UUID REFERENCES trapper.raw_intake_request(raw_id),

    -- =========================================================================
    -- RAW FORM DATA
    -- =========================================================================
    raw_name TEXT,
    raw_phone TEXT,
    raw_email TEXT,
    raw_address TEXT,
    raw_role TEXT,  -- 'requester', 'property_owner', 'feeder', 'neighbor'
    raw_notes TEXT,

    -- Validation results
    validation_errors JSONB,
    validation_warnings JSONB,
    validated_at TIMESTAMPTZ,

    -- Matching results (populated by normalizer)
    potential_matches JSONB,  -- Array of {person_id, confidence, match_reasons}
    match_decision TEXT       -- 'new', 'merge_into:<id>', 'needs_review'
);

CREATE INDEX IF NOT EXISTS idx_raw_intake_person_status ON trapper.raw_intake_person(intake_status);
CREATE INDEX IF NOT EXISTS idx_raw_intake_person_promoted ON trapper.raw_intake_person(promoted_person_id) WHERE promoted_person_id IS NOT NULL;

COMMENT ON TABLE trapper.raw_intake_person IS
'Append-only raw intake for new people from Atlas UI. Normalizer validates against garbage name rules and matches existing people.';

-- ============================================================================
-- 4. RAW INTAKE: PLACES
-- ============================================================================
-- For new places/addresses entered via forms

CREATE TABLE IF NOT EXISTS trapper.raw_intake_place (
    raw_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Lifecycle
    intake_status trapper.intake_status NOT NULL DEFAULT 'pending',
    supersedes_raw_id UUID REFERENCES trapper.raw_intake_place(raw_id),

    -- Promotion tracking
    promoted_place_id UUID,  -- Will reference places after promotion
    promoted_at TIMESTAMPTZ,
    promotion_notes TEXT,

    -- Review tracking
    review_reason TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_decision TEXT,

    -- Source tracking
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_system TEXT NOT NULL DEFAULT 'atlas_ui',
    linked_raw_request_id UUID REFERENCES trapper.raw_intake_request(raw_id),

    -- =========================================================================
    -- RAW FORM DATA
    -- =========================================================================
    raw_display_name TEXT,
    raw_address TEXT,
    raw_place_kind TEXT,
    raw_property_type TEXT,
    raw_location_description TEXT,
    raw_notes TEXT,

    -- Google Places data (if from autocomplete)
    google_place_id TEXT,
    google_formatted_address TEXT,
    google_lat NUMERIC,
    google_lng NUMERIC,
    google_address_components JSONB,

    -- Validation results
    validation_errors JSONB,
    validation_warnings JSONB,
    validated_at TIMESTAMPTZ,

    -- Matching results
    potential_matches JSONB,  -- Array of {place_id, confidence, match_reasons}
    match_decision TEXT       -- 'new', 'merge_into:<id>', 'needs_review'
);

CREATE INDEX IF NOT EXISTS idx_raw_intake_place_status ON trapper.raw_intake_place(intake_status);
CREATE INDEX IF NOT EXISTS idx_raw_intake_place_promoted ON trapper.raw_intake_place(promoted_place_id) WHERE promoted_place_id IS NOT NULL;

-- ============================================================================
-- 5. RAW INTAKE: CASE NOTES
-- ============================================================================
-- For timeline events / notes added to requests

CREATE TABLE IF NOT EXISTS trapper.raw_intake_case_note (
    raw_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Lifecycle
    intake_status trapper.intake_status NOT NULL DEFAULT 'pending',
    supersedes_raw_id UUID REFERENCES trapper.raw_intake_case_note(raw_id),

    -- Promotion tracking
    promoted_note_id UUID,
    promoted_at TIMESTAMPTZ,

    -- Source tracking
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_system TEXT NOT NULL DEFAULT 'atlas_ui',

    -- =========================================================================
    -- RAW NOTE DATA
    -- =========================================================================
    request_id UUID NOT NULL,  -- Which request this note belongs to
    raw_note_type TEXT,        -- 'call', 'visit', 'update', 'outcome', 'internal'
    raw_content TEXT NOT NULL,
    raw_contact_made BOOLEAN,
    raw_contact_method TEXT,   -- 'phone', 'text', 'email', 'in_person'
    raw_outcome TEXT,

    -- Validation results
    validation_errors JSONB,
    validated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_raw_intake_case_note_request ON trapper.raw_intake_case_note(request_id);
CREATE INDEX IF NOT EXISTS idx_raw_intake_case_note_status ON trapper.raw_intake_case_note(intake_status);

-- ============================================================================
-- 6. REVIEW QUEUE
-- ============================================================================
-- Central queue for items needing human review

CREATE TABLE IF NOT EXISTS trapper.review_queue (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What needs review
    entity_type TEXT NOT NULL,  -- 'request', 'person', 'place', 'cat'
    raw_table TEXT NOT NULL,    -- 'raw_intake_request', 'raw_intake_person', etc.
    raw_id UUID NOT NULL,

    -- Why it needs review
    review_reason TEXT NOT NULL,
    review_category TEXT,       -- 'duplicate_suspect', 'garbage_name', 'ambiguous_match', 'validation_failed'
    confidence_score NUMERIC,
    details JSONB,              -- Context-specific details (potential matches, validation errors, etc.)

    -- Review status
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'in_progress', 'resolved', 'escalated'
    assigned_to TEXT,

    -- Resolution
    resolution TEXT,            -- 'approved', 'rejected', 'merged', 'split', 'edited'
    resolution_notes TEXT,
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status ON trapper.review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_entity ON trapper.review_queue(entity_type, raw_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_category ON trapper.review_queue(review_category);

COMMENT ON TABLE trapper.review_queue IS
'Central queue for items needing human review before promotion to SoT.
Used for duplicate suspects, garbage names, ambiguous matches, etc.';

-- ============================================================================
-- 7. INTAKE AUDIT LOG
-- ============================================================================
-- Tracks all intake → SoT promotions for auditability

CREATE TABLE IF NOT EXISTS trapper.intake_audit_log (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was promoted
    raw_table TEXT NOT NULL,
    raw_id UUID NOT NULL,
    sot_table TEXT NOT NULL,
    sot_id UUID NOT NULL,

    -- What happened
    action TEXT NOT NULL,  -- 'create', 'update', 'merge'
    changes JSONB,         -- What fields were set/changed

    -- Who/when/why
    promoted_by TEXT NOT NULL,
    promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promotion_reason TEXT,

    -- For debugging
    normalizer_version TEXT,
    validation_result JSONB
);

CREATE INDEX IF NOT EXISTS idx_intake_audit_raw ON trapper.intake_audit_log(raw_table, raw_id);
CREATE INDEX IF NOT EXISTS idx_intake_audit_sot ON trapper.intake_audit_log(sot_table, sot_id);
CREATE INDEX IF NOT EXISTS idx_intake_audit_time ON trapper.intake_audit_log(promoted_at);

-- ============================================================================
-- 8. VIEW: PENDING INTAKE
-- ============================================================================
-- Shows all pending intake items across tables

CREATE OR REPLACE VIEW trapper.v_pending_intake AS
SELECT
    'request' AS entity_type,
    raw_id,
    intake_status,
    created_by,
    created_at,
    COALESCE(raw_summary, 'Request at ' || COALESCE(raw_address, 'unknown location')) AS description,
    validation_errors,
    validation_warnings
FROM trapper.raw_intake_request
WHERE intake_status IN ('pending', 'validated', 'needs_review')

UNION ALL

SELECT
    'person' AS entity_type,
    raw_id,
    intake_status,
    created_by,
    created_at,
    COALESCE(raw_name, 'Unknown person') AS description,
    validation_errors,
    validation_warnings
FROM trapper.raw_intake_person
WHERE intake_status IN ('pending', 'validated', 'needs_review')

UNION ALL

SELECT
    'place' AS entity_type,
    raw_id,
    intake_status,
    created_by,
    created_at,
    COALESCE(raw_display_name, raw_address, 'Unknown place') AS description,
    validation_errors,
    validation_warnings
FROM trapper.raw_intake_place
WHERE intake_status IN ('pending', 'validated', 'needs_review')

ORDER BY created_at DESC;

-- ============================================================================
-- 9. VIEW: REVIEW QUEUE DASHBOARD
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_review_queue_dashboard AS
SELECT
    rq.review_id,
    rq.entity_type,
    rq.review_reason,
    rq.review_category,
    rq.confidence_score,
    rq.status,
    rq.assigned_to,
    rq.created_at,
    rq.updated_at,
    -- Get description based on entity type
    CASE rq.entity_type
        WHEN 'request' THEN (SELECT COALESCE(raw_summary, 'Request') FROM trapper.raw_intake_request WHERE raw_id = rq.raw_id)
        WHEN 'person' THEN (SELECT COALESCE(raw_name, 'Person') FROM trapper.raw_intake_person WHERE raw_id = rq.raw_id)
        WHEN 'place' THEN (SELECT COALESCE(raw_display_name, raw_address, 'Place') FROM trapper.raw_intake_place WHERE raw_id = rq.raw_id)
        ELSE 'Unknown'
    END AS entity_description,
    rq.details
FROM trapper.review_queue rq
WHERE rq.status IN ('pending', 'in_progress')
ORDER BY
    CASE rq.review_category
        WHEN 'duplicate_suspect' THEN 1
        WHEN 'garbage_name' THEN 2
        WHEN 'ambiguous_match' THEN 3
        ELSE 4
    END,
    rq.created_at ASC;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT 'Raw intake tables created:' AS info;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
AND table_name LIKE 'raw_intake_%'
ORDER BY table_name;

SELECT 'Review queue and audit tables:' AS info;
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'trapper'
AND table_name IN ('review_queue', 'intake_audit_log')
ORDER BY table_name;
