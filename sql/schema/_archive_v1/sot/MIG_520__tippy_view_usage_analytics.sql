-- =====================================================
-- MIG_520: Tippy View Usage Analytics
-- =====================================================
-- Tracks which views Tippy queries to enable optimization
-- and understand what data staff needs most.
-- =====================================================

\echo '=========================================='
\echo 'MIG_520: Tippy View Usage Analytics'
\echo '=========================================='

-- -----------------------------------------------------
-- PART 1: Create view usage tracking table
-- -----------------------------------------------------

\echo ''
\echo '1. Creating view usage table...'

CREATE TABLE IF NOT EXISTS trapper.tippy_view_usage (
    usage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    view_name TEXT NOT NULL,
    conversation_id UUID,
    staff_id UUID,
    query_filters JSONB DEFAULT '[]',
    rows_returned INT,
    query_time_ms INT,
    was_successful BOOLEAN DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tippy_view_usage_view
    ON trapper.tippy_view_usage(view_name);

CREATE INDEX IF NOT EXISTS idx_tippy_view_usage_created
    ON trapper.tippy_view_usage(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tippy_view_usage_staff
    ON trapper.tippy_view_usage(staff_id);

COMMENT ON TABLE trapper.tippy_view_usage IS
'Tracks which views Tippy queries for optimization and analytics.';

-- -----------------------------------------------------
-- PART 2: Create view popularity analytics view
-- -----------------------------------------------------

\echo ''
\echo '2. Creating popularity analytics view...'

CREATE OR REPLACE VIEW trapper.v_tippy_view_popularity AS
SELECT
    vc.view_name,
    vc.category,
    vc.description,
    COUNT(u.usage_id) as total_queries,
    COUNT(DISTINCT u.conversation_id) as unique_conversations,
    COUNT(DISTINCT u.staff_id) as unique_staff,
    AVG(u.rows_returned)::INT as avg_rows,
    AVG(u.query_time_ms)::INT as avg_time_ms,
    SUM(CASE WHEN u.was_successful THEN 1 ELSE 0 END) as successful_queries,
    SUM(CASE WHEN NOT u.was_successful THEN 1 ELSE 0 END) as failed_queries,
    MAX(u.created_at) as last_used,
    MIN(u.created_at) as first_used
FROM trapper.tippy_view_catalog vc
LEFT JOIN trapper.tippy_view_usage u ON u.view_name = vc.view_name
GROUP BY vc.view_name, vc.category, vc.description
ORDER BY total_queries DESC NULLS LAST;

COMMENT ON VIEW trapper.v_tippy_view_popularity IS
'View usage popularity metrics for optimization insights.';

-- -----------------------------------------------------
-- PART 3: Create usage summary view
-- -----------------------------------------------------

\echo ''
\echo '3. Creating usage summary view...'

CREATE OR REPLACE VIEW trapper.v_tippy_usage_summary AS
SELECT
    vc.category,
    COUNT(DISTINCT vc.view_name) as total_views,
    COUNT(DISTINCT u.view_name) as views_used,
    SUM(CASE WHEN u.usage_id IS NOT NULL THEN 1 ELSE 0 END) as total_queries,
    COUNT(DISTINCT u.staff_id) as unique_staff
FROM trapper.tippy_view_catalog vc
LEFT JOIN trapper.tippy_view_usage u ON u.view_name = vc.view_name
GROUP BY vc.category
ORDER BY total_queries DESC;

COMMENT ON VIEW trapper.v_tippy_usage_summary IS
'Summary of view usage by category.';

-- -----------------------------------------------------
-- PART 4: Create function to log view usage
-- -----------------------------------------------------

\echo ''
\echo '4. Creating log_view_usage function...'

CREATE OR REPLACE FUNCTION trapper.tippy_log_view_usage(
    p_view_name TEXT,
    p_conversation_id UUID DEFAULT NULL,
    p_staff_id UUID DEFAULT NULL,
    p_filters JSONB DEFAULT '[]',
    p_rows_returned INT DEFAULT NULL,
    p_query_time_ms INT DEFAULT NULL,
    p_was_successful BOOLEAN DEFAULT true,
    p_error_message TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_usage_id UUID;
BEGIN
    INSERT INTO trapper.tippy_view_usage (
        view_name, conversation_id, staff_id,
        query_filters, rows_returned, query_time_ms,
        was_successful, error_message
    ) VALUES (
        p_view_name, p_conversation_id, p_staff_id,
        p_filters, p_rows_returned, p_query_time_ms,
        p_was_successful, p_error_message
    )
    RETURNING usage_id INTO v_usage_id;

    RETURN v_usage_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.tippy_log_view_usage IS
'Logs a view query for analytics tracking.';

-- -----------------------------------------------------
-- PART 5: Update tippy_query_view to log usage
-- -----------------------------------------------------

\echo ''
\echo '5. Updating tippy_query_view to log usage...'

-- Drop and recreate with logging
CREATE OR REPLACE FUNCTION trapper.tippy_query_view(
    p_view_name TEXT,
    p_filters JSONB DEFAULT '[]',
    p_limit INT DEFAULT 50,
    p_columns TEXT[] DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_sql TEXT;
    v_result JSONB;
    v_columns TEXT;
    v_where TEXT := '';
    v_filter RECORD;
    v_count INT;
    v_start_time TIMESTAMPTZ;
    v_duration_ms INT;
BEGIN
    v_start_time := clock_timestamp();

    -- Verify view is in catalog and safe for AI
    IF NOT EXISTS (
        SELECT 1 FROM trapper.tippy_view_catalog
        WHERE view_name = p_view_name AND is_safe_for_ai = true
    ) THEN
        -- Log failed attempt
        PERFORM trapper.tippy_log_view_usage(
            p_view_name, NULL, NULL, p_filters, 0, 0, false,
            format('View "%s" not found in catalog or not accessible', p_view_name)
        );

        RETURN jsonb_build_object(
            'success', false,
            'error', format('View "%s" not found in catalog or not accessible', p_view_name)
        );
    END IF;

    -- Build column list
    IF p_columns IS NULL OR array_length(p_columns, 1) IS NULL THEN
        v_columns := '*';
    ELSE
        v_columns := array_to_string(p_columns, ', ');
    END IF;

    -- Build WHERE clause from filters
    IF p_filters IS NOT NULL AND jsonb_array_length(p_filters) > 0 THEN
        FOR v_filter IN SELECT * FROM jsonb_to_recordset(p_filters) AS x(
            column_name TEXT,
            operator TEXT,
            value TEXT
        )
        LOOP
            -- Validate operator
            IF v_filter.operator NOT IN ('=', '!=', '<', '>', '<=', '>=', 'LIKE', 'ILIKE', 'IS NULL', 'IS NOT NULL') THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', format('Invalid operator: %s', v_filter.operator)
                );
            END IF;

            IF v_where = '' THEN
                v_where := ' WHERE ';
            ELSE
                v_where := v_where || ' AND ';
            END IF;

            IF v_filter.operator IN ('IS NULL', 'IS NOT NULL') THEN
                v_where := v_where || quote_ident(v_filter.column_name) || ' ' || v_filter.operator;
            ELSE
                v_where := v_where || quote_ident(v_filter.column_name) || ' ' || v_filter.operator || ' ' || quote_literal(v_filter.value);
            END IF;
        END LOOP;
    END IF;

    -- Build and execute query
    v_sql := format(
        'SELECT jsonb_agg(row_to_json(t)) FROM (SELECT %s FROM trapper.%I %s LIMIT %s) t',
        v_columns,
        p_view_name,
        v_where,
        p_limit
    );

    EXECUTE v_sql INTO v_result;

    -- Get row count
    v_sql := format(
        'SELECT COUNT(*) FROM trapper.%I %s',
        p_view_name,
        v_where
    );
    EXECUTE v_sql INTO v_count;

    -- Calculate duration
    v_duration_ms := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start_time))::INT;

    -- Log successful usage
    PERFORM trapper.tippy_log_view_usage(
        p_view_name, NULL, NULL, p_filters,
        COALESCE(jsonb_array_length(v_result), 0),
        v_duration_ms, true, NULL
    );

    RETURN jsonb_build_object(
        'success', true,
        'view', p_view_name,
        'total_rows', v_count,
        'returned_rows', COALESCE(jsonb_array_length(v_result), 0),
        'data', COALESCE(v_result, '[]'::jsonb)
    );
EXCEPTION WHEN OTHERS THEN
    -- Calculate duration even on error
    v_duration_ms := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start_time))::INT;

    -- Log failed usage
    PERFORM trapper.tippy_log_view_usage(
        p_view_name, NULL, NULL, p_filters, 0, v_duration_ms, false, SQLERRM
    );

    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------
-- PART 6: Verification
-- -----------------------------------------------------

\echo ''
\echo '6. Verification...'

SELECT
    'tippy_view_usage table' as object,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'trapper' AND table_name = 'tippy_view_usage'
    ) THEN 'EXISTS' ELSE 'MISSING' END as status;

\echo ''
\echo '=== MIG_520 Complete ==='
\echo ''

SELECT trapper.record_migration(520, 'MIG_520__tippy_view_usage_analytics');
