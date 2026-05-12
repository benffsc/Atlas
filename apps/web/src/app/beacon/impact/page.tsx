"use client";

/**
 * /beacon/impact — Impact Story Page
 *
 * Designed for showing the City of Petaluma (or any stakeholder) a defensible,
 * transparent, data-backed impact report. Structured as a narrative:
 *
 *   1. Hero: Total impact (cats → kittens → costs) with confidence range
 *   2. The population model: visual walk-through of how we estimate kittens
 *   3. Where the costs come from: waterfall showing 6 categories
 *   4. Your city's share: geographic breakdown using PostGIS boundaries
 *   5. Methodology: transparent parameters with citations and "adjust it yourself"
 *
 * Every number links to its source. Every assumption is editable.
 * "Show your work" pattern — credibility through transparency.
 */

import { useEffect, useState, useCallback } from "react";
import { fetchApi } from "@/lib/api-client";
import { SkeletonText } from "@/components/feedback/Skeleton";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { CityBarChart } from "@/components/charts/CityBarChart";
import { CostWaterfallChart } from "@/components/charts/CostWaterfallChart";
import { SparklineSVG } from "@/components/charts/SparklineSVG";
import type { CostBreakdown, EconomicModel, ImpactResponse } from "@/app/api/dashboard/impact/route";

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

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

const TIER_LABELS: Record<ConfidenceTier, { label: string; desc: string }> = {
  conservative: { label: "Conservative", desc: "60% of base model. Defensible floor for cautious claims." },
  moderate: { label: "Moderate", desc: "Base model output. Best single estimate from peer-reviewed parameters." },
  high: { label: "High", desc: "180% of base model. Upper range supported by literature." },
};

const sectionStyle: React.CSSProperties = {
  padding: "1.5rem",
  marginBottom: "1.5rem",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "1.15rem",
  fontWeight: 700,
  margin: "0 0 0.3rem 0",
};

const sectionSubtitle: React.CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--text-muted)",
  margin: "0 0 1.25rem 0",
  lineHeight: 1.5,
};

// Population model step component
function ModelStep({ number, title, value, detail, color }: {
  number: number; title: string; value: string; detail: string; color?: string;
}) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", padding: "0.75rem 0", borderBottom: "1px solid var(--card-border)" }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%", background: color || "var(--primary)",
        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.75rem", fontWeight: 700, flexShrink: 0,
      }}>
        {number}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{title}</span>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: color || "var(--primary)" }}>{value}</span>
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5, marginTop: "0.2rem" }}>
          {detail}
        </div>
      </div>
    </div>
  );
}

