-- MIG_3062: Email Dry-Run Mode + Test Recipient Override + Go Live Toggle
--
-- Part of FFS-1181 (Out-of-Service-Area Email Pipeline epic),
-- Phase 5 / FFS-1188.
--
-- THE SAFETY HARD-STOP. Three layers of defense ensure no real email
-- reaches a real recipient until Ben explicitly flips Go Live after
-- running through docs/RUNBOOKS/out_of_service_area_email_golive.md.
--
-- This migration adds:
--   1. ops.app_config keys (DB layer of defense):
--        - email.global.dry_run             (default TRUE)
--        - email.test_recipient_override     (default ben@forgottenfelines.com)
--        - email.out_of_area.live           (default FALSE)
--   2. ops.sent_emails CHECK constraint extension to allow status='dry_run'
--
-- The corresponding env vars (managed in Vercel) are:
--   - EMAIL_DRY_RUN
--   - EMAIL_TEST_RECIPIENT_OVERRIDE
--   - EMAIL_OUT_OF_AREA_LIVE
--
-- When BOTH the env var and DB key are set safely, no real send happens.
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3062: Email Dry-Run + Go Live'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Allow dry_run as a sent_emails status
-- ============================================================================

\echo '1. Extending sent_emails status check constraint...'

ALTER TABLE ops.sent_emails
  DROP CONSTRAINT IF EXISTS ops_sent_emails_status_check;

ALTER TABLE ops.sent_emails
  DROP CONSTRAINT IF EXISTS sent_emails_status_check;

ALTER TABLE ops.sent_emails
  ADD CONSTRAINT sent_emails_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'bounced', 'failed', 'dry_run'));

COMMENT ON COLUMN ops.sent_emails.status IS
'MIG_3062 (FFS-1188): Added dry_run for emails rendered + logged but
NOT actually sent due to dry-run mode. Other values from MIG_2091.';

-- ============================================================================
-- 2. Seed config keys with safe defaults
-- ============================================================================

\echo '2. Seeding email pipeline config keys (safe defaults)...'

INSERT INTO ops.app_config (key, value, category, description)
VALUES
  (
    'email.global.dry_run',
    'true'::jsonb,
    'email',
    'When TRUE, ALL template email sends (sendTemplateEmail + sendTemplatedOutlookEmail) are intercepted and logged in ops.sent_emails with status=dry_run instead of being delivered. Default TRUE — flip off only after walking through the Go Live runbook. (FFS-1188)'
  ),
  (
    'email.test_recipient_override',
    '"ben@forgottenfelines.com"'::jsonb,
    'email',
    'When non-empty AND email.global.dry_run is FALSE, all template email sends are routed to this address with the original recipient prepended to the subject as [TEST → original@email]. Used for the runbook''s pilot real send. Set to empty string ("") to send to actual recipients. (FFS-1188)'
  ),
  (
    'email.out_of_area.live',
    'false'::jsonb,
    'email',
    'Out-of-service-area pipeline kill switch. Must be TRUE (and EMAIL_OUT_OF_AREA_LIVE env var must also be ''true'') for the pipeline to run. Until this and the env var are both true, /api/cron/send-emails and /api/emails/send-out-of-service-area return 503. (FFS-1188 / FFS-1182)'
  )
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 3. Verification
-- ============================================================================

\echo '3. Verification...'

DO $$
DECLARE
  v_dry_run TEXT;
  v_override TEXT;
  v_live TEXT;
BEGIN
  SELECT (value)::TEXT INTO v_dry_run
    FROM ops.app_config WHERE key = 'email.global.dry_run';
  SELECT (value)::TEXT INTO v_override
    FROM ops.app_config WHERE key = 'email.test_recipient_override';
  SELECT (value)::TEXT INTO v_live
    FROM ops.app_config WHERE key = 'email.out_of_area.live';

  RAISE NOTICE '   email.global.dry_run           : %', v_dry_run;
  RAISE NOTICE '   email.test_recipient_override  : %', v_override;
  RAISE NOTICE '   email.out_of_area.live         : %', v_live;

  IF v_dry_run IS NULL OR v_dry_run::JSONB <> 'true'::JSONB THEN
    RAISE WARNING 'email.global.dry_run is not TRUE — was it changed?';
  END IF;
  IF v_live IS NULL OR v_live::JSONB <> 'false'::JSONB THEN
    RAISE WARNING 'email.out_of_area.live is not FALSE — was it changed?';
  END IF;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3062 complete'
\echo '  All defaults are SAFE (dry-run on, override set, out-of-area live off)'
\echo ''
