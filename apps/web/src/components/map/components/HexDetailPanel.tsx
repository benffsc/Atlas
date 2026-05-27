"use client";

import { useMemo, useState } from "react";
import type { AtlasPin } from "@/components/map";
import type { HexBinSelection } from "./CatHexbinLayer";
import { HexForecastSection } from "./HexForecastSection";

interface HexDetailPanelProps {
  selection: HexBinSelection;
  onClose: () => void;
  onPlaceClick?: (placeId: string) => void;
}

/** Format an ISO date as relative time like "3 days ago" or "2 months ago" */
function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/** Freshness bucket for a date */
function freshnessBucket(iso: string | null): "recent" | "aging" | "stale" | "unknown" {
  if (!iso) return "unknown";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 365) return "recent";
  if (days <= 365 * 2) return "aging";
  return "stale";
}

const FRESHNESS_COLORS: Record<string, string> = {
  recent: "var(--success-text, #16a34a)",
  aging: "var(--warning-text, #d97706)",
  stale: "var(--danger-text, #dc2626)",
  unknown: "var(--foreground-muted, #9ca3af)",
};

const FRESHNESS_LABELS: Record<string, string> = {
  recent: "< 1 year",
  aging: "1-2 years",
  stale: "2+ years",
  unknown: "No data",
};

