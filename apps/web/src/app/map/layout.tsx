// Force dynamic rendering — the map page uses useSearchParams and
// cannot be statically prerendered (Next 16 Turbopack requirement)
export const dynamic = "force-dynamic";

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
