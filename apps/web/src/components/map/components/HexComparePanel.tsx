"use client";

import { useMemo } from "react";
import type { AtlasPin } from "@/components/map";
import type { HexBinSelection } from "./CatHexbinLayer";
import { useHexForecast, DEFAULT_COST_PER_CAT } from "@/components/map/hooks/useHexForecast";
import type { HexForecast } from "@/components/map/hooks/useHexForecast";

interface HexComparePanelProps {
  selections: HexBinSelection[];
  onRemove: (index: number) => void;
  onClose: () => void;
}

const COMPARE_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b"];

function relativeTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const RISK_COLORS: Record<string, string> = {
  Low: "#16a34a",
  Moderate: "#d97706",
  High: "#ea580c",
  Critical: "#dc2626",
};

const CONFIDENCE_LABELS: Record<string, { color: string; label: string }> = {
  low: { color: "#dc2626", label: "Low" },
  medium: { color: "#d97706", label: "Medium" },
  high: { color: "#16a34a", label: "High" },
};

function freshnessBucket(iso: string | null): "recent" | "aging" | "stale" | "unknown" {
  if (!iso) return "unknown";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 365) return "recent";
  if (days <= 730) return "aging";
  return "stale";
}

// Wrapper to run forecast hook per column
function useColumnForecast(pins: AtlasPin[]): HexForecast {
  return useHexForecast(pins, 0, DEFAULT_COST_PER_CAT);
}

// Single column stats (computed without hooks for the comparison)
interface ColumnStats {
  totalCats: number;
  totalAltered: number;
  intactEstimate: number;
  alterationRate: number;
  diseaseRiskCount: number;
  watchListCount: number;
  needsTrapperCount: number;
  activeRequests: number;
  placeCount: number;
  freshness: { recent: number; aging: number; stale: number; unknown: number };
  lastActivity: string | null;
  topAddress: string;
  diseases: { short_code: string; color: string; count: number }[];
}

function computeStats(pins: AtlasPin[]): ColumnStats {
  let totalCats = 0, totalAltered = 0, diseaseRiskCount = 0, watchListCount = 0, needsTrapperCount = 0, activeRequests = 0;
  let lastActivity: string | null = null;
  const freshness = { recent: 0, aging: 0, stale: 0, unknown: 0 };
  const diseaseMap = new Map<string, { short_code: string; color: string; count: number }>();

  for (const pin of pins) {
    totalCats += pin.cat_count;
    totalAltered += pin.total_altered || 0;
    if (pin.disease_risk) diseaseRiskCount++;
    if (pin.watch_list) watchListCount++;
    needsTrapperCount += pin.needs_trapper_count;
    activeRequests += pin.active_request_count;
    if (pin.last_alteration_at) {
      if (!lastActivity || pin.last_alteration_at > lastActivity) lastActivity = pin.last_alteration_at;
    }
    freshness[freshnessBucket(pin.last_alteration_at)]++;
    for (const b of pin.disease_badges || []) {
      const ex = diseaseMap.get(b.disease_key);
      if (ex) ex.count += b.positive_cats;
      else diseaseMap.set(b.disease_key, { short_code: b.short_code, color: b.color, count: b.positive_cats });
    }
  }

  // Top city from addresses
  const cities = pins.map(p => { const parts = p.address.split(","); return parts.length >= 2 ? parts[parts.length - 2].trim() : parts[0].trim(); });
  const cityCount = new Map<string, number>();
  for (const c of cities) cityCount.set(c, (cityCount.get(c) || 0) + 1);
  let topAddress = "Area";
  let topCount = 0;
  for (const [c, n] of cityCount) { if (n > topCount) { topCount = n; topAddress = c; } }

  return {
    totalCats, totalAltered,
    intactEstimate: Math.max(totalCats - totalAltered, 0),
    alterationRate: totalCats > 0 ? totalAltered / totalCats : 0,
    diseaseRiskCount, watchListCount, needsTrapperCount, activeRequests,
    placeCount: pins.length, freshness, lastActivity, topAddress,
    diseases: Array.from(diseaseMap.values()),
  };
}

