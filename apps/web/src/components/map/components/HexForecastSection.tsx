"use client";

import { useState } from "react";
import type { AtlasPin } from "@/components/map";
import { useHexForecast, DEFAULT_COST_PER_CAT } from "@/components/map/hooks/useHexForecast";
import type { ForecastSnapshot, ConfidenceLevel } from "@/components/map/hooks/useHexForecast";

interface HexForecastSectionProps {
  pins: AtlasPin[];
}

const CONFIDENCE_STYLES: Record<ConfidenceLevel, { bg: string; color: string; label: string }> = {
  low: { bg: "#fef2f2", color: "#dc2626", label: "Low" },
  medium: { bg: "#fffbeb", color: "#d97706", label: "Medium" },
  high: { bg: "#f0fdf4", color: "#16a34a", label: "High" },
};

const RISK_COLORS: Record<string, string> = {
  Low: "#16a34a",
  Moderate: "#d97706",
  High: "#ea580c",
  Critical: "#dc2626",
};

function formatPop(n: number): string {
  return n.toLocaleString();
}

function changeLabel(pct: number): { text: string; color: string } {
  if (pct > 0) return { text: `+${pct}%`, color: "#dc2626" };
  if (pct < 0) return { text: `${pct}%`, color: "#16a34a" };
  return { text: "0%", color: "var(--foreground-muted, #6b7280)" };
}

function periodLabel(months: number): string {
  if (months === 12) return "1 Year";
  if (months === 60) return "5 Years";
  if (months === 120) return "10 Years";
  return `${months}mo`;
}

