import { redirect } from "next/navigation";

/** Redirect /kiosk/equipment → /kiosk/equipment/scan */
export default function KioskEquipmentPage() {
  redirect("/kiosk/equipment/scan");
}