export function HexDetailPanel({ selection, onClose, onPlaceClick }: HexDetailPanelProps) {
  const { pins } = selection;

  const stats = useMemo(() => {
    let totalCats = 0;
    let totalAltered = 0;
    let activeRequests = 0;
    let needsTrapper = 0;
    let diseaseRisk = 0;
    let watchList = 0;
    const diseaseMap = new Map<string, {
      short_code: string;
      color: string;
      count: number;
      places: { id: string; address: string; positive_cats: number; last_positive: string | null }[];
    }>();
    const pinsByStyle: Record<string, number> = {};
    const freshness = { recent: 0, aging: 0, stale: 0, unknown: 0 };

    // Collect all activity dates (not just alteration)
    const activityDates: { date: string; address: string; placeId: string; type: string }[] = [];

    for (const pin of pins) {
      totalCats += pin.cat_count;
      totalAltered += pin.total_altered || 0;
      activeRequests += pin.active_request_count;
      needsTrapper += pin.needs_trapper_count;
      if (pin.disease_risk) diseaseRisk++;
      if (pin.watch_list) watchList++;

      // Pin style breakdown
      pinsByStyle[pin.pin_style] = (pinsByStyle[pin.pin_style] || 0) + 1;

      // Disease badges — track per-place details
      for (const badge of pin.disease_badges || []) {
        const existing = diseaseMap.get(badge.disease_key);
        if (existing) {
          existing.count += badge.positive_cats;
          existing.places.push({
            id: pin.id,
            address: pin.address,
            positive_cats: badge.positive_cats,
            last_positive: badge.last_positive,
          });
        } else {
          diseaseMap.set(badge.disease_key, {
            short_code: badge.short_code,
            color: badge.color,
            count: badge.positive_cats,
            places: [{
              id: pin.id,
              address: pin.address,
              positive_cats: badge.positive_cats,
              last_positive: badge.last_positive,
            }],
          });
        }
      }

      // Activity: last alteration
      if (pin.last_alteration_at) {
        activityDates.push({
          date: pin.last_alteration_at,
          address: pin.address,
          placeId: pin.id,
          type: "FFR",
        });
      }

      // Freshness
      const bucket = freshnessBucket(pin.last_alteration_at);
      freshness[bucket]++;
    }

    // Sort activities most recent first
    activityDates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const alterationRate = totalCats > 0 ? Math.round((totalAltered / totalCats) * 100) : 0;

    return {
      totalCats,
      totalAltered,
      intactEst: Math.max(totalCats - totalAltered, 0),
      alterationRate,
      activeRequests,
      needsTrapper,
      diseaseRisk,
      watchList,
      diseases: Array.from(diseaseMap.values()),
      pinsByStyle,
      freshness,
      activityDates: activityDates.slice(0, 8),
    };
  }, [pins]);

  // Sort places: most recently active first
  const sortedPlaces = useMemo(() => {
    return [...pins].sort((a, b) => {
      const da = a.last_alteration_at ? new Date(a.last_alteration_at).getTime() : 0;
      const db = b.last_alteration_at ? new Date(b.last_alteration_at).getTime() : 0;
      return db - da;
    });
  }, [pins]);

  const STYLE_LABELS: Record<string, { label: string; color: string }> = {
    disease: { label: "Disease Risk", color: "#dc2626" },
    watch_list: { label: "Watch List", color: "#d97706" },
    active: { label: "Verified", color: "#7c3aed" },
    active_requests: { label: "Active Requests", color: "#2563eb" },
    reference: { label: "Reference", color: "#9ca3af" },
  };

  return (
    <div className="hex-detail-panel">
      {/* Header */}
      <div className="drawer-header">
        <div className="drawer-title">
          <h2>Hex Area Detail</h2>
          <div style={{ fontSize: 13, color: "var(--foreground-muted, #6b7280)", marginTop: 2 }}>
            {pins.length} place{pins.length !== 1 ? "s" : ""} in area
          </div>
        </div>
        <button
          onClick={onClose}
          className="drawer-close-btn"
          title="Close (Esc)"
          aria-label="Close hex detail"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="drawer-body" style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {/* ── Key Stats Grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <StatBox label="Total Cats" value={stats.totalCats} />
          <StatBox label="Altered" value={stats.totalAltered} />
          <StatBox label="Intact (est.)" value={stats.intactEst} />
          <StatBox label="Active Requests" value={stats.activeRequests} accent={stats.activeRequests > 0 ? "#2563eb" : undefined} />
        </div>

        {/* ── Alteration Rate Bar ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, color: "var(--foreground-muted, #6b7280)" }}>
            <span>FFR Progress</span>
            <span style={{ fontWeight: 600, color: "var(--foreground, #111)" }}>{stats.alterationRate}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--border, #e5e7eb)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${stats.alterationRate}%`,
                borderRadius: 4,
                background: stats.alterationRate >= 80 ? "var(--success-text, #16a34a)" : stats.alterationRate >= 50 ? "var(--warning-text, #d97706)" : "var(--danger-text, #dc2626)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>

        {/* ── Alerts ── */}
        {(stats.diseaseRisk > 0 || stats.watchList > 0 || stats.needsTrapper > 0) && (
          <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {stats.diseaseRisk > 0 && <AlertBadge label={`${stats.diseaseRisk} Disease Risk`} color="#dc2626" />}
            {stats.watchList > 0 && <AlertBadge label={`${stats.watchList} Watch List`} color="#d97706" />}
            {stats.needsTrapper > 0 && <AlertBadge label={`${stats.needsTrapper} Needs Trapper`} color="#ea580c" />}
          </div>
        )}

        {/* ── Disease Breakdown (expandable) ── */}
        {stats.diseases.length > 0 && (
          <Section title="Disease Signals">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {stats.diseases.map((d) => (
                <DiseaseRow key={d.short_code} disease={d} onPlaceClick={onPlaceClick} />
              ))}
            </div>
          </Section>
        )}

        {/* ── Pin Status Breakdown ── */}
        <Section title="Pin Breakdown">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(stats.pinsByStyle).map(([style, count]) => {
              const meta = STYLE_LABELS[style] || { label: style, color: "#6b7280" };
              return (
                <span
                  key={style}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    color: "var(--foreground, #111)",
                    background: "var(--background-secondary, #f3f4f6)",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, flexShrink: 0 }} />
                  {meta.label}: {count}
                </span>
              );
            })}
          </div>
        </Section>

        {/* ── Data Freshness ── */}
        <Section title="Data Freshness">
          <div style={{ display: "flex", gap: 8 }}>
            {(["recent", "aging", "stale", "unknown"] as const).map((bucket) => {
              const count = stats.freshness[bucket];
              if (count === 0) return null;
              return (
                <span
                  key={bucket}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    color: FRESHNESS_COLORS[bucket],
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: FRESHNESS_COLORS[bucket], flexShrink: 0 }} />
                  {count} {FRESHNESS_LABELS[bucket]}
                </span>
              );
            })}
          </div>
        </Section>

        {/* ── Recent Activity (clickable) ── */}
        {stats.activityDates.length > 0 && (
          <Section title="Recent Activity">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {stats.activityDates.map((act, i) => (
                <button
                  key={i}
                  onClick={() => onPlaceClick?.(act.placeId)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 12,
                    padding: "6px 8px",
                    border: "none",
                    borderRadius: 6,
                    background: "transparent",
                    cursor: onPlaceClick ? "pointer" : "default",
                    width: "100%",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--background-secondary, #f3f4f6)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span style={{ color: "var(--foreground, #111)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>
                    {act.address.split(",")[0]}
                  </span>
                  <span style={{ color: "var(--foreground-muted, #6b7280)", flexShrink: 0, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                    {act.type} {relativeTime(act.date)}
                    {onPlaceClick && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* ── Places List ── */}
        <PlacesList places={sortedPlaces} onPlaceClick={onPlaceClick} styleLookup={STYLE_LABELS} />

        {/* ── Population Forecast ── */}
        <HexForecastSection pins={pins} />
      </div>
    </div>
  );
}

const PLACES_INITIAL_LIMIT = 5;

function PlacesList({ places, onPlaceClick, styleLookup }: {
  places: AtlasPin[];
  onPlaceClick?: (placeId: string) => void;
  styleLookup: Record<string, { label: string; color: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? places : places.slice(0, PLACES_INITIAL_LIMIT);
  const remaining = places.length - PLACES_INITIAL_LIMIT;

  return (
    <Section title={`Places (${places.length})`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {visible.map((pin) => {
          const styleInfo = styleLookup[pin.pin_style] || { label: pin.pin_style, color: "#6b7280" };
          return (
            <button
              key={pin.id}
              onClick={() => onPlaceClick?.(pin.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                border: "none",
                borderRadius: 6,
                background: "transparent",
                cursor: onPlaceClick ? "pointer" : "default",
                width: "100%",
                textAlign: "left",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--background-secondary, #f3f4f6)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: styleInfo.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pin.display_name || pin.address.split(",")[0]}
                </div>
                <div style={{ fontSize: 11, color: "var(--foreground-muted, #6b7280)" }}>
                  {pin.cat_count} cat{pin.cat_count !== 1 ? "s" : ""}
                  {pin.total_altered > 0 && ` · ${pin.total_altered} altered`}
                  {pin.last_alteration_at && ` · ${relativeTime(pin.last_alteration_at)}`}
                </div>
              </div>
              {onPlaceClick && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--foreground-muted, #9ca3af)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {remaining > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            display: "block",
            width: "100%",
            padding: "8px 0",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--primary, #3b82f6)",
            textAlign: "center",
            marginTop: 4,
          }}
        >
          {expanded ? "Show less" : `Show ${remaining} more place${remaining !== 1 ? "s" : ""}`}
        </button>
      )}
    </Section>
  );
}

/* ── Disease row with expandable place list ── */

interface DiseaseInfo {
  short_code: string;
  color: string;
  count: number;
  places: { id: string; address: string; positive_cats: number; last_positive: string | null }[];
}

function DiseaseRow({ disease, onPlaceClick }: { disease: DiseaseInfo; onPlaceClick?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 8px",
          border: `1px solid ${disease.color}40`,
          borderRadius: 6,
          background: `${disease.color}08`,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          color: disease.color,
          textAlign: "left",
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "rotate(0)" }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span style={{ flex: 1 }}>
          {disease.short_code}: {disease.count} cat{disease.count !== 1 ? "s" : ""}
        </span>
        <span style={{ fontSize: 11, opacity: 0.7 }}>
          {disease.places.length} place{disease.places.length !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <div style={{ marginLeft: 18, marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
          {disease.places.map((place) => (
            <button
              key={place.id}
              onClick={() => onPlaceClick?.(place.id)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                padding: "5px 8px",
                border: "none",
                borderRadius: 4,
                background: "transparent",
                cursor: onPlaceClick ? "pointer" : "default",
                width: "100%",
                textAlign: "left",
                fontSize: 12,
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--background-secondary, #f3f4f6)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--foreground, #111)" }}>
                {place.address.split(",")[0]}
              </span>
              <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4, color: "var(--foreground-muted, #6b7280)", fontSize: 11 }}>
                {place.positive_cats} cat{place.positive_cats !== 1 ? "s" : ""}
                {place.last_positive && ` · ${relativeTime(place.last_positive)}`}
                {onPlaceClick && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Small helper components ── */

function StatBox({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        background: "var(--background-secondary, #f3f4f6)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700, color: accent || "var(--foreground, #111)", lineHeight: 1.2 }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: "var(--foreground-muted, #6b7280)", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function AlertBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        color,
        background: `${color}14`,
        border: `1px solid ${color}30`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
