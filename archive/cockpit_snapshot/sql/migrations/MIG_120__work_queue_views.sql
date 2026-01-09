-- ============================================================
-- MIG_120: Work Queue Views for Ops Dashboard
--
-- Purpose: Create views that mirror staff mental dashboards
-- for use in Cockpit /ops page.
--
-- Status: NOT YET APPLIED - Review before running
--
-- Dependencies:
--   - requests table
--   - appointment_requests table
--   - data_issues table
--   - people table
--   - places table
--   - addresses table
--
-- Note: Some views (trapper_pipeline, foster_pipeline, media_unlinked)
-- require tables that don't exist yet. Placeholders included.
-- ============================================================

-- ============================================================
-- 1. v_work_queue_trapping_requests
-- Mirrors: Trapping Requests card view
-- Purpose: Status-based view + needs attention + missing info flags
-- ============================================================

DROP VIEW IF EXISTS trapper.v_work_queue_trapping_requests CASCADE;

CREATE VIEW trapper.v_work_queue_trapping_requests AS
SELECT
  r.id AS request_id,
  r.case_number,
  r.status::text,
  r.priority_label,
  r.archive_reason,
  r.created_at,
  r.updated_at,

  -- Display info
  COALESCE(p.full_name, pl.display_name, 'Unknown') AS display_name,
  COALESCE(pl.display_name, addr.display_line, LEFT(r.notes, 50)) AS address_display,

  -- Contact info
  p.phone AS contact_phone,
  p.email AS contact_email,

  -- Location
  ST_Y(COALESCE(pl.location, addr.location)) AS lat,
  ST_X(COALESCE(pl.location, addr.location)) AS lng,

  -- TNR Stage (derived from status)
  CASE r.status::text
    WHEN 'new' THEN 'intake'
    WHEN 'needs_review' THEN 'intake'
    WHEN 'in_progress' THEN 'fieldwork'
    WHEN 'active' THEN 'fieldwork'
    WHEN 'paused' THEN 'paused'
    WHEN 'closed' THEN 'closed'
    WHEN 'resolved' THEN 'closed'
    ELSE 'intake'
  END AS tnr_stage,

  -- Attention flags
  (p.phone IS NULL AND p.email IS NULL) AS missing_contact,
  (pl.location IS NULL AND addr.location IS NULL) AS needs_geo,
  (addr.location IS NOT NULL AND NOT addr.is_canonical) AS raw_address_only,

  -- Age
  (CURRENT_DATE - r.created_at::date) AS age_days,
  (CURRENT_DATE - r.updated_at::date) AS days_since_update,

  -- Notes presence
  (r.notes IS NOT NULL AND LENGTH(TRIM(r.notes)) > 0) AS has_notes,

  -- Issue count
  (
    SELECT COUNT(*)::int
    FROM trapper.data_issues di
    WHERE di.entity_id = r.id
      AND NOT di.is_resolved
  ) AS open_issue_count

FROM trapper.requests r
LEFT JOIN trapper.people p ON p.id = r.primary_contact_person_id
LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.addresses addr ON addr.id = COALESCE(pl.primary_address_id, pl.address_id)
WHERE r.archive_reason IS NULL
ORDER BY
  CASE r.status::text
    WHEN 'needs_review' THEN 1
    WHEN 'new' THEN 2
    WHEN 'active' THEN 3
    WHEN 'in_progress' THEN 4
    WHEN 'paused' THEN 5
    ELSE 6
  END,
  r.updated_at DESC NULLS LAST;

COMMENT ON VIEW trapper.v_work_queue_trapping_requests IS
  'Trapping requests work queue - mirrors Airtable card view with status/attention flags';


-- ============================================================
-- 2. v_work_queue_appt_requests
-- Mirrors: Receptionist appointment request dashboard
-- Purpose: Status-based view, sorted by date, minimal fields
-- ============================================================

DROP VIEW IF EXISTS trapper.v_work_queue_appt_requests CASCADE;

CREATE VIEW trapper.v_work_queue_appt_requests AS
SELECT
  ar.id AS appt_request_id,
  ar.source_record_id,
  ar.status::text,
  ar.created_at,
  ar.updated_at,

  -- Contact info
  ar.reporter_name,
  ar.reporter_email,
  ar.reporter_phone,

  -- Location (raw from form)
  ar.raw_address,
  ar.city,
  ar.postal_code,

  -- Cats info
  ar.cats_count_estimate,
  ar.notes,

  -- Age
  (CURRENT_DATE - ar.created_at::date) AS age_days,

  -- Status category for receptionist
  CASE ar.status::text
    WHEN 'new' THEN 'New'
    WHEN 'contacted' THEN 'Contacted'
    WHEN 'booked' THEN 'Booked'
    WHEN 'closed' THEN 'Closed'
    WHEN 'out_of_county' THEN 'Out of County'
    ELSE 'Other'
  END AS status_display

