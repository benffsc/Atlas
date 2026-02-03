\echo '=== MIG_860: Unified attribution window rule ==='
\echo 'Rule: Cat linked if appointment was within 6 months of request creation'
\echo '       OR while the request was still active (not closed/complete).'
\echo ''
\echo 'Replaces: legacy_fixed, active_rolling, resolved_with_buffer tiers'
\echo 'Affects: link_cats_to_requests_safe() + v_request_alteration_stats'

-----------------------------------------------------------------------
-- 1. Update link_cats_to_requests_safe() with unified attribution rule
-----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trapper.link_cats_to_requests_safe()
RETURNS TABLE(linked integer, skipped integer)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_linked INT := 0;
    v_skipped INT := 0;
BEGIN
    WITH new_links AS (
        INSERT INTO trapper.request_cat_links (request_id, cat_id, link_purpose, link_notes, linked_by)
        SELECT DISTINCT
            r.request_id,
            a.cat_id,
            CASE
                WHEN cp.is_spay = TRUE OR cp.is_neuter = TRUE THEN 'tnr_target'::trapper.cat_link_purpose
                ELSE 'wellness'::trapper.cat_link_purpose
            END,
            'Auto-linked: clinic visit ' || a.appointment_date::text || ' within request attribution window',
            'entity_linking_auto'
        FROM trapper.sot_appointments a
        JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
        JOIN trapper.sot_requests r ON r.place_id = cpr.place_id
        LEFT JOIN trapper.cat_procedures cp ON cp.appointment_id = a.appointment_id
        WHERE a.cat_id IS NOT NULL
            -- Appointment must be after request creation
            AND a.appointment_date >= COALESCE(r.source_created_at, r.created_at)::date
            -- Attribution rule: within 6 months of creation OR while request was active
            AND (
                -- Within 6 months of request creation
                a.appointment_date <= (COALESCE(r.source_created_at, r.created_at) + INTERVAL '6 months')::date
                -- OR request is still active (not resolved)
                OR r.resolved_at IS NULL
                -- OR appointment was before request was resolved (request was active at the time)
                OR a.appointment_date <= r.resolved_at::date
            )
            -- Performance guard: recent appointments OR recently-linked cats (MIG_859)
            AND (
                a.appointment_date >= CURRENT_DATE - INTERVAL '60 days'
                OR cpr.created_at >= NOW() - INTERVAL '14 days'
            )
            AND NOT EXISTS (
                SELECT 1 FROM trapper.request_cat_links rcl
                WHERE rcl.request_id = r.request_id AND rcl.cat_id = a.cat_id
            )
        ON CONFLICT (request_id, cat_id) DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_linked FROM new_links;

    RETURN QUERY SELECT v_linked, v_skipped;
END;
$function$;

COMMENT ON FUNCTION trapper.link_cats_to_requests_safe() IS
'Links cats to requests via cat→place→request chain.
Attribution rule (MIG_860): appointment within 6 months of request creation
OR while request was still active (not closed/complete).
Performance guard: 60-day appointment lookback + 14-day cat_place catch-up (MIG_859).';

\echo 'Function updated.'

-----------------------------------------------------------------------
-- 2. Recreate v_request_alteration_stats with unified window rule
-----------------------------------------------------------------------

CREATE OR REPLACE VIEW trapper.v_request_alteration_stats AS
WITH request_windows AS (
    SELECT r.request_id,
        r.place_id,
        r.requester_person_id,
        r.source_system,
        r.source_record_id,
        r.status,
        r.summary,
        r.estimated_cat_count,
        r.resolved_at,
        r.last_activity_at,
        r.redirected_to_request_id,
        r.redirected_from_request_id,
        r.redirect_at,
        r.transfer_type,
        COALESCE(r.source_created_at, r.created_at) AS effective_request_date,

        -- Window start: request creation date (redirect children inherit from parent)
        CASE
            WHEN r.redirected_from_request_id IS NOT NULL THEN (
                SELECT COALESCE(parent.redirect_at, parent.resolved_at, now())
                FROM trapper.sot_requests parent
                WHERE parent.request_id = r.redirected_from_request_id
            )
            ELSE COALESCE(r.source_created_at, r.created_at)
        END AS window_start,

        -- Window end: unified rule
        CASE
            -- Redirected/handed-off: window closes at redirect
            WHEN r.status IN ('redirected', 'handed_off') AND r.redirect_at IS NOT NULL
                THEN r.redirect_at
            -- Active (not resolved): open-ended
            WHEN r.resolved_at IS NULL
                THEN NOW()
            -- Resolved: GREATEST of 6 months from creation or resolution date
            -- (covers both "within 6 months of creation" and "while request was active")
            ELSE GREATEST(
                COALESCE(r.source_created_at, r.created_at) + INTERVAL '6 months',
                r.resolved_at
            )
        END AS window_end,

        -- Window type: simplified
        CASE
            WHEN r.status = 'redirected' THEN 'redirected_closed'
            WHEN r.status = 'handed_off' THEN 'handoff_closed'
            WHEN r.redirected_from_request_id IS NOT NULL AND r.transfer_type = 'handoff' THEN 'handoff_child'
            WHEN r.redirected_from_request_id IS NOT NULL THEN 'redirect_child'
            WHEN r.resolved_at IS NULL THEN 'active'
            ELSE 'resolved'
        END AS window_type

    FROM trapper.sot_requests r
    WHERE r.status <> 'cancelled' OR r.resolution_notes LIKE 'Upgraded to Atlas request%'
),
cat_procedures_in_window AS (
    SELECT DISTINCT cp.cat_id,
        cp.procedure_date,
        cp.is_spay,
        cp.is_neuter,
        c.sex,
        c.display_name AS cat_name,
        ci.id_value AS microchip
    FROM trapper.cat_procedures cp
    JOIN trapper.sot_cats c ON c.cat_id = cp.cat_id
    LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    WHERE cp.is_spay = true OR cp.is_neuter = true
),
matched_cats AS (
    SELECT DISTINCT rw.request_id,
        c.cat_id,
        c.display_name AS cat_name,
        c.sex,
        ci.id_value AS microchip,
        cpw.procedure_date,
        cpw.is_spay,
        cpw.is_neuter,
        rw.effective_request_date,
        CASE
            WHEN rcl.link_id IS NOT NULL THEN 'explicit_link'
            WHEN cpr.cat_place_id IS NOT NULL AND pcr.person_cat_id IS NOT NULL THEN 'place_and_requester'
            WHEN cpr.cat_place_id IS NOT NULL THEN 'place_match'
            WHEN pcr.person_cat_id IS NOT NULL THEN 'requester_match'
            ELSE 'unknown'
        END AS match_reason,
        CASE
            WHEN rcl.link_id IS NOT NULL THEN 1.0
            WHEN cpr.cat_place_id IS NOT NULL AND pcr.person_cat_id IS NOT NULL THEN 0.95
            WHEN cpr.cat_place_id IS NOT NULL THEN 0.85
            WHEN pcr.person_cat_id IS NOT NULL THEN 0.80
            ELSE 0.70
        END AS match_confidence
    FROM request_windows rw
    LEFT JOIN trapper.request_cat_links rcl ON rcl.request_id = rw.request_id
    LEFT JOIN trapper.cat_place_relationships cpr ON cpr.place_id = rw.place_id
    LEFT JOIN trapper.person_cat_relationships pcr ON pcr.person_id = rw.requester_person_id
    JOIN trapper.sot_cats c ON c.cat_id = COALESCE(rcl.cat_id, cpr.cat_id, pcr.cat_id)
    LEFT JOIN trapper.cat_identifiers ci ON ci.cat_id = c.cat_id AND ci.id_type = 'microchip'
    LEFT JOIN cat_procedures_in_window cpw ON cpw.cat_id = c.cat_id
    WHERE rcl.link_id IS NOT NULL OR cpr.cat_place_id IS NOT NULL OR pcr.person_cat_id IS NOT NULL
),
cats_with_procedures AS (
    SELECT mc.request_id,
        mc.cat_id,
        mc.cat_name,
        mc.sex,
        mc.microchip,
        mc.procedure_date,
        mc.is_spay,
        mc.is_neuter,
        mc.effective_request_date,
        mc.match_reason,
        mc.match_confidence
    FROM matched_cats mc
    WHERE mc.procedure_date IS NOT NULL
        AND mc.procedure_date >= (
            SELECT rw.window_start FROM request_windows rw WHERE rw.request_id = mc.request_id
        )
        AND mc.procedure_date <= (
            SELECT rw.window_end FROM request_windows rw WHERE rw.request_id = mc.request_id
        )
),
aggregated_stats AS (
    SELECT rw.request_id,
        count(DISTINCT cwp.cat_id) AS cats_caught,
        count(DISTINCT CASE WHEN cwp.procedure_date > rw.effective_request_date THEN cwp.cat_id END) AS cats_altered,
        count(DISTINCT CASE WHEN cwp.procedure_date < rw.effective_request_date THEN cwp.cat_id END) AS already_altered_before,
        count(DISTINCT CASE WHEN cwp.sex IN ('male', 'Male') THEN cwp.cat_id END) AS males,
        count(DISTINCT CASE WHEN cwp.sex IN ('female', 'Female') THEN cwp.cat_id END) AS females,
        avg(cwp.match_confidence) AS avg_match_confidence
    FROM request_windows rw
    LEFT JOIN cats_with_procedures cwp ON cwp.request_id = rw.request_id
    GROUP BY rw.request_id
),
linked_cats_json AS (
    SELECT cwp.request_id,
        jsonb_agg(DISTINCT jsonb_build_object(
            'cat_id', cwp.cat_id,
            'cat_name', cwp.cat_name,
            'microchip', cwp.microchip,
            'sex', cwp.sex,
            'match_reason', cwp.match_reason,
            'confidence', cwp.match_confidence,
            'procedure_date', cwp.procedure_date,
            'is_spay', cwp.is_spay,
            'is_neuter', cwp.is_neuter,
            'altered_after_request', cwp.procedure_date > cwp.effective_request_date
        )) FILTER (WHERE cwp.cat_id IS NOT NULL) AS linked_cats
    FROM cats_with_procedures cwp
    GROUP BY cwp.request_id
)
SELECT rw.request_id,
    rw.source_system,
    rw.source_record_id,
    rw.status,
    rw.summary,
    rw.estimated_cat_count,
    rw.effective_request_date,
    rw.window_start,
    rw.window_end,
    rw.window_type,
    rw.transfer_type,
    rw.redirected_to_request_id,
    rw.redirected_from_request_id,
    rw.redirect_at,
    COALESCE(ast.cats_caught, 0) AS cats_caught,
    COALESCE(ast.cats_altered, 0) AS cats_altered,
    COALESCE(ast.already_altered_before, 0) AS already_altered_before,
    COALESCE(ast.males, 0) AS males,
    COALESCE(ast.females, 0) AS females,
    CASE
        WHEN (COALESCE(ast.cats_caught, 0) - COALESCE(ast.already_altered_before, 0)) > 0
        THEN round(100.0 * COALESCE(ast.cats_altered, 0)::numeric / (COALESCE(ast.cats_caught, 0) - COALESCE(ast.already_altered_before, 0))::numeric, 1)
        ELSE NULL
    END AS alteration_rate_pct,
    COALESCE(ast.avg_match_confidence, 0) AS avg_match_confidence,
    COALESCE(lcj.linked_cats, '[]'::jsonb) AS linked_cats,
    rw.source_system = 'airtable' AS is_legacy_request,
    CASE
        WHEN rw.source_system <> 'airtable' THEN false
        WHEN rw.status = 'cancelled' AND rw.summary IS NULL THEN false
        ELSE true
    END AS can_upgrade,
    p.display_name AS place_name,
    p.formatted_address AS place_address,
    per.display_name AS requester_name
FROM request_windows rw
LEFT JOIN aggregated_stats ast ON ast.request_id = rw.request_id
LEFT JOIN linked_cats_json lcj ON lcj.request_id = rw.request_id
LEFT JOIN trapper.places p ON p.place_id = rw.place_id
LEFT JOIN trapper.sot_people per ON per.person_id = rw.requester_person_id;

COMMENT ON VIEW trapper.v_request_alteration_stats IS
'Per-request cat attribution stats with unified window rule (MIG_860).
Rule: appointment within 6 months of request creation OR while request was active.
Window types: active, resolved, redirected_closed, handoff_closed, redirect_child, handoff_child.';

\echo 'View updated.'

-----------------------------------------------------------------------
-- 3. Backfill any newly eligible links under the unified rule
-----------------------------------------------------------------------
\echo 'Backfilling any newly eligible cat-request links under unified rule...'

WITH backfill AS (
    INSERT INTO trapper.request_cat_links (request_id, cat_id, link_purpose, link_notes, linked_by)
    SELECT DISTINCT
        r.request_id,
        a.cat_id,
        CASE
            WHEN cp.is_spay = TRUE OR cp.is_neuter = TRUE THEN 'tnr_target'::trapper.cat_link_purpose
            ELSE 'wellness'::trapper.cat_link_purpose
        END,
        'Backfilled (MIG_860): clinic visit ' || a.appointment_date::text || ' within unified attribution window',
        'mig_860_backfill'
    FROM trapper.sot_appointments a
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
    JOIN trapper.sot_requests r ON r.place_id = cpr.place_id
    LEFT JOIN trapper.cat_procedures cp ON cp.appointment_id = a.appointment_id
    WHERE a.cat_id IS NOT NULL
        -- Appointment after request creation
        AND a.appointment_date >= COALESCE(r.source_created_at, r.created_at)::date
        -- Unified attribution rule
        AND (
            a.appointment_date <= (COALESCE(r.source_created_at, r.created_at) + INTERVAL '6 months')::date
            OR r.resolved_at IS NULL
            OR a.appointment_date <= r.resolved_at::date
        )
        AND NOT EXISTS (
            SELECT 1 FROM trapper.request_cat_links rcl
            WHERE rcl.request_id = r.request_id AND rcl.cat_id = a.cat_id
        )
    ON CONFLICT (request_id, cat_id) DO NOTHING
    RETURNING request_id, cat_id
)
SELECT COUNT(*) AS cats_backfilled FROM backfill;

\echo '=== MIG_860 complete ==='
