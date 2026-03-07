-- MIG_2849: Add call_type column to intake_submissions
-- The form captures call_type (community colony TNR, kitten rescue, etc.) but it was only
-- concatenated into situation_description. This adds a proper column for it.

ALTER TABLE ops.intake_submissions ADD COLUMN IF NOT EXISTS call_type TEXT;

COMMENT ON COLUMN ops.intake_submissions.call_type IS 'Type of call: community_colony_tnr, kitten_rescue, owned_cat, etc. From intake form call_type field.';
