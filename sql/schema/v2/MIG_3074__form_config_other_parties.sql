-- MIG_3074: Add otherParties section to form configs
--
-- Appends the otherParties component to existing form configs.
-- This enables the "Other People Involved" section on request forms,
-- gated by useSectionConfig() so admins can toggle it on/off.

-- Add to ffr_new (standalone new request form)
UPDATE ops.app_config
SET value = jsonb_set(
  value, '{sections}',
  COALESCE(value->'sections', '[]'::jsonb) || '[{"component":"otherParties","label":"Other People Involved","props":{"maxEntries":5}}]'::jsonb
)
WHERE key = 'form_config.ffr_new'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(value->'sections', '[]'::jsonb)) elem
    WHERE elem->>'component' = 'otherParties'
  );

-- Add to dynamic_intake (intake conversion wizard)
UPDATE ops.app_config
SET value = jsonb_set(
  value, '{sections}',
  COALESCE(value->'sections', '[]'::jsonb) || '[{"component":"otherParties","label":"Other People Involved","props":{"maxEntries":5}}]'::jsonb
)
WHERE key = 'form_config.dynamic_intake'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(value->'sections', '[]'::jsonb)) elem
    WHERE elem->>'component' = 'otherParties'
  );
