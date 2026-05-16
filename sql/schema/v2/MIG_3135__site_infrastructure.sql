-- MIG_3135: Site infrastructure — site_id on requests, site_timeline, site_assignments
--
-- Adds the structural foundation for site-first TNR tracking:
-- 1. site_id FK on ops.requests (groups requests by site/colony)
-- 2. ops.site_timeline (trigger-populated from journal, appointments, tickets, requests)
-- 3. ops.site_assignments (site-level trapper assignment)
-- 4. Auto-create site trigger (when request created at place with 2+ requests)

-- ============================================================================
-- 1. site_id on requests
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ops' AND table_name = 'requests' AND column_name = 'site_id'
  ) THEN
    ALTER TABLE ops.requests ADD COLUMN site_id UUID REFERENCES sot.colonies(colony_id);
    CREATE INDEX idx_requests_site_id ON ops.requests(site_id) WHERE site_id IS NOT NULL;
    COMMENT ON COLUMN ops.requests.site_id IS 'Links request to its site/colony. Auto-set on creation, enables grouping.';
  END IF;
END $$;

-- Backfill from existing colony_requests junction
UPDATE ops.requests r
SET site_id = cr.colony_id
FROM sot.colony_requests cr
WHERE cr.request_id = r.request_id
  AND cr.deleted_at IS NULL
  AND r.site_id IS NULL;

