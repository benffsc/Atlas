-- MIG_2929: Alert Thresholds + Triage Flags (FFS-513, FFS-515)
--
-- FFS-513: Seed additional operational thresholds into ops.app_config.
-- FFS-515: Create ops.triage_flags table for admin-configurable data quality flags.

BEGIN;

-- ============================================================================
-- FFS-513: Additional operational thresholds in app_config
-- ============================================================================

INSERT INTO ops.app_config (key, value, description, category) VALUES
  ('rules.attribution_before_months', '6',  'Months before request creation to look for cat appointments', 'rules'),
  ('rules.attribution_after_months',  '3',  'Months after request resolution to look for cat appointments (grace period)', 'rules'),
  ('rules.high_volume_threshold',     '10', 'Cat count above which person is flagged as possible caretaker', 'rules'),
  ('rules.dedup_distance_meters',     '10', 'Place dedup radius for coordinate-based matching (meters)', 'rules'),
  ('rules.confidence_min_display',    '0.5','Minimum confidence for displaying identifiers (filters PetLink fabricated emails)', 'rules')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- FFS-515: Triage flags table
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops.triage_flags (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key              TEXT UNIQUE NOT NULL,
  label            TEXT NOT NULL,
  color            TEXT NOT NULL,           -- hex background color
  text_color       TEXT NOT NULL,           -- hex text color
  icon             TEXT,
  description      TEXT,
  condition_type   TEXT NOT NULL,           -- 'days_since', 'field_value', 'count_threshold'
  condition_config JSONB NOT NULL DEFAULT '{}',
  entity_type      TEXT NOT NULL DEFAULT 'request',
  sort_order       INT DEFAULT 0,
  active           BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_triage_flags_entity ON ops.triage_flags(entity_type, active);

-- Seed: Current 5 hardcoded flags from requests/page.tsx
INSERT INTO ops.triage_flags (key, label, color, text_color, description, condition_type, condition_config, entity_type, sort_order) VALUES
  ('no_trapper',      'Needs trapper',   '#fef3c7', '#92400e', 'Request has no trapper assigned',              'field_value',     '{"field": "trapper_count", "operator": "=", "value": 0}', 'request', 10),
  ('client_trapping', 'Client trapping', '#dcfce7', '#166534', 'Client is handling trapping themselves',       'field_value',     '{"field": "client_trapping", "operator": "=", "value": true}', 'request', 20),
  ('no_geometry',     'No map pin',      '#dbeafe', '#1e40af', 'Request location has no geocoded coordinates', 'field_value',     '{"field": "latitude", "operator": "is_null"}', 'request', 30),
  ('stale_30d',       'Stale 30d',       '#fee2e2', '#991b1b', 'Request has had no activity for 30+ days',     'days_since',      '{"field": "updated_at", "threshold_key": "request.stale_days"}', 'request', 40),
  ('no_requester',    'No requester',    '#e0e7ff', '#3730a3', 'Request has no linked requester person',       'field_value',     '{"field": "requester_person_id", "operator": "is_null"}', 'request', 50)
ON CONFLICT (key) DO NOTHING;

COMMIT;
