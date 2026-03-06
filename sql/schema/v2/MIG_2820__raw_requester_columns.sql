-- MIG_2820: Add raw requester contact columns to ops.requests
-- FFS-146: Store raw contact info for auto-resolution when no person is selected
--
-- These columns preserve the caller's name/phone/email even when no
-- requester_person_id is resolved, enabling deferred person resolution.

ALTER TABLE ops.requests
  ADD COLUMN IF NOT EXISTS raw_requester_name TEXT,
  ADD COLUMN IF NOT EXISTS raw_requester_phone TEXT,
  ADD COLUMN IF NOT EXISTS raw_requester_email TEXT;

COMMENT ON COLUMN ops.requests.raw_requester_name IS 'Raw caller name from form when no person selected (FFS-146)';
COMMENT ON COLUMN ops.requests.raw_requester_phone IS 'Raw phone from form, always stored for resolution fallback (FFS-146)';
COMMENT ON COLUMN ops.requests.raw_requester_email IS 'Raw email from form, always stored for resolution fallback (FFS-146)';
