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
      {/* Sidebar toggle */}
      <button
        className="map-nav-rail__item"
        onClick={toggleSidebar}
        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        <Icon name={sidebarOpen ? "panel-left-close" : "panel-left-open"} size={20} />
      </button>

      <div className="map-nav-rail__divider" />

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
