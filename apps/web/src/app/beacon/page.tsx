"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchApi } from "@/lib/api-client";
import { SeasonalAlertsCard } from "@/components/cards";
import { StatCard } from "@/components/ui/StatCard";
import { YoYComparisonChart } from "@/components/charts";
import { Button } from "@/components/ui/Button";

interface ZoneRollup {
  zone_id: string;
  zone_code: string;
  zone_name: string;
  place_count: number;
  total_cats: number;
  altered_cats: number;
  alteration_rate_pct: number | null;
  zone_status: string;
  active_requests: number;
  alterations_last_90d: number;
  estimated_population: number | null;
}

interface ZonesResponse {
  zones: ZoneRollup[];
  summary: {
    total_zones: number;
    total_places: number;
    total_cats: number;
    total_altered: number;
    alteration_rate_pct: number | null;
    status_breakdown: Record<string, number>;
    total_estimated_population: number;
  };
}

interface CountyRollup {
  county: string;
  zone_count: number;
  place_count: number;
  total_cats: number;
  altered_cats: number;
  alteration_rate_pct: number | null;
  active_requests: number;
  alterations_last_90d: number;
  estimated_population: number;
}

interface CountyRollupResponse {
  counties: CountyRollup[];
  summary: {
    total_counties: number;
    total_places: number;
    total_cats: number;
    total_altered: number;
    alteration_rate_pct: number | null;
  };
}

interface DateFilteredPlace {
  place_id: string;
  formatted_address: string;
  display_name: string | null;
  lat: number;
  lng: number;
  service_zone: string | null;
  cat_count: number;
  altered_count: number;
  alteration_rate_pct: number | null;
  colony_status: string;
}

interface DateFilteredSummary {
  total_places: number;
  total_cats: number;
  total_altered: number;
  alteration_rate_pct: number | null;
  status_breakdown: Record<string, number>;
}

interface BeaconSummaryResponse {
  summary: {
    total_cats: number;
    total_places: number;
    places_with_cats: number;
    total_verified_cats: number;
    total_altered_cats: number;
    overall_alteration_rate: number | null;
    known_status_cats: number;
    unknown_status_cats: number;
    colonies_managed: number;
    colonies_in_progress: number;
    colonies_needs_work: number;
    colonies_needs_attention: number;
    colonies_no_data: number;
    total_clusters: number;
    places_in_clusters: number;
    isolated_places: number;
    clusters_managed: number;
    clusters_in_progress: number;
    clusters_needs_work: number;
    clusters_needs_attention: number;
    estimated_cats_to_alter: number | null;
  };
  insights: {
    managed_percentage: number;
    cluster_management_rate: number;
    tnr_target_rate: number;
    progress_to_target: number | null;
  };
}

