-- MIG_3081: Seed relatedPlaces section into form configs
--
-- Adds the relatedPlaces section to the ffr_new and dynamic_intake form configs.
-- Form configs are stored in ops.app_config as JSONB with key = 'form_config.<id>'.
-- The sections array is at value->'sections'.

-- Add to ffr_new (staff new request form)
UPDATE ops.app_config
SET value = jsonb_set(
  value,
  '{sections}',
  (value->'sections') || '[{"component": "relatedPlaces"}]'::jsonb
),
updated_at = NOW()
WHERE key = 'form_config.ffr_new'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(value->'sections') AS s
    WHERE s->>'component' = 'relatedPlaces'
  );

-- Add to dynamic_intake (intake conversion wizard)
UPDATE ops.app_config
SET value = jsonb_set(
  value,
  '{sections}',
  (value->'sections') || '[{"component": "relatedPlaces"}]'::jsonb
),
updated_at = NOW()
WHERE key = 'form_config.dynamic_intake'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(value->'sections') AS s
    WHERE s->>'component' = 'relatedPlaces'
  );
