import { SidebarLayout, type NavSection } from "@/components/SidebarLayout";

const equipmentSections: NavSection[] = [
  {
    title: "Equipment",
    items: [
      { label: "Dashboard", href: "/equipment", icon: "layout-dashboard" },
      { label: "Inventory", href: "/equipment/inventory", icon: "boxes" },
      { label: "Follow-Up", href: "/equipment/collections", icon: "phone-call" },
      { label: "Activity", href: "/equipment/activity", icon: "activity" },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Process Slips", href: "/admin/equipment/scan-slips", icon: "upload-cloud" },
      { label: "Scan / Kiosk", href: "/kiosk/equipment/scan", icon: "scan-barcode" },
      { label: "Restock", href: "/equipment/restock", icon: "clipboard-check" },
    ],
  },
  {
    title: "Print",
    items: [
      { label: "Checkout Slips", href: "/equipment/print/slips", icon: "receipt" },
      { label: "Log Sheet", href: "/equipment/print/log", icon: "file-output" },
    ],
  },
];

export default function EquipmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout sections={equipmentSections} title="Equipment" backLink={{ label: "Home", href: "/" }}>
      {children}
    </SidebarLayout>
  );
}
