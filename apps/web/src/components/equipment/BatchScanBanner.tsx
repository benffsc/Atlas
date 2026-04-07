"use client";

import { Button } from "@/components/ui/Button";

interface BatchScanBannerProps {
  active: boolean;
  onToggle: (on: boolean) => void;
  scanCount: number;
  onClear: () => void;
}

/**
 * Toggle bar for batch scan mode. Persists to localStorage.
 * When active, shows running count and clear button.
 */
export function BatchScanBanner({ active, onToggle, scanCount, onClear }: BatchScanBannerProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.5rem 0.75rem",
        marginBottom: "0.75rem",
        background: active ? "var(--info-bg)" : "transparent",
        border: active ? "1px solid var(--info-border)" : "1px solid transparent",
        borderRadius: "8px",
        transition: "all 150ms ease",
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: "pointer",
          fontSize: "0.85rem",
          fontWeight: 500,
          color: active ? "var(--info-text)" : "var(--text-secondary)",
        }}
      >
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => onToggle(e.target.checked)}
          style={{
            width: 18,
            height: 18,
            cursor: "pointer",
            accentColor: "var(--primary)",
          }}
        />
        Batch Mode
        {active && scanCount > 0 && (
          <span
            style={{
              padding: "0.125rem 0.5rem",
              borderRadius: "10px",
              fontSize: "0.75rem",
              fontWeight: 700,
              background: "var(--primary)",
              color: "var(--primary-foreground, #fff)",
            }}
          >
            {scanCount}
          </span>
        )}
      </label>

      {active && scanCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          style={{ fontSize: "0.75rem" }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
