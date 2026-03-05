"use client";

import { useEffect, useCallback } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { Z_INDEX, BORDERS, SPACING, SHADOWS, TRANSITIONS } from "@/lib/design-tokens";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const SIZE_MAP = {
  sm: "400px",
  md: "560px",
  lg: "720px",
} as const;

export function Modal({ isOpen, onClose, title, size = "md", children, footer }: ModalProps) {
  const containerRef = useFocusTrap(isOpen);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  // Escape key and body scroll lock
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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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
          background: "var(--background, #fff)",
          borderRadius: BORDERS.radius.xl,
          boxShadow: SHADOWS.xl,
          maxWidth: SIZE_MAP[size],
          width: "90%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          zIndex: Z_INDEX.modal,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {title && (
          <div
            style={{
              padding: `${SPACING.lg} ${SPACING.xl}`,
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
                padding: SPACING.xs,
                lineHeight: 1,
              }}
              aria-label="Close"
            >
              &times;
            </button>
          </div>
        )}

        {/* Body */}
        <div
          style={{
            padding: SPACING.xl,
            overflowY: "auto",
            flex: 1,
          }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              padding: `${SPACING.md} ${SPACING.xl}`,
              borderTop: "1px solid var(--border, #e5e7eb)",
              display: "flex",
              justifyContent: "flex-end",
              gap: SPACING.sm,
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
