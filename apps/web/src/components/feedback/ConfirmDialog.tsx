"use client";

import { useEffect, useRef, useCallback } from "react";
import { COLORS, SPACING } from "@/lib/design-tokens";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Styled confirmation dialog replacing window.confirm().
 * Portal-based with focus trap and keyboard support.
 *
 * @example
 * ```tsx
 * <ConfirmDialog
 *   open={showConfirm}
 *   title="Archive submissions?"
 *   message={`This will archive ${count} submissions. You can restore them later.`}
 *   confirmLabel="Archive"
 *   variant="danger"
 *   onConfirm={handleArchive}
 *   onCancel={() => setShowConfirm(false)}
 * />
 * ```
 *
 * @see FFS-622
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the cancel button when opening (safer default)
  useEffect(() => {
    if (open) {
      // Small delay to ensure the element is rendered
      requestAnimationFrame(() => {
        cancelRef.current?.focus();
      });
    }
  }, [open]);

  // Keyboard handling
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
      // Tab trap between cancel and confirm
      if (e.key === "Tab") {
        const buttons = [cancelRef.current, confirmRef.current].filter(Boolean);
        if (buttons.length < 2) return;
        const active = document.activeElement;
        if (e.shiftKey && active === buttons[0]) {
          e.preventDefault();
          buttons[buttons.length - 1]?.focus();
        } else if (!e.shiftKey && active === buttons[buttons.length - 1]) {
          e.preventDefault();
          buttons[0]?.focus();
        }
      }
    },
    [open, onCancel]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

  const isDanger = variant === "danger";
  const confirmBg = isDanger ? COLORS.error : COLORS.primary;
  const confirmHoverBg = isDanger ? COLORS.errorDark : COLORS.primaryDark;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: SPACING.md,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          maxWidth: "420px",
          width: "100%",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.2)",
          animation: "fadeIn 150ms ease-out",
        }}
      >
        <div style={{ padding: "1.5rem 1.5rem 1rem" }}>
          <h3
            id="confirm-dialog-title"
            style={{
              margin: 0,
              fontSize: "1.1rem",
              fontWeight: 600,
              color: isDanger ? COLORS.error : "var(--foreground)",
            }}
          >
            {title}
          </h3>
          <p
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.9rem",
              color: "var(--text-muted, #6b7280)",
              lineHeight: 1.5,
            }}
          >
            {message}
          </p>
        </div>

        <div
          style={{
            padding: "1rem 1.5rem",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
          }}
        >
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: "6px",
              background: "transparent",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "0.875rem",
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: "0.5rem 1rem",
              border: "none",
              borderRadius: "6px",
              background: loading ? COLORS.gray400 : confirmBg,
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 500,
              fontSize: "0.875rem",
              opacity: loading ? 0.7 : 1,
            }}
            onMouseOver={(e) => {
              if (!loading) e.currentTarget.style.background = confirmHoverBg;
            }}
            onMouseOut={(e) => {
              if (!loading) e.currentTarget.style.background = confirmBg;
            }}
          >
            {loading ? "..." : confirmLabel}
          </button>
        </div>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  );
}

export default ConfirmDialog;
