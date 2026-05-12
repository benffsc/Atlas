"use client";

/**
 * /beacon/impact — Interactive Impact Report
 *
 * The UI version of the Petaluma email Tippy generated. Designed to show
 * a city official "What is FFSC worth to your city?" with:
 *
 *   1. City picker + year range → scoped data
 *   2. Big number hero with confidence toggle
 *   3. Three-layer model: kittens → shelter costs → indirect costs
 *   4. Adjustable parameters (sliders) that recompute in real-time
 *   5. ROI framing: "$1 invested → $X saved"
 *   6. Year-by-year data table
 *   7. Transparent methodology with citations
 *
 * Pattern: charity:water (label above number, progressive disclosure),
 * GiveDirectly (confidence ranges), Flourish (scroll-to-reveal narrative)
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { fetchApi } from "@/lib/api-client";
import { SkeletonText } from "@/components/feedback/Skeleton";
import { CostWaterfallChart } from "@/components/charts/CostWaterfallChart";
import { SparklineSVG } from "@/components/charts/SparklineSVG";
import type { CostBreakdown } from "@/app/api/dashboard/impact/route";

// ─── Types ──────────────────────────────────────────────────────────────────

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
    female_count: number;
    male_count: number;
    kittens_prevented_moderate: number;
    total_cost_moderate: number;
  }>;
}

type Tier = "conservative" | "moderate" | "high";

// ─── Model parameters (adjustable) ─────────────────────────────────────────

interface ModelParams {
  littersPerYear: number;
  kittensPerLitter: number;
  kittenSurvivalRate: number;
  shelterCaptureRate: number;
  shelterCostPerCat: number;
  acCostPerCall: number;
  complaintsPerCatYear: number;
  propertyDamagePerColonyYear: number;
  diseaseCostPerCat: number;
  placementCostPerKitten: number;
  indirectMultiplier: number;
  tnrCostPerCat: number;
}

const DEFAULT_PARAMS: ModelParams = {
  littersPerYear: 1.4,
  kittensPerLitter: 3.4,
  kittenSurvivalRate: 0.25,
  shelterCaptureRate: 0.40,
  shelterCostPerCat: 350,
  acCostPerCall: 120,
  complaintsPerCatYear: 0.3,
  propertyDamagePerColonyYear: 200,
  diseaseCostPerCat: 50,
  placementCostPerKitten: 250,
  indirectMultiplier: 1.3,
  tnrCostPerCat: 68,
};

// ─── Compute model from params ──────────────────────────────────────────────

interface ModelResult {
  kittensPreventedPerYear: number;
  kittensToShelter: number;
  layer1_shelterCost: number;
  layer2_acCost: number;
  layer2_propertyCost: number;
  layer2_diseaseCost: number;
  layer2_placementCost: number;
  layer3_indirect: number;
  totalAnnual: number;
  totalCumulative: number;
  tnrCost: number;
  roi: number;
}

function computeModel(femalesPerYear: number, totalCatsPerYear: number, years: number, params: ModelParams): ModelResult {
  const kppy = femalesPerYear * params.littersPerYear * params.kittensPerLitter;
  const survivingKittens = kppy * params.kittenSurvivalRate;
  const kittensToShelter = survivingKittens * params.shelterCaptureRate;

  const layer1 = kittensToShelter * params.shelterCostPerCat;
  const acCalls = totalCatsPerYear * params.complaintsPerCatYear;
  const layer2_ac = acCalls * params.acCostPerCall;
  const colonies = totalCatsPerYear / 15;
  const layer2_prop = colonies * params.propertyDamagePerColonyYear;
  const layer2_disease = survivingKittens * params.diseaseCostPerCat;
  const layer2_placement = kittensToShelter * params.placementCostPerKitten;
  const directTotal = layer1 + layer2_ac + layer2_prop + layer2_disease + layer2_placement;
  const layer3 = directTotal * (params.indirectMultiplier - 1);
  const totalAnnual = directTotal + layer3;
  const totalCumulative = totalAnnual * years;
  const tnrCost = totalCatsPerYear * params.tnrCostPerCat * years;
  const roi = tnrCost > 0 ? totalCumulative / tnrCost : 0;

  return {
    kittensPreventedPerYear: Math.round(kppy),
    kittensToShelter: Math.round(kittensToShelter),
    layer1_shelterCost: Math.round(layer1),
    layer2_acCost: Math.round(layer2_ac),
    layer2_propertyCost: Math.round(layer2_prop),
    layer2_diseaseCost: Math.round(layer2_disease),
    layer2_placementCost: Math.round(layer2_placement),
    layer3_indirect: Math.round(layer3),
    totalAnnual: Math.round(totalAnnual),
    totalCumulative: Math.round(totalCumulative),
    tnrCost: Math.round(tnrCost),
    roi: Math.round(roi * 10) / 10,
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

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

// ─── Slider component ───────────────────────────────────────────────────────

function ParamSlider({ label, value, onChange, min, max, step, suffix, detail }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; suffix?: string; detail?: string;
}) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: "0.2rem" }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ fontWeight: 700, color: "var(--primary)" }}>
          {suffix === "$" ? `$${value}` : suffix === "×" ? `${value}×` : suffix === "%" ? `${Math.round(value * 100)}%` : value}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--primary)", height: "4px" }} />
      {detail && <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>{detail}</div>}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function ImpactPage() {
  const [cities, setCities] = useState<CityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCity, setSelectedCity] = useState<string>("all");
  const [cityDetail, setCityDetail] = useState<CityDetail | null>(null);
  const [params, setParams] = useState<ModelParams>(DEFAULT_PARAMS);
  const [showParams, setShowParams] = useState(false);
  const [tier, setTier] = useState<Tier>("moderate");

  // Load all cities
  useEffect(() => {
    setLoading(true);
    fetchApi<{ cities: CityRow[] }>("/api/beacon/impact/by-city?tier=moderate")
      .then(r => { if (r?.cities) setCities(r.cities); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Load city detail when selection changes
  useEffect(() => {
    if (selectedCity === "all") { setCityDetail(null); return; }
    fetchApi<CityDetail>(`/api/beacon/impact/by-city/${encodeURIComponent(selectedCity)}`)
      .then(r => { if (r?.city_name) setCityDetail(r); })
      .catch(() => {});
  }, [selectedCity]);

  // Compute from either selected city or org-wide totals
  const orgTotal = cities.reduce((s, c) => s + c.cats_altered, 0);
  const orgFemales = cities.reduce((s, c) => s + c.female_count, 0);
  const orgMales = cities.reduce((s, c) => s + c.male_count, 0);
  const orgPlaces = cities.reduce((s, c) => s + c.places_served, 0);

  const cityData = selectedCity !== "all" && cityDetail?.tiers?.moderate
    ? cityDetail.tiers.moderate
    : null;

  const activeCats = cityData?.cats_altered ?? orgTotal;
  const activeFemales = cityData?.female_count ?? orgFemales;
  const activeMales = cityData?.male_count ?? orgMales;
  const activePlaces = cityData?.places_served ?? orgPlaces;
  const activeLabel = selectedCity === "all" ? "all Sonoma County cities" : selectedCity;

  // Determine year span from timeseries or default
  const ts = cityDetail?.timeseries ?? [];
  const yearCount = ts.length > 0 ? ts.length : 5;
  const avgCatsPerYear = yearCount > 0 ? Math.round(activeCats / yearCount) : activeCats;
  const avgFemalesPerYear = yearCount > 0 ? Math.round(activeFemales / yearCount) : activeFemales;

  // Compute model with adjustable params
  const model = useMemo(
    () => computeModel(avgFemalesPerYear, avgCatsPerYear, yearCount, params),
    [avgFemalesPerYear, avgCatsPerYear, yearCount, params]
  );

  // Tier multipliers
  const tierMult = tier === "conservative" ? 0.6 : tier === "high" ? 1.8 : 1.0;
  const tierTotal = Math.round(model.totalCumulative * tierMult);
  const tierAnnual = Math.round(model.totalAnnual * tierMult);

  const costs: CostBreakdown = {
    shelter: Math.round(model.layer1_shelterCost * tierMult * yearCount),
    animal_control: Math.round(model.layer2_acCost * tierMult * yearCount),
    property_damage: Math.round(model.layer2_propertyCost * tierMult * yearCount),
    disease: Math.round(model.layer2_diseaseCost * tierMult * yearCount),
    placement: Math.round(model.layer2_placementCost * tierMult * yearCount),
    indirect: Math.round(model.layer3_indirect * tierMult * yearCount),
    total: tierTotal,
  };

  const updateParam = useCallback((key: keyof ModelParams, val: number) => {
    setParams(p => ({ ...p, [key]: val }));
  }, []);

  if (loading) return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1rem" }}>
      <SkeletonText lines={12} />
    </div>
  );

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 1rem 3rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>Impact Report</h1>
          <p style={{ color: "var(--text-muted)", margin: "0.25rem 0 0 0", fontSize: "0.88rem" }}>
            What is FFSC&apos;s TNR program worth to {activeLabel}?
          </p>
        </div>
        <a href="/beacon" style={{
          padding: "0.4rem 0.8rem", background: "var(--foreground)", color: "var(--background)",
          borderRadius: 6, textDecoration: "none", fontSize: "0.85rem", fontWeight: 500,
        }}>Back to Beacon</a>
      </div>

      {/* Controls: City + Confidence */}
      <div className="card card-elevated" style={{ padding: "1rem", marginBottom: "1.5rem", display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>City</label>
          <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)}
            style={{ padding: "0.35rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.85rem" }}>
            <option value="all">All Cities (Org-wide)</option>
            {cities.map(c => (
              <option key={c.city_name} value={c.city_name}>{c.city_name} ({c.cats_altered} cats)</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Estimate</label>
          {(["conservative", "moderate", "high"] as Tier[]).map(t => (
            <button key={t} type="button" onClick={() => setTier(t)} style={{
              padding: "0.25rem 0.6rem", borderRadius: 4, fontSize: "0.75rem",
              fontWeight: tier === t ? 700 : 400,
              border: `1px solid ${tier === t ? "var(--primary)" : "var(--card-border)"}`,
              background: tier === t ? "var(--primary)" : "transparent",
              color: tier === t ? "#fff" : "var(--text-secondary)",
              cursor: "pointer", textTransform: "capitalize",
            }}>{t}</button>
          ))}
        </div>
        <button type="button" onClick={() => setShowParams(!showParams)} style={{
          marginLeft: "auto", padding: "0.25rem 0.6rem", borderRadius: 4, fontSize: "0.75rem",
          border: "1px solid var(--card-border)", background: showParams ? "var(--primary)" : "transparent",
          color: showParams ? "#fff" : "var(--text-secondary)", cursor: "pointer",
        }}>
          {showParams ? "Hide parameters" : "Adjust model"}
        </button>
      </div>

      {/* Adjustable parameters (collapsed by default) */}
      {showParams && (
        <div className="card card-elevated" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Model Parameters</h2>
            <button type="button" onClick={() => setParams(DEFAULT_PARAMS)} style={{
              fontSize: "0.72rem", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline",
            }}>Reset to defaults</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1.5rem" }}>
            <ParamSlider label="Litters per year" value={params.littersPerYear} onChange={v => updateParam("littersPerYear", v)} min={0.5} max={3} step={0.1} detail="Levy et al. (2003): 1.4 avg" />
            <ParamSlider label="Kittens per litter" value={params.kittensPerLitter} onChange={v => updateParam("kittensPerLitter", v)} min={2} max={6} step={0.1} detail="Nutter et al. (2004): 3.4 surviving" />
            <ParamSlider label="Kitten survival rate" value={params.kittenSurvivalRate} onChange={v => updateParam("kittenSurvivalRate", v)} min={0.1} max={0.6} step={0.05} suffix="%" detail="75% die before 6 months" />
            <ParamSlider label="Shelter capture rate" value={params.shelterCaptureRate} onChange={v => updateParam("shelterCaptureRate", v)} min={0.1} max={0.7} step={0.05} suffix="%" detail="% of survivors entering shelters" />
            <ParamSlider label="Shelter cost per cat" value={params.shelterCostPerCat} onChange={v => updateParam("shelterCostPerCat", v)} min={100} max={600} step={25} suffix="$" detail="Sonoma County: ~$507 (budget/animals)" />
            <ParamSlider label="AC cost per call" value={params.acCostPerCall} onChange={v => updateParam("acCostPerCall", v)} min={50} max={250} step={10} suffix="$" />
            <ParamSlider label="Complaints per cat/year" value={params.complaintsPerCatYear} onChange={v => updateParam("complaintsPerCatYear", v)} min={0.1} max={1} step={0.05} />
            <ParamSlider label="Placement cost per kitten" value={params.placementCostPerKitten} onChange={v => updateParam("placementCostPerKitten", v)} min={100} max={500} step={25} suffix="$" />
            <ParamSlider label="Indirect cost multiplier" value={params.indirectMultiplier} onChange={v => updateParam("indirectMultiplier", v)} min={1} max={2.5} step={0.1} suffix="×" />
            <ParamSlider label="FFSC cost per TNR" value={params.tnrCostPerCat} onChange={v => updateParam("tnrCostPerCat", v)} min={30} max={150} step={5} suffix="$" detail="FFSC avg: $65–$72" />
          </div>
        </div>
      )}

      {/* ─── HERO: The answer ─── */}
      <div className="card card-elevated" style={{ padding: "1.5rem", marginBottom: "1.5rem", textAlign: "center" }}>
        <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>
          Estimated value to {activeLabel} ({tier})
        </div>
        <div style={{ fontSize: "3rem", fontWeight: 700, color: "var(--primary)", lineHeight: 1.1 }}>
          {fmtUsd(tierTotal)}
        </div>
        <div style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
          {fmtUsd(tierAnnual)}/year &middot; {activeCats.toLocaleString()} cats over {yearCount} years &middot; {activePlaces} locations
        </div>
        {model.roi > 0 && (
          <div style={{
            display: "inline-block", marginTop: "0.75rem", padding: "0.4rem 1rem",
            background: "var(--healthy-bg, rgba(22,163,74,0.08))", borderRadius: 20,
            fontSize: "0.88rem", fontWeight: 600, color: "var(--healthy-text, #16a34a)",
          }}>
            For every $1 invested in TNR, {activeLabel} avoids ${model.roi.toFixed(0)} in costs
          </div>
        )}
      </div>

      {/* ─── LAYER 1: Kittens prevented ─── */}
      <div className="card card-elevated" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.5rem 0" }}>
          Layer 1: Kittens prevented
        </h2>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1rem 0", lineHeight: 1.5 }}>
          Not every unspayed cat produces the theoretical maximum, and not every kitten ends up at a shelter.
          We use conservative reproduction parameters from published research.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
          <div style={{ textAlign: "center", padding: "0.5rem", borderRadius: 6, background: "var(--card-bg)" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>~{avgFemalesPerYear}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>females spayed/yr</div>
          </div>
          <div style={{ textAlign: "center", padding: "0.5rem", borderRadius: 6, background: "var(--card-bg)" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{params.littersPerYear} × {params.kittensPerLitter}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>litters × kittens</div>
          </div>
          <div style={{ textAlign: "center", padding: "0.5rem", borderRadius: 6, background: "var(--card-bg)" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{Math.round(params.kittenSurvivalRate * 100)}% survive</div>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>to adulthood</div>
          </div>
          <div style={{ textAlign: "center", padding: "0.5rem", borderRadius: 6, background: "var(--primary-bg, rgba(37,99,235,0.06))" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--primary)" }}>= {model.kittensPreventedPerYear}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>kittens/year</div>
          </div>
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5, padding: "0.5rem 0.75rem", borderLeft: "3px solid var(--primary)", background: "var(--primary-bg, rgba(37,99,235,0.03))", borderRadius: "0 6px 6px 0" }}>
          Of these {model.kittensPreventedPerYear} kittens prevented per year, approximately <strong>{Math.round(params.shelterCaptureRate * 100)}% would enter shelters</strong> ({model.kittensToShelter}/year).
          The remaining {Math.round((1 - params.shelterCaptureRate) * 100)}% would have survived as free-roaming community cats, generating the indirect costs below.
        </div>
      </div>

      {/* ─── LAYER 2+3: Where the costs come from ─── */}
      <div className="card card-elevated" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.5rem 0" }}>
          Layer 2 &amp; 3: Community costs avoided
        </h2>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: "0 0 1rem 0", lineHeight: 1.5 }}>
          Each unmanaged community cat generates shelter intake, animal control, property, disease,
          and placement costs. We model six categories with a {Math.round((params.indirectMultiplier - 1) * 100)}% indirect uplift.
        </p>

        <CostWaterfallChart costs={costs} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "1rem" }}>
          {[
            { label: "Shelter intake", val: costs.shelter, detail: `${model.kittensToShelter}/yr × ${fmtUsd(params.shelterCostPerCat)} × ${yearCount} yrs` },
            { label: "Animal control", val: costs.animal_control, detail: `${avgCatsPerYear} cats × ${params.complaintsPerCatYear} calls/yr × ${fmtUsd(params.acCostPerCall)}` },
            { label: "Property damage", val: costs.property_damage, detail: `~${Math.round(avgCatsPerYear / 15)} colonies × ${fmtUsd(params.propertyDamagePerColonyYear)}/yr` },
            { label: "Disease costs", val: costs.disease, detail: `${Math.round(model.kittensPreventedPerYear * params.kittenSurvivalRate)}/yr × ${fmtUsd(params.diseaseCostPerCat)}` },
            { label: "Kitten placement", val: costs.placement, detail: `${model.kittensToShelter}/yr × ${fmtUsd(params.placementCostPerKitten)}` },
            { label: "Indirect (${Math.round((params.indirectMultiplier-1)*100)}%)", val: costs.indirect, detail: "Volunteer time, environmental impact, admin overhead" },
          ].map(c => (
            <div key={c.label} style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid var(--card-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>{c.label}</span>
                <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{fmtUsd(c.val)}</span>
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{c.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── ROI ─── */}
      <div className="card card-elevated" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.75rem 0" }}>Return on investment</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", textAlign: "center" }}>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>FFSC TNR Cost</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{fmtUsd(model.tnrCost)}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{fmtUsd(params.tnrCostPerCat)}/cat × {activeCats.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Community Savings</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--primary)" }}>{fmtUsd(tierTotal)}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{tier} estimate</div>
          </div>
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>ROI</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--healthy-text, #16a34a)" }}>{model.roi.toFixed(0)}:1</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>${model.roi.toFixed(0)} saved per $1 invested</div>
          </div>
        </div>
      </div>

      {/* ─── Year-by-year data (if city selected) ─── */}
      {ts.length > 0 && (
        <div className="card card-elevated" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.5rem 0" }}>
            Year-by-year data: {selectedCity}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
            <SparklineSVG values={ts.map(t => t.cats_altered)} width={160} height={32} />
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{ts.length} years of verified clinic data</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr>
                  {["Year", "Cats TNR'd", "Females", "Males"].map(h => (
                    <th key={h} style={{
                      padding: "0.4rem 0.6rem", textAlign: h === "Year" ? "left" : "right",
                      borderBottom: "2px solid var(--card-border)", fontWeight: 600, fontSize: "0.75rem", color: "var(--text-secondary)",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ts.map(row => (
                  <tr key={row.period}>
                    <td style={{ padding: "0.4rem 0.6rem", fontWeight: 500 }}>{row.period}</td>
                    <td style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>{row.cats_altered}</td>
                    <td style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>{row.female_count}</td>
                    <td style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>{row.male_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Methodology ─── */}
      <div className="card card-elevated" style={{ padding: "1.25rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 0.5rem 0" }}>Methodology &amp; sources</h2>
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          <p style={{ margin: "0 0 0.5rem 0" }}>
            <strong>Cat locations</strong> determined by geocoded lat/lng tested against official city boundary polygons
            (OpenStreetMap administrative boundaries, cross-referenced with Sonoma County GIS).
            Only confirmed spayed/neutered cats counted. Year based on earliest clinic appointment date.
          </p>
          <p style={{ margin: "0 0 0.5rem 0" }}>
            <strong>Reproduction parameters</strong> from Levy JK et al. (2003) JAVMA — 1.4 surviving litters/year in community
            conditions. Nutter FB et al. (2004) JAVMA 225(9):1399-1402 — 4.0 avg litter size, 85% neonatal survival = 3.4 surviving.
          </p>
          <p style={{ margin: "0 0 0.5rem 0" }}>
            <strong>Shelter costs</strong>: National avg $100 (ASPCA catch-hold-euthanize), Hillsborough County $168, Cook County $135,
            Sonoma County ~$507 ($1.27M budget / 2,500 animals). California average $250–$500 given labor costs.
          </p>
          <p style={{ margin: "0 0 0.5rem 0" }}>
            <strong>TNR cost-effectiveness</strong>: TNR $20–$97/cat vs impound/euthanize $52–$168/cat (ncpetproject.org).
            FFSC average: $65–$72/cat.
          </p>
          <p style={{ margin: "0 0 0.5rem 0" }}>
            <strong>Why this is conservative</strong>: We only count first-generation kittens (no exponential effect).
            Males not counted in reproduction model. Cats outside city limits with city mailing addresses excluded.
            Colony stabilization effect (~13%/yr attrition) not modeled.
          </p>
          <p style={{ margin: 0 }}>
            All parameters are adjustable using the &ldquo;Adjust model&rdquo; button above.
            Three confidence tiers: Conservative (60%), Moderate (base), High (180%).
          </p>
        </div>
      </div>
    </div>
  );
}
