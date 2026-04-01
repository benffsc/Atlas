-- MIG_3031: Kiosk Checkout Config
-- Move hardcoded checkout policy values to ops.app_config.
-- FFS-1057

INSERT INTO ops.app_config (key, value, description, category)
VALUES
  ('kiosk.deposit_presets', '[0, 50, 75]'::jsonb,
   'Default deposit amount buttons shown during checkout', 'kiosk'),
  ('kiosk.purpose_due_offsets', '{"tnr_appointment": 3, "kitten_rescue": 14, "colony_check": 7, "feeding_station": 90, "personal_pet": 14, "ffr": 3, "well_check": 7, "rescue_recovery": 14, "trap_training": 7, "transport": 3}'::jsonb,
   'Days until due date by checkout purpose', 'kiosk'),
  ('kiosk.inactivity_countdown', '30'::jsonb,
   'Seconds to count down before auto-resetting kiosk session', 'kiosk')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = NOW();
