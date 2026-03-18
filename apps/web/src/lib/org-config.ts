/**
 * Org branding helpers — read from ops.app_config with FFSC defaults.
 *
 * Server components / API routes: use these async helpers.
 * Client components: use useAppConfig('org.name_full') from @/hooks/useAppConfig.
 *
 * FFS-684: White-label readiness — all org-specific strings sourced from DB.
 */

import { getServerConfig } from "@/lib/server-config";

// ── Defaults (FFSC) ──────────────────────────────────────────────────
// Keep in sync with MIG_2963 seed data.

const DEFAULTS = {
  "org.name_full": "Forgotten Felines of Sonoma County",
  "org.name_short": "FFSC",
  "org.phone": "(707) 576-7999",
  "org.website": "forgottenfelines.com",
  "org.support_email": "admin@forgottenfelinessoco.org",
  "org.email_from": "Forgotten Felines <noreply@forgottenfelines.org>",
  "org.tagline": "Helping community cats since 1990",
  "org.program_disclaimer":
    "FFSC is a spay/neuter clinic, NOT a 24hr hospital.",
  "org.consent_text":
    "By submitting, you agree to be contacted by Forgotten Felines regarding this request.",
} as const;

type OrgKey = keyof typeof DEFAULTS;

/** Generic getter — reads from DB, falls back to FFSC default. */
export async function getOrgConfig(key: OrgKey): Promise<string> {
  return getServerConfig<string>(key, DEFAULTS[key]);
}

// ── Convenience aliases ──────────────────────────────────────────────

export const getOrgName = () => getOrgConfig("org.name_full");
export const getOrgNameShort = () => getOrgConfig("org.name_short");
export const getOrgPhone = () => getOrgConfig("org.phone");
export const getOrgWebsite = () => getOrgConfig("org.website");
export const getOrgSupportEmail = () => getOrgConfig("org.support_email");
export const getOrgEmailFrom = () => getOrgConfig("org.email_from");
export const getOrgTagline = () => getOrgConfig("org.tagline");
