import type { ReactNode } from "react";
import type { DedupConfig, DedupSummaryItem, BaseDedupResponse } from "./types";

interface Props<C> {
  config: DedupConfig<C>;
  summary: DedupSummaryItem[];
  totalPairs: number;
  data: BaseDedupResponse<C>;
}

export function DedupSummaryBar<C>({ config, summary, totalPairs, data }: Props<C>) {
  if (!summary || summary.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
      <div
        style={{
          padding: "0.75rem 1rem",
          background: "var(--bg-muted, #f8f9fa)",
          borderRadius: "8px",
          textAlign: "center",
          minWidth: "80px",
        }}
      >
        <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{totalPairs}</div>
        <div className="text-muted text-sm">Total Pairs</div>
      </div>
      {summary.map((s) => {
        const groupVal = String(s[config.summaryGroupKey] ?? "");
        const tab = config.tabs.find((t) => t.value === groupVal);
        const color = tab?.color || "#6c757d";
        const label = tab?.label || (s as Record<string, unknown>).tier_label as string || groupVal;

        return (
          <div
            key={groupVal}
            style={{
              padding: "0.75rem 1rem",
              background: "var(--bg-muted, #f8f9fa)",
              borderRadius: "8px",
              textAlign: "center",
              minWidth: "80px",
              borderLeft: `3px solid ${color}`,
            }}
          >
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{s.pair_count}</div>
            <div className="text-muted text-sm">{label}</div>
          </div>
        );
      })}
      {config.renderExtraSummary?.(data)}
    </div>
  );
}
