-- MIG_240__people_match_candidates.sql
-- Canonical People dedupe: match candidates + review queue
-- Part of PEOPLE_SOT_240: Safe linking without destructive merges
-- SAFE: Additive only, no destructive operations

-- ============================================================
-- PRINCIPLES (non-negotiable):
-- 1. Sources stay siloed (Airtable, ClinicHQ, JotForm)
-- 2. trapper.people is the canonical hub
-- 3. Only write links and candidates; never auto-merge
-- 4. Fuzzy logic produces reviewable candidates, never merges
-- ============================================================

-- ============================================================
-- PART 1: Match Candidates Table
-- Stores potential matches between source records and canonical people
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.person_match_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source record being matched
    source_system TEXT NOT NULL CHECK (source_system IN ('clinichq', 'airtable', 'jotform', 'manual')),
    source_record_id TEXT NOT NULL,

    -- Candidate canonical person (NULL = suggest "create new person")
    candidate_person_id UUID REFERENCES trapper.people(id) ON DELETE CASCADE,

    -- Match confidence and evidence
    confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Evidence structure:
    -- {
    --   "matched_on": ["phone_normalized", "email"],
    --   "phone_match": true,
    --   "email_match": false,
    --   "name_similarity": 0.85,
    --   "address_proximity_m": 150,
    --   "tier": 0,
    --   "action": "link" | "create_person"
    -- }

    -- Review status
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected', 'superseded')),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT,

    -- Prevent duplicate candidates for same source+candidate pair
    UNIQUE (source_system, source_record_id, candidate_person_id)
);

-- Index for efficient review queue queries
CREATE INDEX IF NOT EXISTS idx_person_match_candidates_status_confidence
ON trapper.person_match_candidates(status, confidence DESC)
WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_person_match_candidates_source
ON trapper.person_match_candidates(source_system, source_record_id);

CREATE INDEX IF NOT EXISTS idx_person_match_candidates_candidate
ON trapper.person_match_candidates(candidate_person_id)
WHERE candidate_person_id IS NOT NULL;

COMMENT ON TABLE trapper.person_match_candidates IS
'Potential matches between source records and canonical people. Review queue for safe linking.
Status: open (needs review), accepted (linked), rejected (not same person), superseded (another candidate accepted)';

-- ============================================================
-- PART 2: Link Audit Table (append-only)
-- Tracks all link decisions for accountability and rollback
-- ============================================================

CREATE TABLE IF NOT EXISTS trapper.person_link_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What happened
    action TEXT NOT NULL CHECK (action IN ('link_created', 'link_removed', 'candidate_accepted', 'candidate_rejected', 'person_created')),

    -- Who did it
    performed_by TEXT NOT NULL DEFAULT 'system',
    performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- What was affected
    person_id UUID REFERENCES trapper.people(id) ON DELETE SET NULL,
    source_system TEXT,
    source_record_id TEXT,
    candidate_id UUID REFERENCES trapper.person_match_candidates(id) ON DELETE SET NULL,

    -- Snapshot of state at time of action
    previous_state JSONB,
    new_state JSONB,

    -- Reasoning
    reason TEXT,
    evidence_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_person_link_audit_person
ON trapper.person_link_audit(person_id);

CREATE INDEX IF NOT EXISTS idx_person_link_audit_source
ON trapper.person_link_audit(source_system, source_record_id);

CREATE INDEX IF NOT EXISTS idx_person_link_audit_performed_at
ON trapper.person_link_audit(performed_at DESC);

COMMENT ON TABLE trapper.person_link_audit IS
'Append-only audit log for all person linking decisions. Enables rollback and accountability.';

-- ============================================================
-- PART 3: Extended v_people_sot View
-- Add source counts, link state, and ClinicHQ history flag
-- ============================================================

DROP VIEW IF EXISTS trapper.v_people_sot CASCADE;

