"use client";

/**
 * ThemeSyncer — Bridges admin-configurable design tokens → CSS variables.
 *
 * Problem: useDesignTokens() returns TypeScript values from ops.app_config,
 * but components read CSS variables from :root. These two systems are disconnected.
 *
 * Solution: This component reads design tokens via SWR and writes them into
 * CSS custom properties on a wrapper div. Any child component using var(--primary)
 * automatically picks up the admin-configured or product-specific values.
 *
 * Usage (in a layout):
 *   <ThemeSyncer product="beacon">
 *     {children}
 *   </ThemeSyncer>
 *
 * This also applies the product theme class (theme-atlas or theme-beacon)
 * so CSS can scope rules per product:
 *   .theme-beacon { --primary: #4291df; }
 */

import { useEffect, type ReactNode } from "react";
import { useDesignTokens } from "@/hooks/useDesignTokens";
import { useProduct, type ProductId } from "@/lib/product-context";

// Beacon brand colors from the product spec (Dominique's design system)
const BEACON_OVERRIDES: Record<string, string> = {
  "--primary": "#4291df",
  "--primary-foreground": "#ffffff",
  "--accent-blue": "#4291df",
};

export function ThemeSyncer({ children }: { children: ReactNode }) {
  const { brand, isLoading } = useDesignTokens();
  const { product, themeClass } = useProduct();

  useEffect(() => {
    if (isLoading) return;

    const root = document.documentElement;

    // Apply admin-configured brand colors to CSS variables
    if (brand.primary) root.style.setProperty("--primary", brand.primary);
    if (brand.primaryDark) root.style.setProperty("--primary-dark", brand.primaryDark);
    if (brand.primaryLight) root.style.setProperty("--primary-light", brand.primaryLight);
    if (brand.primaryHover) root.style.setProperty("--primary-hover", brand.primaryHover);

    // Apply product-specific overrides on top
    if (product === "beacon") {
      for (const [key, value] of Object.entries(BEACON_OVERRIDES)) {
        root.style.setProperty(key, value);
      }
    }

    // Add theme class to body for CSS scoping
    document.body.classList.remove("theme-atlas", "theme-beacon");
    document.body.classList.add(themeClass);

    return () => {
      // Cleanup: remove product overrides when unmounting
      document.body.classList.remove(themeClass);
      if (product === "beacon") {
        for (const key of Object.keys(BEACON_OVERRIDES)) {
          root.style.removeProperty(key);
        }
      }
    };
  }, [brand, product, themeClass, isLoading]);

  return <>{children}</>;
}
