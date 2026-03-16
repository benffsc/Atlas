"use client";

import { ReactNode, useEffect, useCallback } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { Z_INDEX, SHADOWS, TRANSITIONS } from "@/lib/design-tokens";

interface ActionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}

const WIDTH_MAP = {
  sm: "360px",
  md: "480px",
  lg: "640px",
} as const;

/**
 * Slide-over drawer panel from the right side.
 * Uses focus trap, Escape key, and backdrop click to close.
 */
export function ActionDrawer({
  isOpen,
  onClose,
  title,
  children,
  footer,
  width = "md",
}: ActionDrawerProps) {
  const containerRef = useFocusTrap(isOpen);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        zIndex: Z_INDEX.modalBackdrop,
        transition: `opacity ${TRANSITIONS.fast}`,
      }}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        ref={containerRef}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: WIDTH_MAP[width],
          maxWidth: "100vw",
          background: "var(--background, #fff)",
          boxShadow: SHADOWS.xl,
          display: "flex",
          flexDirection: "column",
          zIndex: Z_INDEX.modal,
          transform: "translateX(0)",
          transition: `transform ${TRANSITIONS.default}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "1rem 1.25rem",
            borderBottom: "1px solid var(--border, #e5e7eb)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "1.25rem",
              color: "var(--text-muted, #9ca3af)",
              padding: "0.25rem",
              lineHeight: 1,
            }}
            aria-label="Close drawer"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "1.25rem", overflowY: "auto", flex: 1 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              padding: "0.75rem 1.25rem",
              borderTop: "1px solid var(--border, #e5e7eb)",
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.5rem",
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
