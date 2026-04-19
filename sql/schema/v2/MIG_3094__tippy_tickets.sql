-- MIG_3094: Tippy Tickets — Field Intelligence Capture
--
-- Staff accumulates field intelligence that has no source system home.
-- Not an intake submission, not a trapping request, not in ClinicHQ/ShelterLuv.
-- This context gets lost. Tippy Tickets capture it and link it to entities.
--
-- Example: "Vicki called, works near an FFSC cat house at 1580 E Washington,
--           saw a pregnant-looking cat. Turns out it's already fixed, just fat."
-- → Creates person, links place, records observation, flags medical follow-up.

\echo ''
\echo '=============================================='
\echo '  MIG_3094: Tippy Tickets'
\echo '=============================================='
\echo ''

-- ============================================================================
-- 1. Create ops.tippy_tickets table
-- ============================================================================

\echo '1. Creating ops.tippy_tickets table...'

CREATE TABLE IF NOT EXISTS ops.tippy_tickets (
  ticket_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  priority          TEXT NOT NULL DEFAULT 'normal',

  -- The raw field intelligence
  raw_input         TEXT NOT NULL,
  summary           TEXT,

  -- Primary entity links (what this ticket is mainly about)
  primary_place_id  UUID REFERENCES sot.places(place_id),
  primary_person_id UUID REFERENCES sot.people(person_id),
  primary_cat_id    UUID REFERENCES sot.cats(cat_id),
  primary_request_id UUID REFERENCES ops.requests(request_id),

  -- All entities involved (broader than primary)
  -- [{entity_type, entity_id, role, display_name}]
  linked_entities   JSONB NOT NULL DEFAULT '[]',

  -- Actions taken as a result of this ticket
  -- [{action, entity_type, entity_id, description, performed_at}]
  actions_taken     JSONB NOT NULL DEFAULT '[]',

  -- Follow-up tracking
  followup_date     DATE,
  followup_notes    TEXT,
  resolved_at       TIMESTAMPTZ,
  resolution_notes  TEXT,

  -- Attribution
  reported_by       TEXT,    -- Who reported (staff name or "community")
  source            TEXT NOT NULL DEFAULT 'staff',

  tags              TEXT[] NOT NULL DEFAULT '{}',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Constraints
ALTER TABLE ops.tippy_tickets
  DROP CONSTRAINT IF EXISTS chk_tippy_ticket_type,
  ADD CONSTRAINT chk_tippy_ticket_type CHECK (
    ticket_type IN (
      'person_intel', 'site_observation', 'site_relationship',
      'cat_return_context', 'data_correction', 'followup_needed',
      'general_intel'
    )
  );

ALTER TABLE ops.tippy_tickets
  DROP CONSTRAINT IF EXISTS chk_tippy_ticket_status,
  ADD CONSTRAINT chk_tippy_ticket_status CHECK (
    status IN ('open', 'actioned', 'closed', 'deferred')
  );

ALTER TABLE ops.tippy_tickets
  DROP CONSTRAINT IF EXISTS chk_tippy_ticket_priority,
  ADD CONSTRAINT chk_tippy_ticket_priority CHECK (
    priority IN ('low', 'normal', 'high', 'urgent')
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tippy_tickets_status
  ON ops.tippy_tickets(status) WHERE status != 'closed';

CREATE INDEX IF NOT EXISTS idx_tippy_tickets_type
  ON ops.tippy_tickets(ticket_type);

CREATE INDEX IF NOT EXISTS idx_tippy_tickets_followup
  ON ops.tippy_tickets(followup_date) WHERE followup_date IS NOT NULL AND status != 'closed';

CREATE INDEX IF NOT EXISTS idx_tippy_tickets_primary_place
  ON ops.tippy_tickets(primary_place_id) WHERE primary_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tippy_tickets_primary_person
  ON ops.tippy_tickets(primary_person_id) WHERE primary_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tippy_tickets_primary_cat
  ON ops.tippy_tickets(primary_cat_id) WHERE primary_cat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tippy_tickets_tags
  ON ops.tippy_tickets USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_tippy_tickets_linked_entities
  ON ops.tippy_tickets USING GIN(linked_entities);

COMMENT ON TABLE ops.tippy_tickets IS
  'Field intelligence that has no source system home. Staff describes reality, '
  'system captures context and links to entities. MIG_3094.';

\echo ''
\echo '✓ MIG_3094 complete — ops.tippy_tickets created'
\echo ''
