/**
 * Map Export Utilities
 *
 * Exports visible map pins to CSV or GeoJSON format.
 * Uses the existing csv-export.ts for CSV generation.
 */

import { generateCsv, downloadCsv } from "./csv-export";
import type { AtlasPin } from "@/components/map/types";

/** Columns exported in CSV format */
const CSV_HEADERS = [
  "Address",
  "Display Name",
  "Latitude",
  "Longitude",
  "Service Zone",
  "Place Kind",
  "Cat Count",
  "Total Altered",
  "Disease Risk",
  "Disease Badges",
  "Watch List",
  "Active Requests",
  "Needs Trapper",
  "Person Count",
  "Pin Style",
  "Last Alteration",
];

function formatDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function pinToCsvRow(pin: AtlasPin): (string | number | boolean | null)[] {
  const activeBadges = (pin.disease_badges || [])
    .filter((b) => b.status !== "historical")
    .map((b) => b.short_code)
    .join("; ");

  return [
    pin.address,
    pin.display_name,
    pin.lat,
    pin.lng,
    pin.service_zone,
    pin.place_kind,
    pin.cat_count,
    pin.total_altered,
    pin.disease_risk,
    activeBadges || null,
    pin.watch_list,
    pin.active_request_count,
    pin.needs_trapper_count,
    pin.person_count,
    pin.pin_style,
    pin.last_alteration_at,
  ];
}

function pinToGeoJsonFeature(pin: AtlasPin): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [pin.lng, pin.lat],
    },
    properties: {
      id: pin.id,
      address: pin.address,
      display_name: pin.display_name,
      service_zone: pin.service_zone,
      place_kind: pin.place_kind,
      cat_count: pin.cat_count,
      total_altered: pin.total_altered,
      disease_risk: pin.disease_risk,
      disease_badges: (pin.disease_badges || [])
        .filter((b) => b.status !== "historical")
        .map((b) => b.short_code),
      watch_list: pin.watch_list,
      active_request_count: pin.active_request_count,
      needs_trapper_count: pin.needs_trapper_count,
      person_count: pin.person_count,
      pin_style: pin.pin_style,
      last_alteration_at: pin.last_alteration_at,
    },
  };
}

export function exportPinsToCsv(pins: AtlasPin[], filterName?: string): void {
  const rows = pins.map(pinToCsvRow);
  const content = generateCsv(CSV_HEADERS, rows);
  const suffix = filterName ? `_${filterName.replace(/\s+/g, "_").toLowerCase()}` : "";
  downloadCsv(content, `atlas_map_export${suffix}_${formatDate()}.csv`);
}

export function exportPinsToGeoJson(pins: AtlasPin[], filterName?: string): void {
  const collection: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: pins.map(pinToGeoJsonFeature),
  };
  const content = JSON.stringify(collection, null, 2);
  const blob = new Blob([content], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const suffix = filterName ? `_${filterName.replace(/\s+/g, "_").toLowerCase()}` : "";
  link.href = url;
  link.download = `atlas_map_export${suffix}_${formatDate()}.geojson`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
