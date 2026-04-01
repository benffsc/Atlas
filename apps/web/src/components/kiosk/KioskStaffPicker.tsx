"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";
import { useAppConfig } from "@/hooks/useAppConfig";
import { Icon } from "@/components/ui/Icon";
import type { StaffSelection } from "./KioskStaffContext";
import type { KioskStaffRow } from "@/app/api/kiosk/staff/route";

interface KioskStaffPickerProps {
  /** Previously selected staff from localStorage — enables "Continue as" shortcut */
  previousStaff: StaffSelection | null;
  onSelect: (staff: StaffSelection) => void;
  onSkip: () => void;
}

/**
 * Full-screen staff picker grid — "Who's at the desk?"
 * Shows after PIN unlock when no staff is selected.
 * Touch-optimized: large tiles, 3-column grid, tap to select.
 */
export function KioskStaffPicker({ previousStaff, onSelect, onSkip }: KioskStaffPickerProps) {
  const [staff, setStaff] = useState<KioskStaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { value: required } = useAppConfig<boolean>("kiosk.staff_selection_required");

  useEffect(() => {
    fetchApi<{ staff: KioskStaffRow[] }>("/api/kiosk/staff")
      .then((data) => setStaff(data.staff))
      .catch(() => setStaff([]))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (s: KioskStaffRow) => {
    onSelect({
      staff_id: s.staff_id,
      person_id: s.person_id,
      display_name: s.display_name,
      initials: s.initials,
    });
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "var(--background, #f9fafb)",
        fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 480, textAlign: "center" }}>
        {/* Header */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "var(--primary-bg, rgba(59,130,246,0.08))",
            border: "2px solid var(--primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 0.75rem",
          }}
        >
          <Icon name="user" size={28} color="var(--primary)" />
        </div>
        <h2
          style={{
            fontSize: "1.35rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 0.25rem",
          }}
        >
          Who&apos;s at the desk?
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
          Tap your name to get started
        </p>

        {/* "Continue as" shortcut */}
        {previousStaff && (
          <button
            onClick={() => onSelect(previousStaff)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.625rem",
              padding: "0.875rem 1rem",
              marginBottom: "1rem",
              background: "var(--primary-bg, rgba(59,130,246,0.08))",
              border: "2px solid var(--primary)",
              borderRadius: "14px",
              cursor: "pointer",
              fontSize: "1rem",
              fontWeight: 600,
              color: "var(--primary)",
              fontFamily: "inherit",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "var(--primary)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.8rem",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {previousStaff.initials}
            </span>
            Continue as {previousStaff.display_name.split(" ")[0]}
          </button>
        )}

        {/* Staff grid */}
        {loading ? (
          <div style={{ padding: "2rem 0" }}>
            <div
              style={{
                width: 32,
                height: 32,
                border: "3px solid var(--border, #e5e7eb)",
                borderTopColor: "var(--primary)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto",
              }}
            />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : staff.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", padding: "2rem 0" }}>
            No staff configured. Ask an admin to enable staff in the kiosk settings.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "0.625rem",
            }}
          >
            {staff.map((s) => (
              <button
                key={s.staff_id}
                onClick={() => handleSelect(s)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0.875rem 0.5rem",
                  minHeight: 88,
                  background: "var(--card-bg, #fff)",
                  border: "1px solid var(--card-border, #e5e7eb)",
                  borderRadius: "14px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  WebkitTapHighlightColor: "transparent",
                  boxShadow: "var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.04))",
                  transition: "transform 100ms ease, box-shadow 100ms ease",
                }}
              >
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "var(--primary-bg, rgba(59,130,246,0.08))",
                    border: "1.5px solid var(--primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    color: "var(--primary)",
                    flexShrink: 0,
                  }}
                >
                  {s.initials}
                </span>
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    lineHeight: 1.2,
                  }}
                >
                  {s.first_name}
                </span>
                {s.department && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      color: "var(--muted)",
                      lineHeight: 1.1,
                    }}
                  >
                    {s.department}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Skip option */}
        {!required && (
          <button
            onClick={onSkip}
            style={{
              display: "block",
              margin: "1.25rem auto 0",
              padding: "0.5rem 1rem",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted)",
              fontSize: "0.85rem",
              fontFamily: "inherit",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
