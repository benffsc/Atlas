/**
 * Fabricated demo pins for the screensaver tour.
 *
 * These are synthetic AtlasPin objects designed to make the hex detail
 * and compare panels look compelling on a TV demo. They do NOT represent
 * real data — they represent the KIND of data Beacon will surface at
 * scale. Used only during the screensaver tour.
 *
 * LABELED: This is demo/showcase data only.
 */

import type { AtlasPin } from "@/components/map/types";

function demoPin(overrides: Partial<AtlasPin> & { id: string; address: string; lat: number; lng: number }): AtlasPin {
  return {
    display_name: null,
    service_zone: "Santa Rosa",
    parent_place_id: null,
    place_kind: "residential",
    unit_identifier: null,
    cat_count: 0,
    people: [],
    person_count: 0,
    disease_risk: false,
    disease_risk_notes: null,
    disease_badges: [],
    disease_count: 0,
    watch_list: false,
    google_entry_count: 0,
    google_summaries: [],
    request_count: 0,
    active_request_count: 0,
    needs_trapper_count: 0,
    intake_count: 0,
    total_altered: 0,
    last_alteration_at: null,
    pin_style: "active",
    pin_tier: "active",
    ...overrides,
  };
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}

// ── Area A: Good FFR progress (west SR / Sebastopol) ──
// 71% alteration rate across 8 sites
export const DEMO_AREA_A: AtlasPin[] = [
  demoPin({
    id: "demo-a1", address: "3820 Selvage Road, Santa Rosa, CA 95401", lat: 38.462, lng: -122.814,
    cat_count: 42, total_altered: 32, last_alteration_at: monthsAgo(1),
    pin_style: "active", active_request_count: 1, needs_trapper_count: 1,
    people: [{ name: "Maria G.", roles: ["caretaker"], is_staff: false }],
    person_count: 1,
  }),
  demoPin({
    id: "demo-a2", address: "4901 Gravenstein Hwy N, Sebastopol, CA 95472", lat: 38.457, lng: -122.871,
    cat_count: 38, total_altered: 30, last_alteration_at: monthsAgo(2),
    pin_style: "active",
    people: [{ name: "Robert K.", roles: ["resident"], is_staff: false }],
    person_count: 1,
  }),
  demoPin({
    id: "demo-a3", address: "1406 Barlow Ln, Sebastopol, CA 95472", lat: 38.417, lng: -122.855,
    cat_count: 31, total_altered: 18, last_alteration_at: monthsAgo(4),
    pin_style: "active", active_request_count: 1,
    disease_risk: true, disease_count: 1,
    disease_badges: [{ disease_key: "fiv", short_code: "FIV", color: "#d97706", status: "confirmed", last_positive: monthsAgo(6), positive_cats: 2 }],
  }),
  demoPin({
    id: "demo-a4", address: "10500 Bodega Hwy, Sebastopol, CA 95472", lat: 38.392, lng: -122.882,
    cat_count: 55, total_altered: 42, last_alteration_at: monthsAgo(1),
    pin_style: "active",
    people: [{ name: "Linda T.", roles: ["colony_caretaker"], is_staff: false }],
    person_count: 1,
  }),
  demoPin({
    id: "demo-a5", address: "2776 Sullivan Road, Sebastopol, CA 95472", lat: 38.431, lng: -122.884,
    cat_count: 19, total_altered: 12, last_alteration_at: monthsAgo(8),
    pin_style: "active", watch_list: true,
  }),
  demoPin({
    id: "demo-a6", address: "5366 Highway 12, Santa Rosa, CA 95407", lat: 38.429, lng: -122.759,
    cat_count: 24, total_altered: 18, last_alteration_at: monthsAgo(3),
    pin_style: "active",
  }),
  demoPin({
    id: "demo-a7", address: "4045 Stony Point Rd, Santa Rosa, CA 95407", lat: 38.438, lng: -122.785,
    cat_count: 15, total_altered: 8, last_alteration_at: monthsAgo(14),
    pin_style: "active_requests", active_request_count: 1, needs_trapper_count: 1,
  }),
  demoPin({
    id: "demo-a8", address: "2100 Llano Rd, Santa Rosa, CA 95407", lat: 38.445, lng: -122.820,
    cat_count: 11, total_altered: 9, last_alteration_at: monthsAgo(5),
    pin_style: "active",
  }),
];

