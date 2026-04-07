-- MIG_3060: Out-of-Service-Area Email Template
--
-- Part of FFS-1181 (Out-of-Service-Area Email Pipeline epic),
-- Phase 2b / FFS-1185.
--
-- Purpose: insert a new template_key='out_of_service_area' that
-- replaces the old, dormant 'out_of_county' template. The body uses
-- placeholder substitution for all org-specific strings (no
-- hardcoded "FFSC" / "Sonoma County" / phone numbers) so the same
-- template works across multiple orgs once the white-label rollout
-- lands.
--
-- The body contains TWO injection points for resource cards:
--   {{nearest_county_resources_html}}
--   {{statewide_resources_html}}
-- These are pre-rendered server-side by lib/email-resource-renderer.ts
-- using ops.get_neighbor_county_resources() (MIG_3059).
--
-- The old 'out_of_county' template row is deactivated (kept for FK
-- integrity with historical ops.sent_emails rows).
--
-- Depends on:
--   - MIG_2091 (ops.email_templates)
--   - MIG_3059 (community_resources county_served column + helper fn)
--
-- Created: 2026-04-07

\echo ''
\echo '=============================================='
\echo '  MIG_3060: out_of_service_area email template'
\echo '=============================================='
\echo ''

BEGIN;

-- ============================================================================
-- 1. Deactivate the old broken template
-- ============================================================================

\echo '1. Deactivating old out_of_county template...'

UPDATE ops.email_templates
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE template_key = 'out_of_county';

-- ============================================================================
-- 2. Insert new out_of_service_area template
-- ============================================================================

\echo '2. Inserting out_of_service_area template...'

INSERT INTO ops.email_templates (
  template_key,
  name,
  description,
  subject,
  body_html,
  body_text,
  placeholders,
  is_active,
  created_by
) VALUES (
  'out_of_service_area',
  'Out of Service Area — Resource Referral',
  'Sent to intake submissions whose geocoded location is outside the org service area. Provides neighbor-county and statewide resources. Manually approved per submission via /intake/queue (FFS-1187).',
  'Community Cat Help Near You (Outside {{service_area_name}})',
  -- HTML body — Ben's approved Airtable text, ported to placeholders.
  -- Resource cards are injected as pre-rendered HTML blocks.
$HTML$
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Community Cat Help Near You</title>
</head>
<body style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #333; line-height: 1.5;">

  <div style="text-align: center; margin-bottom: 24px;">
    <img src="{{org_logo_url}}" alt="{{brand_full_name}}" style="max-width: 220px; height: auto;">
  </div>

  <p style="font-size: 16px;">Hi {{first_name}},</p>

  <p>
    Thank you for reaching out to {{brand_full_name}}. We received your
    request for help with community cats in {{detected_county}} County.
  </p>

  <p>
    Unfortunately, our spay/neuter program is dedicated to the homeless
    cat crisis here in {{service_area_name}}, so we're not able to
    schedule appointments outside our service area. We are a small
    nonprofit and our resources are stretched thin keeping up with
    {{service_area_name}}'s needs.
  </p>

  <p>
    But we want to be a good neighbor — below are organizations in
    your area, plus statewide directories that may be able to help:
  </p>

  <h3 style="margin-top: 28px; margin-bottom: 8px; font-size: 16px; color: #1a4480;">
    Resources in {{detected_county}} County
  </h3>

  {{nearest_county_resources_html}}

  <h3 style="margin-top: 28px; margin-bottom: 8px; font-size: 16px; color: #1a4480;">
    Statewide &amp; National Directories
  </h3>

  {{statewide_resources_html}}

  <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">

  <p style="font-size: 13px; color: #666;">
    If we have you mistaken about your location, just reply to this
    email and let us know — we'll get you scheduled if you're inside
    {{service_area_name}}.
  </p>

  <p style="font-size: 13px; color: #666;">
    Wishing you and the cats all the best,<br>
    The {{brand_name}} team
  </p>

  <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #888; text-align: center;">
    <strong>{{brand_full_name}}</strong><br>
    {{org_address}}<br>
    {{org_phone}} &middot; <a href="https://{{org_website}}" style="color: #1a4480;">{{org_website}}</a>
  </div>

</body>
</html>
$HTML$,
  -- Plain-text fallback
$TEXT$
Hi {{first_name}},

Thank you for reaching out to {{brand_full_name}}. We received your
request for help with community cats in {{detected_county}} County.

Unfortunately, our spay/neuter program is dedicated to the homeless
cat crisis here in {{service_area_name}}, so we're not able to
schedule appointments outside our service area. We are a small
nonprofit and our resources are stretched thin keeping up with
{{service_area_name}}'s needs.

But we want to be a good neighbor — below are organizations in
your area, plus statewide directories that may be able to help:

RESOURCES IN {{detected_county}} COUNTY
{{nearest_county_resources_text}}

STATEWIDE & NATIONAL DIRECTORIES
{{statewide_resources_text}}

If we have you mistaken about your location, just reply to this
email and let us know — we'll get you scheduled if you're inside
{{service_area_name}}.

Wishing you and the cats all the best,
The {{brand_name}} team

--
{{brand_full_name}}
{{org_address}}
{{org_phone}}
{{org_website}}
$TEXT$,
  ARRAY[
    'first_name',
    'detected_county',
    'service_area_name',
    'brand_name',
    'brand_full_name',
    'org_phone',
    'org_email',
    'org_address',
    'org_website',
    'org_logo_url',
    'org_anniversary_badge_url',
    'nearest_county_resources_html',
    'statewide_resources_html',
    'nearest_county_resources_text',
    'statewide_resources_text'
  ],
  TRUE,
  'MIG_3060'
)
ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  body_text = EXCLUDED.body_text,
  placeholders = EXCLUDED.placeholders,
  is_active = TRUE,
  updated_at = NOW();

-- ============================================================================
-- 3. Verification
-- ============================================================================

\echo '3. Verification...'

DO $$
DECLARE
  v_active_new BOOLEAN;
  v_active_old BOOLEAN;
BEGIN
  SELECT is_active INTO v_active_new
    FROM ops.email_templates WHERE template_key = 'out_of_service_area';
  SELECT is_active INTO v_active_old
    FROM ops.email_templates WHERE template_key = 'out_of_county';

  RAISE NOTICE '   out_of_service_area is_active: %', v_active_new;
  RAISE NOTICE '   out_of_county       is_active: %', v_active_old;

  IF v_active_new IS NOT TRUE THEN
    RAISE EXCEPTION 'out_of_service_area template was not activated';
  END IF;
END $$;

COMMIT;

\echo ''
\echo '✓ MIG_3060 complete'
\echo ''
