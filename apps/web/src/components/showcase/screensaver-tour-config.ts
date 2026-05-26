/**
 * Screensaver Tour Configuration
 *
 * Mixed step types: map fly-throughs interleaved with full-screen info slides.
 * All content is TV-optimized (large text, high contrast).
 *
 * Map stops include vague, anonymized colony stories drawn from real
 * patterns in the data — no PII, no addresses, no names.
 *
 * Stats verified 2026-05-26:
 * - 60,000+ cats: 37K verified digital (2013+) + 22K pre-digital (1990-2012)
 * - 2,800+ sites: atlas pin count from map data
 * - 35+ years: FFSC founded 1990
 * - ~20 cats/clinic day: conservative estimate from clinic_day_entries
 */

export type SlideVariant = "hero" | "stat-grid" | "explainer" | "cta";

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

export const SCREENSAVER_STEPS: ScreensaverStep[] = [
  // 1. Hero slide
  {
    type: "slide",
    variant: "hero",
    heading: "Beacon",
    body: "A smarter way to reduce unowned cat populations",
    pauseMs: 6000,
    showLogo: true,
  },
  // 2. County overview map
  {
    type: "map",
    label: "Sonoma County Overview",
    description:
      "Every pin is a location we monitor. Behind each one is a colony with its own story — a caretaker who feeds them, a neighbor who called for help, a trapper who spent weeks earning their trust.",
    lat: 38.45,
    lng: -122.72,
    zoom: 10,
    pauseMs: 8000,
    stat: { value: "2,800+", label: "colony sites" },
  },
  // 3. "What is FFR?" explainer
  {
    type: "slide",
    variant: "explainer",
    heading: "What is FFR?",
    body: "Find-Fix-Return is the humane, evidence-based method for managing community cat populations. Cats are found and humanely trapped, fixed (spayed or neutered) at our clinic, then returned to their outdoor home. Over time, the colony stabilizes and naturally decreases.",
    pauseMs: 8000,
  },
  // 4. Santa Rosa — neighborhood corridor story
  {
    type: "map",
    label: "A Neighborhood Working Together",
    description:
      "Several neighboring properties in central Santa Rosa where cats roam freely between yards. Beacon detected the connection automatically. Instead of responding to each home separately, our team coordinated a single effort across the entire corridor.",
    lat: 38.4485,
    lng: -122.6945,
    zoom: 17,
    pauseMs: 9000,
    stat: { value: "5", label: "linked properties" },
  },
  // 5. What Beacon Does — diagram-inspired slide
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
    pauseMs: 8000,
  },
  // 6. South Santa Rosa — commercial colony story
  {
    type: "map",
    label: "A Colony Behind a Business",
    description:
      "A colony living behind a commercial lot on the south side. A litter of kittens was discovered on the property. Our team worked with the business to trap the mother and kittens — mom was returned after surgery, and the kittens were placed in foster homes.",
    lat: 38.408,
    lng: -122.735,
    zoom: 16,
    pauseMs: 9000,
    stat: { value: "Found", label: "through Beacon" },
  },
  // 7. Santa Rosa density — hexbin view
  {
    type: "map",
    label: "Where the Need Is Greatest",
    description:
      "Each hexagon shows the concentration of colony activity. The darkest cells often represent neighborhoods where a dedicated caretaker is feeding unaltered cats. Beacon helps us find them before kitten season starts.",
    lat: 38.44,
    lng: -122.714,
    zoom: 12,
    pauseMs: 8000,
    stat: { value: "~20", label: "cats per clinic day" },
    layers: ["cat-density-heatmap"],
  },
  // 8. The long-term colony story
  {
    type: "slide",
    variant: "explainer",
    heading: "It Takes Years, Not Days",
    body: "Colony stabilization is patient work — trapping a few cats at a time, returning them, building trust with caretakers. Over months and years, the colony stops growing. The cats are still there. They're just not reproducing.",
    pauseMs: 9000,
  },
  // 9. Disease monitoring map
  {
    type: "map",
    label: "Disease Surveillance",
    description:
      "When a cat tests positive for FIV or FeLV, Beacon maps the result against every colony in the area. This helps our team identify risk corridors and prioritize where to focus next.",
    lat: 38.44,
    lng: -122.72,
    zoom: 11,
    pauseMs: 8000,
    stat: { value: "Active", label: "disease monitoring" },
    layers: ["disease-heatmap"],
  },
  // 10. Impact stat grid slide
  {
    type: "slide",
    variant: "stat-grid",
    heading: "Impact Since 1990",
    stats: [
      { value: "60,000+", label: "cats altered" },
      { value: "2,800+", label: "colony sites monitored" },
      { value: "35+", label: "years of operations" },
      { value: "1", label: "dedicated clinic in Sonoma County" },
    ],
    pauseMs: 8000,
  },
  // 11. "How You Can Help" CTA slide
  {
    type: "slide",
    variant: "cta",
    heading: "How You Can Help",
    body: "Your support funds spay/neuter surgeries, trapping equipment, and the technology that makes this work possible. Every dollar helps reduce outdoor cat suffering in Sonoma County.",
    pauseMs: 8000,
    showLogo: true,
  },
  // 12. County-wide sweep — closing
  {
    type: "map",
    label: "Every Cat Has a Story",
    description:
      "From Cloverdale to Petaluma, Bodega Bay to Sonoma Valley. More than 60,000 cats altered — each one found by a volunteer, treated at our clinic, and returned home. Every pin on this map represents real work by real people.",
    lat: 38.5,
    lng: -122.78,
    zoom: 10,
    pauseMs: 8000,
    stat: { value: "60,000+", label: "cats altered since 1990" },
  },
];
