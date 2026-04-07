-- MIG_3061: Out-of-Service-Area Email Pipeline (view + approval gate + suppression)
--
-- Part of FFS-1181 (Out-of-Service-Area Email Pipeline epic),
-- Phase 3 / FFS-1186.
--
-- Replaces the broken ops.v_pending_out_of_county_emails view (which
-- referenced columns that no longer exist on ops.intake_submissions)
-- with a correctly-named view that:
--   1. Filters by service_area_status = 'out' (not the never-set out_of_county flag)
--   2. Requires manual staff approval (out_of_service_area_approved_at IS NOT NULL)
--   3. Excludes any submission whose recipient_email already received
--      an out_of_service_area email in the last 90 days
--
-- Drops the old broken pieces:
--   - VIEW   ops.v_pending_out_of_county_emails
--   - FUNCTION ops.mark_out_of_county_email_sent(UUID, UUID)
--
-- Adds:
--   - 4 columns on ops.intake_submissions (approval + sent tracking)
--   - View   ops.v_pending_out_of_service_area_emails
--   - Function ops.approve_out_of_service_area_email(UUID, UUID)
--   - Function ops.mark_out_of_service_area_email_sent(UUID, UUID) → BOOLEAN
--   - Function ops.is_suppressed_for_out_of_service_area(TEXT) → BOOLEAN
--
-- Suppression duration is configurable via app_config key
-- 'email.out_of_service_area.suppression_days' (default 90).
--
-- Depends on:
--   - MIG_3057 (service_area_status column on intake_submissions)
--   - MIG_3060 (out_of_service_area template_key in email_templates)
--   - MIG_2091 (sent_emails, email_templates)
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3061: Out-of-Service-Area Pipeline'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Drop broken legacy pieces
-- ============================================================================

\echo '1. Dropping broken legacy view + function...'

DROP VIEW IF EXISTS ops.v_pending_out_of_county_emails;
DROP FUNCTION IF EXISTS ops.mark_out_of_county_email_sent(UUID, UUID);

-- ============================================================================
-- 2. Approval + sent tracking columns
-- ============================================================================

\echo '2. Adding approval + sent tracking columns to intake_submissions...'

ALTER TABLE ops.intake_submissions
  ADD COLUMN IF NOT EXISTS out_of_service_area_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS out_of_service_area_approved_by UUID
    REFERENCES ops.staff(staff_id),
  ADD COLUMN IF NOT EXISTS out_of_service_area_email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS out_of_service_area_email_id UUID
    REFERENCES ops.sent_emails(email_id);

CREATE INDEX IF NOT EXISTS idx_intake_subs_out_of_area_approved
  ON ops.intake_submissions (out_of_service_area_approved_at)
  WHERE out_of_service_area_approved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intake_subs_out_of_area_sent
  ON ops.intake_submissions (out_of_service_area_email_sent_at)
  WHERE out_of_service_area_email_sent_at IS NOT NULL;

COMMENT ON COLUMN ops.intake_submissions.out_of_service_area_approved_at IS
'MIG_3061 (FFS-1186): Set when staff manually approves an out-of-area
submission for sending. The cron + send endpoint only act on rows where
this is non-null. NULL = needs review (red banner in /intake/queue).';

-- ============================================================================
-- 3. Seed suppression-window config key
-- ============================================================================

\echo '3. Seeding email.out_of_service_area.suppression_days...'

