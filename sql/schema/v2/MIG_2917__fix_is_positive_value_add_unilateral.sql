-- MIG_2914: Add 'unilateral' to is_positive_value() (FFS-478)
--
-- Bug: ClinicHQ Cryptorchid field uses 'Unilateral' (meaning one undescended testicle)
-- but is_positive_value() only recognized Left/Right/Bilateral.
-- This caused 3+ historical and 1 current cryptorchid observations to be missed.
--
-- Fix: Add 'unilateral' to the IN list. This is a valid positive indicator
-- meaning the condition IS present on one side (unspecified which).

CREATE OR REPLACE FUNCTION sot.is_positive_value(val TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- Handles (case-insensitive):
  -- - Yes, TRUE, true, Y, Checked, Positive, 1
  -- - Left, Right, Bilateral, Unilateral (for cryptorchid/laterality fields)
  -- Returns FALSE for: NULL, empty string, '---', any other value
  RETURN COALESCE(LOWER(TRIM(val)), '') IN
    ('yes', 'true', 'y', 'checked', 'positive', '1', 'left', 'right', 'bilateral', 'unilateral');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION sot.is_positive_value IS
'Checks if a ClinicHQ checkbox/status value indicates positive/true.
MIG_2914/FFS-478: Added ''unilateral'' — ClinicHQ Cryptorchid uses this
to indicate condition present on one side.';
