import { redirect } from "next/navigation";

/** Detail view not yet implemented — redirect to tracker list */
export default function PartnerOrgDetailPage() {
  redirect("/admin/partner-orgs");
}
