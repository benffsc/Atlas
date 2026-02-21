"use client";

/**
 * Toast - Notification system with undo support
 *
 * Provides non-blocking notifications for user feedback.
 * Supports action buttons for undo/retry operations.
 */

import { useState, useEffect, createContext, useContext, useCallback, ReactNode } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
  action?: ToastAction;
  duration?: number; // ms, 0 = no auto-dismiss
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
  // Convenience methods
  success: (message: string, options?: Partial<Omit<Toast, "id" | "type" | "message">>) => string;
  error: (message: string, options?: Partial<Omit<Toast, "id" | "type" | "message">>) => string;
  warning: (message: string, options?: Partial<Omit<Toast, "id" | "type" | "message">>) => string;
  info: (message: string, options?: Partial<Omit<Toast, "id" | "type" | "message">>) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; icon: string; color: string }> = {
  success: { bg: "#f0fdf4", border: "#bbf7d0", icon: "✓", color: "#166534" },
  error: { bg: "#fef2f2", border: "#fecaca", icon: "✗", color: "#991b1b" },
  warning: { bg: "#fffbeb", border: "#fde68a", icon: "!", color: "#92400e" },
  info: { bg: "#eff6ff", border: "#bfdbfe", icon: "i", color: "#1e40af" },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const [isExiting, setIsExiting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const style = TYPE_STYLES[toast.type];

  useEffect(() => {
    if (toast.duration === 0) return;

    const timeout = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onDismiss, 200);
    }, toast.duration || 5000);

    return () => clearTimeout(timeout);
  }, [toast.duration, onDismiss]);

  const handleAction = async () => {
    if (!toast.action) return;
    setActionLoading(true);
    try {
      await toast.action.onClick();
    } finally {
      setActionLoading(false);
      onDismiss();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
        opacity: isExiting ? 0 : 1,
        transform: isExiting ? "translateX(100%)" : "translateX(0)",
        transition: "all 0.2s ease-out",
        maxWidth: 400,
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: style.color,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {style.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, color: style.color, fontSize: 14 }}>
          {toast.message}
        </div>
        {toast.description && (
          <div style={{ color: "#6b7280", fontSize: 13, marginTop: 2 }}>
            {toast.description}
          </div>
        )}
        {toast.action && (
          <button
            onClick={handleAction}
            disabled={actionLoading}
            style={{
              marginTop: 8,
              padding: "4px 12px",
              background: style.color,
              color: "white",
              border: "none",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
              cursor: actionLoading ? "not-allowed" : "pointer",
              opacity: actionLoading ? 0.7 : 1,
            }}
          >
            {actionLoading ? "..." : toast.action.label}
          </button>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={() => {
          setIsExiting(true);
          setTimeout(onDismiss, 200);
        }}
        style={{
          padding: 4,
          background: "transparent",
          border: "none",
          color: "#9ca3af",
          cursor: "pointer",
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback(
    (message: string, options?: Partial<Omit<Toast, "id" | "type" | "message">>) =>
      addToast({ type: "success", message, ...options }),
    [addToast]
  );

  const error = useCallback(
    (message: string, options?: Partial<Omit<Toast, "id" | "type" | "message">>) =>
      addToast({ type: "error", message, duration: 0, ...options }), // Errors don't auto-dismiss
    [addToast]
  );

  const warning = useCallback(
    (message: string, options?: Partial<Omit<Toast, "id" | "type" | "message">>) =>
      addToast({ type: "warning", message, ...options }),
    [addToast]
  );

  const info = useCallback(
    (message: string, options?: Partial<Omit<Toast, "id" | "type" | "message">>) =>
      addToast({ type: "info", message, ...options }),
    [addToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}
      {/* Toast container */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => (
          <div key={toast.id} style={{ pointerEvents: "auto" }}>
            <ToastItem toast={toast} onDismiss={() => removeToast(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
