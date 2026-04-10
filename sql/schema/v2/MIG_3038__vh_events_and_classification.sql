-- MIG_3038: VH Events, Hours, and Volunteer Classification
--
-- Problem: VH sync captures users and groups but zero activity data.
-- All 1,364 volunteers show hours_logged=0, last_activity_at=NULL.
-- Hours live in the Events API (/api/v1/events), nested as
-- Event > UserGroupRegistrations[] > UserRegistrations[] > Hours.
--
-- This migration adds:
-- 1. source.volunteerhub_events — VH event records
-- 2. source.volunteerhub_event_registrations — Per-volunteer-per-event hours
-- 3. source.volunteerhub_sync_state — Incremental sync cursor
-- 4. source.v_vh_volunteer_hours — Aggregated hours per volunteer
-- 5. source.v_vh_volunteer_classification — approved/applicant/lapsed
-- 6. source.v_vh_population_snapshot — Single-row aggregate stats
-- 7. source.backfill_volunteer_hours_from_events() — Updates volunteerhub_volunteers from events

BEGIN;

-- ============================================================================
-- Table: source.volunteerhub_events
-- ============================================================================

CREATE TABLE IF NOT EXISTS source.volunteerhub_events (
  event_uid       TEXT PRIMARY KEY,
  title           TEXT,
  description     TEXT,
  event_date      TIMESTAMPTZ,
  event_end_date  TIMESTAMPTZ,
  location        TEXT,
  user_group_uid  TEXT REFERENCES source.volunteerhub_user_groups(user_group_uid),
  vh_version      BIGINT,
  raw_data        JSONB,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vh_events_date ON source.volunteerhub_events (event_date);
CREATE INDEX IF NOT EXISTS idx_vh_events_group ON source.volunteerhub_events (user_group_uid);

COMMENT ON TABLE source.volunteerhub_events IS 'VolunteerHub events (clinic shifts, thrift shifts, etc.). Synced from /api/v1/events.';

-- ============================================================================
-- Table: source.volunteerhub_event_registrations
-- ============================================================================

CREATE TABLE IF NOT EXISTS source.volunteerhub_event_registrations (
  registration_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_uid         TEXT NOT NULL REFERENCES source.volunteerhub_events(event_uid) ON DELETE CASCADE,
  volunteerhub_id   TEXT NOT NULL REFERENCES source.volunteerhub_volunteers(volunteerhub_id),
  hours             NUMERIC(6,2),          -- nullable: some events track attendance only
  registration_date TIMESTAMPTZ,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  is_waitlisted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_uid, volunteerhub_id)
);

CREATE INDEX IF NOT EXISTS idx_vh_event_reg_volunteer ON source.volunteerhub_event_registrations (volunteerhub_id);
CREATE INDEX IF NOT EXISTS idx_vh_event_reg_event ON source.volunteerhub_event_registrations (event_uid);

COMMENT ON TABLE source.volunteerhub_event_registrations IS 'Per-volunteer-per-event registration with hours. One row per volunteer per event.';

-- ============================================================================
-- Table: source.volunteerhub_sync_state
-- ============================================================================

