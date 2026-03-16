"use client";

import { ReactNode, useEffect, useCallback } from "react";
import { TRANSITIONS } from "@/lib/design-tokens";

interface ListDetailLayoutProps {
  children: ReactNode;
  detailPanel: ReactNode | null;
  isDetailOpen: boolean;
  onDetailClose: () => void;
  listWidth?: string;
  detailWidth?: string;
}

/**
 * Split-view layout for list pages with an inline detail/preview panel.
 *
 * When `isDetailOpen` is true, the list pane shrinks and a detail panel
 * slides in from the right. Escape key closes the panel. On mobile
 * (< 768px) the detail panel takes full width and hides the list.
 */
export function ListDetailLayout({
  children,
  detailPanel,
  isDetailOpen,
  onDetailClose,
  listWidth = "55%",
  detailWidth = "45%",
}: ListDetailLayoutProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDetailOpen) onDetailClose();
    },
    [isDetailOpen, onDetailClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 60px)" }}>
      {/* List pane */}
      <div
        style={{
          flex: isDetailOpen ? `0 0 ${listWidth}` : "1",
          overflowY: "auto",
          transition: `flex ${TRANSITIONS.default}`,
          padding: "1.5rem",
        }}
        className={isDetailOpen ? "list-detail-list-collapsed" : undefined}
      >
        {children}
      </div>

      {/* Detail pane */}
      {isDetailOpen && detailPanel && (
        <div
          style={{
            flex: `0 0 ${detailWidth}`,
            borderLeft: "1px solid var(--border, #e5e7eb)",
            overflowY: "auto",
            background: "var(--background, #fff)",
          }}
          className="list-detail-panel"
        >
          {detailPanel}
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
