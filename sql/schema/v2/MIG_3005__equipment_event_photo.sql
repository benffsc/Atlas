-- MIG_3005: Add photo_url to equipment_events
-- Allows capturing condition photos at check-in/check-out time
-- FFS-927 / FFS-928

ALTER TABLE ops.equipment_events ADD COLUMN IF NOT EXISTS photo_url TEXT;
COMMENT ON COLUMN ops.equipment_events.photo_url IS 'Photo at time of event (damage, condition evidence)';
