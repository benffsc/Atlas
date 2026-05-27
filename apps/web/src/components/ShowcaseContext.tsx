"use client";

/**
 * ShowcaseContext — Privacy-safe presentation mode for live demos.
 *
 * When showcase mode is active (toggled from the user menu, same as
 * the old "presentation mode"), all PII is redacted client-side using
 * the masking functions from dataMasking.ts. The app shifts from an
 * operational view to an impact-storytelling view:
 *
 *   - Person names → initials + role badge
 *   - Addresses → neighborhood only (street name, no house number)
 *   - Emails/phones → masked or replaced with "Verified Contact"
 *   - Map info windows → stats only, no people names
 *   - Dashboard → impact hero stats with animated count-up
 *
 * Components call useShowcase() to check isShowcase, and useRedact()
 * to get masking functions that are identity (passthrough) when
 * showcase is off.
 */

import { createContext, useContext, useMemo } from "react";
import {
  maskName,
  maskEmail,
  maskPhone,
  maskAddress,
  maskAddressToNeighborhood,
} from "@/lib/dataMasking";

interface ShowcaseContextValue {
  isShowcase: boolean;
}

const ShowcaseCtx = createContext<ShowcaseContextValue>({ isShowcase: false });

export function ShowcaseProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ isShowcase: enabled }), [enabled]);
  return <ShowcaseCtx.Provider value={value}>{children}</ShowcaseCtx.Provider>;
}

export function useShowcase(): ShowcaseContextValue {
  return useContext(ShowcaseCtx);
}

/**
 * useRedact — returns masking functions that are active only in showcase mode.
 *
 * Usage:
 *   const r = useRedact();
 *   <span>{r.name(person.display_name)}</span>
 *   <span>{r.address(place.formatted_address)}</span>
 */
export function useRedact() {
  const { isShowcase } = useShowcase();

  return useMemo(() => {
    if (!isShowcase) {
      // Passthrough — no masking
      return {
        name: (v: string | null | undefined) => v ?? null,
        email: (v: string | null | undefined) => v ?? null,
        phone: (v: string | null | undefined) => v ?? null,
        address: (v: string | null | undefined) => v ?? null,
        neighborhood: (v: string | null | undefined) => v ?? null,
        microchip: (v: string | null | undefined) => v ?? null,
        /** Returns true if a value exists (for showing "Verified" badges) */
        hasValue: (v: string | null | undefined) => !!v,
      };
    }

    return {
      name: maskName,
      email: maskEmail,
      phone: maskPhone,
      address: maskAddress,
      neighborhood: maskAddressToNeighborhood,
      /** Mask last 3 digits of microchip: 985112012345678 → 985112012345*** */
      microchip: (v: string | null | undefined) => {
        if (!v || v.length < 4) return v ?? null;
        return v.slice(0, -3) + "***";
      },
      hasValue: (v: string | null | undefined) => !!v,
    };
  }, [isShowcase]);
}
