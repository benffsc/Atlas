-- MIG_3068: Email Suppression List + Scope + Bounce Handling Tables
--
-- Part of FFS-1181 Follow-Up — Phase 5 (industry-standard deliverability).
-- Replaces the per-template ops.is_suppressed_for_out_of_service_area()
-- check with a multi-scope suppression list that any flow can read.
--
-- Scopes:
--   global                   — any send to this email is blocked
--   per_flow                 — only sends of this flow_slug are blocked
--   per_flow_per_recipient   — reserved for future scoped tuples
--
-- Reasons mirror the SMTP bounce taxonomy (RFC 3463 extended):
--   hard_bounce, soft_bounce_repeated, complaint, unsubscribe,
--   manual, gdpr_erasure, invalid_address
--
-- Sources track WHERE the suppression came from:
--   manual, bounce_webhook, complaint_webhook, unsubscribe_link, gdpr_request
--
-- Also updates ops.is_suppressed_for_out_of_service_area() to delegate
-- to the new ops.is_suppressed(email, flow_slug) gate.
--
-- Depends on:
--   - ops.email_flows (MIG_3066)
--   - ops.staff
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3068: Email Suppressions + Bounces'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. ops.email_suppressions
-- ============================================================================

\echo '1. Creating ops.email_suppressions...'

CREATE TABLE IF NOT EXISTS ops.email_suppressions (
  suppression_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_norm     TEXT NOT NULL,
  scope          TEXT NOT NULL
    CHECK (scope IN ('global','per_flow','per_flow_per_recipient')),
  flow_slug      TEXT REFERENCES ops.email_flows(flow_slug),
  reason         TEXT NOT NULL
    CHECK (reason IN (
      'hard_bounce','soft_bounce_repeated','complaint',
      'unsubscribe','manual','gdpr_erasure','invalid_address'
    )),
  source         TEXT NOT NULL
    CHECK (source IN (
      'manual','bounce_webhook','complaint_webhook',
      'unsubscribe_link','gdpr_request'
    )),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,
  created_by     UUID REFERENCES ops.staff(staff_id),
  notes          TEXT
);

COMMENT ON TABLE ops.email_suppressions IS
'MIG_3068 (FFS-1181 follow-up Phase 5): Multi-scope email suppression
list. Consulted by ops.is_suppressed(email, flow_slug) before every
transactional send. Scope=global blocks all flows; per_flow only blocks
the matching flow_slug. expires_at=NULL means permanent (bounces,
complaints); soft bounces use a 90-day TTL.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_suppressions_unique
  ON ops.email_suppressions (email_norm, scope, COALESCE(flow_slug, ''));

CREATE INDEX IF NOT EXISTS idx_email_suppressions_email
  ON ops.email_suppressions (email_norm);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_expires
  ON ops.email_suppressions (expires_at)
  WHERE expires_at IS NOT NULL;

-- ============================================================================
-- 2. Normalize on INSERT/UPDATE (defense against dirty input)
-- ============================================================================

\echo '2. Creating normalization trigger...'

CREATE OR REPLACE FUNCTION ops.normalize_email_suppression()
RETURNS TRIGGER AS $$
BEGIN
  NEW.email_norm := LOWER(TRIM(NEW.email_norm));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_email_suppression ON ops.email_suppressions;
CREATE TRIGGER trg_normalize_email_suppression
  BEFORE INSERT OR UPDATE ON ops.email_suppressions
  FOR EACH ROW
  EXECUTE FUNCTION ops.normalize_email_suppression();

-- ============================================================================
-- 3. ops.is_suppressed() — new multi-scope check
-- ============================================================================

\echo '3. Creating ops.is_suppressed()...'

