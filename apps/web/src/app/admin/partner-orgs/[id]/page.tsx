import { redirect } from "next/navigation";

/**
 * Redirect: Partner Organization Detail → Organizations
 *
 * Partner orgs have been consolidated into the unified Organizations page.
 * Individual org details are now shown in modals on /admin/organizations.
 */
export default function PartnerOrgDetailRedirect() {
  redirect("/admin/organizations");
}
