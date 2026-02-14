\echo '=== MIG_314: Data Engine Identity Tables ==='
\echo 'Creating tables for the Data Engine identity resolution system'
\echo ''

-- ============================================================================
-- DATA ENGINE MATCHING RULES
-- Configurable rules for identity matching with weights and thresholds
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.data_engine_matching_rules (
    rule_id SERIAL PRIMARY KEY,
    rule_name TEXT NOT NULL UNIQUE,
    rule_category TEXT NOT NULL CHECK (rule_category IN ('exact', 'fuzzy', 'contextual')),

    -- Signal configuration
    primary_signal TEXT NOT NULL CHECK (primary_signal IN ('email', 'phone', 'address', 'name', 'microchip')),
    secondary_signal TEXT CHECK (secondary_signal IN ('email', 'phone', 'address', 'name', 'microchip', NULL)),

    -- Scoring weights
    base_confidence NUMERIC(4,3) NOT NULL CHECK (base_confidence BETWEEN 0 AND 1),
    weight_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,

    -- Thresholds for decision making
    auto_match_threshold NUMERIC(4,3) DEFAULT 0.95 CHECK (auto_match_threshold BETWEEN 0 AND 1),
    review_threshold NUMERIC(4,3) DEFAULT 0.50 CHECK (review_threshold BETWEEN 0 AND 1),
    reject_threshold NUMERIC(4,3) DEFAULT 0.30 CHECK (reject_threshold BETWEEN 0 AND 1),

    -- Rule conditions (JSONB for flexibility and extensibility)
    conditions JSONB DEFAULT '{}',

    -- Status and priority
    is_active BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 100,  -- Higher = evaluated first

    -- Which sources this rule applies to (extensible for future sources)
    applies_to_sources TEXT[] DEFAULT ARRAY['all'],

    -- Metadata
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE trapper.data_engine_matching_rules IS
'Configurable matching rules for the Data Engine identity resolution system. Rules are evaluated by priority and combined for weighted scoring.';

COMMENT ON COLUMN trapper.data_engine_matching_rules.conditions IS
'JSONB conditions for rule application. Examples: {"name_similarity_min": 0.5}, {"require_address_match": true}';

COMMENT ON COLUMN trapper.data_engine_matching_rules.applies_to_sources IS
'Array of source systems this rule applies to. Use ["all"] for universal rules, or specific sources like ["clinichq", "airtable"]';

-- Seed default matching rules
INSERT INTO trapper.data_engine_matching_rules
(rule_name, rule_category, primary_signal, secondary_signal, base_confidence, auto_match_threshold, review_threshold, reject_threshold, conditions, priority, description)
VALUES
-- Exact match rules (highest confidence)
('exact_email', 'exact', 'email', NULL, 1.0, 0.95, 0.50, 0.30,
 '{"name_similarity_min": 0.5}', 100,
 'Email exact match. High confidence but checks name similarity.'),

('exact_email_name_match', 'exact', 'email', 'name', 1.0, 0.90, 0.50, 0.30,
 '{"name_similarity_min": 0.7}', 99,
 'Email match with high name similarity. Very high confidence.'),

('exact_phone_same_name', 'exact', 'phone', 'name', 0.95, 0.90, 0.50, 0.30,
 '{"name_similarity_min": 0.6}', 90,
 'Phone match with similar name. High confidence.'),

('exact_phone_different_name', 'exact', 'phone', 'name', 0.40, 0.95, 0.35, 0.20,
 '{"name_similarity_max": 0.5}', 89,
 'Phone match but names differ. Low confidence - likely household or shared phone.'),

-- Fuzzy match rules (moderate confidence)
('fuzzy_name_same_address', 'fuzzy', 'name', 'address', 0.75, 0.85, 0.45, 0.25,
 '{"name_similarity_min": 0.6}', 70,
 'Name similarity with same address. Moderate-high confidence.'),

('fuzzy_name_same_phone', 'fuzzy', 'name', 'phone', 0.70, 0.85, 0.40, 0.25,
 '{"name_similarity_min": 0.5}', 69,
 'Name similarity with same phone. Moderate confidence.'),

('soundex_name_same_address', 'fuzzy', 'name', 'address', 0.65, 0.80, 0.40, 0.25,
 '{"use_soundex": true}', 60,
 'Phonetic name match with same address. Moderate confidence.'),

-- Contextual rules (household awareness)
('household_shared_phone', 'contextual', 'phone', 'address', 0.50, 0.95, 0.35, 0.20,
 '{"household_enabled": true, "create_household": true}', 50,
 'Shared phone at same address indicates household, not same person.'),

('household_shared_address', 'contextual', 'address', 'name', 0.45, 0.90, 0.30, 0.20,
 '{"household_enabled": true, "name_similarity_max": 0.4}', 49,
 'Different names at same address indicates household members.')

ON CONFLICT (rule_name) DO NOTHING;

\echo 'Created data_engine_matching_rules table with default rules'

-- ============================================================================
-- HOUSEHOLDS
-- Model groups of people at the same address sharing identifiers
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.households (
    household_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_place_id UUID NOT NULL REFERENCES trapper.places(place_id),

    -- Metadata
    household_name TEXT,  -- Auto-generated or manually set
    household_type TEXT CHECK (household_type IN ('family', 'roommates', 'multi_unit', 'unknown')) DEFAULT 'unknown',
    member_count INT DEFAULT 0,

    -- Tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    source_system TEXT,

    CONSTRAINT uq_household_place UNIQUE (primary_place_id)
);

COMMENT ON TABLE trapper.households IS
'Represents a group of people living at the same address who may share phone numbers or other identifiers.';

CREATE INDEX IF NOT EXISTS idx_households_place ON trapper.households(primary_place_id);

\echo 'Created households table'

-- ============================================================================
-- HOUSEHOLD MEMBERS
-- Link people to households with roles and confidence
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.household_members (
    membership_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES trapper.households(household_id) ON DELETE CASCADE,
    person_id UUID NOT NULL REFERENCES trapper.sot_people(person_id),

    -- Role within household
    role TEXT CHECK (role IN ('head', 'spouse', 'partner', 'child', 'parent', 'roommate', 'caretaker', 'other', 'unknown')) DEFAULT 'unknown',

    -- Confidence and provenance
    confidence NUMERIC(3,2) DEFAULT 0.70 CHECK (confidence BETWEEN 0 AND 1),
    inferred_from TEXT,  -- 'shared_phone', 'same_address', 'request_co_requester', 'manual', etc.

    -- Validity period (for tracking changes over time)
    valid_from DATE DEFAULT CURRENT_DATE,
    valid_to DATE,  -- NULL means current

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    source_system TEXT,

    CONSTRAINT uq_person_household_active UNIQUE (person_id, household_id, valid_to)
);

COMMENT ON TABLE trapper.household_members IS
'Links people to households. A person can belong to multiple households over time (tracked via valid_from/valid_to).';

CREATE INDEX IF NOT EXISTS idx_household_members_person ON trapper.household_members(person_id);
CREATE INDEX IF NOT EXISTS idx_household_members_household ON trapper.household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_household_members_active ON trapper.household_members(household_id) WHERE valid_to IS NULL;

\echo 'Created household_members table'

-- ============================================================================
-- HOUSEHOLD SHARED IDENTIFIERS
-- Track which identifiers are shared within a household (to prevent false merges)
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.household_shared_identifiers (
    share_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES trapper.households(household_id) ON DELETE CASCADE,
    identifier_type TEXT NOT NULL CHECK (identifier_type IN ('phone', 'email')),
    identifier_value_norm TEXT NOT NULL,

    -- Track which members share this identifier
    member_person_ids UUID[] NOT NULL,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,

    CONSTRAINT uq_household_identifier UNIQUE (household_id, identifier_type, identifier_value_norm)
);

COMMENT ON TABLE trapper.household_shared_identifiers IS
'Records identifiers (phone/email) that are known to be shared by multiple people in a household. Prevents these from causing false person merges.';

CREATE INDEX IF NOT EXISTS idx_household_shared_identifier ON trapper.household_shared_identifiers(identifier_type, identifier_value_norm);

\echo 'Created household_shared_identifiers table'

-- ============================================================================
-- DATA ENGINE MATCH DECISIONS
-- Full audit trail of every identity matching decision
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.data_engine_match_decisions (
    decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Input data
    staged_record_id UUID,
    source_system TEXT NOT NULL,
    incoming_email TEXT,
    incoming_phone TEXT,
    incoming_name TEXT,
    incoming_address TEXT,

    -- Candidate evaluation
    candidates_evaluated INT DEFAULT 0,
    top_candidate_person_id UUID REFERENCES trapper.sot_people(person_id),
    top_candidate_score NUMERIC(4,3),

    -- Decision
    decision_type TEXT NOT NULL CHECK (decision_type IN (
        'auto_match',       -- High confidence, merged automatically
        'review_pending',   -- Medium confidence, needs human review
        'new_entity',       -- Low confidence, created new person
        'household_member', -- Recognized as different person in same household
        'rejected'          -- Invalid data, no action taken
    )),
    decision_reason TEXT,

    -- Result
    resulting_person_id UUID REFERENCES trapper.sot_people(person_id),
    household_id UUID REFERENCES trapper.households(household_id),

    -- Scoring breakdown (for debugging and tuning)
    score_breakdown JSONB,  -- {"email_score": 1.0, "phone_score": 0.95, "name_score": 0.45}
    rules_applied JSONB,    -- ["exact_email", "fuzzy_name_same_phone"]
    all_candidates JSONB,   -- Top N candidates with scores for review

    -- Processing context
    processing_job_id UUID,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    processing_duration_ms INT,

    -- Human review (if decision_type = 'review_pending')
    review_status TEXT DEFAULT 'not_required' CHECK (review_status IN (
        'not_required', 'pending', 'approved', 'rejected', 'merged', 'kept_separate', 'deferred'
    )),
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    review_action TEXT  -- What action was taken during review
);

COMMENT ON TABLE trapper.data_engine_match_decisions IS
'Complete audit trail of every identity matching decision made by the Data Engine. Enables debugging, tuning, and compliance.';

CREATE INDEX IF NOT EXISTS idx_match_decisions_review_pending ON trapper.data_engine_match_decisions(review_status)
    WHERE review_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_match_decisions_person ON trapper.data_engine_match_decisions(resulting_person_id);
CREATE INDEX IF NOT EXISTS idx_match_decisions_job ON trapper.data_engine_match_decisions(processing_job_id);
CREATE INDEX IF NOT EXISTS idx_match_decisions_source ON trapper.data_engine_match_decisions(source_system, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_decisions_candidate ON trapper.data_engine_match_decisions(top_candidate_person_id)
    WHERE top_candidate_person_id IS NOT NULL;

\echo 'Created data_engine_match_decisions table'

-- ============================================================================
-- DATA ENGINE SOFT BLACKLIST
-- Identifiers that are shared but can match with additional context
-- ============================================================================

CREATE TABLE IF NOT EXISTS trapper.data_engine_soft_blacklist (
    identifier_norm TEXT NOT NULL,
    identifier_type TEXT NOT NULL CHECK (identifier_type IN ('phone', 'email')),

    -- Why it's soft-blacklisted
    reason TEXT NOT NULL,
    distinct_name_count INT,
    sample_names TEXT[],

    -- Conditions to allow matching anyway
    require_name_similarity NUMERIC(3,2) DEFAULT 0.7 CHECK (require_name_similarity BETWEEN 0 AND 1),
    require_address_match BOOLEAN DEFAULT TRUE,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_evaluated_at TIMESTAMPTZ,
    auto_detected BOOLEAN DEFAULT FALSE,

    PRIMARY KEY (identifier_norm, identifier_type)
);

COMMENT ON TABLE trapper.data_engine_soft_blacklist IS
'Identifiers that are known to be shared by multiple people but can still be used for matching with additional context (name similarity, address match).';

-- Seed with known problematic phones (not organizational, but shared)
-- These will be populated by the household detection process

\echo 'Created data_engine_soft_blacklist table'

-- ============================================================================
-- EXTEND EXISTING PHONE BLACKLIST
-- Add context for when to allow matching
-- ============================================================================

DO $$
BEGIN
    -- Add columns to existing phone blacklist if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'identity_phone_blacklist'
                   AND column_name = 'phone_type') THEN
        ALTER TABLE trapper.identity_phone_blacklist
        ADD COLUMN phone_type TEXT CHECK (phone_type IN ('organization', 'shared_household', 'service_provider', 'invalid', 'unknown')) DEFAULT 'unknown';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'identity_phone_blacklist'
                   AND column_name = 'allow_with_name_match') THEN
        ALTER TABLE trapper.identity_phone_blacklist
        ADD COLUMN allow_with_name_match BOOLEAN DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'trapper'
                   AND table_name = 'identity_phone_blacklist'
                   AND column_name = 'allow_with_address_match') THEN
        ALTER TABLE trapper.identity_phone_blacklist
        ADD COLUMN allow_with_address_match BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Update existing blacklist entries with context