CREATE VIEW trapper.v_people_sot AS
WITH source_counts AS (
    SELECT
        psl.person_id,
        COUNT(*) AS total_links,
        COUNT(*) FILTER (WHERE psl.source_system = 'airtable') AS airtable_links,
        COUNT(*) FILTER (WHERE psl.source_system = 'clinichq') AS clinichq_links,
        COUNT(*) FILTER (WHERE psl.source_system = 'jotform') AS jotform_links
    FROM trapper.person_source_link psl
    GROUP BY psl.person_id
),
clinichq_history AS (
    -- Check if person has ClinicHQ history via phone or email
    SELECT DISTINCT p.id AS person_id
    FROM trapper.people p
    JOIN trapper.clinichq_hist_owners cho ON (
        cho.phone_normalized = p.phone_normalized
        OR LOWER(cho.owner_email) = LOWER(p.email)
    )
    WHERE p.phone_normalized IS NOT NULL OR p.email IS NOT NULL
),
open_candidates AS (
    SELECT
        pmc.candidate_person_id AS person_id,
        COUNT(*) AS open_candidate_count
    FROM trapper.person_match_candidates pmc
    WHERE pmc.status = 'open' AND pmc.candidate_person_id IS NOT NULL
    GROUP BY pmc.candidate_person_id
)
SELECT
    p.id AS person_id,
    p.person_key,
    COALESCE(p.display_name, p.full_name, CONCAT(p.first_name, ' ', p.last_name)) AS display_name,
    p.first_name,
    p.last_name,
    p.email,
    p.phone,
    p.phone_normalized,
    p.notes,
    p.created_at,
    p.updated_at,

    -- Source link counts
    COALESCE(sc.total_links, 0) AS source_link_count,
    COALESCE(sc.airtable_links, 0) AS airtable_link_count,
    COALESCE(sc.clinichq_links, 0) AS clinichq_link_count,
    COALESCE(sc.jotform_links, 0) AS jotform_link_count,

    -- ClinicHQ history (direct phone/email match)
    ch.person_id IS NOT NULL AS has_clinichq_history,

    -- Link state
    CASE
        WHEN COALESCE(sc.total_links, 0) > 0 THEN 'linked'
        WHEN COALESCE(oc.open_candidate_count, 0) > 0 THEN 'ambiguous'
        ELSE 'unlinked'
    END AS link_state,

    -- Open candidates count (for review queue)
    COALESCE(oc.open_candidate_count, 0) AS open_candidate_count,

    -- Request counts (via request_parties)
    (SELECT COUNT(DISTINCT request_id) FROM trapper.request_parties rp WHERE rp.person_id = p.id) AS request_count,

    -- Quarantine flags
    CASE
        WHEN LOWER(p.email) LIKE '%ffsc%' OR LOWER(p.email) LIKE '%forgottenfelines%' THEN TRUE
        ELSE FALSE
    END AS is_system_email,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM trapper.people p2
            WHERE p2.phone_normalized = p.phone_normalized
            AND p2.id != p.id
            AND p.phone_normalized IS NOT NULL
        ) THEN TRUE
        ELSE FALSE
    END AS is_shared_phone
FROM trapper.people p
LEFT JOIN source_counts sc ON sc.person_id = p.id
LEFT JOIN clinichq_history ch ON ch.person_id = p.id
LEFT JOIN open_candidates oc ON oc.person_id = p.id;

COMMENT ON VIEW trapper.v_people_sot IS
'Source-of-Truth view for canonical people with source link counts, ClinicHQ history, and link state.
link_state: linked (has source links), ambiguous (has open candidates), unlinked (no links or candidates)';

