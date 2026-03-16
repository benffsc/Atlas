"use client";

import { useSearchParams, usePathname } from "next/navigation";
import { useMemo } from "react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

const ORIGIN_MAP: Record<string, { label: string; href: string }> = {
  trappers: { label: "Trappers", href: "/trappers" },
  fosters: { label: "Fosters", href: "/fosters" },
  people: { label: "People", href: "/people" },
  requests: { label: "Requests", href: "/requests" },
  intake: { label: "Intake Queue", href: "/intake/queue" },
};

const PATH_LABELS: Record<string, string> = {
  trappers: "Trappers",
  fosters: "Fosters",
  people: "People",
  cats: "Cats",
  places: "Places",
  requests: "Requests",
};

/**
 * Derives breadcrumbs from current route and optional `?from=` parameter.
 *
 * - `/trappers/[id]?from=trappers` -> [{label:"Trappers", href:"/trappers"}, {label:"[name]"}]
 * - `/people/[id]?from=trappers` -> [{label:"Trappers", href:"/trappers"}, {label:"[name]"}]
 * - `/people/[id]` (no from) -> [{label:"People", href:"/people"}, {label:"[name]"}]
 */
export function useNavigationContext(entityName?: string) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  return useMemo(() => {
    const from = searchParams.get("from");
    const segments = pathname.split("/").filter(Boolean);
    const rootSegment = segments[0] || "";

    // Determine origin from ?from= param or fall back to path root
    const origin = from && ORIGIN_MAP[from]
      ? ORIGIN_MAP[from]
      : PATH_LABELS[rootSegment]
        ? { label: PATH_LABELS[rootSegment], href: `/${rootSegment}` }
        : null;

    const breadcrumbs: BreadcrumbItem[] = [];

    if (origin) {
      breadcrumbs.push({ label: origin.label, href: origin.href });
    }

    if (entityName) {
      breadcrumbs.push({ label: entityName });
    }

    const backHref = origin?.href || `/${rootSegment}`;
    const backLabel = origin?.label || "Back";

    return { breadcrumbs, backHref, backLabel };
  }, [searchParams, pathname, entityName]);
}
