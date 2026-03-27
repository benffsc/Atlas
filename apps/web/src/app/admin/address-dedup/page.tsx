"use client";

import { DedupPageLayout } from "@/components/admin/dedup";
import type { DedupConfig } from "@/components/admin/dedup";
import { postApi } from "@/lib/api-client";

interface AddressDedupCandidate {
  candidate_id: string;
  canonical_address_id: string;
  duplicate_address_id: string;
  match_tier: number;
  address_similarity: number;
  distance_meters: number | null;
  canonical_formatted: string;
  duplicate_formatted: string;
  canonical_city: string | null;
  duplicate_city: string | null;
  canonical_place_count: number;
  duplicate_place_count: number;
  canonical_people_count: number;
  duplicate_people_count: number;
  canonical_geocoding_status: string | null;
  duplicate_geocoding_status: string | null;
}

function AddressInfo({
  formatted,
  city,
  placeCount,
  peopleCount,
  geocodingStatus,
  label,
  labelColor,
}: {
  formatted: string;
  city: string | null;
  placeCount: number;
  peopleCount: number;
  geocodingStatus: string | null;
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
      <div style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: "0.25rem" }}>
        {formatted || "(no address)"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.8rem" }}>
        {city && <span className="text-muted">City: {city}</span>}
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <span>
            {placeCount} place{placeCount !== 1 ? "s" : ""}
          </span>
          <span>
            {peopleCount} {peopleCount !== 1 ? "people" : "person"}
          </span>
          {geocodingStatus && (
            <span
              style={{
                fontSize: "0.7rem",
                padding: "0.1rem 0.3rem",
                background: geocodingStatus === "success" ? "#19875422" : "#dc354522",
                borderRadius: "3px",
              }}
            >
              {geocodingStatus}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const config: DedupConfig<AddressDedupCandidate> = {
  entityName: "Address",
  apiPath: "/api/admin/address-dedup",
  description:
    "Deduplicate address records by normalized key, text similarity, and geocoding proximity.",

  tabs: [
    { value: "0", label: "All", color: "#6c757d" },
    { value: "1", label: "Exact Key", color: "#dc3545" },
    { value: "2", label: "High Similarity", color: "#fd7e14" },
    { value: "3", label: "Close Proximity", color: "#6f42c1" },
  ],
  filterParamName: "tier",
  defaultFilterValue: "0",
  summaryGroupKey: "match_tier",

  getPairKey: (c) => `${c.canonical_address_id}|${c.duplicate_address_id}`,
  getSinglePayload: (c) => ({
    canonical_address_id: c.canonical_address_id,
    duplicate_address_id: c.duplicate_address_id,
    candidate_id: c.candidate_id,
  }),
  getBatchPairPayload: (key, candidates) => {
    const [canonical_address_id, duplicate_address_id] = key.split("|");
    const candidate = candidates.find(
      (c) =>
        c.canonical_address_id === canonical_address_id &&
        c.duplicate_address_id === duplicate_address_id
    );
    return { canonical_address_id, duplicate_address_id, candidate_id: candidate?.candidate_id || "" };
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
      confirmMessage: "Refresh address dedup candidates? This rescans all addresses.",
      handler: async () => {
        const result = await postApi<{
          tier1_count: number;
          tier2_count: number;
          tier3_count: number;
          total: number;
        }>("/api/admin/address-dedup", { action: "refresh_candidates" });
        return `Refresh complete: ${result.tier1_count} exact key, ${result.tier2_count} high similarity, ${result.tier3_count} close proximity (${result.total} total)`;
      },
    },
  ],

  getTierValue: (c) => String(c.match_tier),

  renderCanonical: (c) => (
    <AddressInfo
      formatted={c.canonical_formatted}
      city={c.canonical_city}
      placeCount={c.canonical_place_count}
      peopleCount={c.canonical_people_count}
      geocodingStatus={c.canonical_geocoding_status}
      label="Canonical"
      labelColor="#198754"
    />
  ),

  renderDuplicate: (c) => (
    <AddressInfo
      formatted={c.duplicate_formatted}
      city={c.duplicate_city}
      placeCount={c.duplicate_place_count}
      peopleCount={c.duplicate_people_count}
      geocodingStatus={c.duplicate_geocoding_status}
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
        minWidth: "70px",
      }}
    >
      <div
        style={{
          fontSize: "1.4rem",
          fontWeight: 700,
          color: config.tabs.find((t) => t.value === String(c.match_tier))?.color || "#6c757d",
        }}
      >
        {Math.round(c.address_similarity * 100)}%
      </div>
      <div className="text-muted" style={{ fontSize: "0.7rem" }}>
        similarity
      </div>
    </div>
  ),

  renderHeaderMeta: (c) => (
    <>
      <span className="text-muted text-sm">
        {Math.round(c.address_similarity * 100)}% similarity
      </span>
      {c.distance_meters != null && (
        <span className="text-muted text-sm">
          {c.distance_meters < 1 ? "<1" : Math.round(c.distance_meters)}m apart
        </span>
      )}
    </>
  ),
};

export default function AddressDedupPage() {
  return <DedupPageLayout config={config} />;
}
