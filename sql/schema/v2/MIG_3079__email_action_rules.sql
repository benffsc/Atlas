-- MIG_3079: Email Action Rules — config-driven email suggestions
--
-- Part of FFS-1181 extensible email infrastructure. This table lets
-- admins define rules like "when service_area_status = 'out', suggest
-- sending the out_of_service_area email." The intake detail panel
-- evaluates rules client-side and shows suggestion banners. No code
-- change needed to add a new email trigger — just INSERT a rule.
--
-- Depends on:
--   - ops.email_flows (MIG_3066)
--
-- Created: 2026-04-10

\echo ''
\echo '=============================================='
\echo '  MIG_3079: Email Action Rules'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. ops.email_action_rules — one row per suggestion trigger
-- ============================================================================

\echo '1. Creating ops.email_action_rules...'

CREATE TABLE IF NOT EXISTS ops.email_action_rules (
  rule_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_slug            TEXT NOT NULL REFERENCES ops.email_flows(flow_slug),
  display_name         TEXT NOT NULL,
  description          TEXT,
  condition_field      TEXT NOT NULL,        -- IntakeSubmission field name
  condition_operator   TEXT NOT NULL         -- eq, neq, in, is_null, is_not_null
    CHECK (condition_operator IN ('eq','neq','in','is_null','is_not_null')),
  condition_value      TEXT,                 -- comma-separated for 'in'
  guard_email_not_sent BOOLEAN NOT NULL DEFAULT TRUE,
  guard_not_suppressed BOOLEAN NOT NULL DEFAULT TRUE,
  guard_has_email      BOOLEAN NOT NULL DEFAULT TRUE,
  suggestion_text      TEXT NOT NULL,
  action_label         TEXT NOT NULL DEFAULT 'Send Email',
  priority             INT NOT NULL DEFAULT 0,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ops.email_action_rules IS 'Config-driven rules that suggest email actions on intake submissions. Evaluated client-side.';
COMMENT ON COLUMN ops.email_action_rules.condition_field IS 'IntakeSubmission field name to evaluate (e.g. service_area_status, triage_category)';
COMMENT ON COLUMN ops.email_action_rules.condition_operator IS 'Comparison operator: eq, neq, in, is_null, is_not_null';
COMMENT ON COLUMN ops.email_action_rules.condition_value IS 'Value to compare against. Comma-separated for "in" operator.';
COMMENT ON COLUMN ops.email_action_rules.guard_email_not_sent IS 'Only suggest if the flow email has NOT been sent for this submission';
COMMENT ON COLUMN ops.email_action_rules.guard_not_suppressed IS 'Only suggest if the recipient is NOT in suppression window';
COMMENT ON COLUMN ops.email_action_rules.guard_has_email IS 'Only suggest if the submission has an email address';
COMMENT ON COLUMN ops.email_action_rules.priority IS 'Higher priority rules show first. Ties broken by display_name.';

-- ============================================================================
-- 2. Seed: out-of-service-area rule
-- ============================================================================

\echo '2. Seeding out-of-service-area rule...'

INSERT INTO ops.email_action_rules (
  flow_slug, display_name, description,
  condition_field, condition_operator, condition_value,
  suggestion_text, action_label, priority
)
VALUES (
  'out_of_service_area',
  'Out-of-Service-Area Resources',
  'Suggests sending resources email when submission is classified as out of service area',
  'service_area_status', 'eq', 'out',
  'This submission is outside our service area. Send the out-of-area resources email with information about alternative services.',
  'Send Resources Email',
  10
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. Index for quick lookups
-- ============================================================================

\echo '3. Creating index...'

CREATE INDEX IF NOT EXISTS idx_email_action_rules_enabled
  ON ops.email_action_rules (enabled) WHERE enabled = TRUE;

\echo 'Done.'

COMMIT;
