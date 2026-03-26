import { SidebarLayout, type NavSection } from "@/components/SidebarLayout";

const equipmentSections: NavSection[] = [
  {
    title: "Equipment",
    items: [
      { label: "Inventory", href: "/equipment", icon: "|||" },
      { label: "Scanner", href: "/equipment/scan", icon: ">>>" },
      { label: "Restock", href: "/equipment/restock", icon: "+++" },
      { label: "Kits", href: "/equipment/kits", icon: "[ ]" },
      { label: "Collections", href: "/equipment/collections", icon: "<<<" },
    ],
  },
  {
    title: "Kiosk (iPad)",
    items: [
      { label: "Open Kiosk", href: "/kiosk/equipment/scan", icon: "scan-barcode" },
      { label: "iPad Setup Guide", href: "/kiosk/setup", icon: "settings" },
    ],
  },
  {
    title: "Related",
    items: [
      { label: "Trappers", href: "/trappers", icon: ">>>" },
      { label: "Requests", href: "/requests", icon: ">>>" },
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
