"use client";

import { useState } from "react";

// TNR-specific relationship types from MIG_2514
export const RELATIONSHIP_TYPES = {
  // Residence types
  resident: { label: "Resident", description: "Lives at this address", category: "residence" },
  property_owner: { label: "Property Owner", description: "Owns this property", category: "residence" },

  // Colony caretaker hierarchy (Alley Cat Allies taxonomy)
  colony_caretaker: { label: "Colony Caretaker", description: "Primary caretaker - manages feeding & TNR", category: "caretaker" },
  colony_supervisor: { label: "Colony Supervisor", description: "Oversees multiple caretakers", category: "caretaker" },
  feeder: { label: "Feeder", description: "Feeds cats but not full caretaker", category: "caretaker" },

  // Transport/logistics
  transporter: { label: "Transporter", description: "Transports cats to/from location", category: "logistics" },

  // Referral/contact
  referrer: { label: "Referrer", description: "Referred FFSC to this location", category: "contact" },
  neighbor: { label: "Neighbor", description: "Neighbor who reported cats", category: "contact" },

  // Work/volunteer
  works_at: { label: "Works At", description: "Works at this business", category: "work" },
  volunteers_at: { label: "Volunteers At", description: "Volunteers at this location", category: "work" },

  // Automated/unverified
  contact_address: { label: "Contact Address", description: "Unverified address from booking", category: "unverified" },
} as const;

export type RelationshipType = keyof typeof RELATIONSHIP_TYPES;

interface RoleSelectorProps {
  value: string;
  onChange: (value: RelationshipType) => void;
  disabled?: boolean;
  showDescription?: boolean;
  size?: "sm" | "md" | "lg";
}

const CATEGORY_ORDER = ["residence", "caretaker", "contact", "logistics", "work", "unverified"];
const CATEGORY_LABELS: Record<string, string> = {
  residence: "Residence",
  caretaker: "Colony Care",
  contact: "Contact",
  logistics: "Logistics",
  work: "Work/Volunteer",
  unverified: "Unverified",
};

export default function RoleSelector({
  value,
  onChange,
  disabled = false,
  showDescription = false,
  size = "md",
}: RoleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const currentType = RELATIONSHIP_TYPES[value as RelationshipType];
  const currentLabel = currentType?.label || value;

  const sizeStyles = {
    sm: { padding: "0.25rem 0.5rem", fontSize: "0.8rem" },
    md: { padding: "0.5rem 0.75rem", fontSize: "0.9rem" },
    lg: { padding: "0.75rem 1rem", fontSize: "1rem" },
  };

  // Group types by category
  const groupedTypes = CATEGORY_ORDER.map(category => ({
    category,
    label: CATEGORY_LABELS[category],
    types: Object.entries(RELATIONSHIP_TYPES)
      .filter(([, info]) => info.category === category)
      .map(([key, info]) => ({ key: key as RelationshipType, ...info })),
  })).filter(group => group.types.length > 0);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          ...sizeStyles[size],
          border: "1px solid var(--border)",
          borderRadius: "6px",
          background: disabled ? "var(--muted-bg)" : "var(--card-bg, #fff)",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          minWidth: "150px",
          justifyContent: "space-between",
        }}
      >
        <span>{currentLabel}</span>
        <span style={{ opacity: 0.5 }}>{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "4px",
            background: "var(--card-bg, #fff)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 100,
            maxHeight: "300px",
            overflow: "auto",
            minWidth: "220px",
          }}
        >
          {groupedTypes.map(group => (
            <div key={group.category}>
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  background: "var(--muted-bg, #f5f5f5)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {group.label}
              </div>
              {group.types.map(type => (
                <button
                  key={type.key}
                  type="button"
                  onClick={() => {
                    onChange(type.key);
                    setIsOpen(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    border: "none",
                    background: value === type.key ? "rgba(59, 130, 246, 0.1)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    display: "block",
                  }}
                >
                  <div style={{ fontWeight: value === type.key ? 600 : 400 }}>
                    {type.label}
                  </div>
                  {showDescription && (
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                      {type.description}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99,
          }}
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
