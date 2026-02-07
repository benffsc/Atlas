-- ============================================================================
-- MIG_941: Phase 2 Audit Views for Identity Resolution
-- ============================================================================
-- Part of the Entity Resolution Architecture Upgrade (Phase 2)
--
-- Creates views for:
-- 1. v_merge_audit_log - Complete merge history with reasoning
-- 2. v_tier4_pending_review - Staff dashboard for Tier 4 matches
-- 3. v_duplicate_prevention_stats - Daily stats on prevention effectiveness
-- 4. v_identity_decision_trace - Full trace for any person's identity history
--
-- These views enable staff to understand:
-- - Why any two people were merged
-- - What pending duplicates need review
-- - How effective the prevention system is
-- ============================================================================

\echo '=== MIG_941: Phase 2 Audit Views for Identity Resolution ==='
\echo ''

-- ============================================================================
-- Phase 1: v_merge_audit_log - Complete merge history
-- ============================================================================

\echo 'Phase 1: Creating v_merge_audit_log...'

CREATE OR REPLACE VIEW trapper.v_merge_audit_log AS
WITH merge_history AS (
    -- Get all merged people from sot_people
    SELECT
        p.person_id AS source_person_id,
        p.display_name AS source_name,
        p.merged_into_person_id AS target_person_id,
        p.merge_reason,
        p.merged_at,
        p.created_at AS source_created_at,
        p.data_source AS source_data_source
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NOT NULL
),
entity_merges AS (
    -- Get additional merge details from entity_merge_history
    SELECT
        emh.source_entity_id,
        emh.target_entity_id,
        emh.merge_reason AS emh_reason,
        emh.merged_by,
        emh.merged_at AS emh_merged_at,
        emh.metadata
    FROM trapper.entity_merge_history emh
    WHERE emh.entity_type = 'person'
      AND emh.undone_at IS NULL
),
target_info AS (
    -- Get target person details
    SELECT
        p.person_id,
        p.display_name,
        p.created_at,
        p.data_source
    FROM trapper.sot_people p
    WHERE p.merged_into_person_id IS NULL
),
data_engine_decisions AS (
    -- Get matching decision if merge was from data engine
    SELECT
        d.resulting_person_id,
        d.decision_type,
        d.decision_reason,
        d.top_candidate_score,
        d.score_breakdown,
        d.rules_applied,
        d.incoming_name,
        d.incoming_email,
        d.incoming_phone,
        d.source_system,
        d.processed_at
    FROM trapper.data_engine_match_decisions d
    WHERE d.decision_type IN ('auto_match', 'review_pending')
)
SELECT
    mh.source_person_id,
    mh.source_name,
    mh.target_person_id,
    ti.display_name AS target_name,
    COALESCE(mh.merge_reason, em.emh_reason) AS merge_reason,
    COALESCE(mh.merged_at, em.emh_merged_at) AS merged_at,

    -- Classification of merge type
    CASE
        WHEN COALESCE(mh.merge_reason, em.emh_reason) LIKE 'MIG_939%' THEN 'org_name_cleanup'
        WHEN COALESCE(mh.merge_reason, em.emh_reason) LIKE 'MIG_940%' THEN 'tier4_prevention'
        WHEN COALESCE(mh.merge_reason, em.emh_reason) LIKE '%same_name_same_address%' THEN 'same_name_same_address'
        WHEN COALESCE(mh.merge_reason, em.emh_reason) LIKE '%duplicate_org_name%' THEN 'org_name_duplicate'
        WHEN COALESCE(mh.merge_reason, em.emh_reason) LIKE '%duplicate_resolution%' THEN 'duplicate_resolution'
        WHEN COALESCE(mh.merge_reason, em.emh_reason) = 'auto_match' THEN 'data_engine_auto'
        WHEN COALESCE(mh.merge_reason, em.emh_reason) = 'manual_merge' THEN 'manual'
        ELSE 'other'
    END AS merge_type,

    -- Data engine details if available
    ded.decision_type AS data_engine_decision,
    ded.decision_reason AS data_engine_reason,
    ded.top_candidate_score AS match_score,
    ded.score_breakdown,
    ded.rules_applied,

    -- Source person identifiers
    (
        SELECT array_agg(DISTINCT pi.id_value_norm ORDER BY pi.id_value_norm)
        FROM trapper.person_identifiers pi
        WHERE pi.person_id = mh.target_person_id  -- transferred to target
          AND pi.id_type IN ('email', 'phone')
    ) AS identifiers_now_on_target,

    -- Who performed the merge
    COALESCE(em.merged_by, 'system') AS merged_by,

    -- Source info
    mh.source_data_source,
    ti.data_source AS target_data_source,
    mh.source_created_at,
    ti.created_at AS target_created_at,

    -- Merge metadata (from entity_merge_history)
    em.metadata AS merge_metadata,

    -- Age info
    EXTRACT(EPOCH FROM (NOW() - COALESCE(mh.merged_at, em.emh_merged_at))) / 86400 AS days_since_merge

