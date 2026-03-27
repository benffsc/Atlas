-- MIG_2993: Improve Tippy place search ranking
-- FFS-908: Place search returns wrong address when multiple match on same street
--
-- Problem: Searching "Pozzan Road" finds 15685 (28 cats) instead of 15760
-- (24 cats, Emily West's mass trapping colony) because cat count is the
-- only tie-breaker.
--
-- Fix: Rank by request activity > recent appointments > cat count
-- Only changes the ORDER BY in the place search — rest of function is unchanged.

-- Replace just the search portion of tippy_place_full_report
-- The function body after place lookup is identical to MIG_2527

CREATE OR REPLACE FUNCTION ops.tippy_place_full_report(p_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_place_id UUID;
    v_result JSONB;
BEGIN
    -- Find the place with improved ranking (FFS-908)
    SELECT p.place_id INTO v_place_id
    FROM sot.places p
    LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE p.merged_into_place_id IS NULL
    AND (
        p.display_name ILIKE '%' || p_address || '%'
        OR a.display_address ILIKE '%' || p_address || '%'
    )
    ORDER BY
        -- Tier 1: Match quality (exact > prefix > substring)
        CASE WHEN p.display_name ILIKE p_address THEN 0
             WHEN p.display_name ILIKE p_address || '%' THEN 1
             ELSE 2 END,
        -- Tier 2: Request activity (places with requests are more interesting)
        (SELECT COUNT(*) FROM ops.requests r
         WHERE r.place_id = p.place_id AND r.merged_into_request_id IS NULL) DESC,
        -- Tier 3: Recent appointment activity (more recent = more relevant)
        (SELECT MAX(appointment_date) FROM ops.appointments apt
         WHERE apt.place_id = p.place_id) DESC NULLS LAST,
        -- Tier 4: Cat count as final tie-breaker
        (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id) DESC
    LIMIT 1;

    IF v_place_id IS NULL THEN
        RETURN JSONB_BUILD_OBJECT(
            'found', false,
            'message', 'No place found matching "' || p_address || '"'
        );
    END IF;

    -- Build comprehensive report (unchanged from MIG_2527)
    SELECT JSONB_BUILD_OBJECT(
        'found', true,
        'place', JSONB_BUILD_OBJECT(
            'place_id', p.place_id,
            'display_name', p.display_name,
            'address', COALESCE(a.display_address, p.display_name),
            'city', a.city,
            'place_kind', p.place_kind,
            'has_active_request', EXISTS (
                SELECT 1 FROM ops.requests r
                WHERE r.place_id = p.place_id
                AND r.status NOT IN ('completed', 'cancelled')
            )
        ),
        'people', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'person_id', person_id,
                'name', display_name,
                'roles', roles,
                'email', email,
                'phone', phone
            )), '[]'::JSONB)
            FROM (
                SELECT
                    pe.person_id,
                    pe.display_name,
                    STRING_AGG(DISTINCT pp.relationship_type, ', ' ORDER BY pp.relationship_type) as roles,
                    (SELECT pi.id_value_raw FROM sot.person_identifiers pi
                     WHERE pi.person_id = pe.person_id AND pi.id_type = 'email'
                     AND pi.confidence >= 0.5 LIMIT 1) as email,
                    (SELECT pi.id_value_raw FROM sot.person_identifiers pi
                     WHERE pi.person_id = pe.person_id AND pi.id_type = 'phone'
                     AND pi.confidence >= 0.5 LIMIT 1) as phone
                FROM sot.person_place pp
                JOIN sot.people pe ON pe.person_id = pp.person_id AND pe.merged_into_person_id IS NULL
                WHERE pp.place_id = p.place_id
                GROUP BY pe.person_id, pe.display_name
            ) people_combined
        ),
        'cat_statistics', (
            SELECT JSONB_BUILD_OBJECT(
                'total_cats', COUNT(DISTINCT c.cat_id),
                'altered_cats', COUNT(DISTINCT c.cat_id) FILTER (
                    WHERE c.altered_status IN ('spayed', 'neutered', 'altered')
                ),
                'unaltered_cats', COUNT(DISTINCT c.cat_id) FILTER (
                    WHERE c.altered_status IS NULL OR c.altered_status = 'intact'
                ),
                'alteration_rate', ROUND(
                    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::NUMERIC
                    / NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
                ),
                'eartipped', COUNT(DISTINCT c.cat_id) FILTER (
                    WHERE c.ear_tip IS NOT NULL AND c.ear_tip != 'none'
                ),
                'deceased', COUNT(DISTINCT c.cat_id) FILTER (WHERE c.is_deceased = true)
            )
            FROM sot.cat_place cp
            JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
            WHERE cp.place_id = p.place_id
        ),
        'appointment_timeline', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'date', appt_date,
                'cats_done', cats_done,
                'is_mass_trapping', cats_done >= 10
            ) ORDER BY appt_date DESC), '[]'::JSONB)
            FROM (
                SELECT
                    apt.appointment_date::date as appt_date,
                    COUNT(DISTINCT apt.cat_id) as cats_done
                FROM ops.appointments apt
                JOIN sot.cat_place cp ON cp.cat_id = apt.cat_id
                WHERE cp.place_id = p.place_id
                GROUP BY apt.appointment_date::date
                HAVING COUNT(DISTINCT apt.cat_id) > 0
                ORDER BY appt_date DESC
                LIMIT 10
            ) timeline
        ),
        'disease_testing', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'test_type', test_type,
                'total_tests', total_tests,
                'positive', positive,
                'negative', negative
            )), '[]'::JSONB)
            FROM (
                SELECT
                    ctr.test_type,
                    COUNT(*) as total_tests,
                    COUNT(*) FILTER (WHERE ctr.test_result ILIKE '%pos%') as positive,
                    COUNT(*) FILTER (WHERE ctr.test_result ILIKE '%neg%') as negative
                FROM sot.cat_place cp
                JOIN sot.cat_test_results ctr ON ctr.cat_id = cp.cat_id
                WHERE cp.place_id = p.place_id
                GROUP BY ctr.test_type
                ORDER BY total_tests DESC
            ) disease_stats
        ),
        'request_history', (
            SELECT JSONB_BUILD_OBJECT(
                'total_requests', COUNT(*),
                'completed', COUNT(*) FILTER (WHERE r.status = 'completed'),
                'active', COUNT(*) FILTER (WHERE r.status NOT IN ('completed', 'cancelled')),
                'cancelled', COUNT(*) FILTER (WHERE r.status = 'cancelled'),
                'recent_requests', (
                    SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                        'request_id', r2.request_id,
                        'status', r2.status,
                        'created_at', r2.created_at,
                        'summary', r2.notes
                    ) ORDER BY r2.created_at DESC), '[]'::JSONB)
                    FROM ops.requests r2
                    WHERE r2.place_id = p.place_id
                    LIMIT 5
                )
            )
            FROM ops.requests r
            WHERE r.place_id = p.place_id
        ),
        'colony_estimate', (
            SELECT JSONB_BUILD_OBJECT(
                'current_estimate', pce.total_count_observed,
                'eartip_count', pce.eartip_count_observed,
                'observation_date', pce.observed_date,
                'method', pce.estimate_method
            )
            FROM sot.place_colony_estimates pce
            WHERE pce.place_id = p.place_id
            ORDER BY pce.observed_date DESC NULLS LAST, pce.created_at DESC
            LIMIT 1
        ),
        'shelterluv_outcomes', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'cat_name', c.name,
                'outcome_type', oh.outcome_type,
                'outcome_subtype', oh.outcome_subtype,
                'outcome_date', oh.outcome_date,
                'person_name', oh.person_name
            ) ORDER BY oh.outcome_date DESC), '[]'::JSONB)
            FROM source.shelterluv_outcome_history oh
            JOIN sot.cats c ON c.cat_id = oh.cat_id AND c.merged_into_cat_id IS NULL
            JOIN sot.cat_place cp ON cp.cat_id = c.cat_id
            WHERE cp.place_id = p.place_id
        ),
        'status_assessment', (
            SELECT CASE
                WHEN cat_stats.alteration_rate >= 90 THEN 'under_control'
                WHEN cat_stats.alteration_rate >= 70 THEN 'good_progress'
                WHEN cat_stats.alteration_rate >= 50 THEN 'needs_attention'
                WHEN cat_stats.alteration_rate > 0 THEN 'early_stages'
                ELSE 'unknown'
            END
            FROM (
                SELECT ROUND(
                    COUNT(DISTINCT c.cat_id) FILTER (WHERE c.altered_status IN ('spayed', 'neutered', 'altered'))::NUMERIC
                    / NULLIF(COUNT(DISTINCT c.cat_id), 0) * 100, 1
                ) as alteration_rate
                FROM sot.cat_place cp
                JOIN sot.cats c ON c.cat_id = cp.cat_id AND c.merged_into_cat_id IS NULL
                WHERE cp.place_id = p.place_id
            ) cat_stats
        ),
        'related_places', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'place_id', rp.place_id,
                'display_name', rp.display_name,
                'cat_count', (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = rp.place_id),
                'connection', 'same_owner'
            )), '[]'::JSONB)
            FROM (
                SELECT DISTINCT p2.place_id, p2.display_name
                FROM sot.person_place pp1
                JOIN sot.person_place pp2 ON pp2.person_id = pp1.person_id
                JOIN sot.places p2 ON p2.place_id = pp2.place_id AND p2.merged_into_place_id IS NULL
                WHERE pp1.place_id = p.place_id
                AND pp2.place_id != p.place_id
            ) rp
        )
    ) INTO v_result
    FROM sot.places p
    LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE p.place_id = v_place_id;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION ops.tippy_place_full_report(TEXT) IS
  'FFS-908: Improved place search ranking — request activity > recent appointments > cat count. '
  'Previously cat count was the only tie-breaker, causing wrong-address results on multi-match streets.';