/** Estimate the hex diameter in miles from pin spread */
function estimateHexSizeMiles(pins: AtlasPin[], center: { lat: number; lng: number }): number {
  if (pins.length < 2) return 0;
  let maxDist = 0;
  for (const pin of pins) {
    const dLat = (pin.lat - center.lat) * 69.0; // ~69 miles per degree lat
    const dLng = (pin.lng - center.lng) * 69.0 * Math.cos(center.lat * Math.PI / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist > maxDist) maxDist = dist;
  }
  // maxDist is roughly the hex radius in miles; diameter = 2x
  return Math.round(maxDist * 2 * 100) / 100;
}

// Individual column with its own forecast hook
function CompareColumn({ selection, index, onRemove }: { selection: HexBinSelection; index: number; onRemove: () => void }) {
  const color = COMPARE_COLORS[index % COMPARE_COLORS.length];
  const stats = useMemo(() => computeStats(selection.pins), [selection.pins]);
  const forecast = useColumnForecast(selection.pins);
  const altPct = Math.round(stats.alterationRate * 100);
  const riskColor = RISK_COLORS[forecast.riskLabel] || "#6b7280";
  const confInfo = CONFIDENCE_LABELS[forecast.confidence];
  const hexSize = useMemo(() => estimateHexSizeMiles(selection.pins, selection.center), [selection.pins, selection.center]);

  return (
    <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 0, borderLeft: index > 0 ? "1px solid var(--border, #e5e7eb)" : "none" }}>
      {/* Column header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border, #e5e7eb)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 20, height: 20, borderRadius: "50%", background: color, color: "white", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {index + 1}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {stats.topAddress}
          </div>
          <div style={{ fontSize: 11, color: "var(--foreground-muted, #6b7280)" }}>
            {stats.placeCount} places · {selection.center.lat.toFixed(4)}, {selection.center.lng.toFixed(4)}
          </div>
          <div style={{ fontSize: 10, color: "var(--foreground-muted, #9ca3af)" }}>
            ~{hexSize > 0 ? `${hexSize} mi` : "< 0.01 mi"} diameter
          </div>
        </div>
        <button
          onClick={onRemove}
          title="Remove from comparison"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--foreground-muted, #9ca3af)", padding: 2, lineHeight: 1 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable body — hidden scrollbar */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 14, scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}>
        {/* Risk Score */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: riskColor }}>{forecast.riskScore}<span style={{ fontSize: 14, fontWeight: 400 }}>/10</span></div>
          <div style={{ fontSize: 11, fontWeight: 600, color: riskColor }}>{forecast.riskLabel} Risk</div>
        </div>

        {/* Key stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <MiniStat label="Cats" value={stats.totalCats} />
          <MiniStat label="Altered" value={stats.totalAltered} />
          <MiniStat label="Intact" value={stats.intactEstimate} accent={stats.intactEstimate > 10 ? "#dc2626" : undefined} />
          <MiniStat label="Requests" value={stats.activeRequests} accent={stats.activeRequests > 0 ? "#2563eb" : undefined} />
        </div>

        {/* Alteration Rate */}
        <div>
          <Row label="FFR Progress" value={`${altPct}%`} />
          <div style={{ height: 6, borderRadius: 3, background: "var(--border, #e5e7eb)", overflow: "hidden", marginTop: 4 }}>
            <div style={{ height: "100%", width: `${altPct}%`, borderRadius: 3, background: altPct >= 75 ? "#16a34a" : altPct >= 50 ? "#d97706" : "#dc2626" }} />
          </div>
        </div>

        {/* FFR Velocity + Confidence */}
        <div>
          <Row label="FFR Velocity" value={`${forecast.tnrVelocity} cats/mo`} />
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: `${confInfo.color}18`, color: confInfo.color }}>
              {confInfo.label} confidence
            </span>
          </div>
        </div>

        {/* Breakeven */}
        <Row label="Breakeven Rate" value={`${forecast.breakevenRate} cats/mo`} valueColor={forecast.tnrVelocity >= forecast.breakevenRate ? "#16a34a" : "#dc2626"} />

        {/* Target */}
        <Row label="Cats to 75%" value={String(forecast.catsToTarget)} />
        <Row label="Time to 75%" value={forecast.monthsToTarget === Infinity ? "Never" : `~${forecast.monthsToTarget} mo`} />

        {/* Cost */}
        <Row label="Cost to 75%" value={`$${forecast.costToTarget.toLocaleString()}`} />

        {/* Disease */}
        {stats.diseases.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--foreground-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Disease</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {stats.diseases.map(d => (
                <span key={d.short_code} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 3, background: `${d.color}18`, color: d.color, fontWeight: 500 }}>
                  {d.short_code}: {d.count}
                </span>
              ))}
            </div>
          </div>
        )}
        {stats.diseases.length === 0 && <Row label="Disease" value="None" valueColor="var(--foreground-muted, #9ca3af)" />}

        {/* Alerts */}
        <Row label="Disease Risk" value={String(stats.diseaseRiskCount)} accent={stats.diseaseRiskCount > 0} />
        <Row label="Watch List" value={String(stats.watchListCount)} accent={stats.watchListCount > 0} />
        <Row label="Needs Trapper" value={String(stats.needsTrapperCount)} accent={stats.needsTrapperCount > 0} />

        {/* Freshness — pie chart */}
        <FreshnessPie freshness={stats.freshness} total={stats.placeCount} />

        {/* Last Activity */}
        <Row label="Last Activity" value={stats.lastActivity ? relativeTime(stats.lastActivity) : "None"} />

        {/* Forecast — all timeframes, both scenarios */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--foreground-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Forecast (No Action)</div>
          {forecast.noAction.snapshots.map((snap) => (
            <ForecastRow key={snap.month} months={snap.month} pop={snap.population} altRate={snap.alterationRate} currentPop={stats.totalCats} />
          ))}
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--foreground-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Forecast (Current Pace)</div>
          {forecast.currentPace.snapshots.map((snap) => (
            <ForecastRow key={snap.month} months={snap.month} pop={snap.population} altRate={snap.alterationRate} currentPop={stats.totalCats} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ──

export function HexComparePanel({ selections, onRemove, onClose }: HexComparePanelProps) {
  if (selections.length === 0) return null;

  return (
    <div style={{
      position: "fixed",
      top: "5%",
      left: "5%",
      right: "5%",
      bottom: "5%",
      zIndex: 1200,
      background: "var(--background, #fff)",
      borderRadius: 16,
      border: "1px solid var(--border, #e5e7eb)",
      boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      animation: "drawer-slide-in 0.2s ease-out",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--border, #e5e7eb)", flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--foreground, #111)" }}>Compare Areas</h2>
          <div style={{ fontSize: 12, color: "var(--foreground-muted, #6b7280)", marginTop: 2 }}>
            {selections.length} area{selections.length !== 1 ? "s" : ""} selected
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close comparison"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--foreground-muted, #6b7280)", padding: 4 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Columns */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {selections.map((sel, i) => (
          <CompareColumn key={`${sel.center.lat}-${sel.center.lng}`} selection={sel} index={i} onRemove={() => onRemove(i)} />
        ))}
        {/* Empty slot placeholders */}
        {selections.length < 4 && (
          <div style={{
            flex: 1, minWidth: 200, display: "flex", alignItems: "center", justifyContent: "center",
            borderLeft: "1px solid var(--border, #e5e7eb)",
            color: "var(--foreground-muted, #9ca3af)", fontSize: 13, textAlign: "center", padding: 20,
          }}>
            Click a hexagon on the map to add{selections.length < 3 ? ` (${4 - selections.length} more)` : " (1 more)"}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ──

function MiniStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div style={{ padding: "6px 8px", borderRadius: 6, background: "var(--background-secondary, #f3f4f6)", textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent || "var(--foreground, #111)" }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 10, color: "var(--foreground-muted, #6b7280)" }}>{label}</div>
    </div>
  );
}

function Row({ label, value, valueColor, accent }: { label: string; value: string; valueColor?: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
      <span style={{ color: "var(--foreground-muted, #6b7280)" }}>{label}</span>
      <span style={{ fontWeight: 500, color: valueColor || (accent ? "#dc2626" : "var(--foreground, #111)") }}>{value}</span>
    </div>
  );
}

// SVG donut pie chart for data freshness
const FRESHNESS_SEGMENTS: { key: keyof ColumnStats["freshness"]; label: string; color: string }[] = [
  { key: "recent", label: "< 1 year", color: "#16a34a" },
  { key: "aging", label: "1-2 years", color: "#d97706" },
  { key: "stale", label: "2+ years", color: "#dc2626" },
  { key: "unknown", label: "No data", color: "#9ca3af" },
];

function FreshnessPie({ freshness, total }: { freshness: ColumnStats["freshness"]; total: number }) {
  if (total === 0) return null;
  const size = 64;
  const cx = size / 2;
  const cy = size / 2;
  const r = 24;
  const strokeW = 10;

  // Build arcs
  let cumAngle = -Math.PI / 2; // start at top
  const arcs: { d: string; color: string }[] = [];
  for (const seg of FRESHNESS_SEGMENTS) {
    const count = freshness[seg.key];
    if (count === 0) continue;
    const angle = (count / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(cumAngle);
    const y1 = cy + r * Math.sin(cumAngle);
    const x2 = cx + r * Math.cos(cumAngle + angle);
    const y2 = cy + r * Math.sin(cumAngle + angle);
    const large = angle > Math.PI ? 1 : 0;
    arcs.push({ d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`, color: seg.color });
    cumAngle += angle;
  }

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--foreground-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Data Freshness</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Background ring */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border, #e5e7eb)" strokeWidth={strokeW} />
          {arcs.map((arc, i) => (
            <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={strokeW} strokeLinecap="butt" />
          ))}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          {FRESHNESS_SEGMENTS.map(seg => {
            const count = freshness[seg.key];
            if (count === 0) return null;
            const pct = Math.round((count / total) * 100);
            return (
              <div key={seg.key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
                <span style={{ color: "var(--foreground, #111)" }}>{pct}%</span>
                <span style={{ color: "var(--foreground-muted, #9ca3af)" }}>{seg.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ForecastRow({ months, pop, altRate, currentPop }: { months: number; pop: number; altRate: number; currentPop: number }) {
  const label = months === 12 ? "1 Year" : months === 60 ? "5 Years" : months === 120 ? "10 Years" : `${months}mo`;
  const delta = pop - currentPop;
  const deltaStr = delta >= 0 ? `+${delta}` : String(delta);
  const deltaColor = delta > 0 ? "#dc2626" : delta < 0 ? "#16a34a" : "var(--foreground-muted, #6b7280)";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "3px 0" }}>
      <span style={{ color: "var(--foreground-muted, #6b7280)", minWidth: 55 }}>{label}</span>
      <span style={{ fontWeight: 600, color: "var(--foreground, #111)" }}>{pop.toLocaleString()}</span>
      <span style={{ fontSize: 11, color: deltaColor, minWidth: 40, textAlign: "right" }}>{deltaStr}</span>
      <span style={{ fontSize: 10, color: "var(--foreground-muted, #9ca3af)", minWidth: 40, textAlign: "right" }}>{altRate}%</span>
    </div>
  );
}
