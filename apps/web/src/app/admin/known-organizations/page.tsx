import { redirect } from "next/navigation";

/**
 * Redirect: Known Organizations → Organizations
 *
 * Known organizations have been consolidated into the unified Organizations page.
 * See /admin/organizations for the new interface.
 */
export default function KnownOrganizationsRedirect() {
  redirect("/admin/organizations");
}
