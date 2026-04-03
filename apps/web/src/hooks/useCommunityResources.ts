/**
 * useCommunityResources — SWR-based hook for community resource cards.
 *
 * Fetches active resources by category from /api/resources.
 * Falls back to hardcoded data while loading (ensures kiosk never shows empty).
 * Caches for 10 minutes — resources don't change frequently.
 *
 * Usage:
 *   const { resources, isLoading } = useCommunityResources("pet_spay");
 *   // resources: TippyResourceCard[]
 *
 * FFS-1114
 */

import useSWR from "swr";
import { fetchApi } from "@/lib/api-client";
import type { TippyResourceCard } from "@/lib/tippy-tree";

// ── Fallback Data ────────────────────────────────────────────────────────────
// Used while loading or if the API is unreachable.
// Matches the seed data in MIG_3039.

const FALLBACK_PET_SPAY: TippyResourceCard[] = [
  {
    name: "Humane Society of Sonoma County",
    description: "Low-cost spay/neuter for owned pets. Appointment only.",
    phone: "(707) 284-3499",
    icon: "heart-handshake",
    urgency: "info",
  },
  {
    name: "Love Me, Fix Me Voucher Program",
    description: "Sonoma County's low-cost spay/neuter voucher program.",
    phone: "(707) 565-7100",
    icon: "heart-pulse",
    urgency: "info",
  },
  {
    name: "Pets Lifeline",
    description: "Low-cost community spay/neuter clinic with sliding scale.",
    phone: "(707) 996-4577",
    icon: "heart",
    urgency: "info",
  },
  {
    name: "Esperanza Spay & Neuter Truck",
    description: "Mobile low-cost spay/neuter service throughout Sonoma County.",
    phone: "(707) 304-6238",
    icon: "truck",
    urgency: "info",
  },
  {
    name: "Rohnert Park Animal Shelter",
    description: "Low-income free monthly spay/neuter clinics. Rohnert Park residents prioritized.",
    phone: "(707) 588-3531",
    icon: "heart-handshake",
    urgency: "info",
  },
];

const FALLBACK_EMERGENCY_VET: TippyResourceCard[] = [
  {
    name: "VCA PetCare East Veterinary Hospital",
    description: "24-hour emergency veterinary hospital.",
    phone: "(707) 579-3900",
    address: "2425 Mendocino Ave, Santa Rosa, CA 95403",
    hours: "Open 24/7",
    icon: "siren",
    urgency: "emergency",
  },
  {
    name: "TruVet Specialty and Emergency Hospital",
    description: "24-hour emergency and specialty hospital.",
    phone: "(707) 787-5340",
    address: "2620 Lakeville Hwy, Bldg D, Petaluma, CA 94954",
    hours: "Open 24/7",
    icon: "siren",
    urgency: "emergency",
  },
  {
    name: "Emergency Animal Hospital of Santa Rosa",
    description: "After-hours emergency care (weekday evenings, weekends/holidays 24hr).",
    phone: "(707) 542-4012",
    address: "1946 Santa Rosa Ave, Santa Rosa, CA 95407",
    hours: "Mon-Fri 6PM-8AM, Sat-Sun & Holidays 24hr",
    icon: "siren",
    urgency: "emergency",
  },
];

const FALLBACK_FFSC: TippyResourceCard[] = [
  {
    name: "Forgotten Felines of Sonoma County",
    description: "Free spay/neuter for community cats through our Trap-Neuter-Return program.",
    phone: "(707) 576-7999",
    address: "1814 Empire Industrial Ct, Santa Rosa, CA 95404",
    icon: "heart",
    urgency: "info",
  },
];

const FALLBACK_GENERAL: TippyResourceCard[] = [
  {
    name: "Dogwood Animal Rescue",
    description: "Free and low-cost spay/neuter assistance for rural Sonoma County areas.",
    phone: "(707) 799-9957",
    icon: "heart",
    urgency: "info",
  },
  {
    name: "Twenty Tails Rescue",
    description: "TNR assistance and barn cat program for Sonoma County.",
    icon: "heart",
    urgency: "info",
  },
];

const FALLBACKS: Record<string, TippyResourceCard[]> = {
  pet_spay: FALLBACK_PET_SPAY,
  emergency_vet: FALLBACK_EMERGENCY_VET,
  ffsc: FALLBACK_FFSC,
  general: FALLBACK_GENERAL,
};

// ── Hook ─────────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetchApi<TippyResourceCard[]>(url);

export function useCommunityResources(category: string): {
  resources: TippyResourceCard[];
  isLoading: boolean;
  error: Error | undefined;
} {
  const { data, error, isLoading } = useSWR<TippyResourceCard[]>(
    `/api/resources?category=${encodeURIComponent(category)}`,
    fetcher,
    {
      dedupingInterval: 600_000, // 10 min
      revalidateOnFocus: false,
      fallbackData: FALLBACKS[category] || [],
    },
  );

  return {
    resources: data || FALLBACKS[category] || [],
    isLoading,
    error,
  };
}
