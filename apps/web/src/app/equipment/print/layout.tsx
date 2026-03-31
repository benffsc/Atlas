/**
 * Print pages under /equipment/print/* need to escape the equipment sidebar
 * layout on print, but still show it on screen for navigation.
 * The @media print CSS in each page hides the sidebar.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
