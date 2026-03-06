-- MIG_2826: Add FFS-151 trapping logistics columns to ops.requests
--
-- These columns were added to ops.intake_submissions in MIG_2532 but
-- were missing from ops.requests. The API INSERT references them,
-- causing all request submissions to fail with "column does not exist".
--
-- Fixed as part of FFS-175 investigation.

\echo 'MIG_2826: Adding trapping logistics columns to ops.requests...'

ALTER TABLE ops.requests
ADD COLUMN IF NOT EXISTS best_trapping_time TEXT,
ADD COLUMN IF NOT EXISTS ownership_status TEXT,
ADD COLUMN IF NOT EXISTS important_notes TEXT[];

COMMENT ON COLUMN ops.requests.best_trapping_time IS
'Best day/time for trapping (FFS-151). Free text from call sheet.';

COMMENT ON COLUMN ops.requests.ownership_status IS
'Cat ownership status: owned, stray, feral, unknown (FFS-151).';

COMMENT ON COLUMN ops.requests.important_notes IS
'Array of important flags from call sheet checkboxes (FFS-151):
withhold_food, other_feeders, cats_cross_property, pregnant_suspected,
injured_priority, caller_can_help, wildlife_concerns, neighbor_issues, urgent';

\echo '   Added: best_trapping_time, ownership_status, important_notes[]'
\echo 'MIG_2826: Done.'
