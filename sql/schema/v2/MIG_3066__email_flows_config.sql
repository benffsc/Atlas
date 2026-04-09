-- MIG_3066: Email Flows Config Table (per-flow safety gates)
--
-- Part of FFS-1181 Follow-Up — Phase 3 (industry-standard email
-- infrastructure). Today the safety gates (email.global.dry_run,
-- email.out_of_area.live, email.test_recipient_override) are
-- free-floating keys in ops.app_config. Industry standard is one row
-- per email flow, each with its own enabled/dry_run/override knobs.
-- This means adding a new transactional flow (welcome, booking
-- confirmation, trapper assignment) ships with its own kill switch
-- by default.
--
-- Seeds the out_of_service_area flow with the same safe defaults the
-- existing global keys have, so the switch-over is a no-op in behavior.
--
-- Depends on:
--   - ops.email_templates (MIG_2091)
--   - ops.staff (MIG_0xxx)
--   - MIG_3061 (out_of_service_area template_key exists)
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3066: Email Flows Config Table'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. ops.email_flows — one row per transactional flow
-- ============================================================================

\echo '1. Creating ops.email_flows...'

CREATE TABLE IF NOT EXISTS ops.email_flows (
  flow_slug                TEXT PRIMARY KEY,
  display_name             TEXT NOT NULL,
  description              TEXT,
  template_key             TEXT REFERENCES ops.email_templates(template_key),
  enabled                  BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run                  BOOLEAN NOT NULL DEFAULT TRUE,
  test_recipient_override  TEXT,
  suppression_scope        TEXT NOT NULL DEFAULT 'per_flow'
    CHECK (suppression_scope IN ('global','per_flow','per_flow_per_recipient')),
  suppression_days         INTEGER NOT NULL DEFAULT 90,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by               UUID REFERENCES ops.staff(staff_id)
);

COMMENT ON TABLE ops.email_flows IS
'MIG_3066 (FFS-1181 follow-up Phase 3): One row per transactional email
flow. Each flow has its own enabled/dry-run/override knobs, replacing
the free-floating email.* keys in app_config. Adding a new flow is now
an INSERT here (+ a new template) rather than a code change.';

COMMENT ON COLUMN ops.email_flows.enabled IS
'Global kill switch for this flow. When FALSE, assertFlowEnabled(flow_slug)
throws. Defaults FALSE so new flows ship dark.';

COMMENT ON COLUMN ops.email_flows.dry_run IS
'Per-flow dry-run. When TRUE, sendTemplateEmail() renders + logs with
status=dry_run but does not call the upstream provider.';

COMMENT ON COLUMN ops.email_flows.test_recipient_override IS
'Per-flow test recipient. When non-null and dry_run is FALSE, sends are
rerouted to this address with [TEST → original] subject prefix.';

COMMENT ON COLUMN ops.email_flows.suppression_scope IS
'How suppression is scoped for this flow:
  global — any suppression hit blocks send
  per_flow — only suppressions for this flow_slug block send
  per_flow_per_recipient — only suppressions with a recipient+flow match';

-- ============================================================================
-- 2. Seed the out_of_service_area flow
-- ============================================================================

\echo '2. Seeding out_of_service_area flow...'

-- Carry over the existing safe defaults from the global app_config keys
-- so the behavior is identical after this migration.
INSERT INTO ops.email_flows (
  flow_slug,
  display_name,
  description,
  template_key,
  enabled,
  dry_run,
  test_recipient_override,
  suppression_scope,
  suppression_days
) VALUES (
  'out_of_service_area',
  'Out of Service Area — Resource Referral',
  'Sent to intake submissions classified outside the org service area. Provides neighbor-county and statewide resources.',
  'out_of_service_area',
  -- Safe defaults matching the current global keys:
  FALSE,                          -- enabled  (matches email.out_of_area.live=false)
  TRUE,                           -- dry_run  (matches email.global.dry_run=true)
  'ben@forgottenfelines.com',     -- test_recipient_override (matches current value)
  'per_flow',
  90
)
ON CONFLICT (flow_slug) DO NOTHING;

-- ============================================================================
-- 3. Index on enabled for fast queue filtering
-- ============================================================================

\echo '3. Creating indexes...'

CREATE INDEX IF NOT EXISTS idx_email_flows_enabled
  ON ops.email_flows (enabled)
  WHERE enabled = TRUE;

-- ============================================================================
-- 4. updated_at trigger
-- ============================================================================

\echo '4. Creating updated_at trigger...'

CREATE OR REPLACE FUNCTION ops.touch_email_flows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_flows_updated_at ON ops.email_flows;
CREATE TRIGGER trg_email_flows_updated_at
  BEFORE UPDATE ON ops.email_flows
  FOR EACH ROW
  EXECUTE FUNCTION ops.touch_email_flows_updated_at();

-- ============================================================================
-- 5. Verification
-- ============================================================================

\echo '5. Verification...'

DO $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT * INTO v_row
    FROM ops.email_flows
   WHERE flow_slug = 'out_of_service_area';

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'out_of_service_area flow not seeded';
  END IF;

  RAISE NOTICE '   Seeded flow: % (enabled=%, dry_run=%, override=%)',
    v_row.flow_slug, v_row.enabled, v_row.dry_run, v_row.test_recipient_override;

  -- Sanity: safe defaults preserved
  IF v_row.enabled <> FALSE THEN
    RAISE EXCEPTION 'out_of_service_area should default to enabled=FALSE';
  END IF;
  IF v_row.dry_run <> TRUE THEN
    RAISE EXCEPTION 'out_of_service_area should default to dry_run=TRUE';
  END IF;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3066 complete'
\echo ''
