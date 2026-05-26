/**
 * Screensaver Tour Configuration
 *
 * Mixed step types: map fly-throughs interleaved with full-screen info slides.
 * All content is TV-optimized (large text, high contrast).
 *
 * Map stops include vague, anonymized colony stories drawn from real
 * patterns in the data — no PII, no addresses, no names.
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
      "Every pin is a location we monitor. Behind each one is a colony with its own story — a caretaker who feeds them, a neighbor who called for help, a trapper who spent weeks earning their trust.",
    lat: 38.45,
    lng: -122.72,
    zoom: 10,
    pauseMs: 8000,
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
  // 4. Santa Rosa — neighborhood corridor story
  {
    type: "map",
    label: "A Neighborhood Working Together",
    description:
      "Five neighboring properties in central Santa Rosa where cats roam freely between yards. Beacon detected the connection automatically. Instead of five separate calls, our team coordinated one sweep — 23 cats altered across the corridor in a single month.",
    lat: 38.4485,
    lng: -122.6945,
    zoom: 17,
    pauseMs: 9000,
    stat: { value: "23", label: "cats in one corridor" },
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
  // 6. South Santa Rosa — commercial colony story
  {
    type: "map",
    label: "The Gas Station Colony",
    description:
      "A colony living behind a commercial lot on the south side. A litter of kittens was found in the engine bay of a delivery truck. Our team trapped the mother and four kittens — mom was returned after surgery, the kittens went into foster care and were all adopted within weeks.",
    lat: 38.408,
    lng: -122.735,
    zoom: 16,
    pauseMs: 9000,
    stat: { value: "4", label: "kittens adopted" },
  },
  // 7. Santa Rosa density — hexbin view
  {
    type: "map",
    label: "Where the Need Is Greatest",
    description:
      "Each hexagon shows the concentration of colony activity. The darkest cells often represent neighborhoods where one dedicated caretaker feeds dozens of cats. Beacon helps us find them before kitten season starts.",
    lat: 38.44,
    lng: -122.714,
    zoom: 12,
    pauseMs: 8000,
    stat: { value: "~22", label: "cats per clinic day" },
    layers: ["cat-density-heatmap"],
  },
  // 8. The long-term colony story
  {
    type: "slide",
    variant: "explainer",
    heading: "It Takes Years, Not Days",
    body: "One rural property had over 40 unaltered cats when we first arrived. Three years of patient work — trapping a few at a time, returning them, building trust with the caretaker — brought the colony to zero new kittens. The cats are still there. They're just not reproducing.",
    pauseMs: 9000,
  },
  // 9. Disease monitoring map
  {
    type: "map",
    label: "Disease Surveillance",
    description:
      "When a cat tests positive for FIV or FeLV, Beacon maps every colony within walking distance. Nearby caretakers are notified so they can watch for symptoms. Early detection protects entire neighborhoods.",
    lat: 38.44,
    lng: -122.72,
    zoom: 11,
    pauseMs: 8000,
    stat: { value: "Active", label: "disease monitoring" },
    layers: ["disease-heatmap"],
  },
  // 10. The relocation story
  {
    type: "map",
    label: "When Colonies Need to Move",
    description:
      "Sometimes a property changes hands and the new owner doesn't want the cats. We don't just remove them — we find barn placements in rural Sonoma County where they can live safely as working mousers. Every relocated cat is tracked in the system.",
    lat: 38.52,
    lng: -122.82,
    zoom: 13,
    pauseMs: 9000,
    stat: { value: "Barn Cat", label: "program" },
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
      "From Cloverdale to Petaluma, Bodega Bay to Sonoma Valley. 37,000 cats altered — each one trapped by a volunteer, treated at our clinic, and returned home. Every pin on this map represents real work by real people.",
    lat: 38.5,
    lng: -122.78,
    zoom: 10,
    pauseMs: 8000,
    stat: { value: "37,000+", label: "cats altered" },
  },
];