export function HexForecastSection({ pins }: HexForecastSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [whatIfRate, setWhatIfRate] = useState<number>(() => {
    // Default to current velocity or breakeven, whichever is higher
    const totalAltered = pins.reduce((s, p) => s + (p.total_altered || 0), 0);
    return Math.max(Math.round(totalAltered / 24), 1);
  });
  const [costPerCat, setCostPerCat] = useState(DEFAULT_COST_PER_CAT);

  const forecast = useHexForecast(pins, whatIfRate, costPerCat);

  const confStyle = CONFIDENCE_STYLES[forecast.confidence];
  const riskColor = RISK_COLORS[forecast.riskLabel] || "#6b7280";

  // Max slider value: 3x breakeven or current velocity, whichever is larger, min 10
  const sliderMax = Math.max(10, Math.round(Math.max(forecast.breakevenRate * 3, forecast.tnrVelocity * 3)));

  return (
    <div style={{ borderTop: "1px solid var(--border, #e5e7eb)", marginTop: 8 }}>
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "12px 0",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--foreground, #111)",
          textAlign: "left",
        }}
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "rotate(0)" }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        Population Forecast
        <span style={{
          marginLeft: "auto",
          fontSize: 11,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 4,
          background: `${riskColor}18`,
          color: riskColor,
        }}>
          Risk: {forecast.riskScore}/10
        </span>
      </button>

      {!expanded ? null : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 16 }}>
          {/* ── Key Metrics Row ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {/* FFR Velocity */}
            <div style={{ padding: "8px", borderRadius: 6, background: "var(--background-secondary, #f3f4f6)", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--foreground, #111)" }}>
                {forecast.tnrVelocity}
              </div>
              <div style={{ fontSize: 10, color: "var(--foreground-muted, #6b7280)" }}>cats/month</div>
              <span style={{
                display: "inline-block",
                marginTop: 3,
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 3,
                background: confStyle.bg,
                color: confStyle.color,
              }}>
                {confStyle.label} confidence
              </span>
            </div>

            {/* Breakeven */}
            <div style={{ padding: "8px", borderRadius: 6, background: "var(--background-secondary, #f3f4f6)", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: forecast.tnrVelocity >= forecast.breakevenRate ? "var(--success-text, #16a34a)" : "var(--danger-text, #dc2626)" }}>
                {forecast.breakevenRate}
              </div>
              <div style={{ fontSize: 10, color: "var(--foreground-muted, #6b7280)" }}>breakeven rate</div>
              <span style={{
                display: "inline-block",
                marginTop: 3,
                fontSize: 10,
                fontWeight: 500,
                color: forecast.tnrVelocity >= forecast.breakevenRate ? "var(--success-text, #16a34a)" : "var(--danger-text, #dc2626)",
              }}>
                {forecast.tnrVelocity >= forecast.breakevenRate ? "Above" : "Below"} breakeven
              </span>
            </div>

            {/* Risk Score */}
            <div style={{ padding: "8px", borderRadius: 6, background: "var(--background-secondary, #f3f4f6)", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: riskColor }}>
                {forecast.riskScore}
                <span style={{ fontSize: 11, fontWeight: 400 }}>/10</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--foreground-muted, #6b7280)" }}>risk score</div>
              <span style={{
                display: "inline-block",
                marginTop: 3,
                fontSize: 10,
                fontWeight: 600,
                color: riskColor,
              }}>
                {forecast.riskLabel}
              </span>
            </div>
          </div>

          {/* ── Target Progress ── */}
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--background-secondary, #f3f4f6)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: "var(--foreground-muted, #6b7280)" }}>
                <strong style={{ color: "var(--foreground, #111)" }}>{forecast.catsToTarget}</strong> cats to reach 75%
              </span>
              <span style={{ color: "var(--foreground-muted, #6b7280)", fontSize: 11 }}>
                {forecast.monthsToTarget === Infinity
                  ? "Never at current pace"
                  : forecast.monthsToTarget <= 1
                    ? "< 1 month"
                    : `~${forecast.monthsToTarget} months`}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--border, #e5e7eb)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min(100, forecast.currentAlterationRate * 100)}%`,
                borderRadius: 3,
                background: "var(--primary, #3b82f6)",
                transition: "width 0.3s",
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 3, color: "var(--foreground-muted, #6b7280)" }}>
              <span>0%</span>
              <span style={{ color: "var(--primary, #3b82f6)", fontWeight: 600 }}>{Math.round(forecast.currentAlterationRate * 100)}%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
          </div>

          {/* ── Cost Estimate ── */}
          <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--background-secondary, #f3f4f6)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Cost Estimate</span>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--foreground-muted, #6b7280)" }}>
                $/cat:
                <input
                  type="number"
                  value={costPerCat}
                  onChange={(e) => setCostPerCat(Math.max(1, Number(e.target.value) || DEFAULT_COST_PER_CAT))}
                  style={{
                    width: 56,
                    padding: "2px 4px",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    fontSize: 11,
                    textAlign: "right",
                    background: "var(--background)",
                  }}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: "var(--foreground-muted, #6b7280)" }}>Cost to 75%</span>
              <strong style={{ color: "var(--foreground, #111)" }}>${forecast.costToTarget.toLocaleString()}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
              <span style={{ color: "var(--foreground-muted, #6b7280)" }}>Monthly (current pace)</span>
              <span style={{ color: "var(--foreground, #111)" }}>${forecast.monthlyCost.toLocaleString()}/mo</span>
            </div>
          </div>

          {/* ── "What If" Slider ── */}
          <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border, #e5e7eb)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em" }}>What If</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary, #3b82f6)" }}>
                {whatIfRate} cats/month
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={sliderMax}
              value={whatIfRate}
              onChange={(e) => setWhatIfRate(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--primary, #3b82f6)", cursor: "pointer" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--foreground-muted, #6b7280)", marginTop: 2 }}>
              <span>0</span>
              <span style={{ color: "var(--danger-text, #dc2626)", fontSize: 10 }}>
                breakeven: {forecast.breakevenRate}
              </span>
              <span>{sliderMax}</span>
            </div>
          </div>

          {/* ── Projection Table ── */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Population Projections
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr", gap: 0, fontSize: 12 }}>
              {/* Header */}
              <div style={headerCellStyle} />
              {["1 Year", "5 Years", "10 Years"].map((h) => (
                <div key={h} style={{ ...headerCellStyle, textAlign: "center" }}>{h}</div>
              ))}

              {/* Rows */}
              <ScenarioRow label="No Intervention" snapshots={forecast.noAction.snapshots} currentPop={forecast.totalCats} color="#dc2626" />
              <ScenarioRow label="Current Pace" snapshots={forecast.currentPace.snapshots} currentPop={forecast.totalCats} color="var(--foreground, #111)" />
              <ScenarioRow label={`Custom (${whatIfRate}/mo)`} snapshots={forecast.whatIf.snapshots} currentPop={forecast.totalCats} color="var(--primary, #3b82f6)" />
            </div>
          </div>

          {/* ── Disclaimer ── */}
          <div style={{ fontSize: 10, color: "var(--foreground-muted, #9ca3af)", lineHeight: 1.4, fontStyle: "italic" }}>
            Estimates based on standard FFR population models with seasonal breeding adjustments. Actual results vary by environment, resources, and cat behavior.
            {forecast.confidence === "low" && " Low confidence — limited activity data available."}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

const headerCellStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontWeight: 600,
  fontSize: 11,
  color: "var(--foreground-muted, #6b7280)",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

const cellStyle: React.CSSProperties = {
  padding: "8px 8px",
  textAlign: "center",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

function ScenarioRow({ label, snapshots, currentPop, color }: {
  label: string;
  snapshots: ForecastSnapshot[];
  currentPop: number;
  color: string;
}) {
  return (
    <>
      <div style={{ ...cellStyle, textAlign: "left", fontWeight: 500, color, whiteSpace: "nowrap" }}>
        {label}
      </div>
      {snapshots.map((snap) => {
        const ch = currentPop > 0 ? Math.round(((snap.population - currentPop) / currentPop) * 100) : 0;
        const { text, color: chColor } = changeLabel(ch);
        return (
          <div key={snap.month} style={cellStyle}>
            <div style={{ fontWeight: 600, color: "var(--foreground, #111)" }}>{formatPop(snap.population)}</div>
            <div style={{ fontSize: 10, color: chColor }}>{text}</div>
            <div style={{ fontSize: 10, color: "var(--foreground-muted, #9ca3af)" }}>{snap.alterationRate}% alt</div>
          </div>
        );
      })}
    </>
  );
}
