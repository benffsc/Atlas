/**
 * Screensaver Tour Configuration
 *
 * The tour sells BEACON as a product. Map stops demonstrate Beacon
 * capabilities by dispatching scripted UI actions (selecting pins,
 * opening hex compare, etc.) so viewers SEE the product, not read
 * about it.
 *
 * Structure: Beacon intro -> problem -> capability demos -> impact -> CTA
 *
 * Stats verified 2026-05-26:
 * - 60,000+ cats: 37K verified digital (2013+) + 22K pre-digital (1990-2012)
 * - 2,800+ sites: atlas pin count from map data
 * - 35+ years: FFSC founded 1990
 * - ~20 cats/clinic day: conservative estimate from clinic_day_entries
 *
 * Demo place IDs are real production UUIDs chosen for visual impact.
 */

export type SlideVariant = "hero" | "stat-grid" | "explainer" | "cta";

export type TourAction =
  | { type: "select-pin"; placeId: string; delay: number }
  | { type: "select-hex"; lat: number; lng: number; delay: number }
  | { type: "compare-start"; delay: number }
  | { type: "compare-add-hex"; lat: number; lng: number; delay: number }
  | { type: "compare-finish"; delay: number }
  | { type: "dismiss"; delay: number };

export type ScreensaverStep =
  | {
      type: "map";
      label: string;
      description: string;
      lat: number;
      lng: number;
      zoom: number;
      pauseMs: number;
      stat?: { value: string; label: string };
      layers?: string[];
      basemap?: "street" | "satellite" | "dark";
      actions?: TourAction[];
    }
  | {
      type: "slide";
      variant: SlideVariant;
      heading: string;
      body?: string;
      stats?: { value: string; label: string }[];
      pauseMs: number;
      showLogo?: boolean;
      background?: string;
    };

// ── Demo place IDs (real production UUIDs, chosen for visual impact) ──
const DEMO = {
  // 3820 Selvage Road — 127 present cats, central county
  countyOverview: "b2f18eff-3ee5-4f72-b49d-1cea4805d356",
  // 5123 Montecito Ave — 35 cats, the corridor hub
  montecitoCorridor: "97ba25bd-d76f-4c0d-a133-105a70786839",
  // 2922 Fulton Rd — has FIV/FeLV positive cats
  diseaseFlag: "057529ef-80c8-4ce3-a5d1-6961a98c0aa6",
  // 2742 Morgan Creek St — 88 cats, south SR area
  needsTnr: "bbd28653-5ed9-46ad-9599-b73240314f82",
};

