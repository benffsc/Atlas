-- MIG_2817: Add missing columns to ops.requests for new request form fields
-- FFS-145: The /requests/new form sends ~21 fields that have no DB column,
-- causing silent data loss on every request creation.
--
-- These columns align with what ops.intake_submissions already captures
-- (via MIG_2531/2532) but were never added to ops.requests.

BEGIN;

-- === Request Purpose ===
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS request_purpose TEXT;
COMMENT ON COLUMN ops.requests.request_purpose IS 'Primary purpose: tnr, relocation, rescue, wellness';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS request_purposes TEXT[];
COMMENT ON COLUMN ops.requests.request_purposes IS 'All selected purposes (array)';

-- === Location Detail ===
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS location_description TEXT;
COMMENT ON COLUMN ops.requests.location_description IS 'Where on property cats are seen (e.g. "In the patio, lower floor")';

-- === Contact & Scheduling ===
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS best_times_seen TEXT;
COMMENT ON COLUMN ops.requests.best_times_seen IS 'When cats are typically visible at the location';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS best_contact_times TEXT;
COMMENT ON COLUMN ops.requests.best_contact_times IS 'When requester is available to be contacted';

-- === Property Access ===
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS traps_overnight_safe BOOLEAN;
COMMENT ON COLUMN ops.requests.traps_overnight_safe IS 'Whether traps can safely be left overnight';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS access_without_contact BOOLEAN;
COMMENT ON COLUMN ops.requests.access_without_contact IS 'Whether trappers can access property without contacting requester';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS permission_status TEXT;
COMMENT ON COLUMN ops.requests.permission_status IS 'Property access authorization status';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS property_owner_name TEXT;
COMMENT ON COLUMN ops.requests.property_owner_name IS 'Name of property owner when requester is not the owner';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS property_owner_phone TEXT;
COMMENT ON COLUMN ops.requests.property_owner_phone IS 'Phone of property owner when requester is not the owner';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS authorization_pending BOOLEAN;
COMMENT ON COLUMN ops.requests.authorization_pending IS 'Whether property authorization is in progress';

-- === Eartip Estimate ===
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS eartip_estimate TEXT;
COMMENT ON COLUMN ops.requests.eartip_estimate IS 'Qualitative eartip estimate: none, few, some, most, all, unknown';

-- === Kitten Details ===
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_age_weeks INTEGER;
COMMENT ON COLUMN ops.requests.kitten_age_weeks IS 'Kitten age in weeks (numeric)';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_mixed_ages_description TEXT;
COMMENT ON COLUMN ops.requests.kitten_mixed_ages_description IS 'Description when kittens are mixed ages';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS kitten_notes TEXT;
COMMENT ON COLUMN ops.requests.kitten_notes IS 'General kitten notes';

-- === Wellness ===
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS wellness_cat_count INTEGER;
COMMENT ON COLUMN ops.requests.wellness_cat_count IS 'Number of cats for wellness purpose';

-- === Urgency ===
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS urgency_reasons TEXT[];
COMMENT ON COLUMN ops.requests.urgency_reasons IS 'Reasons the request is urgent (array)';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS urgency_deadline TEXT;
COMMENT ON COLUMN ops.requests.urgency_deadline IS 'Urgency deadline info';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS urgency_notes TEXT;
COMMENT ON COLUMN ops.requests.urgency_notes IS 'Free text urgency details';

-- === Entry Metadata ===
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS entry_mode TEXT;
COMMENT ON COLUMN ops.requests.entry_mode IS 'Form mode used: standard or complete (Quick Complete)';

ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS completion_data JSONB;
COMMENT ON COLUMN ops.requests.completion_data IS 'Quick Complete mode audit data (final counts, observations, referrals)';

-- === Cats Are Friendly ===
-- This field exists in the form but the column may not exist yet
ALTER TABLE ops.requests ADD COLUMN IF NOT EXISTS cats_are_friendly BOOLEAN;
COMMENT ON COLUMN ops.requests.cats_are_friendly IS 'Whether the cats are reported as friendly/approachable';

COMMIT;
