-- MIG_258: Backfill cat-request links and cat vitals
--
-- This migration backfills data that should have been created during ingest:
-- 1. cat_vitals from cat_info (weight)
-- 2. cat_vitals from appointments (temperature/reproductive status)
-- 3. request_cat_links from cats at same place as requests within attribution window
--
-- MANUAL APPLY:
--   export $(cat .env | grep -v '^#' | xargs)
--   psql "$DATABASE_URL" -f sql/schema/sot/MIG_258__backfill_cat_request_links_and_vitals.sql

\echo ''
\echo '=============================================='
\echo 'MIG_258: Backfill Cat-Request Links & Vitals'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Backfill weight from cat_info into cat_vitals
-- ============================================================

\echo 'Step 1: Backfilling weight from cat_info into cat_vitals...'

INSERT INTO trapper.cat_vitals (
    cat_id, recorded_at, weight_lbs, source_system, source_record_id
)
SELECT DISTINCT ON (ci.cat_id)
    ci.cat_id,
    COALESCE(
        (sr.payload->>'Date')::timestamp with time zone,
        NOW()
    ),
    (sr.payload->>'Weight')::numeric(5,2),
    'clinichq',
    'cat_info_backfill_' || sr.source_row_id
FROM trapper.staged_records sr
JOIN trapper.cat_identifiers ci ON
    ci.id_value = sr.payload->>'Microchip Number'
    AND ci.id_type = 'microchip'
WHERE sr.source_system = 'clinichq'
    AND sr.source_table = 'cat_info'
    AND sr.payload->>'Weight' IS NOT NULL
    AND sr.payload->>'Weight' ~ '^[0-9]+\.?[0-9]*$'
    AND (sr.payload->>'Weight')::numeric > 0
    AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_vitals cv
        WHERE cv.cat_id = ci.cat_id
          AND cv.weight_lbs IS NOT NULL
    )
ORDER BY ci.cat_id, (sr.payload->>'Date')::date DESC NULLS LAST
ON CONFLICT DO NOTHING;

\echo 'Weight vitals created:'
SELECT COUNT(*) as new_weight_records
FROM trapper.cat_vitals
WHERE source_record_id LIKE 'cat_info_backfill_%';

-- ============================================================
-- 2. Backfill temperature/reproductive status from appointments
-- ============================================================

\echo ''
\echo 'Step 2: Backfilling vitals from appointments...'

INSERT INTO trapper.cat_vitals (
    cat_id, appointment_id, recorded_at,
    temperature_f, is_pregnant, is_lactating, is_in_heat,
    source_system, source_record_id
)
SELECT
    a.cat_id,
    a.appointment_id,
    a.appointment_date::timestamp with time zone,
    a.temperature,
    a.is_pregnant,
    a.is_lactating,
    a.is_in_heat,
    'clinichq',
    'appointment_backfill_' || a.appointment_number
FROM trapper.sot_appointments a
WHERE a.cat_id IS NOT NULL
    AND (
        a.temperature IS NOT NULL
        OR a.is_pregnant = TRUE
        OR a.is_lactating = TRUE
        OR a.is_in_heat = TRUE
    )
    AND NOT EXISTS (
        SELECT 1 FROM trapper.cat_vitals cv
        WHERE cv.appointment_id = a.appointment_id
    )
ON CONFLICT DO NOTHING;

\echo 'Appointment vitals created:'
SELECT COUNT(*) as new_appointment_vitals
FROM trapper.cat_vitals
WHERE source_record_id LIKE 'appointment_backfill_%';

-- ============================================================
-- 3. Backfill cat-request links
-- ============================================================

\echo ''
\echo 'Step 3: Backfilling cat-request links from attribution windows...'

-- This links cats to requests based on:
-- - Cat is at the same place as the request (via cat_place_relationships)
-- - Cat had a clinic procedure within the attribution window
-- - Attribution window: from request creation to 6 months after (active) or resolved + 3 months (closed)

INSERT INTO trapper.request_cat_links (request_id, cat_id, link_purpose, link_notes, linked_by)
SELECT DISTINCT
    r.request_id,
    a.cat_id,
    CASE
        WHEN cp.is_spay = TRUE OR cp.is_neuter = TRUE THEN 'tnr_target'::trapper.cat_link_purpose
        ELSE 'wellness'::trapper.cat_link_purpose
    END,
    'Backfilled: clinic visit ' || a.appointment_date::text || ' matched to request at same place',
    'mig_258_backfill'
FROM trapper.sot_appointments a
JOIN trapper.cat_place_relationships cpr ON cpr.cat_id = a.cat_id
JOIN trapper.sot_requests r ON r.place_id = cpr.place_id
LEFT JOIN trapper.cat_procedures cp ON cp.appointment_id = a.appointment_id
WHERE a.cat_id IS NOT NULL
    -- Attribution window logic (from MIG_208):
    AND (
        -- Active request: procedure after request creation minus 1 month buffer
        (r.resolved_at IS NULL AND a.appointment_date >= r.source_created_at - INTERVAL '1 month')
        OR
        -- Resolved request: procedure before resolved + 3 month buffer
        (r.resolved_at IS NOT NULL
         AND a.appointment_date <= r.resolved_at + INTERVAL '3 months'
         AND a.appointment_date >= r.source_created_at - INTERVAL '1 month')
    )
    AND NOT EXISTS (
        SELECT 1 FROM trapper.request_cat_links rcl
        WHERE rcl.request_id = r.request_id AND rcl.cat_id = a.cat_id
    )
ON CONFLICT (request_id, cat_id) DO NOTHING;

\echo ''
\echo 'Cat-request links created:'
SELECT COUNT(*) as new_links,
       COUNT(DISTINCT request_id) as requests_with_new_links,
       COUNT(DISTINCT cat_id) as cats_linked
FROM trapper.request_cat_links
WHERE linked_by = 'mig_258_backfill';

-- ============================================================
-- 4. Verification
-- ============================================================

\echo ''
\echo '====== VERIFICATION ======'

\echo ''
\echo 'Cat vitals summary:'
SELECT
    COUNT(*) as total_vitals,
    COUNT(weight_lbs) as with_weight,
    COUNT(temperature_f) as with_temperature
FROM trapper.cat_vitals;

\echo ''
\echo 'Request-cat links summary:'
SELECT
    COUNT(*) as total_links,
    COUNT(DISTINCT request_id) as requests_with_links,
    COUNT(DISTINCT cat_id) as cats_linked
FROM trapper.request_cat_links;

\echo ''
\echo 'Links by purpose:'
SELECT link_purpose, COUNT(*) as count
FROM trapper.request_cat_links
GROUP BY link_purpose
ORDER BY count DESC;

\echo ''
\echo 'Sample of newly linked requests:'
SELECT
    r.request_id,
    p.display_name as place,
    r.status,
    COUNT(rcl.cat_id) as cats_linked
FROM trapper.sot_requests r
JOIN trapper.request_cat_links rcl ON rcl.request_id = r.request_id
JOIN trapper.places p ON p.place_id = r.place_id
WHERE rcl.linked_by = 'mig_258_backfill'
GROUP BY r.request_id, p.display_name, r.status
ORDER BY cats_linked DESC
LIMIT 10;

\echo ''
SELECT 'MIG_258 Complete' AS status;
