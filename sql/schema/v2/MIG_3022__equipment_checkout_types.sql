-- MIG_3022: Update equipment checkout types
-- Old: client, trapper, internal, foster
-- New: public, trapper, foster, relo, clinic
-- "client" → "public", "internal" → "clinic"

BEGIN;

UPDATE ops.equipment_events
SET checkout_type = 'public'
WHERE checkout_type = 'client';

UPDATE ops.equipment
SET checkout_type = 'public'
WHERE checkout_type = 'client';

UPDATE ops.equipment_events
SET checkout_type = 'clinic'
WHERE checkout_type = 'internal';

UPDATE ops.equipment
SET checkout_type = 'clinic'
WHERE checkout_type = 'internal';

COMMIT;
