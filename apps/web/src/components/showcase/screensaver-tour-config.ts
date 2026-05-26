/**
 * Screensaver Tour Configuration
 *
 * The tour sells BEACON as a product. Map stops demonstrate Beacon
 * capabilities. Colony stories are evidence for why Beacon matters,
 * not the main attraction.
 *
 * Structure: Beacon intro → problem → capability demos → impact → CTA
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
  // 1. Hero — Beacon product intro
  {
    type: "slide",
    variant: "hero",
    heading: "Beacon",
    body: "A smarter way to reduce unowned cat populations",
    pauseMs: 6000,
    showLogo: true,
  },
  // 2. The problem Beacon solves
  {
    type: "slide",
    variant: "explainer",
    heading: "The Problem",
    body: "Spay/neuter works, but population reduction depends on timing, location, and strategy. Altering 50 cats is always good. But altering the right 50 cats, in the right area, at the right time, can change the future of an entire colony. Without better data, organizations respond to the loudest need — not the greatest impact.",
    pauseMs: 9000,
  },
  // 3. Map — Beacon sees the full picture (county overview)
  {
    type: "map",
    label: "Beacon Sees the Full Picture",
    description:
      "Beacon combines clinic records, colony locations, trapper observations, and community reports into a single map. Every pin represents a location where we have real data — not guesswork.",
    lat: 38.45,
    lng: -122.72,
    zoom: 10,
    pauseMs: 8000,
    stat: { value: "2,800+", label: "sites tracked" },
  },
  // 4. What Beacon does — diagram-inspired capabilities
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
  // 5. Map — Geographic Intelligence (density hexbin)
  {
    type: "map",
    label: "Geographic Intelligence",
    description:
      "Beacon identifies where unowned cats are concentrated and where unaltered cats remain. This view highlights the areas where focused intervention can prevent the most future litters.",
    lat: 38.44,
    lng: -122.714,
    zoom: 12,
    pauseMs: 8000,
    stat: { value: "Density", label: "analysis" },
    layers: ["cat-density-heatmap"],
  },
  // 6. Map — Corridor Detection (Montecito)
  {
    type: "map",
    label: "Corridor Detection",
    description:
      "Beacon automatically detects when neighboring properties share a connected cat population. Instead of five separate service calls, our team coordinates a single sweep — more efficient, greater impact.",
    lat: 38.4485,
    lng: -122.6945,
    zoom: 17,
    pauseMs: 9000,
    stat: { value: "5", label: "linked properties" },
  },
  // 7. Map — Disease Surveillance
  {
    type: "map",
    label: "Disease Surveillance",
    description:
      "When a cat tests positive for FIV or FeLV, Beacon maps the result against every colony in the area. Our team can identify risk corridors and prioritize where to focus next.",
    lat: 38.44,
    lng: -122.72,
    zoom: 11,
    pauseMs: 8000,
    stat: { value: "Active", label: "disease monitoring" },
    layers: ["disease-heatmap"],
  },
  // 8. Two levers — from diagram
  {
    type: "slide",
    variant: "explainer",
    heading: "Two Levers for Faster Impact",
    body: "Increase clinic capacity, so more cats can be altered each year. And use Beacon to target cats more strategically, so every surgery has the greatest possible impact. Together, these create faster, more humane reduction in unowned cat populations.",
    pauseMs: 9000,
  },
  // 9. Map — Strategic Prioritization (south SR)
  {
    type: "map",
    label: "Strategic Prioritization",
    description:
      "Beacon helps us ask the important question: where can the next surgery make the biggest difference? Instead of responding to the most visible colony, we can focus resources where they prevent the most future births.",
    lat: 38.408,
    lng: -122.735,
    zoom: 14,
    pauseMs: 8000,
    stat: { value: "~20", label: "cats per clinic day" },
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
    pauseMs: 8000,
  },
  // 11. CTA
  {
    type: "slide",
    variant: "cta",
    heading: "Be Part of What Comes Next",
    body: "Beacon is still growing, and so is its potential. With your support, we can continue expanding clinic capacity, improving our data, and using Beacon to guide smarter, faster, more humane population reduction across Sonoma County.",
    pauseMs: 8000,
    showLogo: true,
  },
  // 12. County-wide closing
  {
    type: "map",
    label: "Better Data, Better Outcomes",
    description:
      "From Cloverdale to Petaluma, Bodega Bay to Sonoma Valley. Beacon turns 35 years of compassion into a planning tool — so every dollar, every volunteer hour, and every surgery makes the greatest possible difference.",
    lat: 38.5,
    lng: -122.78,
    zoom: 10,
    pauseMs: 8000,
    stat: { value: "Beacon", label: "by Forgotten Felines" },
  },
];