FROM trapper.appointment_requests ar
WHERE ar.status::text NOT IN ('closed', 'cancelled', 'spam')
ORDER BY
  CASE ar.status::text
    WHEN 'new' THEN 1
    WHEN 'contacted' THEN 2
    WHEN 'booked' THEN 3
    ELSE 4
  END,
  ar.created_at DESC;

COMMENT ON VIEW trapper.v_work_queue_appt_requests IS
  'Appointment requests work queue - mirrors receptionist card gallery view';


-- ============================================================
-- 3. v_work_queue_trapping_priorities
-- Mirrors: Trapping Priorities narrow view
-- Purpose: Only actionable cases, avoid stale entries
-- ============================================================

DROP VIEW IF EXISTS trapper.v_work_queue_trapping_priorities CASCADE;

CREATE VIEW trapper.v_work_queue_trapping_priorities AS
SELECT
  r.id AS request_id,
  r.case_number,
  r.status::text,
  r.priority_label,
  r.created_at,
  r.updated_at,

  -- Display info
  COALESCE(p.full_name, pl.display_name, 'Unknown') AS display_name,
  COALESCE(pl.display_name, addr.display_line) AS address_display,

  -- Location for map
  ST_Y(COALESCE(pl.location, addr.location)) AS lat,
  ST_X(COALESCE(pl.location, addr.location)) AS lng,

  -- Staleness indicator
  (CURRENT_DATE - r.updated_at::date) AS days_since_update,
  CASE
    WHEN (CURRENT_DATE - r.updated_at::date) > 30 THEN 'stale'
    WHEN (CURRENT_DATE - r.updated_at::date) > 14 THEN 'aging'
    ELSE 'fresh'
  END AS freshness,

  -- Notes
  r.notes,

  -- Issue summary
  (
    SELECT string_agg(di.issue_type, ', ')
    FROM trapper.data_issues di
    WHERE di.entity_id = r.id AND NOT di.is_resolved
  ) AS open_issues

FROM trapper.requests r
LEFT JOIN trapper.people p ON p.id = r.primary_contact_person_id
LEFT JOIN trapper.places pl ON pl.id = COALESCE(r.primary_place_id, r.place_id)
LEFT JOIN trapper.addresses addr ON addr.id = COALESCE(pl.primary_address_id, pl.address_id)
WHERE
  r.archive_reason IS NULL
  AND r.status::text IN ('new', 'needs_review', 'active', 'in_progress')
  AND r.priority_label IS NOT NULL
ORDER BY
  CASE r.priority_label
    WHEN 'High' THEN 1
    WHEN 'Medium' THEN 2
    WHEN 'Low' THEN 3
    ELSE 4
  END,
  r.updated_at DESC NULLS LAST;

COMMENT ON VIEW trapper.v_work_queue_trapping_priorities IS
  'Priority trapping requests - only actionable cases with staleness warnings';


-- ============================================================
-- 4. v_work_queue_data_issues
-- Summary of open data issues by type
-- Useful for /ops dashboard cards
-- ============================================================

DROP VIEW IF EXISTS trapper.v_work_queue_data_issues CASCADE;

CREATE VIEW trapper.v_work_queue_data_issues AS
SELECT
  di.issue_type,
  COUNT(*)::int AS issue_count,
  MIN(di.first_seen_at) AS oldest_issue,
  MAX(di.last_seen_at) AS newest_issue,
  AVG(EXTRACT(EPOCH FROM (NOW() - di.first_seen_at)) / 86400)::numeric(10,1) AS avg_days_open
FROM trapper.data_issues di
WHERE NOT di.is_resolved
GROUP BY di.issue_type
ORDER BY issue_count DESC;

COMMENT ON VIEW trapper.v_work_queue_data_issues IS
  'Data issues summary by type for ops dashboard';


-- ============================================================
-- PLACEHOLDER VIEWS
-- These require tables that don't exist yet.
-- Uncomment and modify when tables are created.
-- ============================================================

-- v_work_queue_email_batch_ready
-- Requires: ready_to_email, email_html fields on requests
-- Currently: Not possible without those fields

-- v_work_queue_media_unlinked
-- Requires: media/attachments table with link status
-- Currently: attachments table exists but no unlinked tracking

-- v_work_queue_trapper_pipeline
-- Requires: potential_trappers, trappers tables
-- Currently: Tables don't exist in DB

-- v_work_queue_foster_pipeline
-- Requires: foster_contracts, fosters tables
-- Currently: Tables don't exist in DB


-- ============================================================
-- GRANTS
-- ============================================================

-- Grant read access (adjust role name as needed)
-- GRANT SELECT ON trapper.v_work_queue_trapping_requests TO authenticated;
-- GRANT SELECT ON trapper.v_work_queue_appt_requests TO authenticated;
-- GRANT SELECT ON trapper.v_work_queue_trapping_priorities TO authenticated;
-- GRANT SELECT ON trapper.v_work_queue_data_issues TO authenticated;
