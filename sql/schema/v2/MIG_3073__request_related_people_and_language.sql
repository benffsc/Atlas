-- MIG_3073: Request related people and language preferences
--
-- Problem: People like Sonia Cano (cat owner linked by microchip) get buried
-- in free-text notes. Staff's language-matching logic (assigning Spanish-speaking
-- trappers) lives only in their heads. No structured "related people" beyond
-- the 3 fixed slots (requester, site_contact, property_owner).
--
-- Fix:
--   1a. ops.request_related_people — flexible relationship table
--   1b. preferred_language on sot.people, sot.trapper_profiles, ops.requests

-- =============================================================================
-- 1a. New table: ops.request_related_people
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.request_related_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ops.requests(request_id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES sot.people(person_id),
  relationship_type TEXT NOT NULL,
  relationship_notes TEXT,
  notify_before_release BOOLEAN DEFAULT FALSE,
  preferred_language TEXT,
  evidence_type TEXT DEFAULT 'manual',
  confidence NUMERIC(3,2) DEFAULT 0.9,
  source_system TEXT DEFAULT 'atlas_ui',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, person_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_rrp_request ON ops.request_related_people(request_id);
CREATE INDEX IF NOT EXISTS idx_rrp_person ON ops.request_related_people(person_id);

COMMENT ON TABLE ops.request_related_people IS 'Flexible related-people links for requests (cat owners, neighbors, transporters, etc.)';
COMMENT ON COLUMN ops.request_related_people.relationship_type IS 'cat_owner, caretaker, neighbor, family_member, tenant, landlord, transporter, rescue_contact, other';
COMMENT ON COLUMN ops.request_related_people.notify_before_release IS 'Should this person be notified before cats are released?';
COMMENT ON COLUMN ops.request_related_people.preferred_language IS 'Language preference for this person in context of this request (en, es, vi, tl, other)';

-- =============================================================================
-- 1b. Language columns on existing tables
-- =============================================================================

ALTER TABLE sot.people ADD COLUMN IF NOT EXISTS preferred_language TEXT;
COMMENT ON COLUMN sot.people.preferred_language IS 'Language preference (en, es, vi, tl, other). Manual > AI invariant applies.';

ALTER TABLE sot.trapper_profiles ADD COLUMN IF NOT EXISTS languages_spoken TEXT[];
COMMENT ON COLUMN sot.trapper_profiles.languages_spoken IS 'Array of languages the trapper speaks (for assignment matching)';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS preferred_language TEXT;
COMMENT ON COLUMN ops.requests.preferred_language IS 'Language preference for this request (drives trapper matching)';
