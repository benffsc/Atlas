import { redirect } from "next/navigation";

// Redirect old Beacon Preview to new Atlas Map
export default function BeaconPreviewRedirect() {
  redirect("/map");
}