export const SCREENSAVER_STEPS: ScreensaverStep[] = [
  // 1. Hero — logo IS the heading (no text "Beacon")
  {
    type: "slide",
    variant: "hero",
    heading: "",
    body: "A smarter way to reduce unowned cat populations",
    pauseMs: 8000,
    showLogo: true,
  },
  // 2. The problem Beacon solves
  {
    type: "slide",
    variant: "explainer",
    heading: "The Problem",
    body: "Spay/neuter works, but population reduction depends on timing, location, and strategy. Altering the right 50 cats, in the right area, at the right time, can change the future of an entire colony. Without better data, organizations respond to the loudest need, not the greatest impact.",
    pauseMs: 14000,
  },
  // 3. Map: Full picture — fly to county, then open a real place drawer
  {
    type: "map",
    label: "The Full Picture",
    description:
      "Every pin is a real location with verified data. Select any site to see its cats, alteration rates, and history.",
    lat: 38.45,
    lng: -122.72,
    zoom: 10,
    pauseMs: 14000,
    stat: { value: "2,800+", label: "sites tracked" },
    layers: [],
    actions: [
      { type: "select-pin", placeId: DEMO.countyOverview, delay: 3500 },
      { type: "dismiss", delay: 11000 },
    ],
  },
  // 4. What Beacon does
  {
    type: "slide",
    variant: "stat-grid",
    heading: "What Beacon Does",
    stats: [
      { value: "See", label: "where the need is greatest" },
      { value: "Prioritize", label: "cats with the most impact" },
      { value: "Forecast", label: "how populations will change" },
      { value: "Direct", label: "clinic capacity where it matters" },
    ],
    pauseMs: 12000,
  },
  // 5. Map: Geographic Intelligence — hexbin density + click a hex
  {
    type: "map",
    label: "Geographic Intelligence",
    description:
      "Where are unowned cats concentrated? Click any hex to see density, alteration rates, and which cats need service.",
    lat: 38.44,
    lng: -122.72,
    zoom: 11,
    pauseMs: 14000,
    stat: { value: "Density", label: "analysis" },
    layers: ["hexbin_density"],
    basemap: "dark" as const,
    actions: [
      { type: "select-hex", lat: 38.44, lng: -122.72, delay: 3500 },
      { type: "dismiss", delay: 11000 },
    ],
  },
  // 6. Map: Corridor Detection — Montecito Ave, satellite view
  {
    type: "map",
    label: "Corridor Detection",
    description:
      "Beacon detects when neighboring properties share a cat population. Instead of five separate calls, our team coordinates a single sweep.",
    lat: 38.4714,
    lng: -122.688,
    zoom: 17,
    pauseMs: 14000,
    stat: { value: "5", label: "linked properties" },
    layers: [],
    basemap: "satellite" as const,
    actions: [
      { type: "select-pin", placeId: DEMO.montecitoCorridor, delay: 3500 },
      { type: "dismiss", delay: 11000 },
    ],
  },
  // 7. Map: Site Comparison — hex compare with two real areas
  {
    type: "map",
    label: "Site Comparison",
    description:
      "Compare sites side by side to see alteration rates, intact estimates, and forecasts. Reveals which areas need help most.",
    lat: 38.43,
    lng: -122.73,
    zoom: 11,
    pauseMs: 20000,
    stat: { value: "Compare", label: "sites" },
    layers: ["hexbin_density"],
    basemap: "dark" as const,
    actions: [
      { type: "compare-start", delay: 2500 },
      // Selvage Road area (heavy colony area, west)
      { type: "compare-add-hex", lat: 38.46, lng: -122.81, delay: 4500 },
      // South SR area (Morgan Creek / Stony Point)
      { type: "compare-add-hex", lat: 38.40, lng: -122.73, delay: 7000 },
      { type: "compare-finish", delay: 9000 },
      { type: "dismiss", delay: 17000 },
    ],
  },
  // 8. Map: Disease Surveillance — disease layer + select flagged place
  {
    type: "map",
    label: "Disease Surveillance",
    description:
      "When a cat tests positive for FIV or FeLV, Beacon maps the result to identify risk corridors and prioritize response.",
    lat: 38.44,
    lng: -122.72,
    zoom: 11,
    pauseMs: 14000,
    stat: { value: "Active", label: "disease monitoring" },
    layers: ["atlas_disease"],
    basemap: "dark" as const,
    actions: [
      { type: "select-pin", placeId: DEMO.diseaseFlag, delay: 3500 },
      { type: "dismiss", delay: 11000 },
    ],
  },
  // 9. Two levers
  {
    type: "slide",
    variant: "explainer",
    heading: "Two Levers for Faster Impact",
    body: "Increase clinic capacity so more cats can be altered each year. Use Beacon to target cats strategically so every surgery has the greatest possible impact. Together, these create faster, more humane population reduction.",
    pauseMs: 13000,
  },
  // 10. Map: Strategic Prioritization — all pins + select high-need site
  {
    type: "map",
    label: "Strategic Prioritization",
    description:
      "Where can the next surgery make the biggest difference? Focus resources where they prevent the most future births.",
    lat: 38.41,
    lng: -122.73,
    zoom: 13,
    pauseMs: 14000,
    stat: { value: "~20", label: "cats per clinic day" },
    layers: [],
    actions: [
      { type: "select-pin", placeId: DEMO.needsTnr, delay: 3500 },
      { type: "dismiss", delay: 11000 },
    ],
  },
  // 11. Impact stats
  {
    type: "slide",
    variant: "stat-grid",
    heading: "Built on 35 Years of Work",
    stats: [
      { value: "60,000+", label: "cats altered since 1990" },
      { value: "2,800+", label: "colony sites monitored" },
      { value: "35+", label: "years of field experience" },
      { value: "1", label: "dedicated clinic in Sonoma County" },
    ],
    pauseMs: 12000,
  },
  // 12. CTA
  {
    type: "slide",
    variant: "cta",
    heading: "Be Part of What Comes Next",
    body: "Beacon is still growing. With your support, we can expand clinic capacity, improve our data, and guide smarter, faster, more humane population reduction across Sonoma County.",
    pauseMs: 12000,
    showLogo: true,
  },
  // 13. County-wide closing (satellite)
  {
    type: "map",
    label: "Better Data, Better Outcomes",
    description:
      "From Cloverdale to Petaluma, Bodega Bay to Sonoma Valley. Beacon turns 35 years of compassion into a planning tool so every dollar, every volunteer hour, and every surgery makes the greatest possible difference.",
    lat: 38.5,
    lng: -122.78,
    zoom: 10,
    pauseMs: 10000,
    stat: { value: "Beacon", label: "by Forgotten Felines" },
    layers: [],
    basemap: "satellite" as const,
  },
];