CREATE OR REPLACE FUNCTION ops.is_suppressed(
  p_email     TEXT,
  p_flow_slug TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM ops.email_suppressions
     WHERE email_norm = LOWER(TRIM(COALESCE(p_email, '')))
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (
         scope = 'global'
         OR (scope = 'per_flow' AND flow_slug = p_flow_slug)
         OR (scope = 'per_flow_per_recipient' AND flow_slug = p_flow_slug)
       )
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION ops.is_suppressed IS
'MIG_3068 (FFS-1181 follow-up Phase 5): Returns TRUE if the email
address is suppressed for the given flow (or globally). Preferred over
the per-template helpers. p_flow_slug=NULL → only global suppressions
match.';

-- ============================================================================
-- 4. Delegate the legacy out_of_service_area helper
-- ============================================================================

\echo '4. Updating ops.is_suppressed_for_out_of_service_area()...'

CREATE OR REPLACE FUNCTION ops.is_suppressed_for_out_of_service_area(
  p_email TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_days INT;
  v_legacy_suppressed BOOLEAN;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN FALSE;
  END IF;

  -- Layer 1: new multi-scope suppression list (hard bounces, unsubscribes)
  IF ops.is_suppressed(p_email, 'out_of_service_area') THEN
    RETURN TRUE;
  END IF;

  -- Layer 2: legacy 90-day duplicate window from sent_emails history.
  -- Preserved for backward compatibility — prevents accidentally sending
  -- a second out-of-area email within the suppression window even if the
  -- recipient is not on the suppression list.
  SELECT (value)::TEXT::INT INTO v_days
    FROM ops.app_config
   WHERE key = 'email.out_of_service_area.suppression_days';
  v_days := COALESCE(v_days, 90);

  SELECT EXISTS (
    SELECT 1
      FROM ops.sent_emails
     WHERE recipient_email = p_email
       AND template_key = 'out_of_service_area'
       AND status = 'sent'
       AND sent_at > NOW() - (v_days || ' days')::INTERVAL
  ) INTO v_legacy_suppressed;

  RETURN v_legacy_suppressed;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION ops.is_suppressed_for_out_of_service_area IS
'MIG_3068 (FFS-1181 follow-up Phase 5): Combined check — new multi-scope
suppression list first, then legacy 90-day sent_emails window.
Prefer ops.is_suppressed() for new callers.';

-- ============================================================================
-- 5. ops.record_bounce() helper — inserts a global suppression row
--    with idempotent upsert semantics.
-- ============================================================================

\echo '5. Creating ops.record_bounce()...'

CREATE OR REPLACE FUNCTION ops.record_bounce(
  p_email  TEXT,
  p_reason TEXT,                    -- hard_bounce|complaint|soft_bounce_repeated|invalid_address
  p_source TEXT DEFAULT 'bounce_webhook',
  p_notes  TEXT DEFAULT NULL,
  p_ttl_days INT DEFAULT NULL       -- NULL = permanent
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RAISE EXCEPTION 'email is required';
  END IF;

  IF p_ttl_days IS NOT NULL THEN
    v_expires := NOW() + (p_ttl_days || ' days')::INTERVAL;
  END IF;

  INSERT INTO ops.email_suppressions (
    email_norm, scope, flow_slug, reason, source, expires_at, notes
  ) VALUES (
    LOWER(TRIM(p_email)), 'global', NULL, p_reason, p_source, v_expires, p_notes
  )
  ON CONFLICT (email_norm, scope, COALESCE(flow_slug, '')) DO UPDATE
    SET reason = EXCLUDED.reason,
        source = EXCLUDED.source,
        expires_at = EXCLUDED.expires_at,
        notes = COALESCE(EXCLUDED.notes, ops.email_suppressions.notes),
        created_at = NOW()
  RETURNING suppression_id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ops.record_bounce IS
'MIG_3068: idempotent upsert into email_suppressions for bounces,
complaints, and repeated soft bounces. Defaults to global scope so all
future sends are blocked. Use p_ttl_days for transient reasons.';

-- ============================================================================
-- 6. Verification
-- ============================================================================

\echo '6. Verification...'

DO $$
DECLARE
  v_before INT;
  v_after INT;
  v_id UUID;
BEGIN
  -- Insert a test row via record_bounce()
  SELECT COUNT(*) INTO v_before FROM ops.email_suppressions;

  v_id := ops.record_bounce(
    'TEST-MIG-3068@example.com',
    'hard_bounce',
    'manual',
    'MIG_3068 verification row — safe to delete',
    NULL
  );

  SELECT COUNT(*) INTO v_after FROM ops.email_suppressions;
  RAISE NOTICE '   Suppressions before: %, after: %', v_before, v_after;

  -- Verify is_suppressed() picks it up
  IF NOT ops.is_suppressed('test-mig-3068@example.com', 'out_of_service_area') THEN
    RAISE EXCEPTION 'is_suppressed() did not detect the test bounce';
  END IF;

  -- Clean up the test row
  DELETE FROM ops.email_suppressions WHERE suppression_id = v_id;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3068 complete'
\echo ''
