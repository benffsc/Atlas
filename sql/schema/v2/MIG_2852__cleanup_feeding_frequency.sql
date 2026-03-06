-- MIG_2852: Clean up invalid feeding_frequency values from atlas_ui
--
-- Problem: Staff typed free text into a free-text input that maps to the
-- feeding_frequency enum column (valid: daily, few_times_week, occasionally, rarely).
-- 9 rows have invalid values from atlas_ui source.
--
-- Fixes FFS-258

BEGIN;

-- 1. twice_daily (7 rows) → daily, preserve detail in internal_notes
UPDATE ops.requests
SET feeding_frequency = 'daily',
    internal_notes = COALESCE(internal_notes || E'\n', '') || '[MIG_2852] Original feeding_frequency was "twice_daily" — mapped to daily',
    updated_at = NOW()
WHERE feeding_frequency = 'twice_daily';

-- 2. "once a day" (1 row) → daily
UPDATE ops.requests
SET feeding_frequency = 'daily',
    internal_notes = COALESCE(internal_notes || E'\n', '') || '[MIG_2852] Original feeding_frequency was "once a day" — mapped to daily',
    updated_at = NOW()
WHERE feeding_frequency = 'once a day';

-- 3. "twice a day, same spot" (1 row) → daily, preserve "same spot" detail
UPDATE ops.requests
SET feeding_frequency = 'daily',
    internal_notes = COALESCE(internal_notes || E'\n', '') || '[MIG_2852] Original feeding_frequency was "twice a day, same spot" — mapped to daily, detail preserved',
    updated_at = NOW()
WHERE feeding_frequency = 'twice a day, same spot';

-- Verification: should return 0 rows
SELECT request_id, feeding_frequency, source_system
FROM ops.requests
WHERE feeding_frequency IS NOT NULL
  AND feeding_frequency NOT IN ('daily', 'few_times_week', 'occasionally', 'rarely');

COMMIT;
