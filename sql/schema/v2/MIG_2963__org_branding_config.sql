-- MIG_2963: Seed org branding values into ops.app_config
-- FFS-684: White-label — move org name, email, phone to ops.app_config
--
-- These values were previously hardcoded across ~12 files.
-- Now configurable via admin UI (FFS-506 pattern).

INSERT INTO ops.app_config (key, value, description, category)
VALUES
  ('org.name_full', '"Forgotten Felines of Sonoma County"', 'Full organization name for headers, footers, print pages', 'organization'),
  ('org.name_short', '"FFSC"', 'Short org name / abbreviation for inline references', 'organization'),
  ('org.phone', '"(707) 576-7999"', 'Main org phone number', 'organization'),
  ('org.website', '"forgottenfelines.com"', 'Org website (without protocol)', 'organization'),
  ('org.support_email', '"admin@forgottenfelinessoco.org"', 'Support/contact email shown on login page', 'organization'),
  ('org.email_from', '"Forgotten Felines <noreply@forgottenfelines.org>"', 'Default FROM address for outbound emails', 'organization'),
  ('org.tagline', '"Helping community cats since 1990"', 'Org tagline for print footers', 'organization'),
  ('org.program_disclaimer', '"FFSC is a spay/neuter clinic, NOT a 24hr hospital."', 'Emergency disclaimer text on intake forms', 'organization'),
  ('org.consent_text', '"By submitting, you agree to be contacted by Forgotten Felines regarding this request."', 'Consent text on intake forms', 'organization')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  category = EXCLUDED.category;