CREATE TABLE IF NOT EXISTS source.volunteerhub_sync_state (
  sync_type       TEXT PRIMARY KEY,       -- 'events', 'users', etc.
  last_sync_at    TIMESTAMPTZ,
  records_synced  INT DEFAULT 0,
  metadata        JSONB,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE source.volunteerhub_sync_state IS 'Tracks incremental sync cursors for VH API endpoints.';

-- ============================================================================
-- View: source.v_vh_volunteer_hours
-- Aggregates hours per volunteer from event registrations
-- ============================================================================

CREATE OR REPLACE VIEW source.v_vh_volunteer_hours AS
SELECT
  er.volunteerhub_id,
  COUNT(DISTINCT er.event_uid) FILTER (WHERE NOT er.is_deleted)                       AS event_count,
  COALESCE(SUM(er.hours) FILTER (WHERE NOT er.is_deleted), 0)                         AS total_hours,
  COALESCE(SUM(er.hours) FILTER (WHERE NOT er.is_deleted
    AND e.event_date >= NOW() - INTERVAL '90 days'), 0)                               AS hours_last_90d,
  MAX(e.event_date) FILTER (WHERE NOT er.is_deleted)                                  AS last_event_date,
  -- Hours breakdown by group name pattern
  COALESCE(SUM(er.hours) FILTER (WHERE NOT er.is_deleted
    AND ug.name ILIKE '%clinic%'), 0)                                                 AS clinic_hours,
  COALESCE(SUM(er.hours) FILTER (WHERE NOT er.is_deleted
    AND ug.name ILIKE '%thrift%'), 0)                                                 AS thrift_hours,
  COALESCE(SUM(er.hours) FILTER (WHERE NOT er.is_deleted
    AND ug.name ILIKE '%laundry%'), 0)                                                AS laundry_hours
FROM source.volunteerhub_event_registrations er
JOIN source.volunteerhub_events e ON e.event_uid = er.event_uid
LEFT JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = e.user_group_uid
GROUP BY er.volunteerhub_id;

COMMENT ON VIEW source.v_vh_volunteer_hours IS 'Aggregated volunteer hours from event registrations. Breaks down by clinic/thrift/laundry.';

-- ============================================================================
-- View: source.v_vh_volunteer_classification
-- Classifies each volunteer as approved/applicant/lapsed
-- ============================================================================

CREATE OR REPLACE VIEW source.v_vh_volunteer_classification AS
WITH approved_group_uids AS (
  -- "Approved Volunteers" parent + all its children
  SELECT user_group_uid FROM source.volunteerhub_user_groups
  WHERE is_approved_parent = TRUE
  UNION
  SELECT ug.user_group_uid FROM source.volunteerhub_user_groups ug
  WHERE ug.parent_user_group_uid IN (
    SELECT user_group_uid FROM source.volunteerhub_user_groups WHERE is_approved_parent = TRUE
  )
),
volunteer_approved_status AS (
  SELECT
    vv.volunteerhub_id,
    -- Has active (left_at IS NULL) membership in any approved group
    EXISTS (
      SELECT 1 FROM source.volunteerhub_group_memberships vgm
      WHERE vgm.volunteerhub_id = vv.volunteerhub_id
        AND vgm.user_group_uid IN (SELECT user_group_uid FROM approved_group_uids)
        AND vgm.left_at IS NULL
    ) AS has_active_approved,
    -- Has ANY historical membership in an approved group (with left_at set)
    EXISTS (
      SELECT 1 FROM source.volunteerhub_group_memberships vgm
      WHERE vgm.volunteerhub_id = vv.volunteerhub_id
        AND vgm.user_group_uid IN (SELECT user_group_uid FROM approved_group_uids)
        AND vgm.left_at IS NOT NULL
    ) AS has_lapsed_approved
  FROM source.volunteerhub_volunteers vv
)
SELECT
  vv.volunteerhub_id,
  vv.display_name,
  vv.email,
  vv.is_active,
  vv.matched_person_id,
  CASE
    WHEN vas.has_active_approved THEN 'approved'
    WHEN vas.has_lapsed_approved AND NOT vas.has_active_approved THEN 'lapsed'
    ELSE 'applicant'
  END AS volunteer_status,
  -- Role flags from group memberships
  EXISTS (
    SELECT 1 FROM source.volunteerhub_group_memberships vgm
    JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = vv.volunteerhub_id
      AND ug.atlas_role = 'trapper' AND vgm.left_at IS NULL
  ) AS is_trapper,
  EXISTS (
    SELECT 1 FROM source.volunteerhub_group_memberships vgm
    JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = vv.volunteerhub_id
      AND ug.atlas_role = 'foster' AND vgm.left_at IS NULL
  ) AS is_foster,
  EXISTS (
    SELECT 1 FROM source.volunteerhub_group_memberships vgm
    JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = vv.volunteerhub_id
      AND ug.atlas_role = 'caretaker' AND vgm.left_at IS NULL
  ) AS is_caretaker,
  EXISTS (
    SELECT 1 FROM source.volunteerhub_group_memberships vgm
    JOIN source.volunteerhub_user_groups ug ON ug.user_group_uid = vgm.user_group_uid
    WHERE vgm.volunteerhub_id = vv.volunteerhub_id
      AND ug.atlas_role = 'staff' AND vgm.left_at IS NULL
  ) AS is_staff
FROM source.volunteerhub_volunteers vv
JOIN volunteer_approved_status vas ON vas.volunteerhub_id = vv.volunteerhub_id;

COMMENT ON VIEW source.v_vh_volunteer_classification IS 'Classifies volunteers as approved/applicant/lapsed based on group membership in Approved Volunteers subtree.';

-- ============================================================================
-- View: source.v_vh_population_snapshot
-- Single-row aggregate stats for the VH dashboard
-- ============================================================================

CREATE OR REPLACE VIEW source.v_vh_population_snapshot AS
SELECT
  COUNT(*)::INT                                                   AS total_volunteers,
  COUNT(*) FILTER (WHERE volunteer_status = 'approved')::INT      AS approved_active,
  COUNT(*) FILTER (WHERE volunteer_status = 'applicant')::INT     AS applicants,
  COUNT(*) FILTER (WHERE volunteer_status = 'lapsed')::INT        AS lapsed,
  COUNT(*) FILTER (WHERE is_trapper)::INT                         AS active_trappers,
  COUNT(*) FILTER (WHERE is_foster)::INT                          AS active_fosters,
  COUNT(*) FILTER (WHERE is_caretaker)::INT                       AS active_caretakers,
  COUNT(*) FILTER (WHERE is_staff)::INT                           AS active_staff,
  COUNT(*) FILTER (WHERE matched_person_id IS NOT NULL)::INT      AS matched_volunteers,
  COUNT(*) FILTER (WHERE matched_person_id IS NULL)::INT          AS unmatched_volunteers
FROM source.v_vh_volunteer_classification;

COMMENT ON VIEW source.v_vh_population_snapshot IS 'Single-row aggregate: approved count, applicants, lapsed, trappers, fosters, hours totals.';

-- ============================================================================
-- Function: source.backfill_volunteer_hours_from_events()
-- Updates volunteerhub_volunteers from the hours view
-- ============================================================================

CREATE OR REPLACE FUNCTION source.backfill_volunteer_hours_from_events()
RETURNS TABLE(updated_count INT, total_hours NUMERIC, total_events INT) AS $$
DECLARE
  v_updated INT := 0;
BEGIN
  UPDATE source.volunteerhub_volunteers vv
  SET
    hours_logged     = vh.total_hours,
    event_count      = vh.event_count,
    last_activity_at = vh.last_event_date
  FROM source.v_vh_volunteer_hours vh
  WHERE vv.volunteerhub_id = vh.volunteerhub_id
    AND (
      vv.hours_logged IS DISTINCT FROM vh.total_hours
      OR vv.event_count IS DISTINCT FROM vh.event_count
      OR vv.last_activity_at IS DISTINCT FROM vh.last_event_date
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN QUERY
  SELECT
    v_updated,
    COALESCE(SUM(vh.total_hours), 0::NUMERIC),
    COALESCE(SUM(vh.event_count)::INT, 0)
  FROM source.v_vh_volunteer_hours vh;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION source.backfill_volunteer_hours_from_events() IS 'Updates hours_logged, event_count, last_activity_at on volunteerhub_volunteers from event registrations.';

COMMIT;