UPDATE trapper.identity_phone_blacklist
SET
    phone_type = 'organization',
    allow_with_name_match = FALSE,
    allow_with_address_match = FALSE
WHERE phone_type IS NULL
  AND (reason ILIKE '%ffsc%' OR reason ILIKE '%office%' OR reason ILIKE '%organization%');

\echo 'Extended identity_phone_blacklist with matching context columns'

-- ============================================================================
-- VIEWS FOR DATA ENGINE MONITORING
-- ============================================================================

CREATE OR REPLACE VIEW trapper.v_data_engine_review_queue AS
SELECT
    d.decision_id,
    d.incoming_name,
    d.incoming_email,
    d.incoming_phone,
    d.incoming_address,
    d.source_system,

    -- Existing person info
    p.person_id AS existing_person_id,
    p.display_name AS existing_name,

    -- Match details
    d.top_candidate_score,
    d.score_breakdown,
    d.rules_applied,
    d.decision_reason,

    -- Context
    (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = p.person_id) AS existing_requests,
    (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) AS existing_appointments,

    -- Household context
    h.household_name,
    h.member_count AS household_size,

    -- Queue info
    d.review_status,
    d.processed_at,
    EXTRACT(EPOCH FROM (NOW() - d.processed_at)) / 3600 AS hours_in_queue

