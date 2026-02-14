\echo '=== MIG_487: Tippy Data Quality Functions ==='
\echo 'Creates SQL functions for Tippy AI assistant data quality tools'
\echo ''

-- ============================================================================
-- PURPOSE
-- Create functions that power new Tippy tools for:
-- 1. Checking entity data quality
-- 2. Finding potential duplicates
-- 3. Viewing merge history
-- 4. Tracing data lineage
-- ============================================================================

\echo 'Step 1: Creating check_entity_quality function...'

CREATE OR REPLACE FUNCTION trapper.check_entity_quality(
    p_entity_type TEXT,
    p_entity_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
    v_completeness NUMERIC;
    v_missing TEXT[];
    v_issues TEXT[];
    v_sources TEXT[];
BEGIN
    IF p_entity_type = 'person' THEN
        -- Check person quality
        SELECT
            jsonb_build_object(
                'entity_type', 'person',
                'entity_id', p.person_id,
                'display_name', p.display_name,
                'completeness_pct', (
                    (CASE WHEN p.display_name IS NOT NULL THEN 20 ELSE 0 END) +
                    (CASE WHEN p.primary_email IS NOT NULL THEN 30 ELSE 0 END) +
                    (CASE WHEN p.primary_phone IS NOT NULL THEN 25 ELSE 0 END) +
                    (CASE WHEN EXISTS (
                        SELECT 1 FROM trapper.person_place_relationships ppr
                        WHERE ppr.person_id = p.person_id
                    ) THEN 15 ELSE 0 END) +
                    (CASE WHEN EXISTS (
                        SELECT 1 FROM trapper.person_roles pr
                        WHERE pr.person_id = p.person_id
                    ) THEN 10 ELSE 0 END)
                ),
                'missing_fields', (
                    SELECT array_agg(field) FROM (
                        SELECT 'email' as field WHERE p.primary_email IS NULL
                        UNION ALL SELECT 'phone' WHERE p.primary_phone IS NULL
                        UNION ALL SELECT 'address' WHERE NOT EXISTS (
                            SELECT 1 FROM trapper.person_place_relationships ppr
                            WHERE ppr.person_id = p.person_id
                        )
                    ) x
                ),
                'issues', (
                    SELECT array_agg(issue) FROM (
                        SELECT 'junk_name' as issue
                        WHERE trapper.is_junk_person_name(p.display_name)
                        UNION ALL SELECT 'no_identifiers'
                        WHERE NOT EXISTS (
                            SELECT 1 FROM trapper.person_identifiers pi
                            WHERE pi.person_id = p.person_id
                        )
                        UNION ALL SELECT 'merged'
                        WHERE p.merged_into_person_id IS NOT NULL
                    ) x
                ),
                'sources', (
                    SELECT array_agg(DISTINCT source_system)
                    FROM trapper.person_identifiers
                    WHERE person_id = p.person_id
                ),
                'identifier_count', (
                    SELECT COUNT(*) FROM trapper.person_identifiers
                    WHERE person_id = p.person_id
                ),
                'role_count', (
                    SELECT COUNT(*) FROM trapper.person_roles
                    WHERE person_id = p.person_id
                ),
                'is_merged', p.merged_into_person_id IS NOT NULL,
                'created_at', p.created_at,
                'updated_at', p.updated_at
            ) INTO v_result
        FROM trapper.sot_people p
        WHERE p.person_id = p_entity_id;

    ELSIF p_entity_type = 'cat' THEN
        -- Check cat quality
        SELECT
            jsonb_build_object(
                'entity_type', 'cat',
                'entity_id', c.cat_id,
                'display_name', c.display_name,
                'completeness_pct', (
                    (CASE WHEN c.display_name IS NOT NULL AND c.display_name != 'Unknown' THEN 15 ELSE 0 END) +
                    (CASE WHEN c.microchip IS NOT NULL THEN 35 ELSE 0 END) +
                    (CASE WHEN c.sex IS NOT NULL THEN 15 ELSE 0 END) +
                    (CASE WHEN c.altered_status IS NOT NULL THEN 20 ELSE 0 END) +
                    (CASE WHEN EXISTS (
                        SELECT 1 FROM trapper.cat_place_relationships cpr
                        WHERE cpr.cat_id = c.cat_id
                    ) THEN 15 ELSE 0 END)
                ),
                'missing_fields', (
                    SELECT array_agg(field) FROM (
                        SELECT 'name' as field WHERE c.display_name IS NULL OR c.display_name = 'Unknown'
                        UNION ALL SELECT 'microchip' WHERE c.microchip IS NULL
                        UNION ALL SELECT 'sex' WHERE c.sex IS NULL
                        UNION ALL SELECT 'altered_status' WHERE c.altered_status IS NULL
                        UNION ALL SELECT 'location' WHERE NOT EXISTS (
                            SELECT 1 FROM trapper.cat_place_relationships cpr
                            WHERE cpr.cat_id = c.cat_id
                        )
                    ) x
                ),
                'issues', (
                    SELECT array_agg(issue) FROM (
                        SELECT 'junk_name' as issue
                        WHERE trapper.is_junk_cat_name(c.display_name)
                        UNION ALL SELECT 'junk_microchip'
                        WHERE trapper.is_junk_microchip(c.microchip)
                        UNION ALL SELECT 'merged'
                        WHERE c.merged_into_cat_id IS NOT NULL
                        UNION ALL SELECT 'no_appointments'
                        WHERE NOT EXISTS (
                            SELECT 1 FROM trapper.sot_appointments a
                            WHERE a.cat_id = c.cat_id
                        )
                    ) x
                ),
                'sources', (
                    SELECT array_agg(DISTINCT source_system)
                    FROM trapper.cat_identifiers
                    WHERE cat_id = c.cat_id
                ),
                'microchip', c.microchip,
                'sex', c.sex,
                'altered_status', c.altered_status,
                'is_merged', c.merged_into_cat_id IS NOT NULL,
                'created_at', c.created_at,
                'updated_at', c.updated_at
            ) INTO v_result
        FROM trapper.sot_cats c
        WHERE c.cat_id = p_entity_id;

    ELSIF p_entity_type = 'place' THEN
        -- Check place quality
        SELECT
            jsonb_build_object(
                'entity_type', 'place',
                'entity_id', pl.place_id,
                'formatted_address', pl.formatted_address,
                'completeness_pct', (
                    (CASE WHEN pl.formatted_address IS NOT NULL THEN 25 ELSE 0 END) +
                    (CASE WHEN pl.location IS NOT NULL THEN 30 ELSE 0 END) +
                    (CASE WHEN pl.google_place_id IS NOT NULL THEN 25 ELSE 0 END) +
                    (CASE WHEN pl.display_name IS NOT NULL THEN 10 ELSE 0 END) +
                    (CASE WHEN EXISTS (
                        SELECT 1 FROM trapper.cat_place_relationships cpr
                        WHERE cpr.place_id = pl.place_id
                    ) THEN 10 ELSE 0 END)
                ),
                'missing_fields', (
                    SELECT array_agg(field) FROM (
                        SELECT 'coordinates' as field WHERE pl.location IS NULL
                        UNION ALL SELECT 'google_place_id' WHERE pl.google_place_id IS NULL
                        UNION ALL SELECT 'normalized_address' WHERE pl.normalized_address IS NULL
                    ) x
                ),
                'issues', (
                    SELECT array_agg(issue) FROM (
                        SELECT 'junk_address' as issue
                        WHERE trapper.is_junk_address(pl.formatted_address)
                        UNION ALL SELECT 'merged'
                        WHERE pl.merged_into_place_id IS NOT NULL
                        UNION ALL SELECT 'not_geocoded'
                        WHERE pl.location IS NULL
                    ) x
                ),
                'has_coordinates', pl.location IS NOT NULL,
                'is_google_verified', COALESCE(pl.is_google_verified, FALSE),
                'google_place_id', pl.google_place_id,
                'is_merged', pl.merged_into_place_id IS NOT NULL,
                'cat_count', (
                    SELECT COUNT(DISTINCT cat_id) FROM trapper.cat_place_relationships
                    WHERE place_id = pl.place_id
                ),
                'created_at', pl.created_at,
                'updated_at', pl.updated_at
            ) INTO v_result
        FROM trapper.places pl
        WHERE pl.place_id = p_entity_id;

    ELSE
        RETURN jsonb_build_object('error', 'Invalid entity_type. Must be person, cat, or place.');
    END IF;

    IF v_result IS NULL THEN
        RETURN jsonb_build_object('error', 'Entity not found');
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.check_entity_quality IS
'Check data quality for a person, cat, or place.
Returns completeness percentage, missing fields, issues, and sources.';

\echo 'Created check_entity_quality function'

-- ============================================================================
-- Step 2: Find potential duplicates function
-- ============================================================================

\echo ''
\echo 'Step 2: Creating find_potential_duplicates function...'

CREATE OR REPLACE FUNCTION trapper.find_potential_duplicates(
    p_entity_type TEXT,
    p_identifier TEXT
)
RETURNS TABLE (
    entity_id UUID,
    display_label TEXT,
    similarity_score NUMERIC,
    match_reason TEXT
) AS $$
BEGIN
    IF p_entity_type = 'person' THEN
        RETURN QUERY
        WITH search_term AS (
            SELECT
                LOWER(TRIM(p_identifier)) as term,
                trapper.norm_phone_us(p_identifier) as phone_norm
        )
        SELECT
            sp.person_id as entity_id,
            sp.display_name as display_label,
            CASE
                WHEN pi.id_type = 'email' AND pi.id_value_norm = (SELECT term FROM search_term) THEN 1.0
                WHEN pi.id_type = 'phone' AND pi.id_value_norm = (SELECT phone_norm FROM search_term) THEN 0.95
                WHEN LOWER(sp.display_name) = (SELECT term FROM search_term) THEN 0.85
                WHEN sp.display_name ILIKE '%' || p_identifier || '%' THEN 0.70
                ELSE 0.50
            END as similarity_score,
            CASE
                WHEN pi.id_type = 'email' AND pi.id_value_norm = (SELECT term FROM search_term) THEN 'exact_email'
                WHEN pi.id_type = 'phone' AND pi.id_value_norm = (SELECT phone_norm FROM search_term) THEN 'exact_phone'
                WHEN LOWER(sp.display_name) = (SELECT term FROM search_term) THEN 'exact_name'
                ELSE 'partial_match'
            END as match_reason
        FROM trapper.sot_people sp
        LEFT JOIN trapper.person_identifiers pi ON pi.person_id = sp.person_id
        WHERE sp.merged_into_person_id IS NULL
          AND (
              (pi.id_type = 'email' AND pi.id_value_norm = (SELECT term FROM search_term))
              OR (pi.id_type = 'phone' AND pi.id_value_norm = (SELECT phone_norm FROM search_term))
              OR sp.display_name ILIKE '%' || p_identifier || '%'
          )
        ORDER BY similarity_score DESC
        LIMIT 10;

    ELSIF p_entity_type = 'cat' THEN
        RETURN QUERY
        SELECT
            sc.cat_id as entity_id,
            sc.display_name as display_label,
            CASE
                WHEN ci.id_type = 'microchip' AND ci.id_value = UPPER(TRIM(p_identifier)) THEN 1.0
                WHEN LOWER(sc.display_name) = LOWER(TRIM(p_identifier)) THEN 0.85
                WHEN sc.display_name ILIKE '%' || p_identifier || '%' THEN 0.70
                ELSE 0.50
            END as similarity_score,
            CASE
                WHEN ci.id_type = 'microchip' AND ci.id_value = UPPER(TRIM(p_identifier)) THEN 'exact_microchip'
                WHEN LOWER(sc.display_name) = LOWER(TRIM(p_identifier)) THEN 'exact_name'
                ELSE 'partial_match'
            END as match_reason
        FROM trapper.sot_cats sc
        LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = sc.cat_id
        WHERE sc.merged_into_cat_id IS NULL
          AND (
              (ci.id_type = 'microchip' AND ci.id_value = UPPER(TRIM(p_identifier)))
              OR sc.display_name ILIKE '%' || p_identifier || '%'
          )
        ORDER BY similarity_score DESC
        LIMIT 10;

    ELSIF p_entity_type = 'place' THEN
        RETURN QUERY
        SELECT
            pl.place_id as entity_id,
            pl.formatted_address as display_label,
            CASE
                WHEN pl.normalized_address = trapper.normalize_address(p_identifier) THEN 1.0
                WHEN pl.google_place_id = p_identifier THEN 1.0
                WHEN pl.formatted_address ILIKE '%' || p_identifier || '%' THEN 0.70
                ELSE 0.50
            END as similarity_score,
            CASE
                WHEN pl.normalized_address = trapper.normalize_address(p_identifier) THEN 'normalized_address'
                WHEN pl.google_place_id = p_identifier THEN 'google_place_id'
                ELSE 'partial_match'
            END as match_reason
        FROM trapper.places pl
        WHERE pl.merged_into_place_id IS NULL
          AND (
              pl.normalized_address = trapper.normalize_address(p_identifier)
              OR pl.google_place_id = p_identifier
              OR pl.formatted_address ILIKE '%' || p_identifier || '%'
          )
        ORDER BY similarity_score DESC
        LIMIT 10;

    ELSE
        -- Return empty for invalid entity type
        RETURN;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.find_potential_duplicates IS
'Find potential duplicates for a given identifier.
Used by Tippy to help staff check before creating new records.';

\echo 'Created find_potential_duplicates function'

-- ============================================================================
-- Step 3: Query merge history function
-- ============================================================================

\echo ''
\echo 'Step 3: Creating query_merge_history function...'

CREATE OR REPLACE FUNCTION trapper.query_merge_history(
    p_entity_type TEXT,
    p_entity_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_entity_type = 'person' THEN
        SELECT jsonb_build_object(
            'entity_type', 'person',
            'entity_id', p_entity_id,
            'is_merged', sp.merged_into_person_id IS NOT NULL,
            'merged_into', sp.merged_into_person_id,
            'merge_reason', sp.merge_reason,
            'merged_at', sp.merged_at,
            'merged_from', (
                SELECT jsonb_agg(jsonb_build_object(
                    'person_id', m.person_id,
                    'display_name', m.display_name,
                    'merge_reason', m.merge_reason,
                    'merged_at', m.merged_at
                ))
                FROM trapper.sot_people m
                WHERE m.merged_into_person_id = p_entity_id
            ),
            'current_entity', (
                SELECT jsonb_build_object(
                    'person_id', c.person_id,
                    'display_name', c.display_name
                )
                FROM trapper.sot_people c
                WHERE c.person_id = COALESCE(sp.merged_into_person_id, p_entity_id)
                  AND c.merged_into_person_id IS NULL
            )
        ) INTO v_result
        FROM trapper.sot_people sp
        WHERE sp.person_id = p_entity_id;

    ELSIF p_entity_type = 'cat' THEN
        SELECT jsonb_build_object(
            'entity_type', 'cat',
            'entity_id', p_entity_id,
            'is_merged', sc.merged_into_cat_id IS NOT NULL,
            'merged_into', sc.merged_into_cat_id,
            'merge_reason', sc.merge_reason,
            'merged_at', sc.merged_at,
            'merged_from', (
                SELECT jsonb_agg(jsonb_build_object(
                    'cat_id', m.cat_id,
                    'display_name', m.display_name,
                    'merge_reason', m.merge_reason,
                    'merged_at', m.merged_at
                ))
                FROM trapper.sot_cats m
                WHERE m.merged_into_cat_id = p_entity_id
            )
        ) INTO v_result
        FROM trapper.sot_cats sc
        WHERE sc.cat_id = p_entity_id;

    ELSIF p_entity_type = 'place' THEN
        SELECT jsonb_build_object(
            'entity_type', 'place',
            'entity_id', p_entity_id,
            'is_merged', pl.merged_into_place_id IS NOT NULL,
            'merged_into', pl.merged_into_place_id,
            'merge_reason', pl.merge_reason,
            'merged_at', pl.merged_at,
            'merged_from', (
                SELECT jsonb_agg(jsonb_build_object(
                    'place_id', m.place_id,
                    'formatted_address', m.formatted_address,
                    'merge_reason', m.merge_reason,
                    'merged_at', m.merged_at
                ))
                FROM trapper.places m
                WHERE m.merged_into_place_id = p_entity_id
            )
        ) INTO v_result
        FROM trapper.places pl
        WHERE pl.place_id = p_entity_id;

    ELSE
        RETURN jsonb_build_object('error', 'Invalid entity_type');
    END IF;

    IF v_result IS NULL THEN
        RETURN jsonb_build_object('error', 'Entity not found');
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.query_merge_history IS
'Query merge history for an entity - what was merged into it and what it merged into.';

\echo 'Created query_merge_history function'

-- ============================================================================
-- Step 4: Query data lineage function
-- ============================================================================

\echo ''
\echo 'Step 4: Creating query_data_lineage function...'

CREATE OR REPLACE FUNCTION trapper.query_data_lineage(
    p_entity_type TEXT,
    p_entity_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_entity_type = 'person' THEN
        SELECT jsonb_build_object(
            'entity_type', 'person',
            'entity_id', p_entity_id,
            'display_name', sp.display_name,
            'source_system', sp.source_system,
            'created_at', sp.created_at,
            'identifiers', (
                SELECT jsonb_agg(jsonb_build_object(
                    'id_type', pi.id_type,
                    'id_value', pi.id_value_norm,
                    'source_system', pi.source_system,
                    'confidence', pi.confidence,
                    'created_at', pi.created_at
                ) ORDER BY pi.created_at)
                FROM trapper.person_identifiers pi
                WHERE pi.person_id = p_entity_id
            ),
            'staged_records', (
                SELECT jsonb_agg(sub.rec)
                FROM (
                    SELECT jsonb_build_object(
                        'staged_record_id', sr.staged_record_id,
                        'source_system', sr.source_system,
                        'source_table', sr.source_table,
                        'created_at', sr.created_at,
                        'processing_status', sr.processing_status
                    ) as rec
                    FROM trapper.staged_records sr
                    JOIN trapper.person_identifiers pi ON pi.staged_record_id = sr.staged_record_id
                    WHERE pi.person_id = p_entity_id
                    ORDER BY sr.created_at DESC
                    LIMIT 10
                ) sub
            ),
            'data_sources', (
                SELECT array_agg(DISTINCT source_system)
                FROM trapper.person_identifiers
                WHERE person_id = p_entity_id
            )
        ) INTO v_result
        FROM trapper.sot_people sp
        WHERE sp.person_id = p_entity_id;

    ELSIF p_entity_type = 'cat' THEN
        SELECT jsonb_build_object(
            'entity_type', 'cat',
            'entity_id', p_entity_id,
            'display_name', sc.display_name,
            'source_system', sc.source_system,
            'created_at', sc.created_at,
            'identifiers', (
                SELECT jsonb_agg(jsonb_build_object(
                    'id_type', ci.id_type,
                    'id_value', ci.id_value,
                    'source_system', ci.source_system,
                    'created_at', ci.created_at
                ) ORDER BY ci.created_at)
                FROM trapper.cat_identifiers ci
                WHERE ci.cat_id = p_entity_id
            ),
            'appointments', (
                SELECT jsonb_agg(sub.appt)
                FROM (
                    SELECT jsonb_build_object(
                        'appointment_id', a.appointment_id,
                        'appointment_date', a.appointment_date,
                        'service_type', a.service_type,
                        'is_spay', a.is_spay,
                        'is_neuter', a.is_neuter,
                        'source_system', a.source_system
                    ) as appt
                    FROM trapper.sot_appointments a
                    WHERE a.cat_id = p_entity_id
                    ORDER BY a.appointment_date DESC
                    LIMIT 5
                ) sub
            ),
            'data_sources', (
                SELECT array_agg(DISTINCT source_system)
                FROM trapper.cat_identifiers
                WHERE cat_id = p_entity_id
            )
        ) INTO v_result
        FROM trapper.sot_cats sc
        WHERE sc.cat_id = p_entity_id;

    ELSIF p_entity_type = 'place' THEN
        SELECT jsonb_build_object(
            'entity_type', 'place',
            'entity_id', p_entity_id,
            'formatted_address', pl.formatted_address,
            'source_system', pl.source_system,
            'created_at', pl.created_at,
            'google_place_id', pl.google_place_id,
            'is_google_verified', pl.is_google_verified,
            'geocode_attempts', (
                SELECT COUNT(*) FROM trapper.geocode_queue
                WHERE place_id = p_entity_id
            ),
            'colony_estimates', (
                SELECT jsonb_agg(sub.est)
                FROM (
                    SELECT jsonb_build_object(
                        'source_type', pce.source_type,
                        'total_cats', pce.total_cats,
                        'observation_date', pce.observation_date,
                        'confidence', pce.confidence
                    ) as est
                    FROM trapper.place_colony_estimates pce
                    WHERE pce.place_id = p_entity_id
                    ORDER BY pce.observation_date DESC
                    LIMIT 5
                ) sub
            )
        ) INTO v_result
        FROM trapper.places pl
        WHERE pl.place_id = p_entity_id;

    ELSE
        RETURN jsonb_build_object('error', 'Invalid entity_type');
    END IF;

    IF v_result IS NULL THEN
        RETURN jsonb_build_object('error', 'Entity not found');
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.query_data_lineage IS
'Trace data lineage - show all sources that contributed to an entity.';

\echo 'Created query_data_lineage function'

-- ============================================================================
-- Step 5: Query VolunteerHub data function
-- ============================================================================

\echo ''
\echo 'Step 5: Creating query_volunteerhub_data function...'

CREATE OR REPLACE FUNCTION trapper.query_volunteerhub_data(
    p_identifier TEXT  -- Email, phone, or person_id
)
RETURNS JSONB AS $$
DECLARE
    v_person_id UUID;
    v_result JSONB;
BEGIN
    -- Try to find person_id
    IF p_identifier ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_person_id := p_identifier::UUID;
    ELSE
        -- Try email or phone lookup
        SELECT pi.person_id INTO v_person_id
        FROM trapper.person_identifiers pi
        WHERE (pi.id_type = 'email' AND pi.id_value_norm = LOWER(TRIM(p_identifier)))
           OR (pi.id_type = 'phone' AND pi.id_value_norm = trapper.norm_phone_us(p_identifier))
        LIMIT 1;
    END IF;

    IF v_person_id IS NULL THEN
        RETURN jsonb_build_object('error', 'Person not found');
    END IF;

    -- Get VolunteerHub data
    SELECT jsonb_build_object(
        'person_id', v_person_id,
        'person_name', sp.display_name,
        'volunteerhub', (
            SELECT jsonb_build_object(
                'volunteerhub_id', vh.volunteerhub_id,
                'status', vh.status,
                'roles', vh.roles,
                'tags', vh.tags,
                'hours_logged', vh.hours_logged,
                'last_activity_at', vh.last_activity_at,
                'joined_at', vh.joined_at,
                'certifications', vh.certifications,
                'availability', vh.availability,
                'match_confidence', vh.match_confidence,
                'match_method', vh.match_method,
                'synced_at', vh.synced_at
            )
            FROM trapper.volunteerhub_volunteers vh
            WHERE vh.matched_person_id = v_person_id
        ),
        'roles', (
            SELECT array_agg(role_type)
            FROM trapper.person_roles
            WHERE person_id = v_person_id
        ),
        'is_volunteer', EXISTS (
            SELECT 1 FROM trapper.volunteerhub_volunteers vh
            WHERE vh.matched_person_id = v_person_id
        )
    ) INTO v_result
    FROM trapper.sot_people sp
    WHERE sp.person_id = v_person_id;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION trapper.query_volunteerhub_data IS
'Get VolunteerHub-specific data for a person including hours, roles, certifications.';

\echo 'Created query_volunteerhub_data function'

-- ============================================================================
-- Step 6: Summary
-- ============================================================================

\echo ''
\echo '=== MIG_487 Complete ==='
\echo ''
\echo 'Created Tippy data quality functions:'
\echo '  - check_entity_quality(type, id): Check completeness and issues'
\echo '  - find_potential_duplicates(type, identifier): Find similar records'
\echo '  - query_merge_history(type, id): Show merge history'
\echo '  - query_data_lineage(type, id): Trace data sources'
\echo '  - query_volunteerhub_data(identifier): Get VH-specific data'
\echo ''

