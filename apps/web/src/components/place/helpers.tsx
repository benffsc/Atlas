"use client";

import type { PlaceContext } from "@/lib/place-types";
import { formatPlaceKind } from "@/lib/display-labels";

export function PlaceKindBadge({ kind }: { kind: string | null | undefined }) {
  if (!kind || kind === "unknown") return null;

  const kindConfig: Record<string, { label: string; bg: string; color: string }> = {
    residential_house: { label: "House", bg: "#dcfce7", color: "#166534" },
    single_family: { label: "House", bg: "#dcfce7", color: "#166534" },
    apartment_unit: { label: "Unit", bg: "#dbeafe", color: "#1d4ed8" },
    apartment_building: { label: "Apts", bg: "#e0e7ff", color: "#4338ca" },
    mobile_home: { label: "Mobile", bg: "#ede9fe", color: "#7c3aed" },
    mobile_home_space: { label: "Mobile", bg: "#ede9fe", color: "#7c3aed" },
    business: { label: "Business", bg: "#fef3c7", color: "#b45309" },
    farm: { label: "Farm", bg: "#ecfccb", color: "#4d7c0f" },
    outdoor_site: { label: "Outdoor", bg: "#ccfbf1", color: "#0d9488" },
    clinic: { label: "Clinic", bg: "#fee2e2", color: "#dc2626" },
    shelter: { label: "Shelter", bg: "#f3e8ff", color: "#9333ea" },
    neighborhood: { label: "Area", bg: "#f3f4f6", color: "#6b7280" },
  };

  const config = kindConfig[kind] || { label: formatPlaceKind(kind), bg: "#f3f4f6", color: "#6b7280" };

  return (
    <span className="badge" style={{ background: config.bg, color: config.color, fontSize: "0.75rem" }}>
      {config.label}
    </span>
  );
}

export function ContextBadge({ context }: { context: PlaceContext }) {
  const contextTypeColors: Record<string, { bg: string; color: string }> = {
    colony_site: { bg: "#dc3545", color: "#fff" },
    foster_home: { bg: "#198754", color: "#fff" },
    adopter_residence: { bg: "#0d6efd", color: "#fff" },
    volunteer_location: { bg: "#6610f2", color: "#fff" },
    trapper_base: { bg: "#fd7e14", color: "#000" },
    trap_pickup: { bg: "#ffc107", color: "#000" },
    clinic: { bg: "#20c997", color: "#000" },
    shelter: { bg: "#6f42c1", color: "#fff" },
    partner_org: { bg: "#0dcaf0", color: "#000" },
    feeding_station: { bg: "#adb5bd", color: "#000" },
  };

  const colors = contextTypeColors[context.context_type] || { bg: "#6c757d", color: "#fff" };

  return (
    <span
      className="badge"
      style={{ fontSize: "0.7rem", background: colors.bg, color: colors.color }}
      title={`${context.context_label}${context.is_verified ? " (Verified)" : ""} - ${Math.round(context.confidence * 100)}% confidence`}
    >
      {context.context_label}
      {context.is_verified && " \u2713"}
    </span>
  );
}

export const PLACE_KINDS = [
  { value: "unknown", label: "Unknown" },
  { value: "residential_house", label: "Residential House" },
  { value: "apartment_unit", label: "Apartment Unit" },
  { value: "apartment_building", label: "Apartment Building" },
  { value: "business", label: "Business" },
  { value: "clinic", label: "Clinic" },
  { value: "neighborhood", label: "Neighborhood" },
  { value: "outdoor_site", label: "Outdoor Site" },
  { value: "mobile_home_space", label: "Mobile Home Space" },
];
