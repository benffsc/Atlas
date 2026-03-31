-- MIG_3016__tippy_place_report_enrichment.sql
-- Enrich tippy_place_full_report() with intake submissions, rich request details,
-- journal entries, trapper assignments, and null_status_count in cat_statistics.
--
-- New sections added to JSONB return:
--   1. intake_submissions  — What callers reported via web intake
--   2. request_details     — Rich request info (replaces sparse request_history.recent_requests)
--   3. journal_entries     — Staff activity log (notes, communications)
--   4. trapper_assignments — Who's been assigned to work this place
--   5. null_status_count   — Added to cat_statistics (cats with no altered_status)
--
-- Created: 2026-03-31

\echo '=============================================='
\echo 'MIG_3016: Tippy Place Report Enrichment'
\echo '=============================================='

-- ============================================================================
-- PART 1: Update tippy_place_full_report with new sections
-- ============================================================================

\echo '1. Updating tippy_place_full_report with enriched data...'

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
        -- People with combined roles
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
                'null_status_count', COUNT(DISTINCT c.cat_id) FILTER (
                    WHERE c.altered_status IS NULL
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
        -- Appointment timeline (detects mass trappings)
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
        -- NEW: Rich request details with structured fields from MIG_2531/2532/2826
        'request_details', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'request_id', r3.request_id,
                'status', r3.status,
                'priority', r3.priority,
                'source_system', r3.source_system,
                'created_at', r3.created_at,
                'resolved_at', r3.resolved_at,
                'estimated_cat_count', r3.estimated_cat_count,
                'total_cats_reported', r3.total_cats_reported,
                'has_kittens', r3.has_kittens,
                'kitten_count', r3.kitten_count,
                'is_emergency', r3.is_emergency,
                'triage_category', r3.triage_category,
                'best_trapping_time', r3.best_trapping_time,
                'has_medical_concerns', r3.has_medical_concerns,
                'medical_description', r3.medical_description,
                'important_notes', r3.important_notes,
                'ownership_status', r3.ownership_status,
                'notes', LEFT(r3.notes, 1000),
                'internal_notes', LEFT(r3.internal_notes, 1000),
                'dogs_on_site', r3.dogs_on_site,
                'trap_savvy', r3.trap_savvy,
                'previous_tnr', r3.previous_tnr,
                'requester', (
                    SELECT pe.display_name
                    FROM sot.people pe
                    WHERE pe.person_id = r3.requester_person_id
                    AND pe.merged_into_person_id IS NULL
                )
            ) ORDER BY r3.created_at DESC), '[]'::JSONB)
            FROM (
                SELECT * FROM ops.requests
                WHERE place_id = p.place_id
                ORDER BY created_at DESC
                LIMIT 5
            ) r3
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
        -- ShelterLuv outcomes (foster/adoption) for cats from this place
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
        -- ClinicHQ notes from clinic_accounts linked to this place
        'clinic_notes', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'account_id', ca.account_id,
                'client_name', ca.display_name,
                'quick_notes', ca.quick_notes,
                'long_notes', LEFT(ca.long_notes, 2000),
                'tags', ca.tags,
                'notes_updated_at', ca.notes_updated_at,
                'clinichq_client_id', ca.clinichq_client_id
            ) ORDER BY ca.notes_updated_at DESC NULLS LAST), '[]'::JSONB)
            FROM ops.appointments apt
            JOIN ops.clinic_accounts ca ON ca.account_id = apt.owner_account_id
            WHERE apt.inferred_place_id = p.place_id
            AND (ca.quick_notes IS NOT NULL OR ca.long_notes IS NOT NULL OR ca.tags IS NOT NULL)
        ),
        -- NEW: Intake submissions — what callers reported
        'intake_submissions', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'submission_id', sub.submission_id,
                'submitted_at', sub.created_at,
                'requester_name', COALESCE(
                    NULLIF(TRIM(CONCAT(sub.first_name, ' ', sub.last_name)), ''),
                    sub.email
                ),
                'situation', sub.situation_description,
                'is_emergency', sub.is_emergency,
                'cat_count', sub.cat_count_estimate,
                'has_kittens', sub.has_kittens,
                'triage_category', sub.triage_category
            ) ORDER BY sub.created_at DESC), '[]'::JSONB)
            FROM (
                SELECT DISTINCT ON (isub.submission_id) isub.*
                FROM ops.intake_submissions isub
                WHERE isub.place_id = p.place_id
                   OR isub.converted_to_request_id IN (
                       SELECT req.request_id FROM ops.requests req WHERE req.place_id = p.place_id
                   )
                ORDER BY isub.submission_id, isub.created_at DESC
                LIMIT 5
            ) sub
        ),
        -- NEW: Journal entries — staff activity log
        'journal_entries', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'entry_type', COALESCE(je.entry_kind, je.entry_type),
                'content', LEFT(COALESCE(je.body, je.content), 500),
                'created_at', je.created_at,
                'author', COALESCE(
                    je.created_by,
                    (SELECT pe.display_name FROM sot.people pe
                     WHERE pe.person_id = je.author_person_id
                     AND pe.merged_into_person_id IS NULL)
                ),
                'is_pinned', je.is_pinned,
                'contact_method', je.contact_method,
                'contact_result', je.contact_result
            ) ORDER BY je.created_at DESC), '[]'::JSONB)
            FROM (
                SELECT DISTINCT ON (j.entry_id) j.*
                FROM ops.journal_entries j
                WHERE (j.place_id = p.place_id OR j.primary_place_id = p.place_id)
                   OR j.request_id IN (
                       SELECT req.request_id FROM ops.requests req WHERE req.place_id = p.place_id
                   )
                   OR j.primary_request_id IN (
                       SELECT req.request_id FROM ops.requests req WHERE req.place_id = p.place_id
                   )
                ORDER BY j.entry_id, j.created_at DESC
                LIMIT 10
            ) je
            WHERE COALESCE(je.is_archived, false) = false
        ),
        -- NEW: Trapper assignments — who's been working this place
        'trapper_assignments', (
            SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
                'trapper_name', pe.display_name,
                'trapper_type', tp.trapper_type,
                'assigned_at', rta.assigned_at,
                'status', rta.status,
                'notes', rta.notes
            ) ORDER BY rta.assigned_at DESC NULLS LAST), '[]'::JSONB)
            FROM ops.request_trapper_assignments rta
            JOIN sot.people pe ON pe.person_id = rta.trapper_person_id AND pe.merged_into_person_id IS NULL
            LEFT JOIN sot.trapper_profiles tp ON tp.person_id = rta.trapper_person_id
            WHERE rta.request_id IN (
                SELECT req.request_id FROM ops.requests req WHERE req.place_id = p.place_id
            )
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
'Comprehensive place report for Tippy AI assistant.
Returns JSONB with: place, people, cat_statistics (with null_status_count),
appointment_timeline, disease_testing, request_history, request_details,
colony_estimate, shelterluv_outcomes, clinic_notes, intake_submissions,
journal_entries, trapper_assignments, status_assessment, related_places.
MIG_3016: Added intake_submissions, request_details, journal_entries,
trapper_assignments, null_status_count.';

