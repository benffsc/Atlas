import type { Metadata } from "next";
import { ProductProvider } from "@/lib/product-context";
import { ThemeSyncer } from "@/components/ThemeSyncer";
import { BeaconSidebar } from "@/components/SidebarLayout";

export const metadata: Metadata = {
  title: {
    default: "Beacon",
    template: "%s | Beacon",
  },
};

/**
 * Beacon layout — wraps all /beacon/* routes with Beacon product context.
 *
 * - Sets ProductContext to "beacon" (drives branding, nav, features)
 * - Syncs Beacon design tokens to CSS variables
 * - Shows Beacon-specific sidebar navigation
 * - All existing components that read var(--primary) etc. automatically theme
 *
 * Atlas pages (outside /beacon/*) continue to render with Atlas context unchanged.
 */
export default function BeaconLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProductProvider product="beacon">
      <ThemeSyncer>
        <BeaconSidebar>
          {children}
        </BeaconSidebar>
      </ThemeSyncer>
    </ProductProvider>
  );
}
