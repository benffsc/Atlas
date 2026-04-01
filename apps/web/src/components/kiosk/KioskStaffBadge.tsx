"use client";

import { useState } from "react";
import { useKioskStaff } from "./KioskStaffContext";
import { KioskStaffPicker } from "./KioskStaffPicker";

/**
 * Floating badge showing the active staff member — tap to switch.
 * Fixed bottom-right, above the tab bar.
 */
export function KioskStaffBadge() {
  const { activeStaff, setActiveStaff, clearStaff } = useKioskStaff();
  const [showPicker, setShowPicker] = useState(false);

  if (showPicker) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 96,
          background: "var(--background, #f9fafb)",
        }}
      >
        <KioskStaffPicker
          previousStaff={activeStaff}
          onSelect={(staff) => {
            setActiveStaff(staff);
            setShowPicker(false);
          }}
          onSkip={() => {
            clearStaff();
            setShowPicker(false);
          }}
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowPicker(true)}
      style={{
        position: "fixed",
        bottom: "calc(76px + env(safe-area-inset-bottom, 0px))",
        right: "12px",
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        padding: activeStaff ? "0.375rem 0.75rem 0.375rem 0.375rem" : "0.375rem 0.75rem",
        background: activeStaff ? "var(--card-bg, #fff)" : "var(--muted-bg, #f3f4f6)",
        border: activeStaff
          ? "1.5px solid var(--primary)"
          : "1px solid var(--card-border, #e5e7eb)",
        borderRadius: "999px",
        cursor: "pointer",
        fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.08))",
        WebkitTapHighlightColor: "transparent",
        transition: "transform 100ms ease",
      }}
    >
      {activeStaff ? (
        <>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "var(--primary)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.7rem",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {activeStaff.initials}
          </span>
          <span
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {activeStaff.display_name.split(" ")[0]}
          </span>
        </>
      ) : (
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 500,
            color: "var(--muted)",
          }}
        >
          No staff
        </span>
      )}
    </button>
  );
}
