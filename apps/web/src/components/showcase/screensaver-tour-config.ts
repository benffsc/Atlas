/**
 * Screensaver Tour Configuration
 *
 * Uses FFR (Find Fix Return) not TNR. Demo place IDs are real production
 * UUIDs with verified sensible data. Scripted actions demo the product
 * live on each map step.
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
    };

// Real production UUIDs — verified to have sensible alteration rates
const DEMO = {
  // 790 Los Olivos Rd — 60 cats, 68% altered, good visual density
  countyOverview: "0776d327-f84c-46c7-b098-edafaa9dcded",
  // 5123 Montecito Ave — 35 cats, 97% altered, corridor hub
  montecitoCorridor: "97ba25bd-d76f-4c0d-a133-105a70786839",
  // 2922 Fulton Rd — has FIV/FeLV positive cats
  diseaseFlag: "057529ef-80c8-4ce3-a5d1-6961a98c0aa6",
};

export const SCREENSAVER_STEPS: ScreensaverStep[] = [
  // 1. Hero
  {
    type: "slide",
    variant: "hero",
    heading: "",
    body: "A smarter way to reduce unowned cat populations",
    pauseMs: 8000,
    showLogo: true,
  },
  // 2. The problem
  {
    type: "slide",
    variant: "explainer",
    heading: "The Problem",
    body: "Find, Fix, Return works. But population reduction depends on timing, location, and strategy. Altering the right 50 cats, in the right area, at the right time, can change the future of an entire colony. Without better data, organizations respond to the loudest need, not the greatest impact.",
    pauseMs: 14000,
  },
  // 3. Map: Full picture + open a real place drawer
  {
    type: "map",
    label: "The Full Picture",
    description:
      "Every pin is a real location with verified data. Select any site to see its cats, alteration rates, and history.",
    lat: 38.46,
    lng: -122.69,
    zoom: 13,
    pauseMs: 16000,
    stat: { value: "2,800+", label: "sites tracked" },
    layers: [],
    actions: [
      { type: "select-pin", placeId: DEMO.countyOverview, delay: 4000 },
      { type: "dismiss", delay: 13000 },
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
  // 5. Map: Density hexbin + click a hex
  {
    type: "map",
    label: "Geographic Intelligence",
    description:
      "Where are unowned cats concentrated? Click any hex to see density, FFR progress, and which cats need service.",
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
  // 6. Map: Corridor Detection (Montecito) — real drawer shows corridor links
  {
    type: "map",
    label: "Corridor Detection",
    description:
      "Beacon detects when neighboring properties share a cat population. Instead of five separate calls, our team coordinates a single sweep.",
    lat: 38.4714,
    lng: -122.688,
    zoom: 17,
    pauseMs: 16000,
    stat: { value: "5", label: "linked properties" },
    layers: [],
    basemap: "satellite" as const,
    actions: [
      { type: "select-pin", placeId: DEMO.montecitoCorridor, delay: 4000 },
      { type: "dismiss", delay: 13000 },
    ],
  },
  // 7. Two levers
  {
    type: "slide",
    variant: "explainer",
    heading: "Two Levers for Faster Impact",
    body: "Increase clinic capacity so more cats can be altered each year. Use Beacon to target cats strategically so every surgery has the greatest possible impact. Together, these create faster, more humane population reduction.",
    pauseMs: 12000,
  },
  // 8. Map: Strategic Comparison — 3 areas
  {
    type: "map",
    label: "Strategic Prioritization",
    description:
      "Where should the next clinic day focus? Beacon compares areas side by side, showing FFR progress, disease signals, and forecasts to direct resources where they prevent the most future births.",
    lat: 38.43,
    lng: -122.73,
    zoom: 11,
    pauseMs: 24000,
    stat: { value: "Compare", label: "FFR progress" },
    layers: ["hexbin_density"],
    basemap: "dark" as const,
    actions: [
      { type: "compare-start", delay: 2500 },
      { type: "compare-add-hex", lat: 38.46, lng: -122.81, delay: 4500 },
      { type: "compare-add-hex", lat: 38.35, lng: -122.74, delay: 7000 },
      { type: "compare-add-hex", lat: 38.40, lng: -122.73, delay: 9500 },
      { type: "compare-finish", delay: 12000 },
      { type: "dismiss", delay: 21000 },
    ],
  },
  // 9. Map: Disease Surveillance
  {
    type: "map",
    label: "Disease Surveillance",
    description:
      "When a cat tests positive for FIV or FeLV, Beacon maps the result to identify risk corridors and prioritize response.",
    lat: 38.44,
    lng: -122.72,
    zoom: 11,
    pauseMs: 16000,
    stat: { value: "Active", label: "disease monitoring" },
    layers: ["atlas_disease"],
    basemap: "dark" as const,
    actions: [
      { type: "select-pin", placeId: DEMO.diseaseFlag, delay: 4000 },
      { type: "dismiss", delay: 13000 },
    ],
  },
  // 10. Impact stats
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
  // 11. CTA
  {
    type: "slide",
    variant: "cta",
    heading: "Be Part of What Comes Next",
    body: "Beacon is still growing. With your support, we can expand clinic capacity, improve our data, and guide smarter, faster, more humane population reduction across Sonoma County.",
    pauseMs: 12000,
    showLogo: true,
  },
  // 12. County-wide closing (satellite)
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