FROM merge_history mh
LEFT JOIN target_info ti ON ti.person_id = mh.target_person_id
LEFT JOIN entity_merges em ON em.source_entity_id = mh.source_person_id
LEFT JOIN data_engine_decisions ded ON ded.resulting_person_id = mh.target_person_id
    AND ded.incoming_name = mh.source_name
ORDER BY COALESCE(mh.merged_at, em.emh_merged_at) DESC;

COMMENT ON VIEW trapper.v_merge_audit_log IS
'Complete audit log of all person merges with reasoning, scores, and source attribution.
Part of Phase 2 Entity Resolution Architecture (MIG_941).

Staff can use this to:
- Understand why any two people were merged
- Review merge history for a specific person
- Audit automated vs manual merges
- Trace identifiers that moved during merge

Key columns:
- merge_type: Classification (org_name_cleanup, tier4_prevention, data_engine_auto, manual)
- match_score: Confidence score when data engine made the decision
- score_breakdown: JSONB with email_score, phone_score, name_score, address_score
- identifiers_now_on_target: Emails/phones that transferred during merge
- merged_by: Who or what performed the merge';

\echo 'Created v_merge_audit_log'

-- ============================================================================
-- Phase 2: v_tier4_pending_review - Staff dashboard for Tier 4 matches
-- ============================================================================

\echo ''
\echo 'Phase 2: Creating v_tier4_pending_review...'

CREATE OR REPLACE VIEW trapper.v_tier4_pending_review AS
SELECT
    ppd.duplicate_id,
    ppd.person_id AS existing_person_id,
    ppd.potential_match_id,
    ppd.match_type,
    ppd.name_similarity,
    ppd.status,
    ppd.created_at AS detected_at,

    -- Existing person details
    p1.display_name AS existing_name,
    p1.created_at AS existing_created_at,
    (
        SELECT array_agg(DISTINCT pi.id_value_norm ORDER BY pi.id_value_norm)
        FROM trapper.person_identifiers pi
        WHERE pi.person_id = p1.person_id
          AND pi.id_type = 'email'
    ) AS existing_emails,
    (
        SELECT array_agg(DISTINCT pi.id_value_norm ORDER BY pi.id_value_norm)
        FROM trapper.person_identifiers pi
        WHERE pi.person_id = p1.person_id
          AND pi.id_type = 'phone'
    ) AS existing_phones,

    -- New person details (from data engine decision)
    ppd.new_name,
    ppd.new_source_system AS new_source,

    -- Place info (shared address)
    (
        SELECT pl.formatted_address
        FROM trapper.person_place_relationships ppr
        JOIN trapper.places pl ON pl.place_id = ppr.place_id
        WHERE ppr.person_id = p1.person_id
        LIMIT 1
    ) AS shared_address,

    -- Context: How many cats/requests does existing person have?
    (
        SELECT COUNT(DISTINCT pcr.cat_id)
        FROM trapper.person_cat_relationships pcr
        WHERE pcr.person_id = p1.person_id
    ) AS existing_cat_count,
    (
        SELECT COUNT(*)
        FROM trapper.sot_requests r
        WHERE r.requester_person_id = p1.person_id
    ) AS existing_request_count,
    (
        SELECT COUNT(*)
        FROM trapper.sot_appointments a
        WHERE a.person_id = p1.person_id
    ) AS existing_appointment_count,

    -- Data engine decision if available
    ded.decision_id,
    ded.decision_reason,
    ded.incoming_email,
    ded.incoming_phone,
    ded.incoming_address,

    -- Queue age
    EXTRACT(EPOCH FROM (NOW() - ppd.created_at)) / 3600 AS hours_in_queue,

    -- Staff review info
    ppd.resolved_by,
    ppd.resolved_at,
    ppd.resolution_notes

FROM trapper.potential_person_duplicates ppd
LEFT JOIN trapper.sot_people p1 ON p1.person_id = ppd.person_id
LEFT JOIN trapper.data_engine_match_decisions ded
    ON ded.top_candidate_person_id = ppd.person_id
    AND ded.decision_type = 'review_pending'
    AND ded.incoming_name = ppd.new_name
