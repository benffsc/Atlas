// Standalone layout for print pages - no kiosk tab bar
export default function PrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
