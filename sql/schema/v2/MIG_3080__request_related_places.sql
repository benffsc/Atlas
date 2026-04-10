-- MIG_3080: Request related places
--
-- Problem: Multi-location TNR context (feeder addresses, colony extent, staging
-- areas) lives in free-text notes — invisible to Beacon analytics, search,
-- population models, and colony mapping. ops.requests has a single place_id (1:1).
--
-- Fix: ops.request_related_places junction table, mirroring MIG_3073's
-- ops.request_related_people pattern exactly.
--
-- Example: April Lofgren — trapping at 2408 Summer Creek Dr (primary place_id),
-- suspected source at 2419 Park Creek Dr, colony extends to Holly Oak Dr.

-- =============================================================================
-- 1. New table: ops.request_related_places
-- =============================================================================

CREATE TABLE IF NOT EXISTS ops.request_related_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ops.requests(request_id) ON DELETE CASCADE,
  place_id UUID NOT NULL REFERENCES sot.places(place_id),
  relationship_type TEXT NOT NULL,
  relationship_notes TEXT,
  is_primary_trapping_site BOOLEAN DEFAULT FALSE,
  evidence_type TEXT DEFAULT 'manual',
  confidence NUMERIC(3,2) DEFAULT 0.9,
  source_system TEXT DEFAULT 'atlas_ui',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, place_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_rrpl_request ON ops.request_related_places(request_id);
CREATE INDEX IF NOT EXISTS idx_rrpl_place ON ops.request_related_places(place_id);

COMMENT ON TABLE ops.request_related_places IS 'Flexible related-place links for requests (trapping sites, suspected sources, colony extents, feeder locations, etc.)';
COMMENT ON COLUMN ops.request_related_places.relationship_type IS 'suspected_source, trapping_site, colony_extent, feeder_location, staging_area, property_owner_address, other';
COMMENT ON COLUMN ops.request_related_places.is_primary_trapping_site IS 'Mark one related place as the primary trapping site (distinct from request.place_id which is the request location)';
