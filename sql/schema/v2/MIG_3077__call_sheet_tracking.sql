-- MIG_3077: Call Sheet Tracking
--
-- Call sheets are batches of outreach calls assigned to trappers.
-- Currently print-only artifacts — this migration makes them tracked
-- digital entities with lifecycle, disposition tracking, and conversion
-- to trapping assignments.
--
-- Two-level model:
--   ops.call_sheets       — the batch (assigned to a trapper, has a due date)
--   ops.call_sheet_items  — individual calls with disposition tracking
--
-- See also: ops.request_trapper_assignments (conversion target)

BEGIN;

-- =============================================================================
-- TABLE: ops.call_sheets
-- =============================================================================

CREATE TABLE ops.call_sheets (
  call_sheet_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  title             TEXT NOT NULL,

  -- Assignment
  assigned_to_person_id UUID REFERENCES sot.people(person_id),
  created_by        TEXT,  -- staff who created it

  -- Lifecycle
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'assigned', 'in_progress', 'completed', 'expired')),
  due_date          DATE,

  -- Notes
  notes             TEXT,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_call_sheets_assigned_to ON ops.call_sheets(assigned_to_person_id);
CREATE INDEX idx_call_sheets_status ON ops.call_sheets(status);
CREATE INDEX idx_call_sheets_due_date ON ops.call_sheets(due_date) WHERE due_date IS NOT NULL;

COMMENT ON TABLE ops.call_sheets IS 'Batches of outreach calls assigned to trappers. Tracks what was sent out, outcomes, and conversions to trapping assignments.';
COMMENT ON COLUMN ops.call_sheets.assigned_to_person_id IS 'The trapper who receives this call sheet. FK to sot.people with trapper role.';
COMMENT ON COLUMN ops.call_sheets.created_by IS 'Staff user who created the sheet (UUID as text, consistent with email_batches pattern).';

-- =============================================================================
-- TABLE: ops.call_sheet_items
-- =============================================================================

CREATE TABLE ops.call_sheet_items (
  item_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sheet_id     UUID NOT NULL REFERENCES ops.call_sheets(call_sheet_id) ON DELETE CASCADE,

  -- Who to call
  contact_name      TEXT NOT NULL,
  contact_phone     TEXT,
  contact_email     TEXT,

  -- Where the cats are
  place_id          UUID REFERENCES sot.places(place_id),
  place_address     TEXT,  -- denormalized for printing

  -- Links to existing entities (nullable — some calls are pre-request)
  request_id        UUID REFERENCES ops.requests(request_id),
  person_id         UUID REFERENCES sot.people(person_id),

  -- Sort order on the sheet
  priority_order    INTEGER NOT NULL DEFAULT 0,

  -- Call outcome tracking
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'attempted', 'follow_up', 'converted', 'dead_end', 'skipped')),
  disposition       TEXT CHECK (disposition IN (
    -- Contact outcomes
    'reached', 'left_voicemail', 'left_message_person',
    'no_answer', 'busy', 'wrong_number', 'disconnected',
    'not_interested', 'already_resolved', 'do_not_contact',
    -- Conversion outcomes
    'scheduled_trapping', 'scheduled_callback', 'needs_more_info',
    'referred_elsewhere', 'appointment_booked'
  )),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  follow_up_at      TIMESTAMPTZ,
  notes             TEXT,

  -- Conversion tracking
  converted_to_type TEXT CHECK (converted_to_type IN ('request_assignment', 'new_request', 'appointment')),
  converted_to_id   UUID,  -- polymorphic FK (request_id, assignment_id, or appointment_id)
  converted_at      TIMESTAMPTZ,

  -- Context for the trapper
  context_summary   TEXT,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_csi_call_sheet ON ops.call_sheet_items(call_sheet_id);
