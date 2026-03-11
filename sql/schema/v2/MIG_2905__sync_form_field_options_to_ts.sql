-- MIG_2905: Sync ops.form_field_definitions options to match field-options.ts
--
-- The print system (field-options.ts) is what staff see on paper forms.
-- The DB must match it so server-side validation doesn't reject valid data.
--
-- 6 UPDATEs to fix option mismatches between DB registry and TS constants.

BEGIN;

-- 1. count_confidence: DB had "Good Estimate, Rough Guess" → TS uses "Estimate"
UPDATE ops.form_field_definitions
SET options = '["Exact", "Estimate", "Unknown"]'::jsonb
WHERE field_key = 'count_confidence';

-- 2. fixed_status: DB had "Most/All fixed" → TS uses "All fixed"
UPDATE ops.form_field_definitions
SET options = '["None fixed", "Some fixed", "All fixed", "Unknown"]'::jsonb
WHERE field_key = 'fixed_status';

-- 3. urgency_reasons: DB had 8 items → TS has 5 canonical reasons
UPDATE ops.form_field_definitions
SET options = '["Injured cat", "Sick cat", "Abandoned kittens", "Pregnant cat", "Immediate danger"]'::jsonb
WHERE field_key = 'urgency_reasons';

-- 4. permission_status: DB had "Granted/Denied" → TS uses "Yes/No"
UPDATE ops.form_field_definitions
SET options = '["Yes", "Pending", "No"]'::jsonb
WHERE field_key = 'permission_status';

-- 5. kitten_readiness: DB had "Medium (needs socialization)" → TS uses "Medium (needs work)"
UPDATE ops.form_field_definitions
SET options = '["High (friendly, ideal age)", "Medium (needs work)", "Low (FFR likely)"]'::jsonb
WHERE field_key = 'kitten_readiness';

-- 6. important_notes: Sync to full labels matching field-options.ts L148-158
UPDATE ops.form_field_definitions
SET options = '["Withhold food 24hr before", "Other feeders in area", "Cats cross property lines", "Pregnant cat suspected", "Injured/sick cat priority", "Caller can help trap", "Wildlife concerns", "Neighbor issues", "Urgent / time-sensitive"]'::jsonb
WHERE field_key = 'important_notes';

-- 7. Add cats_friendly if missing (exists in DB but was missing from TS — now added)
-- This is a no-op if options already match.
UPDATE ops.form_field_definitions
SET options = '["Yes", "No", "Mixed", "Unknown"]'::jsonb
WHERE field_key = 'cats_friendly';

COMMIT;
