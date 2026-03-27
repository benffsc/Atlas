"use client";

import { DedupPageLayout } from "@/components/admin/dedup";
import type { DedupConfig } from "@/components/admin/dedup";
import { postApi } from "@/lib/api-client";

interface RequestDedupCandidate {
  candidate_id: string;
  canonical_request_id: string;
  duplicate_request_id: string;
  match_tier: number;
  match_reasons: Record<string, unknown>;
  canonical_summary: string;
  duplicate_summary: string;
  canonical_place_address: string | null;
  duplicate_place_address: string | null;
  canonical_status: string;
  duplicate_status: string;
  canonical_source: string;
  duplicate_source: string;
  canonical_cat_count: number | null;
  duplicate_cat_count: number | null;
  canonical_created: string;
  duplicate_created: string;
  canonical_trip_reports: number;
  duplicate_trip_reports: number;
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    new: "#0d6efd",
    triaged: "#6f42c1",
    scheduled: "#fd7e14",
    in_progress: "#198754",
    completed: "#6c757d",
    cancelled: "#dc3545",
  };
  return (
    <span
      style={{
        fontSize: "0.7rem",
        padding: "0.1rem 0.4rem",
        background: `${colors[status] || "#6c757d"}22`,
        color: colors[status] || "#6c757d",
        borderRadius: "3px",
        fontWeight: 500,
      }}
    >
      {status}
    </span>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function RequestInfo({
  summary,
  placeAddress,
  status,
  source,
  catCount,
  created,
  tripReports,
  label,
  labelColor,
}: {
  summary: string;
  placeAddress: string | null;
  status: string;
  source: string;
  catCount: number | null;
  created: string;
  tripReports: number;
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
      <div
        style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: "0.25rem", lineHeight: 1.3 }}
      >
        {summary || "(no summary)"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.8rem" }}>
        {placeAddress && (
          <span className="text-muted" style={{ fontSize: "0.75rem" }}>
            {placeAddress}
          </span>
        )}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          {statusBadge(status)}
          <span className="text-muted">{source}</span>
          {catCount != null && <span>{catCount} cats</span>}
          <span>
            {tripReports} trip report{tripReports !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="text-muted" style={{ fontSize: "0.75rem" }}>
          Created: {formatDate(created)}
        </span>
      </div>
    </div>
  );
}

function matchReasonsLabel(reasons: Record<string, unknown>): string {
  const parts: string[] = [];
  if (reasons.same_place) parts.push("Same place");
  if (reasons.same_source) parts.push("Same source");
  if (reasons.different_source) parts.push("Cross-source");
  if (reasons.place_family) parts.push("Place family");
  if (reasons.date_diff_days != null) parts.push(`${reasons.date_diff_days}d apart`);
  if (reasons.source_record_similarity != null) {
    parts.push(`${Math.round(Number(reasons.source_record_similarity) * 100)}% ID match`);
  }
  return parts.join(" | ");
}

const TIER_TABS = [
  { value: "0", label: "All", color: "#6c757d" },
  { value: "1", label: "Same Source Reimport", color: "#dc3545" },
  { value: "2", label: "Cross-Source", color: "#fd7e14" },
  { value: "3", label: "Place Family", color: "#6f42c1" },
];

const config: DedupConfig<RequestDedupCandidate> = {
  entityName: "Request",
  apiPath: "/api/admin/request-dedup",
  description: "Deduplicate TNR requests by place, source system, and date proximity.",

  tabs: TIER_TABS,
  filterParamName: "tier",
  defaultFilterValue: "0",
  summaryGroupKey: "match_tier",

  getPairKey: (c) => `${c.canonical_request_id}|${c.duplicate_request_id}`,
  getSinglePayload: (c) => ({
    canonical_request_id: c.canonical_request_id,
    duplicate_request_id: c.duplicate_request_id,
    candidate_id: c.candidate_id,
  }),
  getBatchPairPayload: (key, candidates) => {
    const [canonical_request_id, duplicate_request_id] = key.split("|");
    const candidate = candidates.find(
      (c) =>
        c.canonical_request_id === canonical_request_id &&
        c.duplicate_request_id === duplicate_request_id
    );
    return {
      canonical_request_id,
      duplicate_request_id,
      candidate_id: candidate?.candidate_id || "",
    };
  },

  actions: [
    { key: "keep_separate", label: "Keep Separate", batchLabel: "Keep Separate All", color: "#198754" },
    { key: "merge", label: "Merge", batchLabel: "Merge All", color: "#fd7e14" },
  ],

  headerActions: [
    {
      key: "refresh",
      label: "Refresh Candidates",
      loadingLabel: "Scanning...",
      color: "#0d6efd",
      confirmMessage: "Refresh request dedup candidates? This rescans all requests.",
      handler: async () => {
        const result = await postApi<{
          tier1_count: number;
          tier2_count: number;
          tier3_count: number;
          total: number;
        }>("/api/admin/request-dedup", { action: "refresh_candidates" });
        return `Refresh complete: ${result.tier1_count} same-source, ${result.tier2_count} cross-source, ${result.tier3_count} place family (${result.total} total)`;
      },
    },
  ],

  getTierValue: (c) => String(c.match_tier),

  renderCanonical: (c) => (
    <RequestInfo
      summary={c.canonical_summary}
      placeAddress={c.canonical_place_address}
      status={c.canonical_status}
      source={c.canonical_source}
      catCount={c.canonical_cat_count}
      created={c.canonical_created}
      tripReports={c.canonical_trip_reports}
      label="Canonical"
      labelColor="#198754"
    />
  ),

  renderDuplicate: (c) => (
    <RequestInfo
      summary={c.duplicate_summary}
      placeAddress={c.duplicate_place_address}
      status={c.duplicate_status}
      source={c.duplicate_source}
      catCount={c.duplicate_cat_count}
      created={c.duplicate_created}
      tripReports={c.duplicate_trip_reports}
      label="Duplicate"
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
        minWidth: "50px",
      }}
    >
      <div
        style={{
          fontSize: "1.2rem",
          fontWeight: 700,
          color: TIER_TABS.find((t) => t.value === String(c.match_tier))?.color || "#6c757d",
        }}
      >
        T{c.match_tier}
      </div>
    </div>
  ),

  renderHeaderMeta: (c) => (
    <span className="text-muted text-sm">{matchReasonsLabel(c.match_reasons)}</span>
  ),
};

export default function RequestDedupPage() {
  return <DedupPageLayout config={config} />;
}
