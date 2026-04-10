-- MIG_3081: Seed relatedPlaces section into form configs
--
-- Adds the relatedPlaces section to the ffr_new and dynamic_intake form configs.
-- Config-gated: won't appear until admin enables it for a given form context.

-- Add to ffr_new (staff new request form)
UPDATE ops.form_section_configs
SET sections = sections || '[{"component": "relatedPlaces"}]'::jsonb
WHERE key = 'ffr_new'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(sections) AS s
    WHERE s->>'component' = 'relatedPlaces'
  );

-- Add to dynamic_intake (intake conversion wizard)
UPDATE ops.form_section_configs
SET sections = sections || '[{"component": "relatedPlaces"}]'::jsonb
WHERE key = 'dynamic_intake'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(sections) AS s
    WHERE s->>'component' = 'relatedPlaces'
  );
