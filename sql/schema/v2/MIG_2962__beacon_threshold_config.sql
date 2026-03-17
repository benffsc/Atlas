-- MIG_2962: Extract hardcoded thresholds to ops.app_config
-- Part of FFS-640 (System Resilience V2.6 Batch 3)
--
-- Moves ~15 hardcoded numeric thresholds from API route code into
-- ops.app_config so they can be tuned from the admin UI without deploys.
--
-- Categories:
--   dq.*      — data quality monitoring thresholds (cron/data-quality-check)
--   beacon.*  — Beacon analytics thresholds (colony status, TNR targets)

\echo 'MIG_2962: Seeding threshold config keys into ops.app_config...'

INSERT INTO ops.app_config (key, value, category)
VALUES
  -- Data quality check thresholds (api/cron/data-quality-check)
  ('dq.cat_place_coverage_warning_pct',        '95'::jsonb,  'dq'),
  ('dq.cat_place_coverage_critical_pct',       '90'::jsonb,  'dq'),
  ('dq.pending_reviews_warning',               '100'::jsonb, 'dq'),
  ('dq.geocoding_queue_warning',               '100'::jsonb, 'dq'),
  ('dq.invalid_people_24h_warning',            '10'::jsonb,  'dq'),
  ('dq.orgs_as_people_warning',                '200'::jsonb, 'dq'),
  ('dq.clinichq_export_min_services_per_appt', '8'::jsonb,   'dq'),
  ('dq.mislinked_appointments_warning',        '50'::jsonb,  'dq'),
  ('dq.duplicate_places_warning',              '0'::jsonb,   'dq'),
  ('dq.unpropagated_matches_warning',          '0'::jsonb,   'dq'),

  -- Beacon analytics thresholds
  ('beacon.birth_interval_days',    '42'::jsonb, 'beacon'),
  ('beacon.colony_managed_pct',     '75'::jsonb, 'beacon'),
  ('beacon.colony_in_progress_pct', '50'::jsonb, 'beacon'),
  ('beacon.colony_needs_work_pct',  '25'::jsonb, 'beacon'),
  ('beacon.tnr_target_rate',        '75'::jsonb, 'beacon')
ON CONFLICT (key) DO NOTHING;

\echo '   Inserted 15 threshold config keys (dq.* + beacon.*)'

-- Verify
SELECT key, value, category
FROM ops.app_config
WHERE key LIKE 'dq.%' OR key LIKE 'beacon.%'
ORDER BY category, key;

\echo 'MIG_2962 complete.'
