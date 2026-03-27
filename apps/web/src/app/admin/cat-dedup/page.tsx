"use client";

import { DedupPageLayout } from "@/components/admin/dedup";
import type { DedupConfig } from "@/components/admin/dedup";
import { postApi } from "@/lib/api-client";

interface CatDedupCandidate {
  cat_id_1: string;
  cat_id_2: string;
  name_1: string | null;
  name_2: string | null;
  chip_1: string | null;
  chip_2: string | null;
  chq_1: string | null;
  chq_2: string | null;
  sex_1: string | null;
  sex_2: string | null;
  color_1: string | null;
  color_2: string | null;
  owner_1: string | null;
  owner_2: string | null;
  confidence: number;
  match_reason: string;
  recommended_action: string;
  place_1: string | null;
  place_2: string | null;
  appointments_1: number;
  appointments_2: number;
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "duplicate_microchip":
      return "Exact Microchip";
    case "duplicate_clinichq_id":
      return "Exact ClinicHQ ID";
    case "microchip_typo":
      return "Microchip Typo";
    case "same_name_same_owner":
      return "Same Name + Owner";
    case "phonetic_name_match":
      return "Phonetic Name";
    default:
      return reason;
  }
}

function CatInfo({
  name,
  chip,
  chq,
  sex,
  color,
  owner,
  place,
  appointments,
  label,
  labelColor,
}: {
  name: string | null;
  chip: string | null;
  chq: string | null;
  sex: string | null;
  color: string | null;
  owner: string | null;
  place: string | null;
  appointments: number;
  label: string;
  labelColor: string;
}) {
  return (
    <div
      style={{
        padding: "0.75rem",
        background: `${labelColor}11`,
        borderRadius: "8px",
        border: `1px solid ${labelColor}33`,
      }}
    >
      <div
        style={{
          fontSize: "0.65rem",
          textTransform: "uppercase",
          color: labelColor,
          marginBottom: "0.25rem",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.25rem" }}>
        {name || "(unnamed)"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.8rem" }}>
        {chip && (
          <span title="Microchip" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
            Chip: {chip}
          </span>
        )}
        {chq && (
          <span title="ClinicHQ Animal ID" className="text-muted">
            CHQ: {chq}
          </span>
        )}
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {sex && <span>{sex}</span>}
          {color && <span style={{ opacity: 0.7 }}>{color}</span>}
          <span>{appointments} appts</span>
        </div>
        {owner && (
          <span className="text-muted" title="Owner">
            Owner: {owner}
          </span>
        )}
        {place && (
          <span className="text-muted" title="Place" style={{ fontSize: "0.75rem" }}>
            {place}
          </span>
        )}
      </div>
    </div>
  );
}

const ACTION_TABS = [
  { value: "", label: "All", color: "#6c757d" },
  { value: "auto_merge", label: "Auto-Merge", color: "#dc3545" },
  { value: "review_high", label: "High", color: "#fd7e14" },
  { value: "review_medium", label: "Medium", color: "#6f42c1" },
  { value: "review_low", label: "Low", color: "#0dcaf0" },
];

const config: DedupConfig<CatDedupCandidate> = {
  entityName: "Cat",
  apiPath: "/api/admin/cat-dedup",
  description:
    "Microchip, identifier, name, and phonetic duplicate detection for cats. Review and resolve candidate pairs.",

  tabs: ACTION_TABS,
  filterParamName: "action",
  defaultFilterValue: "",
  summaryGroupKey: "recommended_action",

  getPairKey: (c) => `${c.cat_id_1}|${c.cat_id_2}`,
  getSinglePayload: (c) => ({
    cat_id_1: c.cat_id_1,
    cat_id_2: c.cat_id_2,
  }),
  getBatchPairPayload: (key) => {
    const [cat_id_1, cat_id_2] = key.split("|");
    return { cat_id_1, cat_id_2 };
  },

  actions: [
    { key: "keep_separate", label: "Keep Separate", batchLabel: "Keep Separate All", color: "#198754" },
    { key: "merge", label: "Merge", batchLabel: "Merge All", color: "#fd7e14" },
  ],

  headerActions: [
    {
      key: "scan",
      label: "Run Dedup Scan",
      loadingLabel: "Scanning...",
      color: "#0d6efd",
      confirmMessage:
        "Run dedup scan? This refreshes common cat names and re-scans all cats.",
      handler: async () => {
        const result = await postApi<{
          same_owner_count: number;
          chip_typo_count: number;
          duplicate_id_count: number;
          phonetic_count: number;
        }>("/api/admin/cat-dedup", { action: "scan" });
        return `Scan complete: ${result.duplicate_id_count} duplicate IDs, ${result.chip_typo_count} chip typos, ${result.same_owner_count} same owner, ${result.phonetic_count} phonetic`;
      },
    },
  ],

  getTierValue: (c) => c.recommended_action,

  renderCanonical: (c) => (
    <CatInfo
      name={c.name_1}
      chip={c.chip_1}
      chq={c.chq_1}
      sex={c.sex_1}
      color={c.color_1}
      owner={c.owner_1}
      place={c.place_1}
      appointments={c.appointments_1}
      label="Cat 1"
      labelColor="#198754"
    />
  ),

  renderDuplicate: (c) => (
    <CatInfo
      name={c.name_2}
      chip={c.chip_2}
      chq={c.chq_2}
      sex={c.sex_2}
      color={c.color_2}
      owner={c.owner_2}
      place={c.place_2}
      appointments={c.appointments_2}
      label="Cat 2"
      labelColor="#6c757d"
    />
  ),

  renderCenter: (c) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "70px",
      }}
    >
      <div
        style={{
          fontSize: "1.4rem",
          fontWeight: 700,
          color:
            c.confidence >= 0.95
              ? "#dc3545"
              : c.confidence >= 0.85
                ? "#fd7e14"
                : c.confidence >= 0.65
                  ? "#6f42c1"
                  : "#0dcaf0",
        }}
      >
        {Math.round(c.confidence * 100)}%
      </div>
      <div className="text-muted" style={{ fontSize: "0.7rem" }}>
        confidence
      </div>
    </div>
  ),

  renderHeaderMeta: (c) => (
    <>
      <span
        style={{
          fontSize: "0.75rem",
          padding: "0.2rem 0.5rem",
          background: "var(--bg-muted, #f8f9fa)",
          borderRadius: "4px",
        }}
      >
        {reasonLabel(c.match_reason)}
      </span>
      <span className="text-muted text-sm">{Math.round(c.confidence * 100)}% confidence</span>
    </>
  ),
};

export default function CatDedupPage() {
  return <DedupPageLayout config={config} />;
}