INSERT INTO ops.app_config (key, value, category, description)
VALUES (
  'email.out_of_service_area.suppression_days',
  '90'::jsonb,
  'email',
  'Number of days an email address is suppressed from receiving another out_of_service_area email after a successful send. Prevents accidental duplicates.'
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 4. New view — pending out_of_service_area emails
-- ============================================================================

\echo '4. Creating ops.v_pending_out_of_service_area_emails...'

CREATE OR REPLACE VIEW ops.v_pending_out_of_service_area_emails AS
SELECT
  s.submission_id,
  s.first_name,
  s.email,
  s.county AS detected_county,
  s.service_area_status,
  s.out_of_service_area_approved_at,
  s.out_of_service_area_approved_by,
  s.created_at,
  s.geo_latitude,
  s.geo_longitude
FROM ops.intake_submissions s
WHERE s.service_area_status = 'out'
  AND s.out_of_service_area_approved_at IS NOT NULL  -- approval gate
  AND s.out_of_service_area_email_sent_at IS NULL    -- not yet sent
  AND s.email IS NOT NULL
  AND NOT EXISTS (
    -- 90-day suppression
    SELECT 1
      FROM ops.sent_emails se
     WHERE se.recipient_email = s.email
       AND se.template_key = 'out_of_service_area'
       AND se.status = 'sent'
       AND se.sent_at > NOW() - (
         COALESCE(
           (SELECT (value)::TEXT::INT FROM ops.app_config
             WHERE key = 'email.out_of_service_area.suppression_days'),
           90
         ) || ' days'
       )::INTERVAL
  );

COMMENT ON VIEW ops.v_pending_out_of_service_area_emails IS
'MIG_3061 (FFS-1186): Replaces the broken v_pending_out_of_county_emails.
Returns submissions classified out-of-service-area, manually approved by
staff, not yet sent, with a non-null email, and not suppressed by the
90-day duplicate window.';

-- ============================================================================
-- 5. Approval function
-- ============================================================================

\echo '5. Creating ops.approve_out_of_service_area_email()...'

CREATE OR REPLACE FUNCTION ops.approve_out_of_service_area_email(
  p_submission_id UUID,
  p_approved_by   UUID
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE ops.intake_submissions
     SET out_of_service_area_approved_at = NOW(),
         out_of_service_area_approved_by = p_approved_by,
         updated_at = NOW()
   WHERE submission_id = p_submission_id
     AND service_area_status = 'out'
     AND out_of_service_area_approved_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.approve_out_of_service_area_email IS
'MIG_3061 (FFS-1186): Marks an out-of-area submission as approved for
sending. Idempotent: returns FALSE if already approved or not classified
out-of-service-area.';

-- ============================================================================
-- 6. Mark-sent function (also transitions to redirected)
-- ============================================================================

\echo '6. Creating ops.mark_out_of_service_area_email_sent()...'

CREATE OR REPLACE FUNCTION ops.mark_out_of_service_area_email_sent(
  p_submission_id UUID,
  p_email_id      UUID
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE ops.intake_submissions
     SET out_of_service_area_email_sent_at = NOW(),
         out_of_service_area_email_id      = p_email_id,
         submission_status                 = 'redirected',
         updated_at                        = NOW()
   WHERE submission_id = p_submission_id
     AND out_of_service_area_email_sent_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. Suppression check function
-- ============================================================================

\echo '7. Creating ops.is_suppressed_for_out_of_service_area()...'

CREATE OR REPLACE FUNCTION ops.is_suppressed_for_out_of_service_area(
  p_email TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_days INT;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN FALSE;
  END IF;

  SELECT (value)::TEXT::INT INTO v_days
    FROM ops.app_config
   WHERE key = 'email.out_of_service_area.suppression_days';
  v_days := COALESCE(v_days, 90);

  RETURN EXISTS (
    SELECT 1
      FROM ops.sent_emails
     WHERE recipient_email = p_email
       AND template_key = 'out_of_service_area'
       AND status = 'sent'
       AND sent_at > NOW() - (v_days || ' days')::INTERVAL
  );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.is_suppressed_for_out_of_service_area IS
'MIG_3061 (FFS-1186): Returns TRUE if the given email address has
received an out_of_service_area email within the configured suppression
window (default 90 days). Used as a gate by sendOutOfServiceAreaEmail().';

-- ============================================================================
-- 8. Verification
-- ============================================================================

\echo '8. Verification...'

DO $$
DECLARE
  v_count INT;
BEGIN
  -- Should be 0 immediately after migration (nothing approved yet)
  SELECT COUNT(*) INTO v_count
    FROM ops.v_pending_out_of_service_area_emails;
  RAISE NOTICE '   v_pending_out_of_service_area_emails count: %', v_count;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'approve_out_of_service_area_email'
  ) THEN
    RAISE EXCEPTION 'approve_out_of_service_area_email() not created';
  END IF;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3061 complete'
\echo ''
