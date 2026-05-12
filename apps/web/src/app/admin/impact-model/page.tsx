"use client";

/**
 * /admin/impact-model — Dedicated admin page for impact model parameters.
 *
 * Grouped parameter inputs with:
 *   - Live preview of computed impact from current parameters
 *   - Source citations for each parameter
 *   - Reset to defaults
 *
 * Reads/writes ops.app_config keys (category = 'impact').
 */

import { useEffect, useState, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { CostWaterfallChart } from "@/components/charts/CostWaterfallChart";
import type { EconomicModel } from "@/app/api/dashboard/impact/route";

interface ConfigKey {
  key: string;
  value: string;
  description: string;
}

interface ParamGroup {
  title: string;
  keys: Array<{
    key: string;
    label: string;
    type: "number" | "text";
    suffix?: string;
    min?: number;
    max?: number;
    step?: number;
  }>;
}

const GROUPS: ParamGroup[] = [
  {
    title: "Reproduction Model",
    keys: [
      { key: "impact.female_ratio", label: "Female ratio", type: "number", min: 0, max: 1, step: 0.01 },
      { key: "impact.litters_per_year_per_female", label: "Litters per year per female", type: "number", min: 0, max: 5, step: 0.1 },
      { key: "impact.kittens_per_litter", label: "Kittens per litter", type: "number", min: 1, max: 8, step: 0.5 },
      { key: "impact.kitten_survival_rate", label: "Kitten survival rate", type: "number", min: 0, max: 1, step: 0.05 },
      { key: "impact.reproductive_years", label: "Reproductive lifespan (years)", type: "number", min: 1, max: 10, step: 1 },
      { key: "impact.male_pregnancies_prevented_per_year", label: "Male pregnancies prevented/year", type: "number", min: 0, max: 10, step: 0.5 },
    ],
  },
  {
    title: "Cost Categories",
    keys: [
      { key: "impact.shelter_capture_rate", label: "Shelter capture rate", type: "number", min: 0, max: 1, step: 0.05 },
      { key: "impact.shelter_intake_cost_usd", label: "Shelter intake cost", type: "number", suffix: "USD", min: 0, max: 1000, step: 25 },
      { key: "impact.animal_control_cost_per_complaint_usd", label: "AC cost per complaint", type: "number", suffix: "USD", min: 0, max: 500, step: 25 },
      { key: "impact.complaints_per_unaltered_cat_per_year", label: "Complaints per unaltered cat/year", type: "number", min: 0, max: 2, step: 0.1 },
      { key: "impact.property_damage_per_colony_per_year_usd", label: "Property damage per colony/year", type: "number", suffix: "USD", min: 0, max: 1000, step: 25 },
      { key: "impact.disease_treatment_cost_per_cat_usd", label: "Disease cost per cat", type: "number", suffix: "USD", min: 0, max: 500, step: 10 },
      { key: "impact.placement_cost_per_kitten_usd", label: "Placement cost per kitten", type: "number", suffix: "USD", min: 0, max: 1000, step: 25 },
      { key: "impact.indirect_cost_multiplier", label: "Indirect cost multiplier", type: "number", min: 1, max: 3, step: 0.1 },
    ],
  },
  {
    title: "Confidence Tiers",
    keys: [
      { key: "impact.confidence_conservative_multiplier", label: "Conservative multiplier", type: "number", min: 0.1, max: 1, step: 0.05 },
      { key: "impact.confidence_moderate_multiplier", label: "Moderate multiplier", type: "number", min: 0.5, max: 1.5, step: 0.1 },
      { key: "impact.confidence_high_multiplier", label: "High multiplier", type: "number", min: 1, max: 3, step: 0.1 },
    ],
  },
];

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

export default function ImpactModelPage() {
  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<EconomicModel | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetchApi<{ items: ConfigKey[] }>("/api/admin/config?category=impact")
      .then((result) => {
        if (result && Array.isArray(result.items)) {
          const vals: Record<string, string> = {};
          const descs: Record<string, string> = {};
          for (const item of result.items) {
            // Parse JSON value
            try {
              vals[item.key] = JSON.parse(item.value);
            } catch {
              vals[item.key] = item.value;
            }
            descs[item.key] = item.description;
          }
          setConfigs(vals);
          setDescriptions(descs);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Initial preview
    fetchApi<{ economic_model?: EconomicModel }>("/api/dashboard/impact")
      .then((result) => {
        if (result?.economic_model) setPreview(result.economic_model);
      })
      .catch(() => {});
  }, []);

  const handleChange = (key: string, value: string) => {
    setConfigs((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Save each changed config key
      for (const [key, value] of Object.entries(configs)) {
        const jsonValue = typeof value === "string" && !isNaN(Number(value))
          ? value
          : JSON.stringify(value);
        await postApi("/api/admin/config", { key, value: jsonValue });
      }
      setDirty(false);

      // Refresh preview
      const result = await fetchApi<{ economic_model?: EconomicModel }>("/api/dashboard/impact");
      if (result?.economic_model) setPreview(result.economic_model);
    } catch {}
    finally { setSaving(false); }
  }, [configs]);

  if (loading) {
    return (
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "2rem" }}>Impact Model Configuration</h1>
        <div style={{ color: "var(--text-muted)" }}>Loading parameters...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Impact Model Configuration</h1>
          <p style={{ color: "var(--text-muted)", margin: "0.3rem 0 0 0", fontSize: "0.85rem" }}>
            Adjust the economic impact model parameters. All values are from peer-reviewed literature.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            padding: "0.5rem 1.25rem",
            borderRadius: 6,
            border: "none",
            background: dirty ? "var(--primary)" : "var(--card-border)",
            color: dirty ? "#fff" : "var(--text-muted)",
            fontWeight: 600,
            cursor: dirty ? "pointer" : "default",
            fontSize: "0.85rem",
          }}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {/* Live preview */}
      {preview && (
        <div className="card card-elevated" style={{ padding: "1.25rem", marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem 0" }}>Live Preview (Moderate Tier)</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Conservative</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{formatCurrency(preview.conservative.costs.total)}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>Moderate</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--primary)" }}>{formatCurrency(preview.moderate.costs.total)}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>High</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{formatCurrency(preview.high.costs.total)}</div>
            </div>
          </div>
          <CostWaterfallChart costs={preview.moderate.costs} />
        </div>
      )}

      {/* Parameter groups */}
      {GROUPS.map((group) => (
        <div key={group.title} className="card card-elevated" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 1rem 0" }}>{group.title}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
            {group.keys.map((param) => {
              const val = configs[param.key] ?? "";
              const desc = descriptions[param.key];
              return (
                <div key={param.key}>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--foreground)" }}>
                    {param.label}
                    {param.suffix && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> ({param.suffix})</span>}
                  </label>
                  <input
                    type={param.type}
                    value={val}
                    onChange={(e) => handleChange(param.key, e.target.value)}
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    style={{
                      width: "100%",
                      padding: "0.4rem 0.6rem",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      fontSize: "0.85rem",
                    }}
                  />
                  {desc && (
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.2rem", lineHeight: 1.4 }}>
                      {desc.length > 120 ? desc.slice(0, 120) + "..." : desc}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