CREATE INDEX idx_csi_request ON ops.call_sheet_items(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_csi_status ON ops.call_sheet_items(status);
CREATE INDEX idx_csi_follow_up ON ops.call_sheet_items(follow_up_at) WHERE follow_up_at IS NOT NULL AND status = 'follow_up';

COMMENT ON TABLE ops.call_sheet_items IS 'Individual calls on a call sheet with disposition and conversion tracking.';
COMMENT ON COLUMN ops.call_sheet_items.disposition IS 'What happened when the trapper tried to call. Separate from status (lifecycle stage).';
COMMENT ON COLUMN ops.call_sheet_items.converted_to_type IS 'What the successful call became: request_assignment, new_request, or appointment.';
COMMENT ON COLUMN ops.call_sheet_items.context_summary IS 'Brief context for the trapper (pulled from request/intake at sheet creation time).';

-- =============================================================================
-- TRIGGERS: updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION ops.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_call_sheets_updated_at
  BEFORE UPDATE ON ops.call_sheets
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

CREATE TRIGGER trg_call_sheet_items_updated_at
  BEFORE UPDATE ON ops.call_sheet_items
  FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();

-- =============================================================================
-- VIEW: ops.v_call_sheet_summary
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_call_sheet_summary AS
SELECT
  cs.call_sheet_id,
  cs.title,
  cs.status,
  cs.due_date,
  cs.notes,
  cs.created_at,
  cs.updated_at,
  cs.assigned_at,
  cs.completed_at,
  cs.created_by,
  cs.assigned_to_person_id,
  p.display_name AS assigned_to_name,
  pr.trapper_type AS assigned_to_trapper_type,
  COUNT(csi.item_id)                                          AS total_items,
  COUNT(csi.item_id) FILTER (WHERE csi.status = 'pending')    AS pending_count,
  COUNT(csi.item_id) FILTER (WHERE csi.status = 'attempted')  AS attempted_count,
  COUNT(csi.item_id) FILTER (WHERE csi.status = 'follow_up')  AS follow_up_count,
  COUNT(csi.item_id) FILTER (WHERE csi.status = 'converted')  AS converted_count,
  COUNT(csi.item_id) FILTER (WHERE csi.status = 'dead_end')   AS dead_end_count,
  COUNT(csi.item_id) FILTER (WHERE csi.status = 'skipped')    AS skipped_count,
  COUNT(csi.item_id) FILTER (WHERE csi.status NOT IN ('pending', 'skipped')) AS completed_items,
  CASE
    WHEN cs.due_date IS NOT NULL AND cs.due_date < CURRENT_DATE AND cs.status NOT IN ('completed', 'expired')
    THEN TRUE ELSE FALSE
  END AS is_overdue
FROM ops.call_sheets cs
LEFT JOIN ops.call_sheet_items csi ON csi.call_sheet_id = cs.call_sheet_id
LEFT JOIN sot.people p ON p.person_id = cs.assigned_to_person_id
LEFT JOIN sot.person_roles pr ON pr.person_id = cs.assigned_to_person_id AND pr.role = 'trapper'
GROUP BY cs.call_sheet_id, p.display_name, pr.trapper_type;

COMMENT ON VIEW ops.v_call_sheet_summary IS 'Call sheets with aggregated item counts and trapper info. Used by /api/admin/call-sheets list endpoint.';

-- =============================================================================
-- VIEW: ops.v_call_sheet_items_detail
-- =============================================================================

CREATE OR REPLACE VIEW ops.v_call_sheet_items_detail AS
SELECT
  csi.*,
  pl.display_name AS place_name,
  pl.formatted_address AS place_full_address,
  r.status AS request_status,
  r.summary AS request_summary,
  r.priority AS request_priority,
  per.display_name AS person_name,
  per.primary_phone,
  per.primary_email
FROM ops.call_sheet_items csi
LEFT JOIN sot.places pl ON pl.place_id = csi.place_id
LEFT JOIN ops.requests r ON r.request_id = csi.request_id
LEFT JOIN sot.v_person_list_v3 per ON per.person_id = csi.person_id;

COMMENT ON VIEW ops.v_call_sheet_items_detail IS 'Call sheet items joined with place, request, and person details. Used by /api/admin/call-sheets/[id] detail endpoint.';

-- =============================================================================
-- NAV ITEM: Add Call Sheets to admin sidebar
-- =============================================================================

INSERT INTO ops.nav_items (sidebar, section, label, path, icon, sort_order)
VALUES ('admin', 'Dashboard', 'Call Sheets', '/admin/call-sheets', 'phone-outgoing', 25);

COMMIT;
