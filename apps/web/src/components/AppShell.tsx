"use client";

import { usePathname } from "next/navigation";
import GlobalSearch from "@/components/GlobalSearch";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Check if this is a print route - these should have no chrome
  const isPrintRoute = pathname?.includes("/print");

  if (isPrintRoute) {
    // Print routes get no navigation, no container wrapper
    return <>{children}</>;
  }

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <a href="/" className="nav-brand">
            <img src="/logo.png" alt="Atlas" className="nav-logo" />
            <span>Atlas</span>
          </a>
          <GlobalSearch />
          <div className="nav-links">
            <a href="/requests" className="nav-link">
              Requests
            </a>
            <a href="/cats" className="nav-link">
              Cats
            </a>
            <a href="/people" className="nav-link">
              People
            </a>
            <a href="/places" className="nav-link">
              Places
            </a>
            <a href="/intake/queue" className="nav-link">
              Intake
            </a>
            <a href="/admin/ingest" className="nav-link" style={{ opacity: 0.7 }}>
              Ingest
            </a>
          </div>
        </div>
      </nav>
      <main className="container">{children}</main>
    </>
  );
}
