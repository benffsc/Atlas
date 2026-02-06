"use client";

import React from "react";
import { formatDateLocal } from "@/lib/formatters";

export interface CatDisease {
  disease_key: string;
  short_code: string;
  color: string;
  test_date?: string | null;
}

export interface CatCardData {
  cat_id: string | null;
  cat_name?: string | null;
  display_name?: string | null;
  cat_sex?: string | null;
  sex?: string | null;
  cat_color?: string | null;
  color?: string | null;
  primary_color?: string | null;
  photo_url: string | null;
  microchip: string | null;
  needs_microchip: boolean;
  is_spay?: boolean;
  is_neuter?: boolean;
  altered_status?: string | null;
  is_deceased?: boolean;
  deceased_date?: string | null;
  death_cause?: string | null;
  felv_status?: string | null;
  fiv_status?: string | null;
  positive_diseases?: CatDisease[];
  clinic_day_number?: number | null;
  clinichq_animal_id?: string | null;
  place_address?: string | null;
  owner_name?: string | null;
  trapper_name?: string | null;
  last_seen?: string | null;
}

interface CatCardProps {
  cat: CatCardData;
  onClick?: () => void;
  compact?: boolean;
  showAddress?: boolean;
  showOwner?: boolean;
}

// Color gradient helper for placeholder photos
const getColorGradient = (color: string | null | undefined): string => {
  if (!color) return "#9ca3af 0%, #d1d5db 100%";
  const c = color.toLowerCase();
  if (c.includes("black")) return "#1f2937 0%, #374151 100%";
  if (c.includes("orange") || c.includes("ginger")) return "#f59e0b 0%, #d97706 100%";
  if (c.includes("gray") || c.includes("grey")) return "#6b7280 0%, #9ca3af 100%";
  if (c.includes("white")) return "#e5e7eb 0%, #f9fafb 100%";
  if (c.includes("calico") || c.includes("tortie")) return "#92400e 0%, #f59e0b 50%, #374151 100%";
  if (c.includes("tabby")) return "#78716c 0%, #a8a29e 100%";
  if (c.includes("cream") || c.includes("buff")) return "#fde68a 0%, #fef3c7 100%";
  if (c.includes("brown")) return "#78350f 0%, #92400e 100%";
  if (c.includes("blue")) return "#64748b 0%, #94a3b8 100%";
  return "#9ca3af 0%, #d1d5db 100%";
};