-- ============================================================
-- PART 4: Unlinked Sources View
-- Lists source records not yet linked to canonical people
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_people_unlinked_sources AS
-- ClinicHQ owners not linked
SELECT
    'clinichq'::text AS source_system,
    cho.id::text AS source_record_id,
    cho.owner_name AS display_name,
    cho.owner_email AS email,
    cho.phone AS phone,
    cho.phone_normalized,
    NULL::text AS address_display,
    cho.total_appointments AS visit_count,
    cho.first_appointment AS first_seen,
    cho.last_appointment AS last_seen,
    -- Check if already linked
    NOT EXISTS (
        SELECT 1 FROM trapper.person_source_link psl
        WHERE psl.source_system = 'clinichq' AND psl.source_pk = cho.id::text
    ) AS is_unlinked,
    -- Check if has open candidates
    EXISTS (
        SELECT 1 FROM trapper.person_match_candidates pmc
        WHERE pmc.source_system = 'clinichq'
        AND pmc.source_record_id = cho.id::text
        AND pmc.status = 'open'
    ) AS has_open_candidates
FROM trapper.clinichq_hist_owners cho
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.person_source_link psl
    WHERE psl.source_system = 'clinichq' AND psl.source_pk = cho.id::text
)

UNION ALL

-- Appointment requests (JotForm) not linked
SELECT
    'jotform'::text AS source_system,
    ar.id::text AS source_record_id,
    COALESCE(ar.requester_name, CONCAT(ar.first_name, ' ', ar.last_name)) AS display_name,
    ar.email,
    ar.phone,
    -- Normalize phone inline
    regexp_replace(ar.phone, '[^0-9]', '', 'g') AS phone_normalized,
    COALESCE(ar.cats_address, ar.requester_address) AS address_display,
    1 AS visit_count,
    ar.submitted_at AS first_seen,
    ar.submitted_at AS last_seen,
    NOT EXISTS (
        SELECT 1 FROM trapper.person_source_link psl
        WHERE psl.source_system = 'jotform' AND psl.source_pk = ar.id::text
    ) AS is_unlinked,
    EXISTS (
        SELECT 1 FROM trapper.person_match_candidates pmc
        WHERE pmc.source_system = 'jotform'
        AND pmc.source_record_id = ar.id::text
        AND pmc.status = 'open'
    ) AS has_open_candidates
FROM trapper.appointment_requests ar
WHERE NOT EXISTS (
    SELECT 1 FROM trapper.person_source_link psl
    WHERE psl.source_system = 'jotform' AND psl.source_pk = ar.id::text
);

COMMENT ON VIEW trapper.v_people_unlinked_sources IS
'Source records (ClinicHQ owners, JotForm submissions) not yet linked to canonical people.
Use for matching candidate generation and backlog tracking.';

-- ============================================================
-- PART 5: Candidate Review Queue View
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_person_candidate_review_queue AS
SELECT
    pmc.id AS candidate_id,
    pmc.source_system,
    pmc.source_record_id,
    pmc.confidence,
    pmc.evidence,
    pmc.status,
    pmc.created_at,

    -- Confidence tier
    CASE
        WHEN pmc.confidence >= 0.95 THEN 'tier0'
        WHEN pmc.confidence >= 0.80 THEN 'tier1'
        WHEN pmc.confidence >= 0.50 THEN 'tier2'
        ELSE 'tier3'
    END AS confidence_tier,

    -- Source record info (from evidence or lookup)
    pmc.evidence->>'source_name' AS source_name,
    pmc.evidence->>'source_email' AS source_email,
    pmc.evidence->>'source_phone' AS source_phone,

    -- Candidate person info
    pmc.candidate_person_id,
    p.display_name AS candidate_name,
    p.email AS candidate_email,
    p.phone AS candidate_phone,
    p.phone_normalized AS candidate_phone_normalized,

    -- Match evidence summary
    pmc.evidence->'matched_on' AS matched_on,
    (pmc.evidence->>'phone_match')::boolean AS phone_match,
    (pmc.evidence->>'email_match')::boolean AS email_match,
    (pmc.evidence->>'name_similarity')::numeric AS name_similarity,

    -- Is this a "create new person" suggestion?
    pmc.candidate_person_id IS NULL AS is_create_new_suggestion