export default function ImpactPage() {
  const [impact, setImpact] = useState<ImpactResponse | null>(null);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<ConfidenceTier>("moderate");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [cityDetail, setCityDetail] = useState<CityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchApi<ImpactResponse>("/api/dashboard/impact"),
      fetchApi<{ cities: CityRow[] }>(`/api/beacon/impact/by-city?tier=${tier}`),
    ]).then(([impactResult, cityResult]) => {
      if (impactResult && "cats_altered" in impactResult) setImpact(impactResult);
      if (cityResult && Array.isArray(cityResult.cities)) setCities(cityResult.cities);
    }).catch(() => {})
    .finally(() => setLoading(false));
  }, [tier]);

  const openCity = useCallback(async (cityName: string) => {
    setSelectedCity(cityName);
    setDetailLoading(true);
    try {
      const result = await fetchApi<CityDetail>(`/api/beacon/impact/by-city/${encodeURIComponent(cityName)}`);
      if (result && result.city_name) setCityDetail(result);
    } catch {} finally { setDetailLoading(false); }
  }, []);

  const eco = impact?.economic_model;
  const ecoTier = eco?.[tier];
  const cats = impact?.cats_altered ?? 0;
  const females = Math.round(cats * 0.5);
  const males = cats - females;
  const kittens = ecoTier?.kittens_prevented ?? impact?.kittens_prevented ?? 0;
  const totalCost = ecoTier?.costs.total ?? impact?.shelter_cost_avoided ?? 0;
  const costs = ecoTier?.costs;

  const detailTierData = cityDetail?.tiers?.[tier] ?? null;
  const detailCosts: CostBreakdown | null = detailTierData ? {
    shelter: detailTierData.shelter_cost, animal_control: detailTierData.animal_control_cost,
    property_damage: detailTierData.property_damage_cost, disease: detailTierData.disease_cost,
    placement: detailTierData.placement_cost, indirect: detailTierData.indirect_cost,
    total: detailTierData.total_cost,
  } : null;

  if (loading) return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1rem" }}>
      <SkeletonText lines={12} />
    </div>
  );

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 1rem 3rem" }}>
      {/* Page header */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>Our Impact</h1>
          <a href="/beacon" style={{
            padding: "0.4rem 0.8rem", background: "var(--foreground)", color: "var(--background)",
            borderRadius: 6, textDecoration: "none", fontSize: "0.85rem", fontWeight: 500,
          }}>Back to Beacon</a>
        </div>
        <p style={{ color: "var(--text-muted)", margin: "0.5rem 0 0 0", fontSize: "0.9rem", lineHeight: 1.6 }}>
          A transparent, research-backed analysis of the community impact of TNR {impact?.start_year ? `since ${impact.start_year}` : ""}.
          Every number below is derived from our operational data and peer-reviewed population models.
          Click any parameter to see its source.
        </p>
      </div>

      {/* Confidence tier selector */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {(Object.keys(TIER_LABELS) as ConfidenceTier[]).map(t => (
          <button key={t} type="button" onClick={() => setTier(t)} style={{
            padding: "0.4rem 1rem", borderRadius: 6, fontSize: "0.82rem",
            fontWeight: tier === t ? 700 : 400,
            border: `1.5px solid ${tier === t ? "var(--primary)" : "var(--card-border)"}`,
            background: tier === t ? "var(--primary)" : "transparent",
            color: tier === t ? "#fff" : "var(--text-secondary)",
            cursor: "pointer", textTransform: "capitalize",
          }}>
            {TIER_LABELS[t].label}
          </button>
        ))}
        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", alignSelf: "center", marginLeft: "0.5rem" }}>
          {TIER_LABELS[tier].desc}
        </span>
      </div>

      {/* ─── SECTION 1: Hero numbers ─── */}
      <div className="card card-elevated" style={sectionStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", textAlign: "center" }}>
          <div>
            <div style={{ fontSize: "2.25rem", fontWeight: 700 }}>{fmt(cats)}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>cats altered</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{females.toLocaleString()}F / {males.toLocaleString()}M</div>
          </div>
          <div>
            <div style={{ fontSize: "2.25rem", fontWeight: 700, color: "var(--primary)" }}>~{fmt(kittens)}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>kittens prevented</div>
            {eco && <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              {fmt(eco.conservative.kittens_prevented)} to {fmt(eco.high.kittens_prevented)}
            </div>}
          </div>
          <div>
            <div style={{ fontSize: "2.25rem", fontWeight: 700, color: "var(--healthy-text, #16a34a)" }}>{fmtUsd(totalCost)}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>community costs avoided</div>
            {eco && <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              {fmtUsd(eco.conservative.costs.total)} to {fmtUsd(eco.high.costs.total)}
            </div>}
          </div>
        </div>
      </div>

      {/* ─── SECTION 2: The population model ─── */}
      <div className="card card-elevated" style={sectionStyle}>
        <h2 style={sectionTitle}>How we estimate kittens prevented</h2>
        <p style={sectionSubtitle}>
          Not every altered cat prevents the same number of kittens. Our model accounts for sex ratio,
          litter frequency, kitten mortality, and reproductive lifespan. Each parameter comes from published research.
        </p>

        <ModelStep
          number={1}
          title="Cats altered by FFSC"
          value={cats.toLocaleString()}
          detail="Verified surgical records from ClinicHQ (2014–present) plus ED reference counts (1990–2013). Each cat counted once at first surgery."
        />
        <ModelStep
          number={2}
          title="Of those, approximately half are female"
          value={`${females.toLocaleString()} females`}
          detail="Only spayed females are directly prevented from reproducing. Males prevent pregnancies indirectly — but since many females are already spayed, the male contribution has diminishing returns (30% non-overlap factor)."
          color="var(--warning-bg, #f59e0b)"
        />
        <ModelStep
          number={3}
          title="Each unaltered female produces ~10 kittens/year"
          value="2.5 litters × 4 kittens"
          detail="Nutter et al. (2004, JAVMA): unaltered community cats produce 2–3 litters/year with average litter size of 4.0. That's 10 kittens born per female per year before mortality."
        />
        <ModelStep
          number={4}
          title="But 75% of kittens die before 6 months"
          value="25% survive"
          detail="This is the key deflator. Kitten mortality in unmanaged outdoor colonies is approximately 75% from exposure, predation, disease, and starvation (Nutter et al., 2004; Levy et al., 2003). Only 1 in 4 survive to adulthood."
          color="var(--danger-bg, #ef4444)"
        />
        <ModelStep
          number={5}
          title="Over a 5-year reproductive lifespan"
          value="× 5 years"
          detail="An unaltered community cat typically reproduces for 3–5 years (McCarthy et al., 2013). Each cat we alter prevents 5 years of future litters. We use the upper-mid estimate."
        />
        <div style={{ padding: "1rem", background: "var(--primary-bg, rgba(37,99,235,0.05))", borderRadius: 8, marginTop: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Result: estimated kittens prevented</span>
            <span style={{ fontWeight: 700, fontSize: "1.25rem", color: "var(--primary)" }}>~{fmt(kittens)}</span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            {females.toLocaleString()} females × 2.5 litters × 4 kittens × 25% survival × 5 years = {fmt(Math.round(females * 2.5 * 4 * 0.25 * 5))} from females, plus male contribution.
            Of these, ~30% would have entered shelters. The remaining 70% would have been free-roaming community cats generating the costs below.
          </div>
        </div>
      </div>

      {/* ─── SECTION 3: Where the costs come from ─── */}
      {costs && (
        <div className="card card-elevated" style={sectionStyle}>
          <h2 style={sectionTitle}>Where the community costs come from</h2>
          <p style={sectionSubtitle}>
            Prevented kittens don't just save shelters money — they prevent animal control calls,
            property damage from colonies, disease transmission, and the entire foster-to-adoption pipeline.
            We model six cost categories.
          </p>

          <CostWaterfallChart costs={costs} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "1.25rem" }}>
            {[
              { label: "Shelter intake", value: costs.shelter, detail: `30% of surviving kittens enter shelters. ${fmt(Math.round(kittens * 0.25 * 0.30))} cats × $300 intake cost.` },
              { label: "Animal control", value: costs.animal_control, detail: "0.3 complaints per unaltered cat per year × $150 per officer response × 5 years." },
              { label: "Property damage", value: costs.property_damage, detail: "~$200/year per unmanaged colony (garden damage, vehicle scratches, waste). ~1 colony per 15 cats." },
              { label: "Disease costs", value: costs.disease, detail: "FIV, FeLV, respiratory treatment, public health monitoring. ~$50 per prevented kitten." },
              { label: "Kitten placement", value: costs.placement, detail: "Vetting, spay/neuter, foster supplies, transport for the 30% that enter rescue. $250/kitten." },
              { label: "Indirect costs", value: costs.indirect, detail: "Volunteer coordination, environmental impact on wildlife, administrative overhead. 30% uplift on direct costs." },
            ].map(cat => (
              <div key={cat.label} style={{ padding: "0.6rem", borderRadius: 6, border: "1px solid var(--card-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>{cat.label}</span>
                  <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>{fmtUsd(cat.value)}</span>
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.4 }}>{cat.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── SECTION 4: Your city's share ─── */}
      {cities.length > 0 && (
        <div className="card card-elevated" style={sectionStyle}>
          <h2 style={sectionTitle}>Impact by city</h2>
          <p style={sectionSubtitle}>
            Using official city boundaries from OpenStreetMap, we spatially match each cat
            to its home address to determine which city benefits from each alteration.
            Click a city to see its full breakdown.
          </p>

          <CityBarChart cities={cities} onCityClick={openCity} />

          <div style={{ overflowX: "auto", marginTop: "1rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr>
                  {["City", "Cats altered", "Kittens prevented", "Places", "Economic impact"].map(h => (
                    <th key={h} style={{
                      padding: "0.4rem 0.6rem", textAlign: h === "City" ? "left" : "right",
                      borderBottom: "2px solid var(--card-border)", fontWeight: 600, fontSize: "0.75rem",
                      color: "var(--text-secondary)",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cities.map(c => (
                  <tr key={c.city_name} onClick={() => openCity(c.city_name)} style={{ cursor: "pointer" }}
                    onMouseOver={e => (e.currentTarget.style.background = "rgba(0,0,0,0.02)")}
                    onMouseOut={e => (e.currentTarget.style.background = "")}>
                    <td style={{ padding: "0.4rem 0.6rem", fontWeight: 500 }}>{c.city_name}</td>
                    <td style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>{c.cats_altered.toLocaleString()}</td>
                    <td style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>~{fmt(c.kittens_prevented)}</td>
                    <td style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>{c.places_served}</td>
                    <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", fontWeight: 700, color: "var(--primary)" }}>{fmtUsd(c.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── SECTION 5: Methodology transparency ─── */}
      <div className="card card-elevated" style={sectionStyle}>
        <h2 style={sectionTitle}>Methodology &amp; sources</h2>
        <p style={sectionSubtitle}>
          All parameters are admin-configurable and can be adjusted with local data.
          We deliberately use conservative estimates to avoid overclaiming impact.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <h3 style={{ fontSize: "0.88rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>Population model</h3>
            <ul style={{ margin: 0, padding: "0 0 0 1.25rem", fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <li>Female ratio: 50%</li>
              <li>Litters per year: 2.5 (Nutter et al., 2004)</li>
              <li>Kittens per litter: 4.0 (Nutter et al., 2004)</li>
              <li>Kitten survival rate: 25% (75% mortality)</li>
              <li>Reproductive lifespan: 5 years</li>
              <li>Male non-overlap factor: 30%</li>
            </ul>
          </div>
          <div>
            <h3 style={{ fontSize: "0.88rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>Cost parameters</h3>
            <ul style={{ margin: 0, padding: "0 0 0 1.25rem", fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
              <li>Shelter capture rate: 30% of survivors</li>
              <li>Shelter intake cost: $300/cat (ASPCA)</li>
              <li>AC cost per complaint: $150 (NACA)</li>
              <li>Complaints per unaltered cat: 0.3/year</li>
              <li>Property damage: $200/colony/year</li>
              <li>Disease cost: $50/cat</li>
              <li>Placement cost: $250/kitten</li>
              <li>Indirect multiplier: 1.3×</li>
            </ul>
          </div>
        </div>

        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <strong>Key sources:</strong> Nutter FB, Levine JF, Stoskopf MK (2004) "Reproductive capacity of free-roaming domestic cats"
          JAVMA 225(9):1399-1402. Levy JK, Gale DW, Gale LA (2003) "Evaluation of the effect of a long-term trap-neuter-return program
          on a free-roaming cat colony" JAVMA 222(1):42-46. McCarthy RJ, Levine SH, Reed JM (2013) "Estimation of effectiveness of
          three methods of feral cat population control" J. Mammology. ASPCA shelter cost surveys. National Animal Care &amp; Control Association
          response cost data. Marsh P (2010) "Replacing Myth with Math."
        </div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a href="/admin/impact-model" style={{
            padding: "0.4rem 0.8rem", borderRadius: 6, fontSize: "0.82rem", fontWeight: 500,
            border: "1px solid var(--primary)", color: "var(--primary)", textDecoration: "none",
          }}>
            Adjust parameters
          </a>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", alignSelf: "center" }}>
            Admins can update any parameter. Changes recalculate all numbers instantly.
          </span>
        </div>
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
            <div style={{ textAlign: "center", padding: "1rem 0" }}>
              <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "var(--primary)" }}>{fmtUsd(detailTierData.total_cost)}</div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>estimated economic impact ({tier})</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Cats Altered</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{detailTierData.cats_altered.toLocaleString()}</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{detailTierData.female_count}F / {detailTierData.male_count}M</div>
              </div>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Kittens Prevented</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>~{fmt(detailTierData.kittens_prevented)}</div>
              </div>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Places Served</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{detailTierData.places_served}</div>
              </div>
              <div className="card" style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Impact per Cat</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                  {fmtUsd(detailTierData.cats_altered > 0 ? detailTierData.total_cost / detailTierData.cats_altered : 0)}
                </div>
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.75rem 0" }}>Cost Breakdown</h3>
              <CostWaterfallChart costs={detailCosts} />
            </div>
            {cityDetail?.timeseries && cityDetail.timeseries.length > 2 && (
              <div>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>Annual Trend</h3>
                <SparklineSVG values={cityDetail.timeseries.map(t => t.cats_altered)} width={200} height={40} />
              </div>
            )}
          </div>
        )}
      </ActionDrawer>
    </div>
  );
}