WHERE ppd.status = 'pending'
  AND ppd.match_type IN ('same_name_same_address', 'tier4_same_name_same_address', 'tier4')
ORDER BY ppd.created_at ASC;

COMMENT ON VIEW trapper.v_tier4_pending_review IS
'Staff dashboard for reviewing Tier 4 (same-name-same-address) duplicate candidates.
Part of Phase 2 Entity Resolution Architecture (MIG_941).

These are cases where:
- A new person record was attempted with same name as existing person
- Both are at the same address
- But they have DIFFERENT contact info (phone/email)

Staff should review each case and decide:
1. MERGE: Same person, different phone (update contact info)
2. KEEP SEPARATE: Different people with same name at same address (roommates, family)
3. NEEDS MORE INFO: Investigate further

Key columns:
- existing_name: The person already in the system
- new_name: The name on the incoming record
- shared_address: The address they share
- name_similarity: How similar the names are (0.0 - 1.0)
- hours_in_queue: How long this has been waiting';

\echo 'Created v_tier4_pending_review'

-- ============================================================================
-- Phase 3: v_duplicate_prevention_stats - Daily stats on effectiveness
-- ============================================================================

\echo ''
\echo 'Phase 3: Creating v_duplicate_prevention_stats...'

CREATE OR REPLACE VIEW trapper.v_duplicate_prevention_stats AS
SELECT
    DATE(d.processed_at) AS date,
    d.source_system,

    -- Decision counts
    COUNT(*) FILTER (WHERE d.decision_type = 'new_entity') AS new_entities_created,
    COUNT(*) FILTER (WHERE d.decision_type = 'auto_match') AS auto_matched,
    COUNT(*) FILTER (WHERE d.decision_type = 'review_pending') AS sent_to_review,
    COUNT(*) FILTER (WHERE d.decision_type = 'household_member') AS household_members,
    COUNT(*) FILTER (WHERE d.decision_type = 'rejected') AS rejected,

    -- Tier 4 specific
    COUNT(*) FILTER (WHERE d.decision_reason LIKE '%Tier 4%' OR d.decision_reason LIKE '%tier4%') AS tier4_prevented,

    -- Org detection
    COUNT(*) FILTER (WHERE d.decision_reason LIKE '%Organization%' OR d.decision_reason LIKE '%organization%') AS org_names_rejected,

    -- Quality metrics
    ROUND(AVG(d.top_candidate_score)::NUMERIC, 3) AS avg_match_score,
    ROUND(AVG(d.processing_duration_ms)::NUMERIC, 0) AS avg_processing_ms,

    -- Totals
    COUNT(*) AS total_decisions

FROM trapper.data_engine_match_decisions d
WHERE d.processed_at >= NOW() - INTERVAL '90 days'
GROUP BY DATE(d.processed_at), d.source_system
ORDER BY date DESC, source_system;

COMMENT ON VIEW trapper.v_duplicate_prevention_stats IS
'Daily statistics on duplicate prevention effectiveness.
Part of Phase 2 Entity Resolution Architecture (MIG_941).

Key metrics:
- tier4_prevented: Duplicates caught by same-name-same-address check
- org_names_rejected: Business names that were NOT created as people
- auto_matched: Records matched to existing people automatically
- sent_to_review: Records that need human review

Use this to monitor:
- Is Tier 4 prevention working?
- Are we still creating new duplicates?
- Is org name detection catching business names?';

\echo 'Created v_duplicate_prevention_stats'

-- ============================================================================
-- Phase 4: v_identity_decision_trace - Full trace for any person
-- ============================================================================

\echo ''
\echo 'Phase 4: Creating v_identity_decision_trace...'

