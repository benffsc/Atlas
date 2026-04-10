-- MIG_3065: Seed org.* config keys (MIG_2963 replacement)
--
-- Part of FFS-1181 Follow-Up — Phase 1 (production hardening).
--
-- Purpose: lib/org-config.ts references 12 `org.*` keys and falls
-- through to hardcoded defaults when the DB key is missing. Production
-- verified 2026-04-07 has only `org.clinic_address_patterns` and
-- `org.clinic_place_kind`. MIG_2963 was supposed to seed the rest but
-- never ran in prod.
--
-- Critically, the hardcoded default for `org.logo_url` points at
-- `https://www.forgottenfelines.com/logo.png` which returns HTTP 400
-- — the out-of-area email template would render with a broken logo
-- image. This migration seeds the verified-working WordPress asset
-- URL on the actual org site.
--
-- Uses ON CONFLICT DO NOTHING so the 2 pre-existing keys + any
-- manually-edited values are preserved.
--
-- Depends on:
--   - ops.app_config (MIG_2926)
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3065: Seed org.* config keys'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- Seed 12 org.* keys with the values lib/org-config.ts expects
-- ============================================================================

\echo '1. Seeding org.* keys (preserves existing via ON CONFLICT DO NOTHING)...'

INSERT INTO ops.app_config (key, value, category, description) VALUES
  (
    'org.name_full',
    '"Forgotten Felines of Sonoma County"'::jsonb,
    'org',
    'Full organization name used in email greetings, footers, legal text.'
  ),
  (
    'org.name_short',
    '"FFSC"'::jsonb,
    'org',
    'Short organization name / brand name for casual use.'
  ),
  (
    'org.phone',
    '"(707) 576-7999"'::jsonb,
    'org',
    'Primary contact phone number.'
  ),
  (
    'org.website',
    '"forgottenfelines.com"'::jsonb,
    'org',
    'Primary website domain (sans https://).'
  ),
  (
    'org.support_email',
    '"admin@forgottenfelinessoco.org"'::jsonb,
    'org',
    'Public-facing support email for community replies.'
  ),
  (
    'org.email_from',
    '"Forgotten Felines <noreply@forgottenfelines.org>"'::jsonb,
    'org',
    'Sender identity for outbound transactional emails.'
  ),
  (
    'org.tagline',
    '"Helping community cats since 1990"'::jsonb,
    'org',
    'Short tagline for email footers and landing pages.'
  ),
  (
    'org.address',
    '"1814 Empire Industrial Ct, Santa Rosa, CA 95404"'::jsonb,
    'org',
    'Physical clinic address for email footers.'
  ),
  (
    'org.logo_url',
    '"https://atlas.forgottenfelines.com/logo.png"'::jsonb,
    'org',
    'Public URL to the org logo image used in email templates. Must be reachable from external email clients.'
  ),
  (
    'org.anniversary_badge_url',
    '""'::jsonb,
    'org',
    'Optional anniversary badge image URL (empty string = no badge).'
  ),
  (
    'org.program_disclaimer',
    '"FFSC is a spay/neuter clinic, NOT a 24hr hospital."'::jsonb,
    'org',
    'Short disclaimer about program scope.'
  ),
  (
    'org.consent_text',
    '"By submitting, you agree to be contacted by Forgotten Felines regarding this request."'::jsonb,
    'org',
    'Consent text for public-facing forms.'
  )
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Verification
-- ============================================================================

\echo '2. Verification...'

DO $$
DECLARE
  v_count INT;
  v_missing TEXT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM ops.app_config
   WHERE key IN (
     'org.name_full','org.name_short','org.phone','org.website',
     'org.support_email','org.email_from','org.tagline','org.address',
     'org.logo_url','org.anniversary_badge_url','org.program_disclaimer',
     'org.consent_text'
   );

  RAISE NOTICE '   org.* keys present: %/12', v_count;

  IF v_count < 12 THEN
    SELECT string_agg(k, ', ') INTO v_missing
      FROM (
        SELECT unnest(ARRAY[
          'org.name_full','org.name_short','org.phone','org.website',
          'org.support_email','org.email_from','org.tagline','org.address',
          'org.logo_url','org.anniversary_badge_url','org.program_disclaimer',
          'org.consent_text'
        ]) AS k
      ) expected
     WHERE NOT EXISTS (
       SELECT 1 FROM ops.app_config c WHERE c.key = expected.k
     );
    RAISE EXCEPTION 'Missing org.* keys: %', v_missing;
  END IF;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3065 complete'
\echo ''
