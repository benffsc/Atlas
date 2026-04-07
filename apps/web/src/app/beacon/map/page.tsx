// Force dynamic rendering — the map uses useSearchParams and cannot be
// statically prerendered (Next 16 Turbopack requirement)
export const dynamic = "force-dynamic";

import BeaconMapView from "@/components/beacon/BeaconMapView";

export const metadata = {
  title: "Map",
  description: "Spatial view of population density, alteration coverage, and zone health.",
};

/**
 * Beacon Map page — analyst-framed spatial view.
 *
 * Inherits ProductProvider + ThemeSyncer + BeaconSidebar from the
 * /beacon/layout.tsx shell. The map itself is rendered by BeaconMapView,
 * which wraps the shared AtlasMapV2 component with `analystMode={true}`.
 *
 * Tracked under FFS-1173 (parent epic FFS-1172).
 */
export default function BeaconMapPage() {
  return <BeaconMapView />;
}