FROM trapper.data_engine_match_decisions d
LEFT JOIN trapper.sot_people p ON p.person_id = d.top_candidate_person_id
LEFT JOIN trapper.households h ON h.household_id = d.household_id
WHERE d.review_status = 'pending'
ORDER BY d.processed_at ASC;

COMMENT ON VIEW trapper.v_data_engine_review_queue IS
'Pending identity matches that need human review. Ordered by oldest first.';

CREATE OR REPLACE VIEW trapper.v_data_engine_stats AS
SELECT
    source_system,
    COUNT(*) AS total_decisions,
    COUNT(*) FILTER (WHERE decision_type = 'auto_match') AS auto_matched,
    COUNT(*) FILTER (WHERE decision_type = 'new_entity') AS new_entities,
    COUNT(*) FILTER (WHERE decision_type = 'household_member') AS household_members,
    COUNT(*) FILTER (WHERE decision_type = 'review_pending') AS pending_review,
    COUNT(*) FILTER (WHERE decision_type = 'rejected') AS rejected,
    ROUND(AVG(top_candidate_score)::numeric, 3) AS avg_match_score,
    ROUND(AVG(processing_duration_ms)::numeric, 0) AS avg_processing_ms,
    COUNT(*) FILTER (WHERE processed_at > NOW() - INTERVAL '24 hours') AS last_24h,
    COUNT(*) FILTER (WHERE processed_at > NOW() - INTERVAL '7 days') AS last_7d
