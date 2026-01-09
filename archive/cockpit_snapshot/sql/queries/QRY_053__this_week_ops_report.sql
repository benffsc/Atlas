-- QRY_053__this_week_ops_report.sql
-- Weekly ops report: upcoming appointments, new requests, follow-up needs, potential matches
-- Window: 14 days back (requests) + 14 days forward (upcoming)
-- Timezone: America/Los_Angeles for request submitted_at
-- Note: Placeholders are reported separately and excluded from follow-up list

\pset pager off

\echo ''
\echo '========================================'
\echo '  THIS WEEK OPS REPORT'
\echo '  Window: 14 days back / 14 days forward'
\echo '========================================'
\echo ''

-- ============================================================
\echo '=== UPCOMING APPOINTMENTS - REAL (Next 14 Days) ==='
\echo '    (Excludes placeholder rows)'
-- ============================================================

\echo ''
\echo '--- Counts by Date ---'
SELECT
    appt_date,
    COUNT(*) AS appointments
FROM trapper.v_this_week_focus
WHERE is_scheduled = true
  AND NOT (
      person_full_name ILIKE 'Priority % Placeholder'
      OR regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ('1111111111','2222222222','3333333333','4444444444')
  )
GROUP BY appt_date
ORDER BY appt_date;

\echo ''
\echo '--- Breakdown by Ownership Type ---'
SELECT
    COALESCE(ownership_type, '(not specified)') AS ownership_type,
    COUNT(*) AS count
FROM trapper.v_this_week_focus
WHERE is_scheduled = true
  AND NOT (
      person_full_name ILIKE 'Priority % Placeholder'
      OR regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ('1111111111','2222222222','3333333333','4444444444')
  )
GROUP BY ownership_type
ORDER BY count DESC;

\echo ''
\echo '--- Breakdown by Client Type ---'
SELECT
    COALESCE(client_type, '(not specified)') AS client_type,
    COUNT(*) AS count
FROM trapper.v_this_week_focus
WHERE is_scheduled = true
  AND NOT (
      person_full_name ILIKE 'Priority % Placeholder'
      OR regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ('1111111111','2222222222','3333333333','4444444444')
  )
GROUP BY client_type
ORDER BY count DESC;

-- ============================================================
\echo ''
\echo '=== PLACEHOLDER UPCOMING APPOINTMENTS (Next 14 Days) ==='
\echo '    (Reserved slots: Priority X Placeholder or fake phone)'
-- ============================================================

\echo ''
\echo '--- Placeholder Counts by Date ---'
SELECT
    appt_date,
    COUNT(*) AS placeholders
FROM trapper.v_this_week_focus
WHERE is_scheduled = true
  AND (
      person_full_name ILIKE 'Priority % Placeholder'
      OR regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ('1111111111','2222222222','3333333333','4444444444')
  )
GROUP BY appt_date
ORDER BY appt_date;

\echo ''
\echo '--- Placeholder Breakdown by Name Pattern ---'
SELECT
    COALESCE(person_full_name, '(no name)') AS placeholder_name,
    COUNT(*) AS count
FROM trapper.v_this_week_focus
WHERE is_scheduled = true
  AND (
      person_full_name ILIKE 'Priority % Placeholder'
      OR regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ('1111111111','2222222222','3333333333','4444444444')
  )
GROUP BY person_full_name
ORDER BY count DESC;

-- ============================================================
\echo ''
\echo '=== NEW APPOINTMENT REQUESTS (Last 14 Days) ==='
-- ============================================================

\echo ''
\echo '--- Counts by Submitted Date ---'
SELECT
    event_date AS submitted_date,
    COUNT(*) AS requests
FROM trapper.v_this_week_focus
WHERE is_scheduled = false
GROUP BY event_date
ORDER BY event_date DESC;

\echo ''
\echo '--- Breakdown by County ---'
SELECT
    COALESCE(county, '(not specified)') AS county,
    COUNT(*) AS count
FROM trapper.v_this_week_focus
WHERE is_scheduled = false
GROUP BY county
ORDER BY count DESC;

\echo ''
\echo '--- Breakdown by Status ---'
SELECT
    COALESCE(status, '(not specified)') AS status,
    COUNT(*) AS count
