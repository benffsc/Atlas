"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { useMapLayout } from "./MapLayoutContext";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: "home" },
  { label: "Map", href: "/map", icon: "map" },
  { label: "Intake Queue", href: "/intake/queue", icon: "inbox" },
  { label: "Requests", href: "/requests", icon: "clipboard-list" },
  { label: "Cats", href: "/cats", icon: "cat" },
  { label: "People", href: "/people", icon: "users" },
  { label: "Places", href: "/places", icon: "map-pin" },
] as const;

export function MapNavRail() {
  const pathname = usePathname();
  const { toggleSidebar, sidebarOpen } = useMapLayout();

  return (
    <nav className="map-nav-rail" aria-label="App navigation">
      {/* Sidebar expand — only visible when sidebar is collapsed */}
      {!sidebarOpen && (
        <button
          className="map-nav-rail__item"
          onClick={toggleSidebar}
          title="Open sidebar (L)"
          aria-label="Open sidebar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
            <path d="m14 9 3 3-3 3" />
          </svg>
        </button>
      )}

      {!sidebarOpen && <div className="map-nav-rail__divider" />}

      {/* Nav items */}
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === "/map"
          ? pathname === "/map"
          : pathname.startsWith(item.href) && item.href !== "/";

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`map-nav-rail__item ${isActive ? "map-nav-rail__item--active" : ""}`}
            title={item.label}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon name={item.icon} size={20} />
          </Link>
        );
      })}

      <div className="map-nav-rail__spacer" />

      {/* Admin link at bottom */}
      <Link
        href="/admin"
        className={`map-nav-rail__item ${pathname.startsWith("/admin") ? "map-nav-rail__item--active" : ""}`}
        title="Admin"
        aria-label="Admin"
      >
        <Icon name="settings" size={20} />
      </Link>
    </nav>
  );
}