-- ============================================================================
-- PART 2: Update tippy_place_summary to include new sections
-- ============================================================================

\echo '2. Updating tippy_place_summary with enriched data...'

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
    v_clinic_notes JSONB;
    v_intake_subs JSONB;
    v_journal JSONB;
    v_trapper_assigns JSONB;
    v_request_details JSONB;
    v_mass_trapping_dates TEXT;
    v_notes_text TEXT;
    v_intake_text TEXT;
    v_journal_text TEXT;
    v_trapper_text TEXT;
    v_request_detail_text TEXT;
BEGIN
    v_report := ops.tippy_place_full_report(p_address);

    IF NOT (v_report->>'found')::BOOLEAN THEN
        RETURN 'No place found matching "' || p_address || '"';
    END IF;

    v_cat_stats := v_report->'cat_statistics';
    v_people := v_report->'people';
    v_diseases := v_report->'disease_testing';
    v_timeline := v_report->'appointment_timeline';
    v_clinic_notes := v_report->'clinic_notes';
    v_intake_subs := v_report->'intake_submissions';
    v_journal := v_report->'journal_entries';
    v_trapper_assigns := v_report->'trapper_assignments';
    v_request_details := v_report->'request_details';

    -- Extract mass trapping dates
    SELECT STRING_AGG(
        (item->>'date') || ' (' || (item->>'cats_done') || ' cats)',
        ', '
    ) INTO v_mass_trapping_dates
    FROM jsonb_array_elements(v_timeline) AS item
    WHERE (item->>'is_mass_trapping')::BOOLEAN = true;

    -- Extract clinic notes summary
    SELECT STRING_AGG(
        format('  [%s] %s%s',
            note->>'client_name',
            CASE WHEN note->>'quick_notes' IS NOT NULL
                THEN 'Quick: ' || (note->>'quick_notes') || '. '
                ELSE '' END,
            CASE WHEN note->>'long_notes' IS NOT NULL
                THEN LEFT(note->>'long_notes', 200) ||
                    CASE WHEN LENGTH(note->>'long_notes') > 200 THEN '...' ELSE '' END
                ELSE '' END
        ), E'\n'
    ) INTO v_notes_text
    FROM jsonb_array_elements(v_clinic_notes) AS note
    LIMIT 3;

    -- Extract intake submissions summary
    SELECT STRING_AGG(
        format('  [%s] %s — %s cats%s%s',
            LEFT(sub->>'submitted_at', 10),
            COALESCE(sub->>'requester_name', 'Unknown'),
            COALESCE(sub->>'cat_count', '?'),
            CASE WHEN (sub->>'has_kittens')::BOOLEAN THEN ' (has kittens)' ELSE '' END,
            CASE WHEN (sub->>'is_emergency')::BOOLEAN THEN ' EMERGENCY' ELSE '' END
        ), E'\n'
    ) INTO v_intake_text
    FROM jsonb_array_elements(v_intake_subs) AS sub
    LIMIT 3;

    -- Extract journal entries summary
    SELECT STRING_AGG(
        format('  [%s] %s: %s',
            LEFT(je->>'created_at', 10),
            COALESCE(je->>'author', 'System'),
            LEFT(COALESCE(je->>'content', ''), 150) ||
                CASE WHEN LENGTH(COALESCE(je->>'content', '')) > 150 THEN '...' ELSE '' END
        ), E'\n'
    ) INTO v_journal_text
    FROM jsonb_array_elements(v_journal) AS je
    LIMIT 5;

    -- Extract trapper assignments summary
    SELECT STRING_AGG(
        format('  - %s (%s) — %s',
            COALESCE(ta->>'trapper_name', 'Unknown'),
            COALESCE(ta->>'trapper_type', 'unknown'),
            COALESCE(ta->>'status', 'unknown')
        ), E'\n'
    ) INTO v_trapper_text
    FROM jsonb_array_elements(v_trapper_assigns) AS ta;

    -- Extract request details summary
    SELECT STRING_AGG(
        format('  [%s] %s (priority: %s)%s%s — %s cats needing TNR, %s total reported%s',
            LEFT(rd->>'created_at', 10),
            COALESCE(rd->>'status', '?'),
            COALESCE(rd->>'priority', '?'),
            CASE WHEN (rd->>'is_emergency')::BOOLEAN THEN ' EMERGENCY' ELSE '' END,
            CASE WHEN (rd->>'has_medical_concerns')::BOOLEAN THEN ' MEDICAL' ELSE '' END,
            COALESCE(rd->>'estimated_cat_count', '?'),
            COALESCE(rd->>'total_cats_reported', '?'),
            CASE WHEN rd->>'notes' IS NOT NULL
                THEN E'\n    Notes: ' || LEFT(rd->>'notes', 200) ||
                    CASE WHEN LENGTH(COALESCE(rd->>'notes', '')) > 200 THEN '...' ELSE '' END
                ELSE '' END
        ), E'\n'
    ) INTO v_request_detail_text
    FROM jsonb_array_elements(v_request_details) AS rd
    LIMIT 3;

    v_summary := format(
        E'%s\n\n' ||
        E'PEOPLE:\n%s\n\n' ||
        E'CAT STATISTICS:\n' ||
        E'  - Total cats: %s\n' ||
        E'  - Altered: %s (%s%% alteration rate)\n' ||
        E'  - Unaltered: %s remaining\n' ||
        E'  - Unknown status: %s\n\n' ||
        E'STATUS: %s\n\n' ||
        CASE WHEN v_mass_trapping_dates IS NOT NULL
            THEN E'MASS TRAPPING EVENTS:\n  - %s\n\n'
            ELSE '' END ||
        CASE WHEN v_notes_text IS NOT NULL
            THEN E'CLINIC NOTES:\n%s\n\n'
            ELSE '' END ||
        CASE WHEN v_intake_text IS NOT NULL
            THEN E'INTAKE SUBMISSIONS:\n%s\n\n'
            ELSE '' END ||
        CASE WHEN v_journal_text IS NOT NULL
            THEN E'STAFF JOURNAL:\n%s\n\n'
            ELSE '' END ||
        CASE WHEN v_trapper_text IS NOT NULL
            THEN E'TRAPPER ASSIGNMENTS:\n%s\n\n'
            ELSE '' END ||
        CASE WHEN v_request_detail_text IS NOT NULL
            THEN E'REQUEST DETAILS:\n%s\n\n'
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
        COALESCE(v_cat_stats->>'null_status_count', '0'),
        UPPER(REPLACE(v_report->>'status_assessment', '_', ' ')),
        v_mass_trapping_dates,
        v_notes_text,
        v_intake_text,
        v_journal_text,
        v_trapper_text,
        v_request_detail_text,
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

COMMENT ON FUNCTION ops.tippy_place_summary(TEXT) IS
'Human-readable place summary for Tippy AI assistant.
MIG_3016: Now includes intake submissions, staff journal entries,
trapper assignments, request details, and null_status_count.';

-- ============================================================================
-- SUMMARY
-- ============================================================================

\echo ''
\echo '=============================================='
\echo 'MIG_3016 Complete!'
\echo '=============================================='
\echo ''
\echo 'Enhanced tippy_place_full_report() with:'
\echo '  - intake_submissions: What callers reported via web intake'
\echo '  - request_details: Rich request info (priority, medical, kittens, trapping logistics)'
\echo '  - journal_entries: Staff activity log (notes, communications, pinned items)'
\echo '  - trapper_assignments: Who has been assigned to work this place'
\echo '  - null_status_count: Added to cat_statistics for cats with unknown altered status'
\echo ''
\echo 'Enhanced tippy_place_summary() to render new sections in text output.'
\echo ''
\echo 'Test queries:'
\echo '  SELECT ops.tippy_place_full_report(''15760 Pozzan'')->''intake_submissions'';'
\echo '  SELECT ops.tippy_place_full_report(''15760 Pozzan'')->''request_details'';'
\echo '  SELECT ops.tippy_place_full_report(''15760 Pozzan'')->''journal_entries'';'
\echo '  SELECT ops.tippy_place_full_report(''15760 Pozzan'')->''trapper_assignments'';'
\echo '  SELECT ops.tippy_place_full_report(''15760 Pozzan'')->''cat_statistics''->''null_status_count'';'
\echo '  SELECT ops.tippy_place_summary(''15760 Pozzan'');'
\echo ''
