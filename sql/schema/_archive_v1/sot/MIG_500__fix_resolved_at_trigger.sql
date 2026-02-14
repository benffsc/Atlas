-- MIG_500: Fix resolved_at Enforcement
--
-- Problem:
--   Tests show completed/cancelled requests often have NULL resolved_at.
--   resolved_at is only set by API code, not enforced at database level.
--   This violates entity lifecycle rules in CLAUDE.md.
--
-- Solution:
--   1. Add database trigger to set resolved_at when status becomes terminal
--   2. Clear resolved_at if status returns from terminal (reopening)
--   3. Backfill existing data
--   4. Add resolved_at to v_request_list view
--
-- APPLY:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema/sot/MIG_500__fix_resolved_at_trigger.sql

\echo ''
\echo '=============================================='
\echo 'MIG_500: Fix resolved_at Enforcement'
\echo '=============================================='
\echo ''

-- ============================================================
-- 1. Create trigger function for resolved_at enforcement
-- ============================================================

\echo '1. Creating set_resolved_at_on_status_change trigger function...'

CREATE OR REPLACE FUNCTION trapper.set_resolved_at_on_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Terminal statuses: completed, cancelled, partial
  -- When entering terminal status, set resolved_at if not already set
  IF NEW.status IN ('completed', 'cancelled', 'partial')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('completed', 'cancelled', 'partial'))
     AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := NOW();
  END IF;

  -- When leaving terminal status (reopening), clear resolved_at
  IF NEW.status NOT IN ('completed', 'cancelled', 'partial')
     AND OLD.status IN ('completed', 'cancelled', 'partial') THEN
    NEW.resolved_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trapper.set_resolved_at_on_status_change IS
'Trigger function to enforce resolved_at on terminal status transitions.
Sets resolved_at when entering completed/cancelled/partial.
Clears resolved_at when leaving terminal status (reopening request).';

-- ============================================================
-- 2. Create the trigger on sot_requests
-- ============================================================

\echo '2. Creating trigger on sot_requests...'

DROP TRIGGER IF EXISTS trg_set_resolved_at ON trapper.sot_requests;

CREATE TRIGGER trg_set_resolved_at
  BEFORE UPDATE OF status ON trapper.sot_requests
  FOR EACH ROW
  EXECUTE FUNCTION trapper.set_resolved_at_on_status_change();

COMMENT ON TRIGGER trg_set_resolved_at ON trapper.sot_requests IS
'Enforces resolved_at field on status changes per CLAUDE.md lifecycle rules';

-- ============================================================
-- 3. Backfill existing data with missing resolved_at
-- ============================================================

\echo '3. Backfilling resolved_at for existing terminal requests...'

-- Use updated_at as best guess for when request was resolved
-- Fall back to created_at + 30 days if updated_at is same as created_at
UPDATE trapper.sot_requests
SET resolved_at = CASE
  WHEN updated_at IS NOT NULL AND updated_at != created_at THEN updated_at
  ELSE COALESCE(updated_at, created_at) + INTERVAL '1 day'
END
WHERE status IN ('completed', 'cancelled', 'partial')
  AND resolved_at IS NULL;

\echo 'Backfill complete.'

-- Show count of updated records
SELECT
  status,
  COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS has_resolved_at,
  COUNT(*) FILTER (WHERE resolved_at IS NULL) AS missing_resolved_at
FROM trapper.sot_requests
WHERE status IN ('completed', 'cancelled', 'partial')
GROUP BY status;

-- ============================================================
-- 4. Update v_request_list to include resolved_at
-- ============================================================

\echo '4. Updating v_request_list view to include resolved_at...'

DROP VIEW IF EXISTS trapper.v_request_list CASCADE;

CREATE VIEW trapper.v_request_list AS
SELECT
    r.request_id,
    r.status::TEXT,
    r.priority::TEXT,
    r.summary,
    r.estimated_cat_count,
    r.has_kittens,
    r.scheduled_date,
    r.assigned_to,
    r.assigned_trapper_type::TEXT,
    r.created_at,
    r.updated_at,
    r.source_created_at,
    r.last_activity_at,
    r.hold_reason::TEXT,
    r.resolved_at,  -- ADDED: Terminal status timestamp
    -- Place info (use address if place name matches requester name)
    r.place_id,
    CASE
      WHEN p.display_name IS NOT NULL AND per.display_name IS NOT NULL
        AND LOWER(TRIM(p.display_name)) = LOWER(TRIM(per.display_name))
      THEN COALESCE(SPLIT_PART(p.formatted_address, ',', 1), p.formatted_address)
      ELSE COALESCE(p.display_name, SPLIT_PART(p.formatted_address, ',', 1))
    END AS place_name,
    p.formatted_address AS place_address,
    p.safety_notes AS place_safety_notes,
    sa.locality AS place_city,
    p.service_zone,
    ST_Y(p.location::geometry) AS latitude,
    ST_X(p.location::geometry) AS longitude,
    -- Requester info with contact details
    r.requester_person_id,
    per.display_name AS requester_name,
    -- Email: prefer primary_email, fall back to most recent identifier
    COALESCE(
        per.primary_email,
        (SELECT pi.id_value_raw FROM trapper.person_identifiers pi
         WHERE pi.person_id = per.person_id AND pi.id_type = 'email'
         ORDER BY pi.created_at DESC LIMIT 1)
    ) AS requester_email,
    -- Phone: prefer primary_phone, fall back to most recent identifier
    COALESCE(
        per.primary_phone,
        (SELECT pi.id_value_raw FROM trapper.person_identifiers pi
         WHERE pi.person_id = per.person_id AND pi.id_type = 'phone'
         ORDER BY pi.created_at DESC LIMIT 1)
    ) AS requester_phone,
    -- Cat count
    (SELECT COUNT(*) FROM trapper.request_cats rc WHERE rc.request_id = r.request_id) AS linked_cat_count,
    -- Staleness
    EXTRACT(DAY FROM NOW() - COALESCE(r.last_activity_at, r.created_at))::INT AS days_since_activity,
    -- Is this a legacy Airtable request?
    r.source_system = 'airtable' AS is_legacy_request
FROM trapper.sot_requests r
LEFT JOIN trapper.places p ON p.place_id = r.place_id
LEFT JOIN trapper.sot_addresses sa ON sa.address_id = p.sot_address_id
LEFT JOIN trapper.sot_people per ON per.person_id = r.requester_person_id;

COMMENT ON VIEW trapper.v_request_list IS
'Request list view for queue display with requester contact info.
Includes resolved_at for terminal status tracking (MIG_500).
Uses smart place_name logic (shows address when name matches requester).';

-- ============================================================
-- Summary
-- ============================================================

\echo ''
\echo '=============================================='
\echo 'MIG_500 Complete!'
\echo '=============================================='
\echo ''
\echo 'Changes:'
\echo '  - Created trg_set_resolved_at trigger'
\echo '  - Backfilled resolved_at for terminal requests'
\echo '  - Added resolved_at to v_request_list view'
\echo ''
\echo 'Trigger behavior:'
\echo '  - Sets resolved_at = NOW() when status -> completed/cancelled/partial'
\echo '  - Clears resolved_at when status leaves terminal state (reopening)'
\echo ''

-- Record migration
SELECT trapper.record_migration(500, 'MIG_500__fix_resolved_at_trigger');
