/**
 * Screensaver Tour Configuration
 *
 * Mixed step types: map fly-throughs interleaved with full-screen info slides.
 * All content is TV-optimized (large text, high contrast).
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
    body: "Real-time intelligence for community cat management",
    pauseMs: 6000,
    showLogo: true,
  },
  // 2. County overview map
  {
    type: "map",
    label: "Sonoma County Overview",
    description:
      "Every pin is a colony site we monitor — over 2,800 active locations across the county.",
    lat: 38.45,
    lng: -122.72,
    zoom: 10,
    pauseMs: 7000,
    stat: { value: "2,800+", label: "colony sites" },
  },
  // 3. "What is TNR?" explainer
  {
    type: "slide",
    variant: "explainer",
    heading: "What is TNR?",
    body: "Trap-Neuter-Return is the humane, evidence-based method for managing community cat populations. Cats are humanely trapped, spayed or neutered at our clinic, then returned to their outdoor home. Over time, the colony stabilizes and naturally decreases.",
    pauseMs: 8000,
  },
  // 4. Santa Rosa density map
  {
    type: "map",
    label: "Santa Rosa — Highest Density",
    description:
      "Santa Rosa has the most colony activity. Our clinic processes ~22 cats per day from sites across the city.",
    lat: 38.44,
    lng: -122.714,
    zoom: 13,
    pauseMs: 7000,
    stat: { value: "~22", label: "cats per clinic day" },
  },
  // 5. Impact stat grid slide
  {
    type: "slide",
    variant: "stat-grid",
    heading: "Impact at Scale",
    stats: [
      { value: "37,000+", label: "cats altered" },
      { value: "2,800+", label: "colony sites monitored" },
      { value: "110,000+", label: "kittens prevented" },
      { value: "13", label: "years of operations" },
    ],
    pauseMs: 8000,
  },
  // 6. Montecito corridor map
  {
    type: "map",
    label: "Montecito Ave Corridor",
    description:
      "5 adjacent properties where cats move freely between yards. Beacon automatically detects these corridors.",
    lat: 38.4485,
    lng: -122.6945,
    zoom: 17,
    pauseMs: 7000,
    stat: { value: "5", label: "linked addresses" },
  },
  // 7. Cat density hexbin map
  {
    type: "map",
    label: "Cat Density Analysis",
    description:
      "Hexbin view shows concentration of colony activity. Darker cells = more cats. This helps prioritize trapping resources.",
    lat: 38.44,
    lng: -122.714,
    zoom: 12,
    pauseMs: 7000,
    stat: { value: "Hexbin", label: "density view" },
    layers: ["cat-density-heatmap"],
  },
  // 8. Disease monitoring map
  {
    type: "map",
    label: "Disease Monitoring",
    description:
      "Real-time disease tracking across all colonies. FIV, FeLV, and other conditions are mapped to identify risk corridors.",
    lat: 38.44,
    lng: -122.72,
    zoom: 11,
    pauseMs: 7000,
    stat: { value: "Active", label: "disease surveillance" },
    layers: ["disease-heatmap"],
  },
  // 9. "How You Can Help" CTA slide
  {
    type: "slide",
    variant: "cta",
    heading: "How You Can Help",
    body: "Your support funds spay/neuter surgeries, trapping equipment, and the technology that makes this work possible. Every dollar helps reduce outdoor cat suffering in Sonoma County.",
    pauseMs: 8000,
    showLogo: true,
  },
  // 10. County-wide sweep map
  {
    type: "map",
    label: "County-Wide Coverage",
    description:
      "From Cloverdale to Petaluma, Bodega Bay to Sonoma Valley. Every cat altered is verified at our clinic — real data, real impact.",
    lat: 38.5,
    lng: -122.78,
    zoom: 10,
    pauseMs: 7000,
    stat: { value: "37,000+", label: "cats altered" },
  },
];
