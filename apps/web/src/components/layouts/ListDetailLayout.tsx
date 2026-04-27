"use client";

import { ReactNode, useEffect, useCallback, useState } from "react";
import { TRANSITIONS } from "@/lib/design-tokens";

export type PanelSize = "default" | "half" | "full";

interface ListDetailLayoutProps {
  children: ReactNode;
  detailPanel: ReactNode | null;
  isDetailOpen: boolean;
  onDetailClose: () => void;
  listWidth?: string;
  detailWidth?: string;
  /** Controlled panel size — if provided, layout uses this instead of internal state */
  panelSize?: PanelSize;
  /** Callback when panel size changes (for parent state sync) */
  onPanelSizeChange?: (size: PanelSize) => void;
  /** Title shown in the panel toolbar (used by unified shells) */
  panelTitle?: string;
  /** Link to the full detail page (shown as "Open →" in toolbar) */
  panelDetailHref?: string;
}

/**
 * Split-view layout for list pages with an inline detail/preview panel.
 *
 * The panel supports three sizes:
 * - `default`: standard side panel (45% width)
 * - `half`: expanded to 65% width, list still visible
 * - `full`: panel takes over entire viewport with smooth animation
 *
 * Escape key collapses one step (full → half → default → close).
 */
export function ListDetailLayout({
  children,
  detailPanel,
  isDetailOpen,
  onDetailClose,
  listWidth = "55%",
  detailWidth = "45%",
  panelSize: controlledSize,
  onPanelSizeChange,
  panelTitle,
  panelDetailHref,
}: ListDetailLayoutProps) {
  const [internalSize, setInternalSize] = useState<PanelSize>("default");
  const size = controlledSize ?? internalSize;

  const setSize = useCallback((s: PanelSize) => {
    if (controlledSize !== undefined) {
      onPanelSizeChange?.(s);
    } else {
      setInternalSize(s);
    }
  }, [controlledSize, onPanelSizeChange]);

  // Reset size when panel closes
  useEffect(() => {
    if (!isDetailOpen) setSize("default");
  }, [isDetailOpen, setSize]);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDetailOpen) {
        if (size === "full") {
          setSize("half");
        } else if (size === "half") {
          setSize("default");
        } else {
          onDetailClose();
        }
      }
    },
    [isDetailOpen, size, setSize, onDetailClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  // Compute flex values based on panel size
  const listFlex = !isDetailOpen
    ? "1"
    : size === "full"
      ? "0 0 0%"
      : size === "half"
        ? "0 0 35%"
        : `0 0 ${listWidth}`;

  const panelFlex = size === "full"
    ? "1 1 100%"
    : size === "half"
      ? "0 0 65%"
      : `0 0 ${detailWidth}`;

  return (
    <div style={{ display: "flex", height: "calc(100vh - 60px)", position: "relative" }}>
      {/* List pane */}
      <div
        style={{
          flex: listFlex,
          overflowY: "auto",
          transition: `flex 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease`,
          padding: "var(--content-padding, 1.5rem)",
          opacity: size === "full" ? 0 : 1,
          pointerEvents: size === "full" ? "none" : "auto",
          minWidth: 0,
        }}
        className={isDetailOpen ? "list-detail-list-collapsed" : undefined}
      >
        {children}
      </div>

      {/* Detail pane */}
      {isDetailOpen && detailPanel && (
        <div
          style={{
            flex: panelFlex,
            borderLeft: size === "full" ? "none" : "1px solid var(--border, #e5e7eb)",
            overflowY: "auto",
            background: "var(--background, #fff)",
            boxShadow: size === "full" ? "none" : "-4px 0 12px rgba(0,0,0,0.06)",
            transition: "flex 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-left 0.2s ease, box-shadow 0.2s ease",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
          className="list-detail-panel"
          data-panel-size={size}
        >
          {/* Unified panel toolbar */}
          <PanelToolbar
            size={size}
            onSizeChange={setSize}
            onClose={onDetailClose}
            title={panelTitle}
            detailHref={panelDetailHref}
          />
          <div style={{ flex: 1, overflowY: "auto" }}>
            {detailPanel}
          </div>
        </div>
      )}

      {/* Mobile: detail as full-width overlay */}
      <style>{`
        @media (max-width: 768px) {
          .list-detail-list-collapsed { display: none !important; }
          .list-detail-panel {
            flex: 1 1 100% !important;
            border-left: none !important;
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Unified panel toolbar: [X close] [title...] [size toggles] [Open →]
 * Single bar that handles all panel chrome so shells don't need their own headers.
 */
function PanelToolbar({
  size,
  onSizeChange,
  onClose,
  title,
  detailHref,
}: {
  size: PanelSize;
  onSizeChange: (size: PanelSize) => void;
  onClose: () => void;
  title?: string;
  detailHref?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.35rem 0.75rem",
        borderBottom: "1px solid var(--border, #e5e7eb)",
        background: "var(--section-bg, #f9fafb)",
        flexShrink: 0,
      }}
    >
      {/* Close */}
      <button
        onClick={onClose}
        title="Close panel (Esc)"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "24px", height: "24px", border: "none", borderRadius: "4px",
          cursor: "pointer", background: "transparent", color: "var(--text-muted, #9ca3af)",
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Title */}
      {title && (
        <span style={{
          flex: 1, minWidth: 0, fontWeight: 600, fontSize: "0.8rem",
          color: "var(--foreground)", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {title}
        </span>
      )}
      {!title && <span style={{ flex: 1 }} />}

      {/* Size toggles */}
      <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
        <SizeButton active={size === "default"} onClick={() => onSizeChange("default")} title="Side panel" aria-label="Side panel view">
          <SidebarIcon />
        </SizeButton>
        <SizeButton active={size === "half"} onClick={() => onSizeChange("half")} title="Expanded" aria-label="Expanded view">
          <HalfIcon />
        </SizeButton>
        <SizeButton active={size === "full"} onClick={() => onSizeChange("full")} title="Full width" aria-label="Full width view">
          <FullIcon />
        </SizeButton>
      </div>

      {/* Open full page link */}
      {detailHref && (
        <a
          href={detailHref}
          style={{
            fontSize: "0.7rem", color: "var(--primary, #3b82f6)",
            textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0,
            fontWeight: 500,
          }}
        >
          Open →
        </a>
      )}
    </div>
  );
}

function SizeButton({
  active,
  onClick,
  title,
  children,
  ...rest
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "28px",
        height: "22px",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        background: active ? "var(--primary, #3b82f6)" : "transparent",
        color: active ? "#fff" : "var(--text-muted, #9ca3af)",
        transition: "background 0.15s, color 0.15s",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// Mini icons representing the panel layouts
function SidebarIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
      <rect x="0.5" y="0.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1" />
      <line x1="9" y1="0.5" x2="9" y2="9.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function HalfIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
      <rect x="0.5" y="0.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1" />
      <line x1="5" y1="0.5" x2="5" y2="9.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function FullIcon() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
      <rect x="0.5" y="0.5" width="13" height="9" rx="1" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.15" />
    </svg>
  );
}
