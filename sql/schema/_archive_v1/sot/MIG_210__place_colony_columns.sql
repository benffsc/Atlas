-- MIG_210: Add colony size columns directly to places table
-- These columns are computed from place_colony_estimates and v_place_colony_status
-- Having them directly on the place makes them accessible to Beacon without complex joins
--
-- Colony size represents our best estimate of total cats at a location,
-- distinct from "cats caught" (verified clinic data).
--
-- Alteration rate = verified_altered_count / colony_size_estimate

-- Add colony columns to places
ALTER TABLE trapper.places ADD COLUMN IF NOT EXISTS colony_size_estimate INTEGER;
ALTER TABLE trapper.places ADD COLUMN IF NOT EXISTS colony_confidence NUMERIC(3,2);
ALTER TABLE trapper.places ADD COLUMN IF NOT EXISTS colony_estimate_count INTEGER DEFAULT 0;
ALTER TABLE trapper.places ADD COLUMN IF NOT EXISTS colony_updated_at TIMESTAMPTZ;

-- Index for querying places with colony data
CREATE INDEX IF NOT EXISTS idx_places_colony_size ON trapper.places(colony_size_estimate) WHERE colony_size_estimate > 0;

-- Function to sync colony data from view to places table
CREATE OR REPLACE FUNCTION trapper.sync_place_colony_data()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE trapper.places p
  SET
    colony_size_estimate = v.colony_size_estimate,
    colony_confidence = v.final_confidence,
    colony_estimate_count = v.estimate_count,
    colony_updated_at = NOW()
  FROM trapper.v_place_colony_status v
  WHERE p.place_id = v.place_id
    AND (
      p.colony_size_estimate IS DISTINCT FROM v.colony_size_estimate
      OR p.colony_confidence IS DISTINCT FROM v.final_confidence
      OR p.colony_estimate_count IS DISTINCT FROM v.estimate_count
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- Initial sync
SELECT trapper.sync_place_colony_data();

-- Comment explaining the columns
COMMENT ON COLUMN trapper.places.colony_size_estimate IS 'Weighted estimate of total cats at this location from multiple sources';
COMMENT ON COLUMN trapper.places.colony_confidence IS 'Confidence score (0-1) of the colony estimate based on source quality and recency';
COMMENT ON COLUMN trapper.places.colony_estimate_count IS 'Number of estimates contributing to the colony size calculation';
COMMENT ON COLUMN trapper.places.colony_updated_at IS 'Last time colony data was synced from estimates';