export default function BeaconPage() {
  const [data, setData] = useState<BeaconSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [zones, setZones] = useState<ZonesResponse | null>(null);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [countyData, setCountyData] = useState<CountyRollupResponse | null>(null);
  const [countyLoading, setCountyLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateFiltered, setDateFiltered] = useState<DateFilteredSummary | null>(null);
  const [dateFilteredPlaces, setDateFilteredPlaces] = useState<DateFilteredPlace[]>([]);
  const [dateFilterLoading, setDateFilterLoading] = useState(false);

  useEffect(() => {
    fetchApi<BeaconSummaryResponse>("/api/beacon/summary")
      .then((data) => setData({ summary: data.summary, insights: data.insights }))
      .catch(() => null)
      .finally(() => setLoading(false));

    fetchApi<ZonesResponse>("/api/beacon/zones")
      .then(setZones)
      .catch(() => null)
      .finally(() => setZonesLoading(false));

    fetchApi<CountyRollupResponse>("/api/beacon/county-rollup")
      .then(setCountyData)
      .catch(() => null)
      .finally(() => setCountyLoading(false));
  }, []);

  const applyDateFilter = useCallback(() => {
    if (!dateFrom && !dateTo) {
      setDateFiltered(null);
      setDateFilteredPlaces([]);
      return;
    }
    setDateFilterLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    fetchApi<{ places: DateFilteredPlace[]; summary: DateFilteredSummary }>(`/api/beacon/map?${params}`)
      .then((d) => {
        setDateFiltered(d.summary);
        setDateFilteredPlaces(d.places || []);
      })
      .catch(() => null)
      .finally(() => setDateFilterLoading(false));
  }, [dateFrom, dateTo]);

  const summary = data?.summary;
  const insights = data?.insights;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>
            Beacon
          </h1>
          <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0 0" }}>
            Ecological analytics and TNR impact assessment
          </p>
        </div>
        <a
          href="/map"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            background: "var(--foreground)",
            color: "var(--background)",
            borderRadius: "6px",
            textDecoration: "none",
            fontSize: "0.9rem",
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          Open Atlas Map
        </a>
      </div>

      {/* Summary Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <StatCard
          value={loading ? "-" : summary?.places_with_cats?.toLocaleString() || "0"}
          label="Active Colonies"
          valueColor="var(--text-secondary)"
        />
        <StatCard
          value={loading ? "-" : summary?.total_verified_cats?.toLocaleString() || "0"}
          label="Verified Cats"
          valueColor="#8b5cf6"  // purple — no direct CSS variable
        />
        <StatCard
          value={loading ? "-" : summary?.total_altered_cats?.toLocaleString() || "0"}
          label="Cats Altered"
          valueColor="var(--healthy-text)"
        />
        <StatCard
          value={
            loading
              ? "-"
              : summary?.overall_alteration_rate
              ? `${Math.round(summary.overall_alteration_rate)}%`
              : "0%"
          }
          label={
            summary?.unknown_status_cats && summary.unknown_status_cats > (summary?.known_status_cats || 0)
              ? `Alteration Rate (of ${(summary?.known_status_cats || 0).toLocaleString()} known)`
              : "Alteration Rate"
          }
          valueColor={
            summary?.overall_alteration_rate && summary.overall_alteration_rate >= 70
              ? "var(--healthy-text)"
              : summary?.overall_alteration_rate && summary.overall_alteration_rate >= 50
              ? "var(--caution-text)"
              : "var(--critical-text)"
          }
        />
        <StatCard
          value={loading ? "-" : (summary?.clusters_needs_attention || 0).toString()}
          label="Needs Attention"
          valueColor="var(--critical-text)"
        />
      </div>

      {/* Quick Info */}
      <div
        className="card card-elevated"
        style={{
          padding: "1.5rem",
          marginBottom: "2rem",
          background: "linear-gradient(135deg, var(--healthy-bg) 0%, var(--success-bg) 100%)",
          border: "1px solid var(--healthy-border)",
        }}
      >
        <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.125rem", color: "var(--healthy-text)" }}>
          About Beacon
        </h2>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--healthy-text)", lineHeight: 1.6 }}>
          Beacon tracks ecological metrics across TNR sites to measure impact and identify areas needing attention.
          Colony estimates are derived from intake forms, trapper observations, and post-clinic surveys.
          The <strong>70% alteration threshold</strong> is the scientifically-supported target for population stabilization
          (Levy et al., 2014; McCarthy et al., 2013).
        </p>
      </div>

      {/* Date Range Filter */}
      <div
        className="card card-elevated"
        style={{ padding: "1.25rem", marginBottom: "2rem" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Date Filter</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{
              padding: "0.4rem 0.6rem",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              fontSize: "0.85rem",
            }}
          />
          <span style={{ color: "var(--text-muted)" }}>to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{
              padding: "0.4rem 0.6rem",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              fontSize: "0.85rem",
            }}
          />
          <Button
            onClick={applyDateFilter}
            loading={dateFilterLoading}
            variant="primary"
            size="sm"
          >
            Apply
          </Button>
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); setDateFiltered(null); setDateFilteredPlaces([]); }}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "transparent",
                cursor: "pointer",
                fontSize: "0.85rem",
                color: "var(--text-muted)",
              }}
            >
              Clear
            </button>
          )}
        </div>
        {dateFiltered && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "0.75rem",
              marginTop: "1rem",
              paddingTop: "1rem",
              borderTop: "1px solid var(--border)",
            }}
          >
            <MiniStat label="Places" value={dateFiltered.total_places} />
            <MiniStat label="Cats Seen" value={dateFiltered.total_cats} />
            <MiniStat label="Altered" value={dateFiltered.total_altered} />
            <MiniStat
              label="Alteration Rate"
              value={dateFiltered.alteration_rate_pct !== null ? `${dateFiltered.alteration_rate_pct}%` : "N/A"}
            />
            <MiniStat label="Managed" value={dateFiltered.status_breakdown?.managed || 0} />
            <MiniStat
              label="Needs Attention"
              value={dateFiltered.status_breakdown?.needs_attention || 0}
              color="var(--critical-text)"
            />
          </div>
        )}

        {/* Date-Filtered Map */}
        {dateFilteredPlaces.length > 0 && (
          <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                Filtered Map ({dateFilteredPlaces.length} sites)
              </span>
              <span style={{
                display: "inline-block",
                padding: "0.1rem 0.5rem",
                borderRadius: "9999px",
                fontSize: "0.7rem",
                fontWeight: 500,
                background: "var(--primary-bg, #dbeafe)",
                color: "var(--primary, #3b82f6)",
              }}>
                {dateFrom || "start"} — {dateTo || "now"}
              </span>
            </div>
            <DateFilteredMap places={dateFilteredPlaces} />
          </div>
        )}
      </div>

      {/* County-Level Rollup */}
      {!countyLoading && countyData && countyData.counties.length > 0 && (
        <div
          className="card card-elevated"
          style={{
            padding: "1.25rem",
            marginBottom: "2rem",
            background: "linear-gradient(135deg, var(--info-bg) 0%, var(--primary-bg, #dbeafe) 100%)",
            border: "1px solid var(--info-border)",
          }}
        >
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem", fontWeight: 600, color: "var(--info-text)" }}>
            County Impact Overview
          </h2>
          {/* Summary totals */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "1rem",
            marginBottom: "1rem",
            paddingBottom: "1rem",
            borderBottom: "1px solid color-mix(in srgb, var(--info-border) 25%, transparent)",
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--info-text)" }}>
                {countyData.summary.total_places.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--primary, #3b82f6)" }}>Active Sites</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#7c3aed" }}> {/* purple — no direct CSS var */}
                {countyData.summary.total_cats.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#8b5cf6" }}>Total Cats</div> {/* purple — no direct CSS var */}
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--healthy-text)" }}>
                {countyData.summary.total_altered.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--healthy-text)" }}>Altered</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{
                fontSize: "1.5rem", fontWeight: 700,
                color: countyData.summary.alteration_rate_pct !== null && countyData.summary.alteration_rate_pct >= 70
                  ? "var(--healthy-text)"
                  : countyData.summary.alteration_rate_pct !== null && countyData.summary.alteration_rate_pct >= 50
                  ? "var(--caution-text)"
                  : "var(--critical-text)",
              }}>
                {countyData.summary.alteration_rate_pct !== null ? `${countyData.summary.alteration_rate_pct}%` : "—"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Overall Rate</div>
            </div>
          </div>
          {/* Per-county breakdown */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {countyData.counties
              .filter(c => c.total_cats > 0)
              .map(c => {
                const rate = c.alteration_rate_pct ?? 0;
                const barColor = rate >= 75 ? "var(--healthy-text)" : rate >= 50 ? "var(--caution-text)" : "var(--critical-text)";
                return (
                  <div key={c.county} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ width: "100px", fontSize: "0.85rem", fontWeight: 600, color: "var(--info-text)", flexShrink: 0 }}>
                      {c.county}
                    </div>
                    <div style={{
                      flex: 1, height: "22px", background: "rgba(255,255,255,0.6)",
                      borderRadius: "4px", overflow: "hidden", position: "relative",
                    }}>
                      <div style={{
                        height: "100%", width: `${Math.min(rate, 100)}%`,
                        background: barColor, borderRadius: "4px",
                        transition: "width 0.5s ease",
                      }} />
                      <div style={{
                        position: "absolute", top: 0, bottom: 0, left: "75%",
                        borderLeft: "2px dashed rgba(0,0,0,0.2)",
                      }} />
                    </div>
                    <div style={{ width: "45px", textAlign: "right", fontSize: "0.85rem", fontWeight: 700, color: barColor, flexShrink: 0 }}>
                      {rate}%
                    </div>
                    <div style={{ width: "80px", fontSize: "0.7rem", color: "var(--primary, #3b82f6)", textAlign: "right", flexShrink: 0 }}>
                      {c.total_cats} cats
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Zone-level summary fallback (shows while county data loads or if county view not available) */}
      {!countyLoading && !countyData && !zonesLoading && zones?.summary && (
        <div
          className="card card-elevated"
          style={{
            padding: "1.25rem",
            marginBottom: "2rem",
            background: "linear-gradient(135deg, var(--info-bg) 0%, var(--primary-bg, #dbeafe) 100%)",
            border: "1px solid var(--info-border)",
          }}
        >
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem", fontWeight: 600, color: "var(--info-text)" }}>
            Service Area Overview
          </h2>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "1rem",
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--info-text)" }}>
                {zones.summary.total_places.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--primary, #3b82f6)" }}>Active Sites</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#7c3aed" }}> {/* purple — no direct CSS var */}
                {zones.summary.total_cats.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#8b5cf6" }}>Total Cats</div> {/* purple — no direct CSS var */}
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--healthy-text)" }}>
                {zones.summary.total_altered.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--healthy-text)" }}>Altered</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{
                fontSize: "1.5rem", fontWeight: 700,
                color: zones.summary.alteration_rate_pct !== null && zones.summary.alteration_rate_pct >= 70
                  ? "var(--healthy-text)"
                  : zones.summary.alteration_rate_pct !== null && zones.summary.alteration_rate_pct >= 50
                  ? "var(--caution-text)"
                  : "var(--critical-text)",
              }}>
                {zones.summary.alteration_rate_pct !== null ? `${zones.summary.alteration_rate_pct}%` : "—"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Overall Rate</div>
            </div>
          </div>
        </div>
      )}

      {/* Zone Rollups */}
      {!zonesLoading && zones && zones.zones.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
            Zone TNR Progress
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.85rem",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Zone</th>
                  <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Places</th>
                  <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Cats</th>
                  <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Altered</th>
                  <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Rate</th>
                  <th style={{ textAlign: "center", padding: "0.5rem 0.75rem" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>90d Alts</th>
                  <th style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>Active Reqs</th>
                </tr>
              </thead>
              <tbody>
                {zones.zones.map((z) => (
                  <tr key={z.zone_id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.5rem 0.75rem", fontWeight: 500 }}>
                      {z.zone_name || z.zone_code}
                    </td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{z.place_count}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{z.total_cats}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{z.altered_cats}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>
                      {z.alteration_rate_pct !== null ? `${z.alteration_rate_pct}%` : "—"}
                    </td>
                    <td style={{ textAlign: "center", padding: "0.5rem 0.75rem" }}>
                      <ZoneStatusBadge status={z.zone_status} />
                    </td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{z.alterations_last_90d}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{z.active_requests}</td>
                  </tr>
                ))}
              </tbody>
              {zones.summary && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 600 }}>
                    <td style={{ padding: "0.5rem 0.75rem" }}>Total</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{zones.summary.total_places}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{zones.summary.total_cats}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>{zones.summary.total_altered}</td>
                    <td style={{ textAlign: "right", padding: "0.5rem 0.75rem" }}>
                      {zones.summary.alteration_rate_pct !== null ? `${zones.summary.alteration_rate_pct}%` : "—"}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Seasonal Alerts Section */}
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          Seasonal Status & Alerts
        </h2>
        <SeasonalAlertsCard />
      </div>

      {/* Year-over-Year Trends Section */}
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          Year-over-Year Trends
        </h2>
        <YoYComparisonChart />
      </div>

      {/* Analytics Sections */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1.5rem",
        }}
      >
        <AnalyticsCard
          title="Colony Estimates"
          description="Place-by-place colony size estimates with confidence scores"
          href="/admin/beacon/colony-estimates"
          icon="🐱"
          stats={
            loading
              ? undefined
              : `${summary?.places_with_cats || 0} active colonies`
          }
        />
        <AnalyticsCard
          title="Cluster Analysis"
          description="Geographic clustering of colonies for coordinated TNR"
          href="/api/beacon/clusters"
          icon="📍"
          stats={
            loading
              ? undefined
              : `${summary?.total_clusters || 0} clusters identified`
          }
        />
        <AnalyticsCard
          title="Reproduction Events"
          description="Pregnancy, lactation, and kitten observations"
          href="/admin/beacon/reproduction"
          icon="🍼"
        />
        <AnalyticsCard
          title="Mortality Tracking"
          description="Death events and causes for population modeling"
          href="/admin/beacon/mortality"
          icon="📉"
        />
        <AnalyticsCard
          title="Seasonal Patterns"
          description="Monthly trends in intake, alterations, and births"
          href="/admin/beacon/seasonal"
          icon="📅"
        />
        <AnalyticsCard
          title="Location Comparison"
          description="Side-by-side TNR metrics for up to 10 locations"
          href="/beacon/compare"
          icon="📊"
        />
        <AnalyticsCard
          title="Population Forecasts"
          description="10-year population projections and TNR impact scenarios"
          href="/beacon/scenarios"
          icon="📈"
        />
      </div>

      {/* Scientific Context */}
      <div
        className="card card-elevated"
        style={{
          padding: "1.5rem",
          marginTop: "2rem",
        }}
      >
        <h3 style={{ margin: "0 0 1rem 0", fontSize: "1rem" }}>Scientific Context</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "1rem",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
          }}
        >
          <div>
            <strong style={{ color: "var(--text)" }}>70% Alteration Target</strong>
            <p style={{ margin: "0.25rem 0 0 0" }}>
              Research indicates 70% sterilization coverage is needed to achieve population stabilization
              in free-roaming cat colonies (Levy et al., 2014).
            </p>
          </div>
          <div>
            <strong style={{ color: "var(--text)" }}>Lower-Bound Estimates</strong>
            <p style={{ margin: "0.25rem 0 0 0" }}>
              Beacon reports conservative "at least" counts based on verified clinic records,
              acknowledging uncertainty in true population sizes.
            </p>
          </div>
          <div>
            <strong style={{ color: "var(--text)" }}>Data Sources</strong>
            <p style={{ margin: "0.25rem 0 0 0" }}>
              Colony estimates are weighted by source reliability: clinic records (100%),
              post-surgery surveys (85%), trapper observations (80%), intake forms (55%).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


function AnalyticsCard({
  title,
  description,
  href,
  icon,
  stats,
}: {
  title: string;
  description: string;
  href: string;
  icon: string;
  stats?: string;
}) {
  return (
    <a
      href={href}
      className="card card-elevated"
      style={{
        padding: "1.25rem",
        textDecoration: "none",
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.5rem" }}>{icon}</span>
        <div style={{ fontWeight: 600, fontSize: "1rem" }}>{title}</div>
      </div>
      <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
        {description}
      </div>
      {stats && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--primary, #3b82f6)",
            marginTop: "auto",
            paddingTop: "0.5rem",
          }}
        >
          {stats}
        </div>
      )}
    </a>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: color || "var(--text)" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  managed: { bg: "var(--healthy-bg)", text: "var(--healthy-text)", label: "Managed" },
  in_progress: { bg: "var(--caution-bg)", text: "var(--caution-text)", label: "In Progress" },
  needs_work: { bg: "var(--warning-bg)", text: "#9a3412", label: "Needs Work" },      // amber-dark, no exact var
  needs_attention: { bg: "var(--critical-bg)", text: "var(--critical-text)", label: "Needs Attention" },
  no_data: { bg: "var(--bg-secondary)", text: "var(--text-secondary)", label: "No Data" },
};

function ZoneStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_COLORS[status] || STATUS_COLORS.no_data;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 500,
        background: cfg.bg,
        color: cfg.text,
      }}
    >
      {cfg.label}
    </span>
  );
}