export function CatCard({ cat, onClick, compact = false, showAddress = true, showOwner = false }: CatCardProps) {
  const isUnchipped = cat.cat_id && !cat.microchip && cat.needs_microchip;
  const isUnlinked = !cat.cat_id;

  // Normalize field names (API responses may vary)
  const name = cat.cat_name || cat.display_name;
  const sex = cat.cat_sex || cat.sex;
  const color = cat.cat_color || cat.color || cat.primary_color;
  const isSpay = cat.is_spay || cat.altered_status === "spayed";
  const isNeuter = cat.is_neuter || cat.altered_status === "neutered";

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (cat.cat_id) {
      // Use same tab navigation so browser back button works
      window.location.href = `/cats/${cat.cat_id}`;
    }
  };

  return (
    <div
      onClick={handleClick}
      style={{
        position: "relative",
        padding: compact ? "8px" : "12px",
        background: isUnchipped
          ? "linear-gradient(135deg, var(--warning-bg) 0%, var(--card-bg) 100%)"
          : cat.is_deceased
          ? "linear-gradient(135deg, rgba(55, 65, 81, 0.1) 0%, var(--card-bg) 100%)"
          : isUnlinked
          ? "var(--section-bg)"
          : "var(--card-bg)",
        border: isUnchipped
          ? "2px solid var(--warning-text)"
          : cat.is_deceased
          ? "2px solid #6b7280"
          : isUnlinked
          ? "2px dashed var(--card-border)"
          : "1px solid var(--card-border)",
        borderRadius: compact ? "8px" : "12px",
        cursor: cat.cat_id ? "pointer" : "default",
        transition: "all 0.15s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        opacity: cat.is_deceased ? 0.85 : 1,
      }}
      onMouseEnter={(e) => {
        if (cat.cat_id) {
          e.currentTarget.style.transform = "translateY(-4px)";
          e.currentTarget.style.boxShadow = "0 8px 25px rgba(0,0,0,0.15)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
      }}
    >
      {/* Clinic Day Number Badge */}
      {cat.clinic_day_number && (
        <div
          style={{
            position: "absolute",
            top: compact ? "4px" : "8px",
            left: compact ? "4px" : "8px",
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            padding: compact ? "2px 6px" : "4px 10px",
            borderRadius: "6px",
            fontSize: compact ? "0.7rem" : "0.8rem",
            fontWeight: 700,
            zIndex: 1,
            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          }}
        >
          #{cat.clinic_day_number}
        </div>
      )}

      {/* Photo or Placeholder */}
      <div
        style={{
          width: "100%",
          aspectRatio: compact ? "1/1" : "4/3",
          background: cat.photo_url
            ? `url(${cat.photo_url}) center/cover`
            : `linear-gradient(145deg, ${getColorGradient(color)})`,
          borderRadius: compact ? "6px" : "8px",
          marginBottom: compact ? "8px" : "12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {!cat.photo_url && (
          <span style={{ fontSize: compact ? "2rem" : "3rem", opacity: 0.4 }}>
            {isUnlinked ? "?" : cat.is_deceased ? "🪦" : "🐱"}
          </span>
        )}

        {/* Badges Container - Bottom Right, Stacked */}
        <div
          style={{
            position: "absolute",
            bottom: compact ? "4px" : "8px",
            right: compact ? "4px" : "8px",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "4px",
          }}
        >
          {/* Deceased/Euthanized Badge */}
          {cat.is_deceased && (
            <span
              style={{
                padding: compact ? "2px 6px" : "4px 10px",
                background: cat.death_cause === "euthanasia" ? "#1f2937" : "#374151",
                color: "#fff",
                borderRadius: "4px",
                fontSize: compact ? "0.6rem" : "0.7rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {cat.death_cause === "euthanasia" ? "Euthanized" : "Deceased"}
            </span>
          )}

          {/* Disease Badges (FeLV, FIV, Ringworm, etc.) */}
          {(() => {
            // Build list of diseases to show
            const diseases: { code: string; color: string }[] = [];

            // Use positive_diseases array if available (preferred)
            if (cat.positive_diseases && cat.positive_diseases.length > 0) {
              cat.positive_diseases.forEach(d => {
                diseases.push({ code: d.short_code + "+", color: d.color });
              });
            } else {
              // Fallback to legacy felv_status/fiv_status fields
              if (cat.felv_status === "positive") {
                diseases.push({ code: "FeLV+", color: "#dc2626" });
              }
              if (cat.fiv_status === "positive") {
                diseases.push({ code: "FIV+", color: "#ea580c" });
              }
            }

            if (diseases.length === 0) return null;

            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", maxWidth: compact ? "80px" : "120px" }}>
                {diseases.map((d, i) => (
                  <span
                    key={i}
                    style={{
                      padding: compact ? "2px 6px" : "4px 8px",
                      background: d.color,
                      color: "#fff",
                      borderRadius: "4px",
                      fontSize: compact ? "0.55rem" : "0.65rem",
                      fontWeight: 700,
                    }}
                  >
                    {d.code}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* Service Type Badge (Spay/Neuter) */}
          {(isSpay || isNeuter) && !cat.is_deceased && (
            <span
              style={{
                padding: compact ? "2px 6px" : "4px 10px",
                background: isSpay ? "#be185d" : "#2563eb",
                color: "#fff",
                borderRadius: "4px",
                fontSize: compact ? "0.6rem" : "0.7rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {isSpay ? "Spay" : "Neuter"}
            </span>
          )}
        </div>
      </div>

      {/* Cat Name */}
      <div style={{
        fontSize: compact ? "0.85rem" : "1rem",
        fontWeight: 700,
        marginBottom: compact ? "4px" : "6px",
        color: cat.is_deceased ? "var(--muted)" : "var(--foreground)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textDecoration: cat.is_deceased ? "line-through" : "none",
      }}>
        {name || (isUnlinked ? "Unlinked Appointment" : "Unknown")}
      </div>

      {/* Sex and Color */}
      <div style={{
        fontSize: compact ? "0.75rem" : "0.85rem",
        color: "var(--muted)",
        marginBottom: compact ? "4px" : "8px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}>
        {sex && (
          <span style={{
            color: sex.toLowerCase() === "female" ? "var(--danger-text)" : "var(--info-text)",
            fontWeight: 500,
          }}>
            {sex}
          </span>
        )}
        {sex && color && <span style={{ color: "var(--card-border)" }}>•</span>}
        {color && <span>{color}</span>}
      </div>

      {/* Status Badges (Chipped/No Chip/Unlinked) */}
      {!compact && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
          {cat.microchip && (
            <span
              style={{
                padding: "3px 8px",
                fontSize: "0.7rem",
                fontWeight: 600,
                background: "var(--success-bg)",
                color: "var(--success-text)",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "0.65rem" }}>✓</span> Chipped
            </span>
          )}
          {isUnchipped && (
            <span
              style={{
                padding: "3px 8px",
                fontSize: "0.7rem",
                fontWeight: 600,
                background: "var(--warning-bg)",
                color: "var(--warning-text)",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "0.8rem" }}>!</span> No Chip
            </span>
          )}
          {isUnlinked && (
            <span
              style={{
                padding: "3px 8px",
                fontSize: "0.7rem",
                fontWeight: 600,
                background: "var(--section-bg)",
                color: "var(--muted)",
                borderRadius: "4px",
              }}
            >
              Unlinked
            </span>
          )}
        </div>
      )}

      {/* Owner Name */}
      {showOwner && cat.owner_name && (
        <div style={{
          fontSize: compact ? "0.7rem" : "0.75rem",
          color: "var(--muted)",
          marginTop: "4px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          👤 {cat.owner_name}
        </div>
      )}

      {/* Address (truncated) */}
      {showAddress && cat.place_address && (
        <div style={{
          fontSize: compact ? "0.65rem" : "0.75rem",
          color: "var(--muted)",
          marginTop: "4px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          📍 {cat.place_address}
        </div>
      )}

      {/* Last Seen */}
      {cat.last_seen && (
        <div style={{
          fontSize: compact ? "0.65rem" : "0.7rem",
          color: "var(--muted)",
          marginTop: "4px",
        }}>
          Last seen: {formatDateLocal(cat.last_seen)}
        </div>
      )}

      {/* Deceased Date */}
      {cat.is_deceased && cat.deceased_date && (
        <div style={{
          fontSize: compact ? "0.65rem" : "0.7rem",
          color: "#6b7280",
          marginTop: "4px",
        }}>
          {cat.death_cause === "euthanasia" ? "Euthanized" : "Deceased"}: {formatDateLocal(cat.deceased_date)}
        </div>
      )}

      {/* ClinicHQ ID for unchipped */}
      {isUnchipped && cat.clinichq_animal_id && !compact && (
        <div style={{
          fontSize: "0.7rem",
          color: "var(--warning-text)",
          marginTop: "6px",
          fontFamily: "monospace",
        }}>
          CHQ: {cat.clinichq_animal_id}
        </div>
      )}
    </div>
  );
}

export default CatCard;
