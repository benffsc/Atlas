"use client";

/**
 * /beacon/impact — Geographic Impact Dashboard
 *
 * Shows economic impact broken down by city:
 *   - City ranking table (sortable)
 *   - Comparison bar chart
 *   - City deep-dive drawer (hero stat + cost waterfall + sparkline)
 *   - Persistent confidence tier toggle
 *
 * Data: /api/beacon/impact/by-city, /api/beacon/impact/by-city/[cityName]
 */

import { useEffect, useState, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import { SkeletonTable } from "@/components/feedback/Skeleton";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { CityBarChart } from "@/components/charts/CityBarChart";
import { CostWaterfallChart } from "@/components/charts/CostWaterfallChart";
import { SparklineSVG } from "@/components/charts/SparklineSVG";
import type { CostBreakdown } from "@/app/api/dashboard/impact/route";

type ConfidenceTier = "conservative" | "moderate" | "high";

interface CityRow {
  city_name: string;
  cats_altered: number;
  female_count: number;
  male_count: number;
  places_served: number;
  kittens_prevented: number;
  shelter_cost: number;
  animal_control_cost: number;
  property_damage_cost: number;
  disease_cost: number;
  placement_cost: number;
  indirect_cost: number;
  total_cost: number;
}

interface CityDetail {
  city_name: string;
  tiers: Record<string, CityRow>;
  timeseries: Array<{
    period: string;
    cats_altered: number;
    kittens_prevented_moderate: number;
    total_cost_moderate: number;
  }>;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

type SortKey = "city_name" | "cats_altered" | "total_cost" | "places_served" | "kittens_prevented";

export default function ImpactPage() {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<ConfidenceTier>("moderate");
  const [sortKey, setSortKey] = useState<SortKey>("total_cost");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [cityDetail, setCityDetail] = useState<CityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchApi<{ cities: CityRow[] }>(`/api/beacon/impact/by-city?tier=${tier}`)
      .then((result) => {
        if (result && Array.isArray(result.cities)) {
          setCities(result.cities);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tier]);

  const openCity = useCallback(async (cityName: string) => {
    setSelectedCity(cityName);
    setDetailLoading(true);
    try {
      const result = await fetchApi<CityDetail>(`/api/beacon/impact/by-city/${encodeURIComponent(cityName)}`);
      if (result && result.city_name) {
        setCityDetail(result);
      }
    } catch {}
    finally { setDetailLoading(false); }
  }, []);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sorted = [...cities].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    if (typeof av === "string" && typeof bv === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  const orgTotal = cities.reduce((s, c) => s + c.total_cost, 0);
  const orgCats = cities.reduce((s, c) => s + c.cats_altered, 0);
  const orgKittens = cities.reduce((s, c) => s + c.kittens_prevented, 0);

  // City detail data for drawer
  const detailTierData = cityDetail?.tiers?.[tier] ?? null;
  const detailCosts: CostBreakdown | null = detailTierData ? {
    shelter: detailTierData.shelter_cost,
    animal_control: detailTierData.animal_control_cost,
    property_damage: detailTierData.property_damage_cost,
    disease: detailTierData.disease_cost,
    placement: detailTierData.placement_cost,
    indirect: detailTierData.indirect_cost,
    total: detailTierData.total_cost,
  } : null;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>
            Geographic Impact
          </h1>
          <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0 0" }}>
            Economic impact of TNR by city — powered by PostGIS spatial analysis
          </p>
        </div>
        <a
          href="/beacon"
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            padding: "0.5rem 1rem", background: "var(--foreground)", color: "var(--background)",
            borderRadius: "6px", textDecoration: "none", fontSize: "0.9rem", fontWeight: 500,
          }}
        >
          Back to Beacon
        </a>
      </div>

      {/* Org-wide summary + confidence toggle */}
      <div className="card card-elevated" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>Overall Impact</h2>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {(["conservative", "moderate", "high"] as ConfidenceTier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                style={{
                  padding: "0.25rem 0.7rem",
                  borderRadius: 4,
                  fontSize: "0.75rem",
                  fontWeight: tier === t ? 700 : 400,
                  border: `1px solid ${tier === t ? "var(--primary)" : "var(--card-border)"}`,
                  background: tier === t ? "var(--primary)" : "transparent",
                  color: tier === t ? "#fff" : "var(--text-secondary)",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Total Economic Impact
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--primary)" }}>
              {formatCurrency(orgTotal)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Cats Altered
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--foreground)" }}>
              {formatNumber(orgCats)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Kittens Prevented
            </div>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--foreground)" }}>
              ~{formatNumber(orgKittens)}
            </div>
          </div>
        </div>
      </div>

      {/* Bar chart */}
      {!loading && cities.length > 0 && (
        <div className="card card-elevated" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 600 }}>
            Impact by City ({tier})
          </h2>
          <CityBarChart cities={sorted} onCityClick={openCity} />
        </div>
      )}

      {/* City ranking table */}
      <div className="card card-elevated" style={{ padding: "1.25rem" }}>
        <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 600 }}>City Rankings</h2>
        {loading ? (
          <SkeletonTable rows={5} columns={5} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  {[
                    { key: "city_name" as SortKey, label: "City" },
                    { key: "cats_altered" as SortKey, label: "Cats Altered" },
                    { key: "kittens_prevented" as SortKey, label: "Kittens Prevented" },
                    { key: "places_served" as SortKey, label: "Places" },
                    { key: "total_cost" as SortKey, label: "Economic Impact" },
                  ].map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        padding: "0.5rem 0.75rem",
                        textAlign: col.key === "city_name" ? "left" : "right",
                        borderBottom: "2px solid var(--card-border)",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "0.78rem",
                        color: sortKey === col.key ? "var(--primary)" : "var(--text-secondary)",
                        userSelect: "none",
                      }}
                    >
                      {col.label} {sortKey === col.key && (sortAsc ? "↑" : "↓")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((city) => (
                  <tr
                    key={city.city_name}
                    onClick={() => openCity(city.city_name)}
                    style={{ cursor: "pointer" }}
                    onMouseOver={(e) => (e.currentTarget.style.background = "var(--card-bg-hover, rgba(0,0,0,0.02))")}
                    onMouseOut={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ padding: "0.5rem 0.75rem", fontWeight: 500 }}>{city.city_name}</td>
                    <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>{city.cats_altered.toLocaleString()}</td>
                    <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>~{formatNumber(city.kittens_prevented)}</td>
                    <td style={{ padding: "0.5rem 0.75rem", textAlign: "right" }}>{city.places_served}</td>
                    <td style={{ padding: "0.5rem 0.75rem", textAlign: "right", fontWeight: 700, color: "var(--primary)" }}>
                      {formatCurrency(city.total_cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* City deep-dive drawer */}
      <ActionDrawer
        isOpen={selectedCity !== null}
        onClose={() => { setSelectedCity(null); setCityDetail(null); }}
        title={selectedCity ? `${selectedCity} — Impact Detail` : ""}
        width="lg"
      >
        {detailLoading && <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>}
        {detailTierData && detailCosts && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* Hero stat */}
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "var(--primary)" }}>
                {formatCurrency(detailTierData.total_cost)}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                estimated economic impact ({tier})
              </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Cats Altered</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{detailTierData.cats_altered.toLocaleString()}</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{detailTierData.female_count}F / {detailTierData.male_count}M</div>
              </div>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Kittens Prevented</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>~{formatNumber(detailTierData.kittens_prevented)}</div>
              </div>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Places Served</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{detailTierData.places_served}</div>
              </div>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Cost per Cat</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                  {formatCurrency(detailTierData.cats_altered > 0 ? detailTierData.total_cost / detailTierData.cats_altered : 0)}
                </div>
              </div>
            </div>

            {/* Cost waterfall */}
            <div>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.75rem 0" }}>Cost Breakdown</h3>
              <CostWaterfallChart costs={detailCosts} />
            </div>

            {/* Timeseries sparkline */}
            {cityDetail?.timeseries && cityDetail.timeseries.length > 2 && (
              <div>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>Annual Trend</h3>
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <SparklineSVG
                    values={cityDetail.timeseries.map(t => t.cats_altered)}
                    width={120}
                    height={30}
                  />
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    {cityDetail.timeseries.length} years of data
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </ActionDrawer>
    </div>
  );
}
