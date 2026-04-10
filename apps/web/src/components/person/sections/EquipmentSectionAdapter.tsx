"use client";

/**
 * Equipment Section Adapter — shows equipment currently held by a person.
 *
 * Used on person detail pages to answer "what does this person have
 * checked out right now?" at a glance. Queries /api/equipment with
 * custodian_person_id filter.
 *
 * FFS-1206 (Layer 1.5 of the Equipment Overhaul epic FFS-1201).
 */

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api-client";
import { Icon } from "@/components/ui/Icon";
import type { SectionProps } from "@/lib/person-roles/types";

interface EquipmentItem {
  equipment_id: string;
  barcode: string | null;
  display_name: string;
  type_display_name: string | null;
  custody_status: string;
  days_checked_out: number | null;
  current_due_date: string | null;
}

export function EquipmentSectionAdapter({ personId }: SectionProps) {
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!personId) return;
    let cancelled = false;
    fetchApi<{ equipment: EquipmentItem[] }>(
      `/api/equipment?custodian_person_id=${personId}&limit=20`,
    )
      .then((data) => {
        if (!cancelled) setItems(data.equipment || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  if (loading) {
    return (
      <div style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.85rem" }}>
        Loading equipment…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: "1.25rem",
          textAlign: "center",
          color: "var(--muted)",
          fontSize: "0.85rem",
        }}
      >
        No equipment currently checked out to this person.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {items.map((item) => {
        const isOverdue =
          item.current_due_date && new Date(item.current_due_date) < new Date();
        return (
          <a
            key={item.equipment_id}
            href={`/equipment/${item.equipment_id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.5rem 0.75rem",
              background: isOverdue
                ? "var(--danger-bg, #fef2f2)"
                : "var(--card-bg, #fff)",
              border: `1px solid ${isOverdue ? "var(--danger-border, #fca5a5)" : "var(--card-border, #e5e7eb)"}`,
              borderRadius: 8,
              fontSize: "0.85rem",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <Icon
              name="box"
              size={16}
              color={
                isOverdue
                  ? "var(--danger-text, #dc2626)"
                  : "var(--primary)"
              }
            />
            <code style={{ fontWeight: 600, minWidth: 40 }}>
              {item.barcode || "—"}
            </code>
            <span style={{ flex: 1, fontWeight: 500 }}>
              {item.display_name}
            </span>
            {item.type_display_name && (
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "var(--muted)",
                  flexShrink: 0,
                }}
              >
                {item.type_display_name}
              </span>
            )}
            {item.days_checked_out != null && (
              <span
                style={{
                  fontSize: "0.7rem",
                  color: isOverdue
                    ? "var(--danger-text, #dc2626)"
                    : "var(--muted)",
                  fontWeight: isOverdue ? 700 : 400,
                  flexShrink: 0,
                }}
              >
                {item.days_checked_out}d
                {isOverdue && " overdue"}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
