"use client";

import { ReactNode } from "react";
import { BackButton } from "@/components/common";

interface EntityDetailHeaderProps {
  /** Entity UUID */
  entityId: string;
  /** Entity type for display (e.g., "cat", "place") */
  entityType: string;
  /** Primary display name */
  displayName: string;
  /** Optional subtitle below the name */
  subtitle?: ReactNode;
  /** Badge elements to show after name */
  badges?: ReactNode;
  /** Action buttons (edit, print, history, etc.) */
  actions?: ReactNode;
  /** Optional photo/media slot to the left of the name */
  photoSlot?: ReactNode;
  /** Back button destination */
  backHref?: string;
  /** Additional content below the header */
  children?: ReactNode;
}

/**
 * Generic entity detail page header.
 *
 * Provides a consistent layout for all entity detail pages:
 * - Back button
 * - Optional photo slot
 * - Entity name with badges
 * - Optional subtitle
 * - Action buttons
 * - Extensible via children
 *
 * For person-specific behavior (name editing, DNC warning, aliases),
 * use the PersonEntityHeader wrapper instead.
 */
export function EntityDetailHeader({
  entityId,
  entityType,
  displayName,
  subtitle,
  badges,
  actions,
  photoSlot,
  backHref = "/",
  children,
}: EntityDetailHeaderProps) {
  return (
    <div>
      <BackButton fallbackHref={backHref} />

      <div style={{ marginTop: "1rem" }}>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          {photoSlot && (
            <div style={{ flexShrink: 0 }}>{photoSlot}</div>
          )}

          <div style={{ flex: 1, minWidth: "200px" }}>
            {/* Name row with badges */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              flexWrap: "wrap",
              marginBottom: "0.5rem",
            }}>
              <h1 style={{ margin: 0, fontSize: "1.75rem" }}>{displayName}</h1>
              {badges}
              {actions && (
                <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
                  {actions}
                </div>
              )}
            </div>

            {/* Subtitle */}
            {subtitle && (
              <div style={{ marginBottom: "0.5rem" }}>{subtitle}</div>
            )}

            {/* ID */}
            <p className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>
              ID: {entityId}
            </p>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