FROM trapper.person_match_candidates pmc
LEFT JOIN trapper.people p ON p.id = pmc.candidate_person_id
WHERE pmc.status = 'open'
ORDER BY pmc.confidence DESC, pmc.created_at ASC;

COMMENT ON VIEW trapper.v_person_candidate_review_queue IS
'Review queue for person match candidates. Sorted by confidence (highest first).
confidence_tier: tier0 (>=0.95), tier1 (>=0.80), tier2 (>=0.50), tier3 (<0.50)';

-- ============================================================
-- PART 6: Linking Stats View
-- ============================================================

CREATE OR REPLACE VIEW trapper.v_people_linking_stats AS
WITH clinichq_counts AS (
    SELECT
        COUNT(*) AS total_owners,
        COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM trapper.person_source_link psl
            WHERE psl.source_system = 'clinichq' AND psl.source_pk = cho.id::text
        )) AS linked_owners
    FROM trapper.clinichq_hist_owners cho
),
candidate_counts AS (
    SELECT
        COUNT(*) AS total_candidates,
        COUNT(*) FILTER (WHERE status = 'open') AS open_candidates,
        COUNT(*) FILTER (WHERE status = 'accepted') AS accepted_candidates,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_candidates,
        COUNT(*) FILTER (WHERE status = 'open' AND confidence >= 0.95) AS tier0_open,
        COUNT(*) FILTER (WHERE status = 'open' AND confidence >= 0.80 AND confidence < 0.95) AS tier1_open,
        COUNT(*) FILTER (WHERE status = 'open' AND confidence >= 0.50 AND confidence < 0.80) AS tier2_open,
        COUNT(*) FILTER (WHERE status = 'open' AND confidence < 0.50) AS tier3_open
    FROM trapper.person_match_candidates
),
link_counts AS (
    SELECT
        COUNT(*) AS total_links,
        COUNT(*) FILTER (WHERE source_system = 'clinichq') AS clinichq_links,
        COUNT(*) FILTER (WHERE source_system = 'airtable') AS airtable_links,
        COUNT(*) FILTER (WHERE source_system = 'jotform') AS jotform_links
    FROM trapper.person_source_link
)
SELECT
    -- ClinicHQ backlog
    cc.total_owners AS clinichq_total_owners,
    cc.linked_owners AS clinichq_linked_owners,
    cc.total_owners - cc.linked_owners AS clinichq_unlinked_owners,
    ROUND(100.0 * cc.linked_owners / NULLIF(cc.total_owners, 0), 1) AS clinichq_linked_pct,

    -- Candidates
    cand.total_candidates,
    cand.open_candidates,
    cand.accepted_candidates,
    cand.rejected_candidates,
    ROUND(100.0 * cand.accepted_candidates / NULLIF(cand.accepted_candidates + cand.rejected_candidates, 0), 1) AS acceptance_rate_pct,

    -- Open by tier
    cand.tier0_open,
    cand.tier1_open,
    cand.tier2_open,
    cand.tier3_open,

    -- Links
    lc.total_links,
    lc.clinichq_links,
    lc.airtable_links,
    lc.jotform_links,

    -- Canonical people count
    (SELECT COUNT(*) FROM trapper.people) AS canonical_people_count
FROM clinichq_counts cc, candidate_counts cand, link_counts lc;

COMMENT ON VIEW trapper.v_people_linking_stats IS
'Dashboard stats for people linking: backlog, candidates by tier, acceptance rate.';

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo 'MIG_240 complete. Verifying People Match Candidates infrastructure:'
\echo ''

\echo 'person_match_candidates table:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'person_match_candidates'
ORDER BY ordinal_position
LIMIT 8;

\echo ''
\echo 'person_link_audit table:'
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'trapper' AND table_name = 'person_link_audit'
ORDER BY ordinal_position
LIMIT 8;

\echo ''
\echo 'Linking stats (should work even with empty tables):'
SELECT * FROM trapper.v_people_linking_stats;