FROM trapper.v_this_week_focus
WHERE is_scheduled = false
GROUP BY status
ORDER BY count DESC;

-- ============================================================
\echo ''
\echo '=== FOLLOW-UP NEEDED - REAL (Top 25) ==='
\echo '    Missing: contact (email AND phone) OR address'
\echo '    (Excludes placeholder rows)'
-- ============================================================

SELECT
    feed_type,
    event_date,
    age_days,
    person_full_name,
    email,
    phone,
    LEFT(address, 40) AS address_preview,
    CASE
        WHEN NULLIF(TRIM(email), '') IS NULL AND NULLIF(TRIM(phone), '') IS NULL THEN 'NO CONTACT'
        ELSE ''
    END AS missing_contact,
    CASE
        WHEN NULLIF(TRIM(address), '') IS NULL THEN 'NO ADDRESS'
        ELSE ''
    END AS missing_address
FROM trapper.v_this_week_focus
WHERE needs_follow_up = true
  AND NOT (
      person_full_name ILIKE 'Priority % Placeholder'
      OR regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ('1111111111','2222222222','3333333333','4444444444')
  )
ORDER BY
    -- Requests: newest first (most recent submissions)
    -- Upcoming: soonest first (most urgent appointments)
    CASE WHEN is_scheduled = false THEN 0 ELSE 1 END,
    CASE WHEN is_scheduled = false THEN submitted_at END DESC NULLS LAST,
    CASE WHEN is_scheduled = true THEN appt_date END ASC NULLS LAST
LIMIT 25;

-- ============================================================
\echo ''
\echo '=== POTENTIAL SCHEDULED MATCHES (Best Effort) ==='
\echo '    Matching on email or phone within 30-day window'
-- ============================================================

SELECT
    req.id AS request_id,
    req.event_date AS request_date,
    req.person_full_name AS request_name,
    COALESCE(req.email, req.phone) AS request_contact,
    upg.id AS upcoming_id,
    upg.appt_date,
    upg.person_full_name AS upcoming_name,
    upg.animal_name,
    LEFT(upg.address, 30) AS upcoming_address
FROM trapper.v_intake_unified_feed req
JOIN trapper.v_intake_unified_feed upg ON (
    -- Match on email (case-insensitive)
    (
        NULLIF(TRIM(LOWER(req.email)), '') IS NOT NULL
        AND LOWER(req.email) = LOWER(upg.email)
    )
    OR
    -- Match on phone digits
    (
        NULLIF(regexp_replace(req.phone, '\D', '', 'g'), '') IS NOT NULL
        AND LENGTH(regexp_replace(req.phone, '\D', '', 'g')) >= 10
        AND regexp_replace(req.phone, '\D', '', 'g') = regexp_replace(upg.phone, '\D', '', 'g')
    )
)
WHERE req.is_scheduled = false
  AND upg.is_scheduled = true
  -- Within 30-day window: request event_date to upcoming appt_date
  AND upg.appt_date BETWEEN req.event_date AND (req.event_date + 30)
  -- Exclude placeholders from matches
  AND NOT (
      upg.person_full_name ILIKE 'Priority % Placeholder'
      OR regexp_replace(COALESCE(upg.phone, ''), '\D', '', 'g') IN ('1111111111','2222222222','3333333333','4444444444')
  )
ORDER BY req.event_date DESC, upg.appt_date ASC
LIMIT 20;

-- ============================================================
\echo ''
\echo '=== SUMMARY COUNTS ==='
-- ============================================================

SELECT
    feed_type,
    COUNT(*) AS total,
    SUM(CASE WHEN needs_follow_up THEN 1 ELSE 0 END) AS needs_follow_up,
    SUM(CASE WHEN (
        person_full_name ILIKE 'Priority % Placeholder'
        OR regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ('1111111111','2222222222','3333333333','4444444444')
    ) THEN 1 ELSE 0 END) AS placeholders
FROM trapper.v_this_week_focus
GROUP BY feed_type
ORDER BY feed_type;

\echo ''
\echo '========================================'
\echo '  END OF REPORT'
\echo '========================================'
\echo ''
