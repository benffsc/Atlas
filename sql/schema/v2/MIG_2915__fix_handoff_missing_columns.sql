-- MIG_2915: Add missing kitten assessment columns to ops.requests
--
-- Fixes FFS-480: Handoff fails with "column kitten_assessment_status of relation requests does not exist"
--
-- These columns were defined in MIG_2495 but never applied to production.
-- The ops.handoff_request() function (MIG_2854) passes them to ops.find_or_create_request()
-- (MIG_2853) which tries to INSERT them into ops.requests.

BEGIN;

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_assessment_status TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_assessment_outcome TEXT;
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_not_needed_reason TEXT;

COMMIT;
