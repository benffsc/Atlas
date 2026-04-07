"use client";

/**
 * ProductContext — The bridge layer between Atlas and Beacon.
 *
 * This single context answers "which product am I rendering in?"
 * and drives: sidebar nav, branding, CSS theme, feature availability.
 *
 * Usage:
 *   // In a layout:
 *   <ProductProvider product="beacon">
 *     {children}
 *   </ProductProvider>
 *
 *   // In any component:
 *   const { product, brandName, isBeacon } = useProduct();
 */

import { createContext, useContext, type ReactNode } from "react";

export type ProductId = "atlas" | "beacon";

interface ProductConfig {
  /** Which product context we're in */
  product: ProductId;
  /** Display name for branding */
  brandName: string;
  /** Short name for compact spaces */
  brandNameShort: string;
  /** CSS class applied to the shell for product-scoped theming */
  themeClass: string;
  /** Whether this is the Beacon product */
  isBeacon: boolean;
  /** Whether this is the Atlas product */
  isAtlas: boolean;
}

// NOTE: Atlas is now the internal DB / backend name only. The user-facing
// product is Beacon across the whole app. Both product IDs resolve to the
// "Beacon" brand name — the distinction between `atlas` and `beacon` product
// IDs is kept for routing/theme purposes (e.g. /beacon/* analytics pages have
// their own theme), but all user-visible chrome says "Beacon".
const PRODUCT_CONFIGS: Record<ProductId, ProductConfig> = {
  atlas: {
    product: "atlas",
    brandName: "Beacon",
    brandNameShort: "Beacon",
    themeClass: "theme-atlas",
    isBeacon: false,
    isAtlas: true,
  },
  beacon: {
    product: "beacon",
    brandName: "Beacon",
    brandNameShort: "Beacon",
    themeClass: "theme-beacon",
    isBeacon: true,
    isAtlas: false,
  },
};

const ProductCtx = createContext<ProductConfig>(PRODUCT_CONFIGS.atlas);

export function ProductProvider({
  product,
  children,
}: {
  product: ProductId;
  children: ReactNode;
}) {
  const config = PRODUCT_CONFIGS[product];
  return <ProductCtx.Provider value={config}>{children}</ProductCtx.Provider>;
}

export function useProduct(): ProductConfig {
  return useContext(ProductCtx);
}
