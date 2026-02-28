-- MIG_2580: Add archive support to requests
-- Allows staff to archive requests with reasons, similar to intake decline and journal archive patterns
-- Date: 2026-02-27

-- Add archive columns to ops.requests
ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by TEXT,
ADD COLUMN IF NOT EXISTS archive_reason TEXT,
ADD COLUMN IF NOT EXISTS archive_notes TEXT;

-- Index for filtering archived requests (partial index for efficiency)
CREATE INDEX IF NOT EXISTS idx_requests_is_archived
ON ops.requests(is_archived) WHERE is_archived = TRUE;

-- Add comment explaining archive reasons
COMMENT ON COLUMN ops.requests.archive_reason IS 'Archive reason code: duplicate, merged, out_of_area, no_response, withdrawn, resolved_elsewhere, invalid, test_data, other';
COMMENT ON COLUMN ops.requests.archive_notes IS 'Optional notes explaining archive reason (required for merged, resolved_elsewhere, other)';

-- Update v_request_list view to exclude archived by default
-- Note: The view definition needs to add WHERE clause, but we'll handle filtering in the API
-- This keeps the view flexible for showing archived requests when needed

-- Verify columns were added
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ops' AND table_name = 'requests' AND column_name = 'is_archived'
  ) THEN
    RAISE EXCEPTION 'Column is_archived was not created';
  END IF;

  RAISE NOTICE 'MIG_2580: Archive columns added to ops.requests successfully';
END $$;
