-- =====================================================
-- MIG_517: Tippy View Catalog
-- =====================================================
-- Creates a catalog of views that Tippy can query,
-- enabling dynamic schema navigation instead of
-- hardcoded query tools.
-- =====================================================

\echo '=========================================='
\echo 'MIG_517: Tippy View Catalog'
\echo '=========================================='

-- -----------------------------------------------------
-- PART 1: Create view catalog table
-- -----------------------------------------------------

\echo ''
\echo '1. Creating view catalog table...'

CREATE TABLE IF NOT EXISTS trapper.tippy_view_catalog (
    view_name TEXT PRIMARY KEY,
    category TEXT NOT NULL CHECK (category IN (
        'entity',      -- Core entity views (people, cats, places)
        'stats',       -- Statistics and aggregations
        'processing',  -- Data pipeline and jobs
        'quality',     -- Data quality and duplicates
        'ecology',     -- Beacon/population modeling
        'linkage'      -- Relationship views
    )),
    description TEXT NOT NULL,
    key_columns TEXT[] DEFAULT '{}',
    filter_columns TEXT[] DEFAULT '{}',
    example_questions TEXT[] DEFAULT '{}',
    requires_filter BOOLEAN DEFAULT false,
    is_safe_for_ai BOOLEAN DEFAULT true,
    row_estimate INT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_view_catalog_category ON trapper.tippy_view_catalog(category);

COMMENT ON TABLE trapper.tippy_view_catalog IS 'Catalog of views Tippy can query for dynamic schema navigation';

-- -----------------------------------------------------
-- PART 2: Create function to populate catalog
-- -----------------------------------------------------

\echo ''
\echo '2. Creating catalog population function...'

CREATE OR REPLACE FUNCTION trapper.populate_tippy_view_catalog()
RETURNS JSONB AS $$
DECLARE
    v_added INT := 0;
    v_updated INT := 0;
BEGIN
    -- Entity views
    INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
    VALUES
        ('v_canonical_people', 'entity', 'All active people (not merged)',
         ARRAY['person_id', 'display_name', 'email', 'phone'],
         ARRAY['display_name', 'email', 'phone'],
         ARRAY['Who is John Smith?', 'Find person by email']),
        ('v_canonical_cats', 'entity', 'All active cats (not merged)',
         ARRAY['cat_id', 'display_name', 'microchip', 'altered_status'],
         ARRAY['display_name', 'microchip'],
         ARRAY['Find cat by microchip', 'Search for cat named Whiskers']),
        ('v_canonical_places', 'entity', 'All active places (not merged)',
         ARRAY['place_id', 'display_address', 'city', 'zip'],
         ARRAY['display_address', 'city', 'zip'],
         ARRAY['Find place at 123 Oak St', 'Places in Petaluma']),
        ('v_person_detail', 'entity', 'Full person profile with roles and contact info',
         ARRAY['person_id', 'display_name', 'roles', 'request_count'],
         ARRAY['person_id', 'display_name'],
         ARRAY['Tell me about this person', 'What is their history?']),
        ('v_cat_detail', 'entity', 'Full cat profile with medical history',
         ARRAY['cat_id', 'display_name', 'microchip', 'procedures', 'last_seen'],
         ARRAY['cat_id', 'microchip', 'display_name'],
         ARRAY['Full history of this cat', 'Medical records for microchip X']),
        ('v_place_detail', 'entity', 'Full place details with colony and request data',
         ARRAY['place_id', 'display_address', 'colony_estimate', 'request_count'],
         ARRAY['place_id', 'display_address'],
         ARRAY['Everything about this address', 'Colony status at 456 Main']),
        ('v_search_sot_unified', 'entity', 'Unified search across all entities',
         ARRAY['entity_type', 'entity_id', 'display_name', 'search_text'],
         ARRAY['search_text'],
         ARRAY['Search for anything matching "Garcia"'])
    ON CONFLICT (view_name) DO UPDATE SET
        description = EXCLUDED.description,
        key_columns = EXCLUDED.key_columns,
        filter_columns = EXCLUDED.filter_columns,
        example_questions = EXCLUDED.example_questions,
        updated_at = NOW();

    GET DIAGNOSTICS v_added = ROW_COUNT;

    -- Stats views
    INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
    VALUES
        ('v_request_alteration_stats', 'stats', 'Per-request cat attribution with rolling windows',
         ARRAY['request_id', 'cats_verified', 'cats_claimed', 'attribution_window'],
         ARRAY['request_id', 'place_id'],
         ARRAY['How many cats for request X?', 'Attribution for this request']),
        ('v_trapper_full_stats', 'stats', 'Comprehensive trapper metrics (clinic, assignments, catches)',
         ARRAY['person_id', 'display_name', 'total_cats', 'clinic_days', 'active_assignments'],
         ARRAY['person_id', 'display_name'],
         ARRAY['Trapper stats for Ben', 'How many cats has this trapper done?']),
        ('v_place_alteration_history', 'stats', 'TNR progress over time by place',
         ARRAY['place_id', 'year', 'month', 'cats_altered'],
         ARRAY['place_id'],
         ARRAY['TNR history at this address', 'Progress over time']),
        ('v_place_ecology_stats', 'stats', 'Colony estimation with Chapman mark-resight',
         ARRAY['place_id', 'a_known', 'n_recent_max', 'alteration_rate', 'population_estimate'],
         ARRAY['place_id', 'city'],
         ARRAY['Population estimate for this colony', 'Alteration rate at address']),
        ('v_ffr_impact_summary', 'stats', 'Overall FFR impact metrics',
         ARRAY['total_cats', 'total_requests', 'completion_rate'],
         ARRAY[]::TEXT[],
         ARRAY['Overall impact', 'How many cats has FFSC helped?']),
        ('v_clinic_day_comparison', 'stats', 'Clinic day performance metrics',
         ARRAY['clinic_date', 'total_appointments', 'total_cats', 'avg_per_slot'],
         ARRAY['clinic_date'],
         ARRAY['How was last clinic?', 'Busiest clinic days']),
        ('v_seasonal_dashboard', 'stats', 'Seasonal trends and kitten surge prediction',
         ARRAY['season', 'births', 'kittens', 'surge_risk'],
         ARRAY[]::TEXT[],
         ARRAY['Kitten season predictions', 'Seasonal patterns'])
    ON CONFLICT (view_name) DO UPDATE SET
        description = EXCLUDED.description,
        key_columns = EXCLUDED.key_columns,
        filter_columns = EXCLUDED.filter_columns,
        example_questions = EXCLUDED.example_questions,
        updated_at = NOW();

    -- Processing views
    INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
    VALUES
        ('v_processing_dashboard', 'processing', 'Job queue status by source system',
         ARRAY['source_system', 'source_table', 'queued', 'processing', 'completed', 'failed'],
         ARRAY['source_system', 'source_table'],
         ARRAY['Processing queue status', 'Are there stuck jobs?']),
        ('v_intake_triage_queue', 'processing', 'Incoming intake submissions to process',
         ARRAY['submission_id', 'submitted_at', 'caller_name', 'address', 'status'],
         ARRAY['status'],
         ARRAY['Pending intake forms', 'What needs triaging?']),
        ('v_external_import_stats', 'processing', 'External data source sync statistics',
         ARRAY['source_system', 'last_sync', 'records_synced', 'status'],
         ARRAY['source_system'],
         ARRAY['Airtable sync status', 'When was last import?'])
    ON CONFLICT (view_name) DO UPDATE SET
        description = EXCLUDED.description,
        key_columns = EXCLUDED.key_columns,
        filter_columns = EXCLUDED.filter_columns,
        example_questions = EXCLUDED.example_questions,
        updated_at = NOW();

    -- Quality views
    INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
    VALUES
        ('v_data_quality_dashboard', 'quality', 'Main data quality monitoring dashboard',
         ARRAY['metric', 'value', 'threshold', 'status'],
         ARRAY[]::TEXT[],
         ARRAY['Data quality status', 'Any data issues?']),
        ('v_data_quality_summary', 'quality', 'Executive summary of quality metrics',
         ARRAY['category', 'issues_count', 'severity'],
         ARRAY['category', 'severity'],
         ARRAY['Quality summary', 'High severity issues']),
        ('v_duplicate_merge_candidates', 'quality', 'People/places needing merge review',
         ARRAY['entity_type', 'entity_a', 'entity_b', 'match_score'],
         ARRAY['entity_type'],
         ARRAY['Pending duplicate reviews', 'People to merge']),
        ('v_data_engine_review_queue', 'quality', 'Identity resolution decisions pending review',
         ARRAY['decision_id', 'source_email', 'source_phone', 'matched_person', 'score'],
         ARRAY['status'],
         ARRAY['Identity matches to review', 'Pending person matches']),
        ('v_scas_data_quality', 'quality', 'SCAS-specific data quality issues',
         ARRAY['issue_id', 'issue_type', 'scas_animal_id', 'description'],
         ARRAY['issue_type', 'status'],
         ARRAY['SCAS data issues', 'Missing microchips for SCAS cats'])
    ON CONFLICT (view_name) DO UPDATE SET
        description = EXCLUDED.description,
        key_columns = EXCLUDED.key_columns,
        filter_columns = EXCLUDED.filter_columns,
        example_questions = EXCLUDED.example_questions,
        updated_at = NOW();

    -- Ecology views
    INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
    VALUES
        ('v_beacon_summary', 'ecology', 'Overall Beacon statistics',
         ARRAY['total_places', 'total_cats', 'avg_alteration_rate'],
         ARRAY[]::TEXT[],
         ARRAY['Beacon overview', 'County-wide stats']),
        ('v_beacon_cluster_summary', 'ecology', 'Geographic cluster statistics',
         ARRAY['cluster_id', 'place_count', 'total_cats', 'center_lat', 'center_lng'],
         ARRAY['cluster_id'],
         ARRAY['Cluster details', 'Which areas have most activity?']),
        ('v_site_aggregate_stats', 'ecology', 'Multi-parcel site deduplication',
         ARRAY['site_id', 'places_count', 'total_cats', 'deduped_cats'],
         ARRAY['site_id'],
         ARRAY['Multi-property site stats', 'Deduplicated colony count']),
        ('v_place_colony_status', 'ecology', 'Colony size estimates with confidence',
         ARRAY['place_id', 'total_cats', 'estimate_confidence', 'sources'],
         ARRAY['place_id', 'city'],
         ARRAY['Colony estimate for address', 'How confident is estimate?']),
        ('v_kitten_surge_prediction', 'ecology', 'Projected seasonal kitten intake',
         ARRAY['predicted_month', 'expected_kittens', 'confidence'],
         ARRAY[]::TEXT[],
         ARRAY['Kitten season forecast', 'How many kittens expected?'])
    ON CONFLICT (view_name) DO UPDATE SET
        description = EXCLUDED.description,
        key_columns = EXCLUDED.key_columns,
        filter_columns = EXCLUDED.filter_columns,
        example_questions = EXCLUDED.example_questions,
        updated_at = NOW();

    -- Linkage views
    INSERT INTO trapper.tippy_view_catalog (view_name, category, description, key_columns, filter_columns, example_questions)
    VALUES
        ('v_request_current_trappers', 'linkage', 'Active trapper assignments',
         ARRAY['request_id', 'trapper_id', 'trapper_name', 'assigned_at'],
         ARRAY['request_id', 'trapper_id'],
         ARRAY['Who is assigned to request?', 'Trappers for this request']),
        ('v_person_cat_history', 'linkage', 'Person-cat relationships (foster, adopter, caretaker)',
         ARRAY['person_id', 'cat_id', 'relationship_type', 'start_date', 'end_date'],
         ARRAY['person_id', 'relationship_type'],
         ARRAY['Cats this person has fostered', 'Foster history']),
        ('v_place_context_summary', 'linkage', 'Place context tags (colony_site, foster_home, etc.)',
         ARRAY['place_id', 'contexts', 'context_count'],
         ARRAY['place_id'],
         ARRAY['What type of place is this?', 'Foster homes near me']),
        ('v_place_active_contexts', 'linkage', 'Currently active place contexts',
         ARRAY['place_id', 'context_type', 'start_date', 'evidence'],
         ARRAY['context_type', 'place_id'],
         ARRAY['All colony sites', 'Active foster homes'])
    ON CONFLICT (view_name) DO UPDATE SET
        description = EXCLUDED.description,
        key_columns = EXCLUDED.key_columns,
        filter_columns = EXCLUDED.filter_columns,
        example_questions = EXCLUDED.example_questions,
        updated_at = NOW();

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    RETURN jsonb_build_object(
        'views_added', v_added,
        'views_updated', v_updated,
        'total_views', (SELECT COUNT(*) FROM trapper.tippy_view_catalog)
    );
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------
-- PART 3: Create function for Tippy to discover views
-- -----------------------------------------------------

\echo ''
\echo '3. Creating schema discovery function...'

CREATE OR REPLACE FUNCTION trapper.tippy_discover_schema(
    p_category TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
    view_name TEXT,
    category TEXT,
    description TEXT,
    key_columns TEXT[],
    filter_columns TEXT[],
    example_questions TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.view_name,
        c.category,
        c.description,
        c.key_columns,
        c.filter_columns,
        c.example_questions
    FROM trapper.tippy_view_catalog c
    WHERE c.is_safe_for_ai = true
      AND (p_category IS NULL OR c.category = p_category)
      AND (p_search IS NULL OR
           c.description ILIKE '%' || p_search || '%' OR
           c.view_name ILIKE '%' || p_search || '%' OR
           EXISTS (SELECT 1 FROM unnest(c.example_questions) q WHERE q ILIKE '%' || p_search || '%'))
    ORDER BY c.category, c.view_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION trapper.tippy_discover_schema IS
'Allows Tippy to discover available views by category or search term';

-- -----------------------------------------------------
-- PART 4: Create safe query execution function
-- -----------------------------------------------------

\echo ''
\echo '4. Creating safe query execution function...'

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
BEGIN
    -- Verify view is in catalog and safe for AI
    IF NOT EXISTS (
        SELECT 1 FROM trapper.tippy_view_catalog
        WHERE view_name = p_view_name AND is_safe_for_ai = true
    ) THEN
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

    RETURN jsonb_build_object(
        'success', true,
        'view', p_view_name,
        'total_rows', v_count,
        'returned_rows', COALESCE(jsonb_array_length(v_result), 0),
        'data', COALESCE(v_result, '[]'::jsonb)
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION trapper.tippy_query_view IS
'Safely execute queries against cataloged views with filters and limits';

-- -----------------------------------------------------
-- PART 5: Populate the catalog
-- -----------------------------------------------------

\echo ''
\echo '5. Populating view catalog...'

SELECT trapper.populate_tippy_view_catalog();

-- -----------------------------------------------------
-- PART 6: Verification
-- -----------------------------------------------------

\echo ''
\echo '6. Verification...'

SELECT
    category,
    COUNT(*) as view_count
FROM trapper.tippy_view_catalog
GROUP BY category
ORDER BY category;

\echo ''
\echo 'Example: Discovering stats views...'

SELECT view_name, description
FROM trapper.tippy_discover_schema('stats')
LIMIT 5;

\echo ''
\echo '=== MIG_517 Complete ==='
\echo ''

SELECT trapper.record_migration(517, 'MIG_517__tippy_view_catalog');
