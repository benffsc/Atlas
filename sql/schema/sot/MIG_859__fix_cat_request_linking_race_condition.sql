\echo '=== MIG_859: Fix cat-request linking 60-day race condition ==='
\echo 'Problem: link_cats_to_requests_safe() has a hard 60-day lookback on appointment_date.'
\echo 'When cat_place_relationships are created late (>60 days after appointment),'
\echo 'the function never catches them. 69 cats system-wide are affected.'
\echo ''
\echo 'Fix: Add catch-up clause for recently-created cat_place_relationships.'

-- Fix the function: add catch-up for recently-created cat_place_relationships
CREATE OR REPLACE FUNCTION trapper.link_cats_to_requests_safe()
RETURNS TABLE(linked integer, skipped integer)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_linked INT := 0;
    v_skipped INT := 0;
BEGIN
    -- Link cats to requests within attribution windows
    -- Uses COALESCE to handle NULL source_created_at gracefully
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
            -- Attribution window with NULL-safe logic:
            AND (
                -- Active request: appointment within window
                (r.resolved_at IS NULL
                 AND a.appointment_date >= COALESCE(r.source_created_at, r.created_at, '2020-01-01'::date) - INTERVAL '1 month')
                OR
                -- Resolved request: appointment before resolved + 3 month buffer
                (r.resolved_at IS NOT NULL
                 AND a.appointment_date <= r.resolved_at + INTERVAL '3 months'
                 AND a.appointment_date >= COALESCE(r.source_created_at, r.created_at, '2020-01-01'::date) - INTERVAL '1 month')
            )
            -- Performance guard: process recent appointments OR recently-linked cats
            AND (
                -- Normal: recent appointments (last 60 days)
                a.appointment_date >= CURRENT_DATE - INTERVAL '60 days'
                -- Catch-up: cats whose place link was created recently
                -- This covers late cat_place_relationship creation from delayed ingest
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
'Links cats to requests via cat→place→request chain within attribution windows.
Fixed in MIG_859: Added 14-day catch-up for recently-created cat_place_relationships
to prevent race condition where late cat→place links caused permanent misses.';

\echo 'Function updated with catch-up clause.'

-- One-time backfill: link all cats that fell through the 60-day gap
\echo 'Running one-time backfill for all missed cat-request links...'

WITH backfill_links AS (
    INSERT INTO trapper.request_cat_links (request_id, cat_id, link_purpose, link_notes, linked_by)
    SELECT DISTINCT
        r.request_id,
        a.cat_id,
        CASE
            WHEN cp.is_spay = TRUE OR cp.is_neuter = TRUE THEN 'tnr_target'::trapper.cat_link_purpose
            ELSE 'wellness'::trapper.cat_link_purpose
        END,
        'Backfilled (MIG_859): clinic visit ' || a.appointment_date::text || ' within attribution window, missed due to late cat-place linking',
        'mig_859_backfill'
    FROM trapper.sot_appointments a
    JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
    JOIN trapper.sot_requests r ON r.place_id = cpr.place_id
    LEFT JOIN trapper.cat_procedures cp ON cp.appointment_id = a.appointment_id
    WHERE a.cat_id IS NOT NULL
        AND (
            (r.resolved_at IS NULL
             AND a.appointment_date >= COALESCE(r.source_created_at, r.created_at, '2020-01-01'::date) - INTERVAL '1 month')
            OR
            (r.resolved_at IS NOT NULL
             AND a.appointment_date <= r.resolved_at + INTERVAL '3 months'
             AND a.appointment_date >= COALESCE(r.source_created_at, r.created_at, '2020-01-01'::date) - INTERVAL '1 month')
        )
        AND NOT EXISTS (
            SELECT 1 FROM trapper.request_cat_links rcl
            WHERE rcl.request_id = r.request_id AND rcl.cat_id = a.cat_id
        )
    ON CONFLICT (request_id, cat_id) DO NOTHING
    RETURNING request_id, cat_id
)
SELECT COUNT(*) AS cats_backfilled FROM backfill_links;

\echo '=== MIG_859 complete ==='