CREATE OR REPLACE VIEW trapper.v_identity_decision_trace AS
SELECT
    p.person_id,
    p.display_name,
    p.created_at AS person_created_at,
    p.data_source,

    -- Current status
    CASE
        WHEN p.merged_into_person_id IS NOT NULL THEN 'merged'
        WHEN p.is_system_account THEN 'system_account'
        ELSE 'active'
    END AS current_status,
    p.merged_into_person_id,
    p.merge_reason,
    p.merged_at,

    -- All identifiers
    (
        SELECT jsonb_agg(jsonb_build_object(
            'type', pi.id_type,
            'value', pi.id_value_norm,
            'added_at', pi.created_at
        ) ORDER BY pi.created_at)
        FROM trapper.person_identifiers pi
        WHERE pi.person_id = p.person_id
    ) AS identifiers,

    -- All data engine decisions for this person
    (
        SELECT jsonb_agg(jsonb_build_object(
            'decision_id', d.decision_id,
            'decision_type', d.decision_type,
            'decision_reason', d.decision_reason,
            'incoming_name', d.incoming_name,
            'incoming_email', d.incoming_email,
            'incoming_phone', d.incoming_phone,
            'match_score', d.top_candidate_score,
            'processed_at', d.processed_at
        ) ORDER BY d.processed_at)
        FROM trapper.data_engine_match_decisions d
        WHERE d.resulting_person_id = p.person_id
           OR d.top_candidate_person_id = p.person_id
    ) AS data_engine_history,

    -- Records merged into this person
    (
        SELECT jsonb_agg(jsonb_build_object(
            'source_person_id', sp.person_id,
            'source_name', sp.display_name,
            'merge_reason', sp.merge_reason,
            'merged_at', sp.merged_at
        ) ORDER BY sp.merged_at)
        FROM trapper.sot_people sp
        WHERE sp.merged_into_person_id = p.person_id
    ) AS records_merged_into_this,

    -- Merge history for this person
    (
        SELECT jsonb_agg(jsonb_build_object(
            'merge_reason', emh.merge_reason,
            'merged_by', emh.merged_by,
            'merged_at', emh.merged_at,
            'target_id', emh.target_entity_id,
            'metadata', emh.metadata
        ) ORDER BY emh.merged_at)
        FROM trapper.entity_merge_history emh
        WHERE emh.entity_type = 'person'
          AND (emh.source_entity_id = p.person_id OR emh.target_entity_id = p.person_id)
          AND emh.undone_at IS NULL
    ) AS merge_history,

    -- Relationships count
    (SELECT COUNT(*) FROM trapper.person_cat_relationships pcr WHERE pcr.person_id = p.person_id) AS cat_count,
    (SELECT COUNT(*) FROM trapper.sot_requests r WHERE r.requester_person_id = p.person_id) AS request_count,
    (SELECT COUNT(*) FROM trapper.sot_appointments a WHERE a.person_id = p.person_id) AS appointment_count

FROM trapper.sot_people p
WHERE p.merged_into_person_id IS NULL  -- Only show canonical records
ORDER BY p.created_at DESC;

COMMENT ON VIEW trapper.v_identity_decision_trace IS
'Complete identity trace for any person record.
Part of Phase 2 Entity Resolution Architecture (MIG_941).

Shows for each person:
- All identifiers (emails, phones) and when they were added
- All data engine decisions that touched this person
- All records that were merged into this person
- Complete change history

Use this to answer:
- "Why does this person have two phone numbers?"
- "When was this email added to this person?"
- "Why was Person X merged into Person Y?"
- "What triggered the creation of this person record?"';

\echo 'Created v_identity_decision_trace'

-- ============================================================================
-- Phase 5: Helper function for staff to query merge history
-- ============================================================================

\echo ''
\echo 'Phase 5: Creating query_person_merge_history function...'