// ── Area B: Low FFR coverage, urgent (south SR) ──
// 16% alteration rate across 7 sites
export const DEMO_AREA_B: AtlasPin[] = [
  demoPin({
    id: "demo-b1", address: "2742 Morgan Creek St, Santa Rosa, CA 95407", lat: 38.409, lng: -122.730,
    cat_count: 34, total_altered: 8, last_alteration_at: monthsAgo(18),
    pin_style: "active_requests", active_request_count: 2, needs_trapper_count: 1,
    disease_risk: true, disease_count: 1,
    disease_badges: [{ disease_key: "felv", short_code: "FeLV", color: "#dc2626", status: "confirmed", last_positive: monthsAgo(3), positive_cats: 3 }],
    people: [{ name: "James R.", roles: ["resident"], is_staff: false }],
    person_count: 1,
  }),
  demoPin({
    id: "demo-b2", address: "3980 Stony Point Rd, Santa Rosa, CA 95407", lat: 38.381, lng: -122.741,
    cat_count: 28, total_altered: 5, last_alteration_at: monthsAgo(24),
    pin_style: "active_requests", active_request_count: 1,
    disease_risk: true, disease_count: 1,
    disease_badges: [{ disease_key: "fiv", short_code: "FIV", color: "#d97706", status: "confirmed", last_positive: monthsAgo(8), positive_cats: 1 }],
  }),
  demoPin({
    id: "demo-b3", address: "361 Taylor View Drive, Santa Rosa, CA 95404", lat: 38.415, lng: -122.706,
    cat_count: 22, total_altered: 4, last_alteration_at: monthsAgo(30),
    pin_style: "active", watch_list: true,
  }),
  demoPin({
    id: "demo-b4", address: "1405 Thunderbolt Way, Santa Rosa, CA 95407", lat: 38.415, lng: -122.748,
    cat_count: 19, total_altered: 3, last_alteration_at: monthsAgo(20),
    pin_style: "active_requests", active_request_count: 1, needs_trapper_count: 1,
  }),
  demoPin({
    id: "demo-b5", address: "181 Schlee Way, Santa Rosa, CA 95407", lat: 38.425, lng: -122.723,
    cat_count: 16, total_altered: 2, last_alteration_at: null,
    pin_style: "reference",
  }),
  demoPin({
    id: "demo-b6", address: "430 Ward Rd, Santa Rosa, CA 95407", lat: 38.389, lng: -122.707,
    cat_count: 14, total_altered: 0, last_alteration_at: null,
    pin_style: "reference", watch_list: true,
  }),
  demoPin({
    id: "demo-b7", address: "933 Grand Ave, Santa Rosa, CA 95404", lat: 38.430, lng: -122.709,
    cat_count: 12, total_altered: 1, last_alteration_at: monthsAgo(36),
    pin_style: "active",
  }),
];

// ── Single hex demo for HexDetailPanel ──
export const DEMO_HEX_DETAIL: AtlasPin[] = [
  demoPin({
    id: "demo-h1", address: "7810 Davis Ln, Penngrove, CA 94951", lat: 38.44, lng: -122.72,
    cat_count: 27, total_altered: 22, last_alteration_at: monthsAgo(2),
    pin_style: "active",
    disease_risk: true, disease_count: 1,
    disease_badges: [{ disease_key: "felv", short_code: "FeLV", color: "#dc2626", status: "confirmed", last_positive: monthsAgo(4), positive_cats: 1 }],
  }),
  demoPin({
    id: "demo-h2", address: "175 Scenic Avenue, Santa Rosa, CA 95407", lat: 38.44, lng: -122.72,
    cat_count: 33, total_altered: 25, last_alteration_at: monthsAgo(1),
    pin_style: "active", active_request_count: 1,
    people: [{ name: "Crystal M.", roles: ["trapper"], is_staff: true }],
    person_count: 1,
  }),
  demoPin({
    id: "demo-h3", address: "2922 Fulton Rd, Fulton, CA 95439", lat: 38.44, lng: -122.73,
    cat_count: 18, total_altered: 14, last_alteration_at: monthsAgo(3),
    pin_style: "active",
  }),
  demoPin({
    id: "demo-h4", address: "1012 Rubicon Way, Santa Rosa, CA 95401", lat: 38.44, lng: -122.71,
    cat_count: 22, total_altered: 15, last_alteration_at: monthsAgo(6),
    pin_style: "active", watch_list: true,
  }),
  demoPin({
    id: "demo-h5", address: "4488 Blank Rd, Sebastopol, CA 95472", lat: 38.44, lng: -122.72,
    cat_count: 15, total_altered: 10, last_alteration_at: monthsAgo(10),
    pin_style: "active_requests", active_request_count: 1,
  }),
];