FROM trapper.data_engine_match_decisions
GROUP BY source_system;

COMMENT ON VIEW trapper.v_data_engine_stats IS
'Statistics on Data Engine matching decisions by source system.';

CREATE OR REPLACE VIEW trapper.v_households_summary AS
SELECT
    h.household_id,
    h.household_name,
    h.household_type,
    p.formatted_address AS address,
    h.member_count,
    ARRAY_AGG(DISTINCT sp.display_name) FILTER (WHERE sp.display_name IS NOT NULL) AS member_names,
    (SELECT COUNT(*) FROM trapper.household_shared_identifiers hsi WHERE hsi.household_id = h.household_id) AS shared_identifiers,
    h.created_at,
    h.source_system
FROM trapper.households h
JOIN trapper.places p ON p.place_id = h.primary_place_id
LEFT JOIN trapper.household_members hm ON hm.household_id = h.household_id AND hm.valid_to IS NULL
LEFT JOIN trapper.sot_people sp ON sp.person_id = hm.person_id
GROUP BY h.household_id, h.household_name, h.household_type, p.formatted_address, h.member_count, h.created_at, h.source_system
ORDER BY h.member_count DESC, h.created_at DESC;

COMMENT ON VIEW trapper.v_households_summary IS
'Summary view of all households with member names and shared identifier counts.';

\echo ''
\echo '=== MIG_314 Complete ==='
\echo 'Created tables:'
\echo '  - data_engine_matching_rules (with 9 default rules)'
\echo '  - households'
\echo '  - household_members'
\echo '  - household_shared_identifiers'
\echo '  - data_engine_match_decisions'
\echo '  - data_engine_soft_blacklist'
\echo ''
\echo 'Created views:'
\echo '  - v_data_engine_review_queue'
\echo '  - v_data_engine_stats'
\echo '  - v_households_summary'
\echo ''
\echo 'Extended: identity_phone_blacklist with matching context columns'
