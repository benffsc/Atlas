import { redirect } from "next/navigation";

/**
 * Redirect: Partner Organizations → Organizations
 *
 * Partner orgs have been consolidated into the unified Organizations page.
 * See /admin/organizations for the new interface.
 */
export default function PartnerOrgsRedirect() {
  redirect("/admin/organizations");
}
