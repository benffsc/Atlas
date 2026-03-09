-- MIG_2882: Fix ops.clinic_day_entries schema gaps
--
-- Three issues found:
-- 1. No updated_at column — PATCH route sets it → 500
-- 2. Status CHECK constraint only allows surgical workflow statuses
--    (checked_in/in_surgery/recovering/released/held) but import route
--    writes master list statuses (completed/no_show/cancelled/partial/pending)
-- 3. No place_id or request_id columns — PATCH route allows updating them → 500

BEGIN;

-- 1. Add updated_at column
ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 2. Expand status CHECK to include both surgical workflow AND master list statuses
ALTER TABLE ops.clinic_day_entries
  DROP CONSTRAINT IF EXISTS clinic_day_entries_status_check;

ALTER TABLE ops.clinic_day_entries
  ADD CONSTRAINT clinic_day_entries_status_check
  CHECK (status IN (
    -- Surgical workflow (original)
    'checked_in', 'in_surgery', 'recovering', 'released', 'held',
    -- Master list import statuses
    'completed', 'no_show', 'cancelled', 'partial', 'pending'
  ));

-- 3. Add place_id and request_id columns for entry linking
ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS place_id UUID REFERENCES sot.places(place_id);

ALTER TABLE ops.clinic_day_entries
  ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES ops.requests(request_id);

COMMIT;
