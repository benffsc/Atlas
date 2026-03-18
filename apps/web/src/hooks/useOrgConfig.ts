/**
 * useOrgConfig — convenience wrapper over useAppConfig for org branding.
 *
 * Returns all org values with FFSC defaults. Uses SWR deduplication
 * so multiple calls share a single fetch.
 *
 * FFS-684: White-label readiness.
 */

import { useAppConfig } from "@/hooks/useAppConfig";

export function useOrgConfig() {
  const { value: nameFull } = useAppConfig<string>("org.name_full");
  const { value: nameShort } = useAppConfig<string>("org.name_short");
  const { value: phone } = useAppConfig<string>("org.phone");
  const { value: website } = useAppConfig<string>("org.website");
  const { value: supportEmail } = useAppConfig<string>("org.support_email");
  const { value: tagline } = useAppConfig<string>("org.tagline");

  return { nameFull, nameShort, phone, website, supportEmail, tagline };
}
