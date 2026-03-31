"use client";

/**
 * Kiosk configuration accessible from the Equipment sidebar.
 * Re-exports the admin kiosk page content so staff can find it
 * from the equipment management flow, not just /admin/kiosk.
 */
import AdminKioskPage from "@/app/admin/kiosk/page";

export default function EquipmentKioskConfigPage() {
  return <AdminKioskPage />;
}
