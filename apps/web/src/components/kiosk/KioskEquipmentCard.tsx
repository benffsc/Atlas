"use client";

import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import {
  getCustodyStyle,
  getConditionStyle,
  getCategoryStyle,
} from "@/lib/equipment-styles";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  getLabel,
  EQUIPMENT_CUSTODY_STATUS_OPTIONS,
  EQUIPMENT_CONDITION_OPTIONS,
  EQUIPMENT_CHECKOUT_TYPE_OPTIONS,
  EQUIPMENT_EVENT_TYPE_OPTIONS,
} from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

interface KioskEquipmentCardProps {
  equipment: VEquipmentInventoryRow & { available_actions: string[] };
  onAction: (action: string) => void;
}

/**
 * Maps action names to Button variant + optional custom style overrides.
 * check_in and found use success-colored custom styles since Button
 * does not have a built-in "success" variant.
 */
function getActionButtonProps(action: string): {
  variant: "primary" | "secondary" | "ghost" | "danger" | "outline";
  style?: React.CSSProperties;
  icon?: string;
} {
  switch (action) {
    case "check_out":
      return { variant: "primary", icon: "log-out" };
    case "check_in":
      return {
        variant: "secondary",
        icon: "log-in",
        style: {
          background: "var(--success-bg)",
          color: "var(--success-text)",
          border: "1px solid var(--success-border)",
        },
      };
    case "transfer":
      return { variant: "secondary", icon: "arrow-right-left" };
    case "condition_change":
      return { variant: "outline", icon: "wrench" };
    case "reported_missing":
      return { variant: "danger", icon: "alert-triangle" };
    case "found":
      return {
        variant: "secondary",
        icon: "check-circle",
        style: {
          background: "var(--success-bg)",
          color: "var(--success-text)",
          border: "1px solid var(--success-border)",
        },
      };
    case "maintenance_start":
      return { variant: "secondary", icon: "tool" };
    case "maintenance_end":
      return { variant: "secondary", icon: "check" };
    case "retired":
      return { variant: "danger", icon: "archive" };
    case "note":
      return { variant: "ghost", icon: "message-square" };
    default:
      return { variant: "outline" };
  }
}

/**
 * Large kiosk-friendly equipment status card.
 * Shows equipment info, status badges, and available action buttons.
 */
