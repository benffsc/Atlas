import { SidebarLayout, type NavSection } from "@/components/SidebarLayout";
import { TransitionBanner } from "./TransitionBanner";

const equipmentSections: NavSection[] = [
  {
    title: "Equipment",
    items: [
      { label: "Inventory", href: "/equipment", icon: "boxes" },
      { label: "Scanner", href: "/equipment/scan", icon: "scan-barcode" },
      { label: "Restock", href: "/equipment/restock", icon: "clipboard-check" },
      { label: "Kits", href: "/equipment/kits", icon: "package" },
      { label: "Collections", href: "/equipment/collections", icon: "layers" },
    ],
  },
  {
    title: "Print Forms",
    items: [
      { label: "Checkout Slips", href: "/equipment/print/slips", icon: "receipt" },
      { label: "Log Sheet", href: "/equipment/print/log", icon: "file-output" },
    ],
  },
  {
    title: "Kiosk",
    items: [
      { label: "Open Kiosk", href: "/kiosk", icon: "tablet" },
      { label: "Kiosk Config", href: "/equipment/kiosk-config", icon: "settings" },
      { label: "iPad Setup", href: "/kiosk/setup", icon: "smartphone" },
    ],
  },
  {
    title: "Related",
    items: [
      { label: "Trappers", href: "/trappers", icon: "snail" },
      { label: "Requests", href: "/requests", icon: "clipboard-list" },
    ],
  },
];

export default function EquipmentLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout sections={equipmentSections} title="Equipment" backLink={{ label: "Home", href: "/" }}>
      <TransitionBanner />
      {children}
    </SidebarLayout>
  );
}
