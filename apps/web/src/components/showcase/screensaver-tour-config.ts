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
  // Full Picture cascade (3 places near Los Olivos area)
  losOlivos: "0776d327-f84c-46c7-b098-edafaa9dcded",     // 60 cats, 68%
  dartmouth: "a00b94dd-5e31-4d17-8acb-79e0e9905858",     // 31 cats, 65%
  carrAve: "b6e731eb-e6ce-461a-b20c-8a35f63f0680",       // 30 cats, 83%
  // Corridor cascade (Montecito Ave + neighbors)
  montecito5123: "97ba25bd-d76f-4c0d-a133-105a70786839",  // 35 cats, 97%
  montecito5055: "931a6b35-c98c-46d5-abc1-85d65f08ab9d",  // 6 cats
  montecito5245: "40412b12-e425-4f7a-be84-39640a4392af",  // 4 cats
  // Disease cascade
  diseaseFulton: "057529ef-80c8-4ce3-a5d1-6961a98c0aa6",
  diseaseRose: "1b4dec9e-7396-4c7d-b8fd-ee390860a22f",
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
    pauseMs: 42000,
    stat: { value: "2,800+", label: "sites tracked" },
    layers: [],
    actions: [
      // Cascade: open 3 places — starts after card shrinks (8s)
      { type: "select-pin", placeId: DEMO.losOlivos, delay: 10000 },
      { type: "dismiss", delay: 18000 },
      { type: "select-pin", placeId: DEMO.dartmouth, delay: 20000 },
      { type: "dismiss", delay: 28000 },
      { type: "select-pin", placeId: DEMO.carrAve, delay: 30000 },
      { type: "dismiss", delay: 38000 },
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
    pauseMs: 22000,
    stat: { value: "Density", label: "analysis" },
    layers: ["hexbin_density"],
    basemap: "dark" as const,
    actions: [
      { type: "select-hex", lat: 38.44, lng: -122.72, delay: 6000 },
      { type: "dismiss", delay: 18000 },
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
    pauseMs: 42000,
    stat: { value: "5", label: "linked properties" },
    layers: [],
    basemap: "satellite" as const,
    actions: [
      // Cascade through corridor properties — starts after card shrinks
      { type: "select-pin", placeId: DEMO.montecito5123, delay: 10000 },
      { type: "dismiss", delay: 18000 },
      { type: "select-pin", placeId: DEMO.montecito5055, delay: 20000 },
      { type: "dismiss", delay: 28000 },
      { type: "select-pin", placeId: DEMO.montecito5245, delay: 30000 },
      { type: "dismiss", delay: 38000 },
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
    pauseMs: 46000,
    stat: { value: "Compare", label: "FFR progress" },
    layers: ["hexbin_density"],
    basemap: "dark" as const,
    actions: [
      // Start compare well after card description reappears (9.4s)
      { type: "compare-start", delay: 14000 },
      { type: "compare-add-hex", lat: 38.46, lng: -122.81, delay: 16000 },
      { type: "compare-add-hex", lat: 38.35, lng: -122.74, delay: 19000 },
      { type: "compare-add-hex", lat: 38.40, lng: -122.73, delay: 22000 },
      { type: "compare-finish", delay: 24000 },
      { type: "dismiss", delay: 42000 },
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
    pauseMs: 30000,
    stat: { value: "Active", label: "disease monitoring" },
    layers: ["atlas_disease"],
    basemap: "dark" as const,
    actions: [
      { type: "select-pin", placeId: DEMO.diseaseFulton, delay: 10000 },
      { type: "dismiss", delay: 18000 },
      { type: "select-pin", placeId: DEMO.diseaseRose, delay: 20000 },
      { type: "dismiss", delay: 28000 },
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
  // 11. CTA — last slide, then loops back to hero with logo centering
  {
    type: "slide",
    variant: "cta",
    heading: "Be Part of What Comes Next",
    body: "Beacon is still growing. With your support, we can expand clinic capacity, improve our data, and guide smarter, faster, more humane population reduction across Sonoma County.",
    pauseMs: 14000,
  },
];
