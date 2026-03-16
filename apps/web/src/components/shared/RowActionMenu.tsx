"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Z_INDEX } from "@/lib/design-tokens";

interface RowAction {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  dividerBefore?: boolean;
}

interface RowActionMenuProps {
  actions: RowAction[];
}

/**
 * Three-dot kebab menu for list/table row actions.
 * Renders an absolutely positioned dropdown; closes on outside click or Escape.
 */
export function RowActionMenu({ actions }: RowActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, close]);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0.25rem 0.4rem",
          fontSize: "1rem",
          lineHeight: 1,
          color: "var(--text-muted, #9ca3af)",
          borderRadius: "4px",
        }}
        aria-label="Row actions"
        aria-expanded={open}
      >
        &#x22EE;
      </button>

      {open && (
        <div
          ref={menuRef}
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: "2px",
            background: "var(--background, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "6px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            minWidth: "160px",
            zIndex: Z_INDEX.dropdown,
            overflow: "hidden",
          }}
        >
          {actions.map((action, i) => (
            <div key={i}>
              {action.dividerBefore && (
                <div style={{ borderTop: "1px solid var(--border, #e5e7eb)", margin: "2px 0" }} />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  action.onClick();
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.825rem",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: action.variant === "danger" ? "#dc2626" : "var(--foreground)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--section-bg, #f9fafb)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                }}
              >
                {action.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
