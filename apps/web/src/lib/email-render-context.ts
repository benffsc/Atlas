/**
 * Email Render Context — shared org placeholder builder.
 *
 * Part of FFS-1181 Follow-Up Phase 2. Every transactional email template
 * gets these org-level placeholders for free; individual sends only need
 * to provide template-specific payload on top.
 *
 * Industry pattern: merge at render, not at write. Send-time:
 *
 *   final_placeholders = { ...buildOrgRenderContext(), ...caller_payload }
 *
 * Caller-provided keys override the org defaults, so you can e.g. swap
 * the logo for a campaign variant without touching the helper.
 *
 * References:
 *   - Postmark Layouts / templates — https://postmarkapp.com/developer/user-guide/send-email-with-api/templates
 *   - Customer.io Email Layouts
 *   - Intercom Brands
 */

import {
  getOrgName,
  getOrgNameShort,
  getOrgPhone,
  getOrgSupportEmail,
  getOrgWebsite,
  getOrgAddress,
  getOrgLogoUrl,
  getOrgAnniversaryBadgeUrl,
  getOrgTagline,
} from "./org-config";
import { getServiceAreaName } from "./geo-config";

/**
 * Build the org-level render context for any transactional template.
 *
 * Returns a flat Record<string,string> of placeholder → value suitable
 * for merging into sendTemplateEmail() / sendTemplatedOutlookEmail()'s
 * `placeholders` argument.
 *
 * Keys currently provided (keep in sync with email templates):
 *
 *   brand_full_name         — "Forgotten Felines of Sonoma County"
 *   brand_name              — "FFSC"
 *   org_phone               — "(707) 576-7999"
 *   org_email               — public support email
 *   org_website             — "forgottenfelines.com"
 *   org_address             — physical clinic address
 *   org_logo_url            — reachable logo URL for email clients
 *   org_anniversary_badge_url
 *   org_tagline             — short footer tagline
 *   service_area_name       — human-readable service area ("Sonoma County")
 */
export async function buildOrgRenderContext(): Promise<Record<string, string>> {
  const [
    brandFullName,
    brandName,
    orgPhone,
    orgEmail,
    orgWebsite,
    orgAddress,
    orgLogoUrl,
    orgAnniversaryBadgeUrl,
    orgTagline,
    serviceAreaName,
  ] = await Promise.all([
    getOrgName(),
    getOrgNameShort(),
    getOrgPhone(),
    getOrgSupportEmail(),
    getOrgWebsite(),
    getOrgAddress(),
    getOrgLogoUrl(),
    getOrgAnniversaryBadgeUrl(),
    getOrgTagline(),
    getServiceAreaName(),
  ]);

  return {
    brand_full_name: brandFullName,
    brand_name: brandName,
    org_phone: orgPhone,
    org_email: orgEmail,
    org_website: orgWebsite,
    org_address: orgAddress,
    org_logo_url: orgLogoUrl,
    org_anniversary_badge_url: orgAnniversaryBadgeUrl,
    org_tagline: orgTagline,
    service_area_name: serviceAreaName,
  };
}