-- ============================================================================
-- 2. Site timeline
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.site_timeline (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sot.colonies(colony_id) ON DELETE CASCADE,
  event_date TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'note', 'phone_call', 'field_visit', 'status_change',
    'trapping', 'clinic_visit', 'assignment', 'observation',
    'intake', 'request_created', 'request_resolved', 'address_added',
    'contact_added', 'system'
  )),
  title TEXT NOT NULL,
  body TEXT,
  actor TEXT,                -- staff name or "system"
  source_table TEXT,         -- 'journal_entries', 'appointments', etc.
  source_id UUID,            -- FK to the source row
  metadata JSONB,            -- extra structured data (cat count, status, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_timeline_site_date
  ON ops.site_timeline(site_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_site_timeline_source
  ON ops.site_timeline(source_table, source_id) WHERE source_id IS NOT NULL;

COMMENT ON TABLE ops.site_timeline IS
  'Unified timeline for sites. Populated by triggers on journal_entries, appointments, requests, etc. One query for the full story.';

-- ============================================================================
-- 3. Site-level trapper assignments
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.site_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sot.colonies(colony_id) ON DELETE CASCADE,
  trapper_person_id UUID NOT NULL REFERENCES sot.people(person_id),
  is_primary BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  assigned_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_assignments_active
  ON ops.site_assignments(site_id, trapper_person_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_site_assignments_trapper
  ON ops.site_assignments(trapper_person_id) WHERE status = 'active';

COMMENT ON TABLE ops.site_assignments IS
  'Trapper assigned to a site (not per-request). Covers all requests at the site. Per-request assignment overrides.';

-- ============================================================================
-- 4. Backfill site_timeline from existing data
-- ============================================================================

-- Journal entries → timeline
INSERT INTO ops.site_timeline (site_id, event_date, event_type, title, body, actor, source_table, source_id)
SELECT DISTINCT ON (je.id)
  r.site_id,
  COALESCE(je.occurred_at, je.created_at),
  CASE je.entry_kind
    WHEN 'contact_attempt' THEN 'phone_call'
    WHEN 'field_visit' THEN 'field_visit'
    WHEN 'trap_event' THEN 'trapping'
    WHEN 'status_change' THEN 'status_change'
    ELSE 'note'
  END,
  CASE je.entry_kind
    WHEN 'contact_attempt' THEN 'Phone call'
    WHEN 'field_visit' THEN 'Field visit'
    WHEN 'trap_event' THEN 'Trapping event'
    WHEN 'status_change' THEN 'Status change'
    ELSE COALESCE(je.title, 'Note')
  END,
  je.body,
  COALESCE(je.created_by_staff_name, je.created_by),
  'journal_entries',
  je.id
FROM ops.journal_entries je
JOIN ops.requests r ON r.request_id = je.primary_request_id AND r.site_id IS NOT NULL
WHERE je.is_archived = FALSE
ON CONFLICT DO NOTHING;

-- Also backfill journal entries linked via place
INSERT INTO ops.site_timeline (site_id, event_date, event_type, title, body, actor, source_table, source_id)
SELECT DISTINCT ON (je.id)
  cp.colony_id AS site_id,
  COALESCE(je.occurred_at, je.created_at),
  CASE je.entry_kind
    WHEN 'contact_attempt' THEN 'phone_call'
    WHEN 'field_visit' THEN 'field_visit'
    WHEN 'trap_event' THEN 'trapping'
    ELSE 'note'
  END,
  COALESCE(je.title, 'Note'),
  je.body,
  COALESCE(je.created_by_staff_name, je.created_by),
  'journal_entries',
  je.id
FROM ops.journal_entries je
JOIN sot.colony_places cp ON cp.place_id = je.primary_place_id AND cp.is_active = TRUE
WHERE je.is_archived = FALSE
  AND NOT EXISTS (SELECT 1 FROM ops.site_timeline st WHERE st.source_table = 'journal_entries' AND st.source_id = je.id)
ON CONFLICT DO NOTHING;

-- Request creation events → timeline
INSERT INTO ops.site_timeline (site_id, event_date, event_type, title, body, actor, source_table, source_id)
SELECT
  r.site_id,
  r.created_at,
  'request_created',
  'Request created',
  r.summary,
  COALESCE(rq.first_name || ' ' || rq.last_name, rq.first_name, 'Intake'),
  'requests',
  r.request_id
FROM ops.requests r
LEFT JOIN sot.people rq ON rq.person_id = r.requester_person_id
WHERE r.site_id IS NOT NULL
  AND r.merged_into_request_id IS NULL
ON CONFLICT DO NOTHING;

-- Appointments → timeline
INSERT INTO ops.site_timeline (site_id, event_date, event_type, title, body, actor, source_table, source_id)
SELECT DISTINCT ON (a.appointment_id)
  cp.colony_id AS site_id,
  a.appointment_date,
  'clinic_visit',
  CASE WHEN a.cat_count > 1 THEN a.cat_count || ' cats to clinic' ELSE 'Cat to clinic' END,
  a.client_name,
  NULL,
  'appointments',
  a.appointment_id
FROM ops.appointments a
JOIN sot.colony_places cp ON (cp.place_id = a.place_id OR cp.place_id = a.inferred_place_id) AND cp.is_active = TRUE
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 5. Trigger: auto-populate site_timeline on new journal entries
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.journal_to_site_timeline()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_site_id UUID;
BEGIN
  -- Find site via request
  IF NEW.primary_request_id IS NOT NULL THEN
    SELECT site_id INTO v_site_id FROM ops.requests WHERE request_id = NEW.primary_request_id;
  END IF;

  -- Fallback: find site via place
  IF v_site_id IS NULL AND NEW.primary_place_id IS NOT NULL THEN
    SELECT cp.colony_id INTO v_site_id
    FROM sot.colony_places cp
    JOIN sot.colonies c ON c.colony_id = cp.colony_id AND c.deleted_at IS NULL
    WHERE cp.place_id = NEW.primary_place_id AND cp.is_active = TRUE
    LIMIT 1;
  END IF;

  IF v_site_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO ops.site_timeline (site_id, event_date, event_type, title, body, actor, source_table, source_id)
  VALUES (
    v_site_id,
    COALESCE(NEW.occurred_at, NEW.created_at),
    CASE NEW.entry_kind
      WHEN 'contact_attempt' THEN 'phone_call'
      WHEN 'field_visit' THEN 'field_visit'
      WHEN 'trap_event' THEN 'trapping'
      WHEN 'status_change' THEN 'status_change'
      ELSE 'note'
    END,
    CASE NEW.entry_kind
      WHEN 'contact_attempt' THEN 'Phone call'
      WHEN 'field_visit' THEN 'Field visit'
      WHEN 'trap_event' THEN 'Trapping event'
      ELSE COALESCE(NEW.title, 'Note')
    END,
    NEW.body,
    COALESCE(NEW.created_by_staff_name, NEW.created_by),
    'journal_entries',
    NEW.id
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_to_timeline ON ops.journal_entries;
CREATE TRIGGER trg_journal_to_timeline
  AFTER INSERT ON ops.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION ops.journal_to_site_timeline();

-- ============================================================================
-- 6. Extend request creation trigger: auto-create site when 2+ requests at same place
-- ============================================================================

CREATE OR REPLACE FUNCTION ops.auto_site_on_request()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_site_id UUID;
  v_place_name TEXT;
  v_request_count INT;
BEGIN
  IF NEW.place_id IS NULL THEN RETURN NEW; END IF;

  -- Check if place already belongs to a site
  SELECT cp.colony_id INTO v_site_id
  FROM sot.colony_places cp
  JOIN sot.colonies c ON c.colony_id = cp.colony_id AND c.deleted_at IS NULL
  WHERE cp.place_id = NEW.place_id AND cp.is_active = TRUE
  LIMIT 1;

  IF v_site_id IS NOT NULL THEN
    -- Link request to existing site
    NEW.site_id := v_site_id;
    INSERT INTO sot.colony_requests (colony_id, request_id, added_by)
    VALUES (v_site_id, NEW.request_id, 'auto')
    ON CONFLICT (colony_id, request_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- No site yet — check if this place now has 2+ requests (including this one)
  SELECT COUNT(*) INTO v_request_count
  FROM ops.requests r
  WHERE r.place_id = NEW.place_id
    AND r.merged_into_request_id IS NULL
    AND r.is_archived = FALSE;

  -- v_request_count doesn't include the current INSERT yet (BEFORE trigger)
  -- so 1+ existing = 2+ total
  IF v_request_count >= 1 THEN
    SELECT COALESCE(p.display_name, split_part(p.formatted_address, ',', 1))
    INTO v_place_name
    FROM sot.places p WHERE p.place_id = NEW.place_id;

    INSERT INTO sot.colonies (name, colony_status, description)
    VALUES (COALESCE(v_place_name, 'Site'), 'active', 'Auto-created: multiple requests at this address')
    RETURNING colony_id INTO v_site_id;

    INSERT INTO sot.colony_places (colony_id, place_id, is_primary, place_role)
    VALUES (v_site_id, NEW.place_id, TRUE, 'core_site')
    ON CONFLICT (colony_id, place_id) DO NOTHING;

    -- Link ALL existing requests at this place to the new site
    UPDATE ops.requests SET site_id = v_site_id
    WHERE place_id = NEW.place_id AND merged_into_request_id IS NULL AND site_id IS NULL;

    INSERT INTO sot.colony_requests (colony_id, request_id, added_by)
    SELECT v_site_id, r.request_id, 'auto'
    FROM ops.requests r
    WHERE r.place_id = NEW.place_id AND r.merged_into_request_id IS NULL
    ON CONFLICT (colony_id, request_id) DO NOTHING;

    NEW.site_id := v_site_id;

    -- Timeline event
    INSERT INTO ops.site_timeline (site_id, event_date, event_type, title, body, source_table, source_id, actor)
    VALUES (v_site_id, NOW(), 'request_created', 'Site created', 'Auto-created from multiple requests at ' || COALESCE(v_place_name, 'this address'), 'requests', NEW.request_id, 'system');
  END IF;

  RETURN NEW;
END;
$$;

-- Replace the old auto-link trigger with this comprehensive one
DROP TRIGGER IF EXISTS trg_auto_request_scope ON ops.requests;
DROP TRIGGER IF EXISTS trg_auto_site_request ON ops.requests;
CREATE TRIGGER trg_auto_site_request
  BEFORE INSERT ON ops.requests
  FOR EACH ROW
  EXECUTE FUNCTION ops.auto_site_on_request();

-- Keep the scope trigger but as AFTER (it uses NEW.request_id which needs to exist)
CREATE OR REPLACE FUNCTION ops.auto_populate_request_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_corridor RECORD;
BEGIN
  IF NEW.place_id IS NULL THEN RETURN NEW; END IF;

  FOR v_corridor IN
    SELECT place_id, relationship FROM sot.get_corridor_places(NEW.place_id)
  LOOP
    INSERT INTO ops.request_scope_places (request_id, place_id, role, added_by)
    VALUES (NEW.request_id, v_corridor.place_id,
      CASE WHEN v_corridor.relationship = 'self' THEN 'anchor' ELSE 'scope' END,
      'auto_corridor')
    ON CONFLICT (request_id, place_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_request_scope
  AFTER INSERT ON ops.requests
  FOR EACH ROW
  EXECUTE FUNCTION ops.auto_populate_request_scope();