export function KioskEquipmentCard({ equipment, onAction }: KioskEquipmentCardProps) {
  const isMobile = useIsMobile();
  const custodyStyle = getCustodyStyle(equipment.custody_status);
  const conditionStyle = getConditionStyle(equipment.condition_status);
  const isOut = equipment.custody_status === "checked_out" || equipment.custody_status === "in_field";

  // Format due date nicely
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const dueDate = equipment.current_due_date || equipment.inferred_due_date || equipment.expected_return_date;
  const isOverdue = dueDate && new Date(dueDate) < new Date();

  return (
    <div
      style={{
        background: "var(--card-bg, #fff)",
        border: "1px solid var(--card-border, #e5e7eb)",
        borderRadius: "16px",
        overflow: "hidden",
        boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.08))",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1.25rem 1.25rem 1rem",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "0.75rem",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <h2
                style={{
                  fontSize: "1.35rem",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                {equipment.display_name}
              </h2>
              {(() => {
                const catStyle = getCategoryStyle(equipment.type_category || "");
                const typeName = equipment.type_display_name || equipment.legacy_type;
                return (
                  <span style={{
                    fontSize: "0.7rem",
                    padding: "0.125rem 0.5rem",
                    borderRadius: "4px",
                    background: catStyle.bg,
                    color: catStyle.text,
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}>
                    {typeName}
                  </span>
                );
              })()}
            </div>
            <span
              style={{
                fontSize: "0.9rem",
                color: "var(--muted)",
                display: "block",
              }}
            >
              {[equipment.size, equipment.manufacturer, `#${equipment.barcode || "???"}`].filter(Boolean).join(" \u00B7 ")}
            </span>
          </div>

          {/* Custody status badge */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: "0.375rem 0.75rem",
              borderRadius: "20px",
              fontSize: "0.85rem",
              fontWeight: 600,
              background: custodyStyle.bg,
              color: custodyStyle.text,
              border: `1px solid ${custodyStyle.border}`,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, equipment.custody_status)}
          </span>
        </div>
      </div>

      {/* Photo (if available) */}
      {equipment.photo_url && (
        <div style={{
          padding: "0 1.25rem",
          borderBottom: "1px solid var(--card-border, #e5e7eb)",
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={equipment.photo_url}
            alt={equipment.display_name}
            style={{
              width: "100%",
              maxHeight: "180px",
              objectFit: "contain",
              borderRadius: "8px",
              marginBottom: "0.75rem",
              background: "var(--muted-bg, #f3f4f6)",
            }}
          />
        </div>
      )}

      {/* Info grid */}
      <div
        style={{
          padding: "1rem 1.25rem",
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: "0.75rem",
        }}
      >
        {/* Type */}
        <InfoCell
          label="Type"
          value={equipment.type_display_name || equipment.legacy_type}
        />

        {/* Condition */}
        <InfoCell label="Condition">
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.2rem 0.5rem",
              borderRadius: "6px",
              fontSize: "0.85rem",
              fontWeight: 500,
              background: conditionStyle.bg,
              color: conditionStyle.text,
              border: `1px solid ${conditionStyle.border}`,
            }}
          >
            {getLabel(EQUIPMENT_CONDITION_OPTIONS, equipment.condition_status)}
          </span>
        </InfoCell>

        {/* Custodian — only when checked out */}
        {isOut && (
          <InfoCell
            label="Custodian"
            value={
              equipment.custodian_name ||
              equipment.current_holder_name ||
              "Unknown"
            }
            icon="user"
          />
        )}

        {/* Due date — only when applicable */}
        {isOut && dueDate && (
          <InfoCell
            label="Due Date"
            value={formatDate(dueDate) || ""}
            icon={isOverdue ? "alert-circle" : "calendar"}
            valueColor={isOverdue ? "var(--danger-text)" : undefined}
          />
        )}

        {/* Days out — only when checked out */}
        {isOut && equipment.days_checked_out != null && (
          <InfoCell
            label="Days Out"
            value={`${equipment.days_checked_out}`}
            valueColor={
              equipment.days_checked_out > 14
                ? "var(--danger-text)"
                : equipment.days_checked_out > 7
                  ? "var(--warning-text)"
                  : undefined
            }
          />
        )}

        {/* Checkout type if known */}
        {isOut && equipment.checkout_type && (
          <InfoCell
            label="Checkout Type"
            value={getLabel(EQUIPMENT_CHECKOUT_TYPE_OPTIONS, equipment.checkout_type)}
          />
        )}
      </div>

      {/* Action buttons */}
      {equipment.available_actions.length > 0 && (
        <div
          style={{
            padding: "0 1.25rem 1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
              marginBottom: "0.25rem",
            }}
          >
            Actions
          </div>
          {equipment.available_actions.map((action) => {
            const props = getActionButtonProps(action);
            return (
              <Button
                key={action}
                variant={props.variant}
                size="lg"
                icon={props.icon}
                fullWidth
                onClick={() => onAction(action)}
                style={{
                  minHeight: "56px",
                  fontSize: "1rem",
                  borderRadius: "12px",
                  ...props.style,
                }}
              >
                {getLabel(EQUIPMENT_EVENT_TYPE_OPTIONS, action)}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal helper: single info cell
// ---------------------------------------------------------------------------

function InfoCell({
  label,
  value,
  icon,
  valueColor,
  children,
}: {
  label: string;
  value?: string;
  icon?: string;
  valueColor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--muted)",
          marginBottom: "0.2rem",
        }}
      >
        {label}
      </div>
      {children ? (
        children
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            fontSize: "0.95rem",
            fontWeight: 500,
            color: valueColor || "var(--text-primary)",
          }}
        >
          {icon && <Icon name={icon} size={16} color={valueColor || "var(--muted)"} />}
          {value}
        </div>
      )}
    </div>
  );
}
