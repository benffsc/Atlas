"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

export interface ScanHistoryEntry {
  barcode: string;
  name: string;
  action: string;
  timestamp: Date;
  success: boolean;
}

interface ScanSessionHistoryProps {
  entries: ScanHistoryEntry[];
  onRescan: (barcode: string) => void;
}

/**
 * Collapsible list of recent scans below the barcode input.
 * Tap to re-scan a previous barcode.
 */
export function ScanSessionHistory({ entries, onRescan }: ScanSessionHistoryProps) {
  const [collapsed, setCollapsed] = useState(true);

  if (entries.length === 0) return null;

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          background: "none",
          border: "none",
          color: "var(--text-secondary)",
          fontSize: "0.8rem",
          fontWeight: 500,
          cursor: "pointer",
          padding: "0.25rem 0",
          width: "100%",
        }}
      >
        <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={14} />
        Recent scans ({entries.length})
      </button>

      {!collapsed && (
        <div
          style={{
            marginTop: "0.375rem",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          {entries.map((entry, i) => (
            <button
              key={`${entry.barcode}-${entry.timestamp.getTime()}`}
              onClick={() => onRescan(entry.barcode)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                width: "100%",
                padding: "0.5rem 0.75rem",
                background: i % 2 === 0 ? "var(--card-bg, #fff)" : "var(--bg-secondary, #f9fafb)",
                border: "none",
                borderBottom: i < entries.length - 1 ? "1px solid var(--border)" : "none",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "0.8rem",
              }}
            >
              <Icon
                name={entry.success ? "check-circle" : "x-circle"}
                size={14}
                color={entry.success ? "var(--success-text)" : "var(--danger-text)"}
              />
              <span style={{ fontFamily: "monospace", fontWeight: 600, minWidth: "3rem" }}>
                {entry.barcode}
              </span>
              <span style={{ flex: 1, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.name}
              </span>
              <span style={{
                padding: "0.1rem 0.4rem",
                borderRadius: "4px",
                fontSize: "0.7rem",
                fontWeight: 500,
                background: entry.success ? "var(--success-bg)" : "var(--danger-bg)",
                color: entry.success ? "var(--success-text)" : "var(--danger-text)",
              }}>
                {entry.action.replace(/_/g, " ")}
              </span>
              <span style={{ color: "var(--muted)", fontSize: "0.7rem", flexShrink: 0 }}>
                {formatTime(entry.timestamp)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