CREATE OR REPLACE FUNCTION trapper.query_person_merge_history(
    p_person_id UUID DEFAULT NULL,
    p_name_search TEXT DEFAULT NULL,
    p_days_back INT DEFAULT 30
)
RETURNS TABLE (
    source_person_id UUID,
    source_name TEXT,
    target_person_id UUID,
    target_name TEXT,
    merge_type TEXT,
    merge_reason TEXT,
    merged_at TIMESTAMPTZ,
    merged_by TEXT,
    match_score NUMERIC,
    days_ago NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mal.source_person_id,
        mal.source_name,
        mal.target_person_id,
        mal.target_name,
        mal.merge_type,
        mal.merge_reason,
        mal.merged_at,
        mal.merged_by,
        mal.match_score,
        mal.days_since_merge AS days_ago
    FROM trapper.v_merge_audit_log mal
    WHERE (p_person_id IS NULL OR mal.source_person_id = p_person_id OR mal.target_person_id = p_person_id)
      AND (p_name_search IS NULL OR
           mal.source_name ILIKE '%' || p_name_search || '%' OR
           mal.target_name ILIKE '%' || p_name_search || '%')
      AND mal.merged_at >= NOW() - (p_days_back || ' days')::INTERVAL
    ORDER BY mal.merged_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.query_person_merge_history IS
'Query merge history for staff review.
Part of Phase 2 Entity Resolution Architecture (MIG_941).

Examples:
  -- Find all merges involving "Cristina Campbell"
  SELECT * FROM trapper.query_person_merge_history(p_name_search := ''Cristina'');

  -- Find all merges for a specific person
  SELECT * FROM trapper.query_person_merge_history(p_person_id := ''abc123...'');

  -- Find recent merges (last 7 days)
  SELECT * FROM trapper.query_person_merge_history(p_days_back := 7);';

\echo 'Created query_person_merge_history function'

-- ============================================================================
-- Phase 6: Register views with Tippy catalog
-- ============================================================================

\echo ''
\echo 'Phase 6: Registering views with Tippy catalog...'

INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
VALUES
    ('v_merge_audit_log', 'quality',
     'Complete audit log of all person merges with reasoning, scores, and source attribution',
     ARRAY['source_person_id', 'target_person_id', 'merge_type'],
     ARRAY['merge_type', 'merged_at', 'source_name', 'target_name'],
     ARRAY['Why was this person merged?', 'Show me recent person merges', 'Who merged these records?']),

    ('v_tier4_pending_review', 'quality',
     'Staff dashboard for reviewing Tier 4 (same-name-same-address) duplicate candidates',
     ARRAY['duplicate_id', 'existing_person_id'],
     ARRAY['status', 'match_type', 'existing_name'],
     ARRAY['What duplicates need review?', 'Show pending Tier 4 matches', 'Which same-name-same-address pairs are waiting?']),

    ('v_duplicate_prevention_stats', 'stats',
     'Daily statistics on duplicate prevention effectiveness',
     ARRAY['date', 'source_system'],
     ARRAY['date', 'source_system'],
     ARRAY['How many duplicates did we prevent today?', 'Is Tier 4 prevention working?', 'Show duplicate stats by source']),

    ('v_identity_decision_trace', 'entity',
     'Complete identity trace for any person record showing all decisions, merges, and changes',
     ARRAY['person_id'],
     ARRAY['display_name', 'current_status'],
     ARRAY['Trace identity history for this person', 'Why does this person have two phones?', 'Show the full history of this record'])
ON CONFLICT (view_name) DO UPDATE SET
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    key_columns = EXCLUDED.key_columns,
    filter_columns = EXCLUDED.filter_columns,
    example_questions = EXCLUDED.example_questions,
    updated_at = NOW();

\echo 'Registered 4 views with Tippy catalog'

-- ============================================================================
-- Phase 7: Verification
-- ============================================================================

\echo ''
\echo 'Phase 7: Verification...'

-- Check views exist
SELECT 'Views created:' AS header;
SELECT table_name
FROM information_schema.views
WHERE table_schema = 'trapper'
  AND table_name IN ('v_merge_audit_log', 'v_tier4_pending_review', 'v_duplicate_prevention_stats', 'v_identity_decision_trace');

-- Check function exists
SELECT 'Functions created:' AS header;
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'trapper'
  AND routine_name = 'query_person_merge_history';

-- Quick stats
SELECT 'Quick stats:' AS header;
SELECT
    (SELECT COUNT(*) FROM trapper.v_merge_audit_log) AS total_merges,
    (SELECT COUNT(*) FROM trapper.v_tier4_pending_review) AS pending_tier4_reviews,
    (SELECT COUNT(*) FROM trapper.v_duplicate_prevention_stats) AS days_of_stats;

-- ============================================================================
-- Summary
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_941 Complete!'
\echo '=============================================='
\echo ''
\echo 'Created views:'
\echo '  - v_merge_audit_log: Complete merge history with reasoning'
\echo '  - v_tier4_pending_review: Staff dashboard for Tier 4 matches'
\echo '  - v_duplicate_prevention_stats: Daily prevention effectiveness'
\echo '  - v_identity_decision_trace: Full trace for any person'
\echo ''
\echo 'Created functions:'
\echo '  - query_person_merge_history(person_id, name_search, days_back)'
\echo ''
\echo 'Staff can now:'
\echo '  1. Query v_merge_audit_log to understand why records merged'
\echo '  2. Review v_tier4_pending_review for pending duplicates'
\echo '  3. Monitor v_duplicate_prevention_stats for system health'
\echo '  4. Use v_identity_decision_trace to trace any person''s history'
\echo ''
\echo 'Example queries:'
\echo '  SELECT * FROM trapper.v_tier4_pending_review LIMIT 10;'
\echo '  SELECT * FROM trapper.query_person_merge_history(p_name_search := ''Cristina'');'
\echo '  SELECT * FROM trapper.v_duplicate_prevention_stats WHERE date >= CURRENT_DATE - 7;'
\echo ''
