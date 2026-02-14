-- =====================================================
-- MIG_519: Tippy Unanswerable Questions Tracking
-- =====================================================
-- Tracks questions Tippy cannot answer to identify
-- schema gaps and missing data. Enables pattern analysis
-- to prioritize improvements.
-- =====================================================

\echo '=========================================='
\echo 'MIG_519: Tippy Unanswerable Questions'
\echo '=========================================='

-- -----------------------------------------------------
-- PART 1: Create unanswerable questions table
-- -----------------------------------------------------

\echo ''
\echo '1. Creating unanswerable questions table...'

CREATE TABLE IF NOT EXISTS trapper.tippy_unanswerable_questions (
    question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The question
    question_text TEXT NOT NULL,
    normalized_question TEXT, -- Simplified version for grouping

    -- Context
    conversation_id UUID,
    staff_id UUID,

    -- Why unanswerable
    reason TEXT NOT NULL CHECK (reason IN (
        'no_data',           -- Data doesn't exist in system
        'no_view',           -- No view covers this query pattern
        'permission',        -- User lacks access level
        'ambiguous',         -- Question too unclear to answer
        'out_of_scope',      -- Not within Atlas domain
        'tool_failed',       -- Tool error prevented answer
        'complex_query',     -- Needs query beyond current capabilities
        'other'
    )),
    attempted_tools TEXT[] DEFAULT '{}', -- Tools Tippy tried
    error_details TEXT,
    response_given TEXT, -- What Tippy actually said

    -- Resolution tracking
    resolution_status TEXT DEFAULT 'unresolved' CHECK (resolution_status IN (
        'unresolved',
        'view_created',      -- New view added to handle this
        'data_added',        -- Missing data was populated
        'tool_added',        -- New tool created
        'documentation',     -- Added to Tippy training/prompt
        'out_of_scope',      -- Confirmed not something we support
        'duplicate'          -- Merged with another question
    )),
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    related_view TEXT, -- If view_created, which view

    -- For pattern analysis
    occurrence_count INT DEFAULT 1,
    first_asked_at TIMESTAMPTZ DEFAULT NOW(),
    last_asked_at TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_unanswerable_normalized
    ON trapper.tippy_unanswerable_questions(normalized_question);

CREATE INDEX IF NOT EXISTS idx_unanswerable_reason
    ON trapper.tippy_unanswerable_questions(reason);

CREATE INDEX IF NOT EXISTS idx_unanswerable_unresolved
    ON trapper.tippy_unanswerable_questions(resolution_status)
    WHERE resolution_status = 'unresolved';

CREATE INDEX IF NOT EXISTS idx_unanswerable_staff
    ON trapper.tippy_unanswerable_questions(staff_id);

COMMENT ON TABLE trapper.tippy_unanswerable_questions IS
'Tracks questions Tippy cannot answer, enabling schema gap analysis and prioritized improvements.';

-- -----------------------------------------------------
-- PART 2: Create function to log unanswerable question
-- -----------------------------------------------------

\echo ''
\echo '2. Creating log_unanswerable function...'

CREATE OR REPLACE FUNCTION trapper.tippy_log_unanswerable(
    p_question_text TEXT,
    p_reason TEXT,
    p_attempted_tools TEXT[] DEFAULT '{}',
    p_error_details TEXT DEFAULT NULL,
    p_response_given TEXT DEFAULT NULL,
    p_conversation_id UUID DEFAULT NULL,
    p_staff_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_question_id UUID;
    v_normalized TEXT;
    v_existing_id UUID;
BEGIN
    -- Normalize question for grouping (lowercase, trim, remove punctuation)
    v_normalized := LOWER(TRIM(regexp_replace(p_question_text, '[^\w\s]', '', 'g')));
    v_normalized := regexp_replace(v_normalized, '\s+', ' ', 'g');

    -- Check for similar existing question
    SELECT question_id INTO v_existing_id
    FROM trapper.tippy_unanswerable_questions
    WHERE normalized_question = v_normalized
      AND resolution_status = 'unresolved'
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        -- Increment occurrence count on existing
        UPDATE trapper.tippy_unanswerable_questions
        SET occurrence_count = occurrence_count + 1,
            last_asked_at = NOW(),
            -- Update with latest context
            attempted_tools = CASE
                WHEN p_attempted_tools IS NOT NULL AND array_length(p_attempted_tools, 1) > 0
                THEN p_attempted_tools
                ELSE attempted_tools
            END,
            error_details = COALESCE(p_error_details, error_details)
        WHERE question_id = v_existing_id;

        RETURN v_existing_id;
    END IF;

    -- Create new record
    INSERT INTO trapper.tippy_unanswerable_questions (
        question_text, normalized_question, reason,
        attempted_tools, error_details, response_given,
        conversation_id, staff_id
    ) VALUES (
        p_question_text, v_normalized, p_reason,
        p_attempted_tools, p_error_details, p_response_given,
        p_conversation_id, p_staff_id
    )
    RETURNING question_id INTO v_question_id;

    RETURN v_question_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.tippy_log_unanswerable IS
'Logs an unanswerable question, deduplicating by normalized text.';

-- -----------------------------------------------------
-- PART 3: Create pattern analysis view
-- -----------------------------------------------------

\echo ''
\echo '3. Creating pattern analysis view...'

CREATE OR REPLACE VIEW trapper.v_unanswerable_question_patterns AS
SELECT
    normalized_question,
    reason,
    SUM(occurrence_count) as total_occurrences,
    COUNT(*) as unique_variants,
    MIN(first_asked_at) as first_asked,
    MAX(last_asked_at) as last_asked,
    -- Collect all tools tried across variants
    (SELECT array_agg(DISTINCT tool)
     FROM trapper.tippy_unanswerable_questions q2,
          LATERAL unnest(q2.attempted_tools) as tool
     WHERE q2.normalized_question = q.normalized_question
       AND q2.resolution_status = 'unresolved'
    ) as tools_tried
FROM trapper.tippy_unanswerable_questions q
WHERE resolution_status = 'unresolved'
GROUP BY normalized_question, reason
ORDER BY total_occurrences DESC, last_asked DESC;

COMMENT ON VIEW trapper.v_unanswerable_question_patterns IS
'Aggregated patterns of unanswerable questions, prioritized by frequency.';

-- -----------------------------------------------------
-- PART 4: Create admin review view
-- -----------------------------------------------------

\echo ''
\echo '4. Creating admin review view...'

CREATE OR REPLACE VIEW trapper.v_tippy_gaps_review AS
SELECT
    q.question_id,
    q.question_text,
    q.normalized_question,
    q.reason,
    q.attempted_tools,
    q.error_details,
    q.response_given,
    q.occurrence_count,
    q.first_asked_at,
    q.last_asked_at,
    q.resolution_status,
    q.resolution_notes,
    q.related_view,
    -- Staff info
    s.display_name as asked_by_name,
    -- Resolver info
    rs.display_name as resolved_by_name,
    q.resolved_at,
    -- Priority score (higher = more urgent)
    (q.occurrence_count * 10 +
     CASE q.reason
         WHEN 'no_view' THEN 5
         WHEN 'no_data' THEN 4
         WHEN 'tool_failed' THEN 3
         WHEN 'complex_query' THEN 2
         ELSE 1
     END +
     CASE WHEN q.last_asked_at > NOW() - INTERVAL '7 days' THEN 5 ELSE 0 END
    ) as priority_score
FROM trapper.tippy_unanswerable_questions q
LEFT JOIN trapper.staff s ON s.staff_id = q.staff_id
LEFT JOIN trapper.staff rs ON rs.staff_id = q.resolved_by
ORDER BY
    CASE q.resolution_status WHEN 'unresolved' THEN 0 ELSE 1 END,
    priority_score DESC,
    q.last_asked_at DESC;

COMMENT ON VIEW trapper.v_tippy_gaps_review IS
'Admin view for reviewing and resolving unanswerable question gaps.';

-- -----------------------------------------------------
-- PART 5: Create summary stats view
-- -----------------------------------------------------

\echo ''
\echo '5. Creating summary stats view...'

CREATE OR REPLACE VIEW trapper.v_tippy_gaps_summary AS
SELECT
    reason,
    resolution_status,
    COUNT(*) as question_count,
    SUM(occurrence_count) as total_occurrences,
    MAX(last_asked_at) as most_recent
FROM trapper.tippy_unanswerable_questions
GROUP BY reason, resolution_status
ORDER BY
    resolution_status,
    total_occurrences DESC;

COMMENT ON VIEW trapper.v_tippy_gaps_summary IS
'Summary statistics of unanswerable questions by reason and status.';

-- -----------------------------------------------------
-- PART 6: Verification
-- -----------------------------------------------------

\echo ''
\echo '6. Verification...'

SELECT
    'tippy_unanswerable_questions table' as object,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'tippy_unanswerable_questions'
    ) THEN 'EXISTS' ELSE 'MISSING' END as status;

\echo ''
\echo '=== MIG_519 Complete ==='
\echo ''

SELECT trapper.record_migration(519, 'MIG_519__tippy_unanswerable_questions');
