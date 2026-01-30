import { MainSidebar } from "@/components/SidebarLayout";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <MainSidebar>{children}</MainSidebar>;
}