/** Lightweight inline map for date-filtered beacon places (no Leaflet dependency — uses canvas) */
function DateFilteredMap({ places }: { places: DateFilteredPlace[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || places.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    // Compute bounds from data
    const lats = places.map(p => p.lat).filter(Boolean);
    const lngs = places.map(p => p.lng).filter(Boolean);
    if (lats.length === 0) return;

    const minLat = Math.min(...lats) - 0.02;
    const maxLat = Math.max(...lats) + 0.02;
    const minLng = Math.min(...lngs) - 0.02;
    const maxLng = Math.max(...lngs) + 0.02;

    const toX = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * (w - 20) + 10;
    const toY = (lat: number) => ((maxLat - lat) / (maxLat - minLat)) * (h - 20) + 10;

    // Background — canvas can't use CSS vars; using equivalent of var(--surface-1)
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, w, h);

    // Draw places — canvas can't use CSS vars; hex values mirror design tokens
    places.forEach(p => {
      if (!p.lat || !p.lng) return;
      const x = toX(p.lng);
      const y = toY(p.lat);
      const radius = Math.min(Math.max(p.cat_count * 0.5, 3), 12);

      // Colors mirror: healthy-text / caution-text / priority-high / critical-text / text-secondary
      const color = p.colony_status === "managed" ? "#16a34a"
        : p.colony_status === "in_progress" ? "#f59e0b"
        : p.colony_status === "needs_work" ? "#ea580c"
        : p.colony_status === "needs_attention" ? "#dc2626"
        : "#9ca3af";

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color + "cc";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }, [places]);

  if (places.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "200px",
        borderRadius: "6px",
        border: "1px solid var(--border)",
      }}
    />
  );
}
