-- MIG_2523: Enhanced Tippy Place Report V2
-- Date: 2026-02-26
--
-- Enhancements:
--   1. Combine multiple roles for same person (e.g., "resident, caretaker")
--   2. Mass trapping detection (cats done in single day)
--   3. ShelterLuv foster/adoption outcomes from this place
--   4. Appointment timeline (when were cats done)

\echo ''
\echo '=============================================='
\echo '  MIG_2523: Enhanced Tippy Place Report V2'
\echo '=============================================='
\echo ''

CREATE OR REPLACE FUNCTION ops.tippy_place_full_report(p_address TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_place_id UUID;
    v_result JSONB;
BEGIN
    -- Find the place
    SELECT place_id INTO v_place_id
    FROM sot.places p
    LEFT JOIN sot.addresses a ON a.address_id = p.sot_address_id
    WHERE p.merged_into_place_id IS NULL
    AND (
        p.display_name ILIKE '%' || p_address || '%'
        OR a.display_address ILIKE '%' || p_address || '%'
    )
    ORDER BY
        CASE WHEN p.display_name ILIKE p_address THEN 0
             WHEN p.display_name ILIKE p_address || '%' THEN 1
             ELSE 2 END,
        (SELECT COUNT(*) FROM sot.cat_place cp WHERE cp.place_id = p.place_id) DESC
    LIMIT 1;

    IF v_place_id IS NULL THEN
        RETURN JSONB_BUILD_OBJECT(
            'found', false,
            'message', 'No place found matching "' || p_address || '"'
        );
    END IF;

    -- Build comprehensive report
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
        -- ENHANCED: Combine roles for same person
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
        -- NEW: Appointment timeline (detects mass trappings)
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
        -- NEW: ShelterLuv outcomes (foster/adoption) for cats from this place
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

-- Update summary to show combined roles and mass trapping flag
CREATE OR REPLACE FUNCTION ops.tippy_place_summary(p_address TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_report JSONB;
    v_summary TEXT;
    v_cat_stats JSONB;
    v_people JSONB;
    v_diseases JSONB;
    v_timeline JSONB;
    v_mass_trapping_dates TEXT;
BEGIN
    v_report := ops.tippy_place_full_report(p_address);

    IF NOT (v_report->>'found')::BOOLEAN THEN
        RETURN 'No place found matching "' || p_address || '"';
    END IF;

    v_cat_stats := v_report->'cat_statistics';
    v_people := v_report->'people';
    v_diseases := v_report->'disease_testing';
    v_timeline := v_report->'appointment_timeline';

    -- Extract mass trapping dates
    SELECT STRING_AGG(
        (item->>'date') || ' (' || (item->>'cats_done') || ' cats)',
        ', '
    ) INTO v_mass_trapping_dates
    FROM jsonb_array_elements(v_timeline) AS item
    WHERE (item->>'is_mass_trapping')::BOOLEAN = true;

    v_summary := format(
        E'%s\n\n' ||
        E'PEOPLE:\n%s\n\n' ||
        E'CAT STATISTICS:\n' ||
        E'  - Total cats: %s\n' ||
        E'  - Altered: %s (%s%% alteration rate)\n' ||
        E'  - Unaltered: %s remaining\n\n' ||
        E'STATUS: %s\n\n' ||
        CASE WHEN v_mass_trapping_dates IS NOT NULL
            THEN E'MASS TRAPPING EVENTS:\n  - %s\n\n'
            ELSE '' END ||
        E'DISEASE TESTING:\n%s\n\n' ||
        E'REQUEST HISTORY:\n' ||
        E'  - Completed: %s\n' ||
        E'  - Active: %s',
        v_report->'place'->>'display_name',
        (SELECT STRING_AGG(
            format('  - %s (%s) - %s',
                person->>'name',
                person->>'roles',
                COALESCE(person->>'phone', person->>'email', 'no contact')
            ), E'\n'
        ) FROM jsonb_array_elements(v_people) AS person),
        v_cat_stats->>'total_cats',
        v_cat_stats->>'altered_cats',
        COALESCE(v_cat_stats->>'alteration_rate', '0'),
        v_cat_stats->>'unaltered_cats',
        UPPER(REPLACE(v_report->>'status_assessment', '_', ' ')),
        v_mass_trapping_dates,
        COALESCE(
            (SELECT STRING_AGG(
                format('  - %s: %s tested (%s positive, %s negative)',
                    disease->>'test_type',
                    disease->>'total_tests',
                    disease->>'positive',
                    disease->>'negative'
                ), E'\n'
            ) FROM jsonb_array_elements(v_diseases) AS disease),
            '  No disease testing recorded'
        ),
        v_report->'request_history'->>'completed',
        v_report->'request_history'->>'active'
    );

    RETURN v_summary;
END;
$$;

\echo ''
\echo '=============================================='
\echo '  VERIFICATION'
\echo '=============================================='
\echo ''

\echo 'Testing enhanced tippy_place_summary (Pozzan)...'
SELECT ops.tippy_place_summary('15760 Pozzan');

\echo ''
\echo 'Testing JSON report appointment_timeline...'
SELECT jsonb_pretty(ops.tippy_place_full_report('15760 Pozzan')->'appointment_timeline');

\echo ''
\echo '=============================================='
\echo '  MIG_2523 Complete!'
\echo '=============================================='
