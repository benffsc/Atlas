"use client";

import { useState } from "react";
import { DedupPageLayout } from "@/components/admin/dedup";
import type { DedupConfig, BaseDedupResponse } from "@/components/admin/dedup";
import { fetchApi, postApi } from "@/lib/api-client";

interface PlaceDedupCandidate {
  candidate_id: string;
  canonical_place_id: string;
  duplicate_place_id: string;
  match_tier: number;
  address_similarity: number;
  distance_meters: number;
  canonical_address: string;
  canonical_name: string | null;
  canonical_kind: string;
  duplicate_address: string;
  duplicate_name: string | null;
  duplicate_kind: string;
  canonical_requests: number;
  canonical_cats: number;
  canonical_children: number;
  duplicate_requests: number;
  duplicate_cats: number;
  duplicate_children: number;
  canonical_people: number;
  duplicate_people: number;
}

interface PlaceDedupResponse extends BaseDedupResponse<PlaceDedupCandidate> {
  junkAddressCount?: number;
}

function PlaceStats({
  requests,
  cats,
  children,
  people,
  kind,
}: {
  requests: number;
  cats: number;
  children: number;
  people: number;
  kind: string;
}) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.8rem", flexWrap: "wrap" }}>
      <span title="Service requests">{requests} requests</span>
      <span title="Cat relationships">{cats} cats</span>
      <span title="People linked">{people} people</span>
      {children > 0 && <span title="Child units">{children} units</span>}
      {kind && (
        <span title="Place kind" style={{ opacity: 0.7 }}>
          {kind}
        </span>
      )}
    </div>
  );
}

const TIER_TABS = [
  { value: "0", label: "All", color: "#6c757d" },
  { value: "1", label: "Close + Similar", color: "#198754" },
  { value: "2", label: "Close + Different", color: "#fd7e14" },
  { value: "3", label: "Farther + Similar", color: "#6f42c1" },
  { value: "4", label: "Text Match Only", color: "#0dcaf0" },
];

function makeConfig(onAutoMerge: () => void, autoMerging: boolean, autoMergeStatus: string): DedupConfig<PlaceDedupCandidate> {
  return {
    entityName: "Place",
    apiPath: "/api/admin/place-dedup",
    description:
      "Geographic proximity + address similarity duplicate detection. Review and resolve candidate pairs.",

    tabs: TIER_TABS,
    filterParamName: "tier",
    defaultFilterValue: "0",
    summaryGroupKey: "match_tier",

    getPairKey: (c) => `${c.canonical_place_id}|${c.duplicate_place_id}|${c.candidate_id}`,
    getSinglePayload: (c) => ({
      candidate_id: c.candidate_id,
      canonical_place_id: c.canonical_place_id,
      duplicate_place_id: c.duplicate_place_id,
    }),
    getBatchPairPayload: (key) => {
      const [canonical_place_id, duplicate_place_id, candidate_id] = key.split("|");
      return { candidate_id, canonical_place_id, duplicate_place_id };
    },

    actions: [
      { key: "keep_separate", label: "Keep Separate", batchLabel: "Keep Separate All", color: "#198754" },
      { key: "merge", label: "Merge", batchLabel: "Merge All", color: "#fd7e14" },
      { key: "dismiss", label: "Skip", batchLabel: "Dismiss All", color: "#6c757d" },
    ],

    headerActions: [
      {
        key: "auto_merge",
        label: autoMerging ? autoMergeStatus || "Auto-merging..." : "Auto-merge High Confidence",
        loadingLabel: autoMergeStatus || "Auto-merging...",
        color: "#fd7e14",
        showWhenFilter: "1",
        handler: async () => {
          onAutoMerge();
        },
      },
      {
        key: "refresh",
        label: "Refresh Candidates",
        loadingLabel: "Refreshing...",
        color: "#0d6efd",
        confirmMessage:
          "Refresh all candidate pairs? This re-scans all places and may take a moment.",
        handler: async () => {
          const result = await postApi<{
            tier1_count: number;
            tier2_count: number;
            tier3_count: number;
            tier4_count: number;
            total: number;
          }>("/api/admin/place-dedup", { action: "refresh_candidates" });
          alert(
            `Refreshed: T1=${result.tier1_count}, T2=${result.tier2_count}, T3=${result.tier3_count}, T4=${result.tier4_count}, Total=${result.total}`
          );
        },
      },
    ],

    getTierValue: (c) => String(c.match_tier),

    renderExtraSummary: (data) => {
      const junkCount = (data as PlaceDedupResponse).junkAddressCount ?? 0;
      if (junkCount <= 0) return null;
      return (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "rgba(220, 53, 69, 0.08)",
            borderRadius: "8px",
            textAlign: "center",
            minWidth: "80px",
            borderLeft: "3px solid #dc3545",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#dc3545" }}>{junkCount}</div>
          <div className="text-muted text-sm">Junk Addresses</div>
        </div>
      );
    },

    renderCanonical: (c) => (
      <div
        style={{
          padding: "0.75rem",
          background: "rgba(25, 135, 84, 0.08)",
          borderRadius: "8px",
          border: "1px solid rgba(25, 135, 84, 0.2)",
        }}
      >
        <div
          style={{
            fontSize: "0.65rem",
            textTransform: "uppercase",
            color: "#198754",
            marginBottom: "0.25rem",
            fontWeight: 600,
          }}
        >
          Keep (Canonical)
        </div>
        <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.25rem" }}>
          <a
            href={`/places/${c.canonical_place_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline dotted" }}
          >
            {c.canonical_address || "(no address)"}
          </a>
        </div>
        {c.canonical_name && (
          <div className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>
            {c.canonical_name}
          </div>
        )}
        <PlaceStats
          requests={c.canonical_requests}
          cats={c.canonical_cats}
          children={c.canonical_children}
          people={c.canonical_people}
          kind={c.canonical_kind}
        />
      </div>
    ),

    renderDuplicate: (c) => (
      <div
        style={{
          padding: "0.75rem",
          background: "rgba(108, 117, 125, 0.08)",
          borderRadius: "8px",
          border: "1px solid rgba(108, 117, 125, 0.2)",
        }}
      >
        <div
          style={{
            fontSize: "0.65rem",
            textTransform: "uppercase",
            color: "#6c757d",
            marginBottom: "0.25rem",
            fontWeight: 600,
          }}
        >
          Merge Into Canonical
        </div>
        <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "0.25rem" }}>
          <a
            href={`/places/${c.duplicate_place_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline dotted" }}
          >
            {c.duplicate_address || "(no address)"}
          </a>
        </div>
        {c.duplicate_name && (
          <div className="text-muted text-sm" style={{ marginBottom: "0.5rem" }}>
            {c.duplicate_name}
          </div>
        )}
        <PlaceStats
          requests={c.duplicate_requests}
          cats={c.duplicate_cats}
          children={c.duplicate_children}
          people={c.duplicate_people}
          kind={c.duplicate_kind}
        />
      </div>
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
              c.address_similarity >= 0.8
                ? "#198754"
                : c.address_similarity >= 0.5
                  ? "#fd7e14"
                  : "#dc3545",
          }}
        >
          {Math.round(c.address_similarity * 100)}%
        </div>
        <div className="text-muted" style={{ fontSize: "0.7rem" }}>
          address
        </div>
        {c.distance_meters != null ? (
          <>
            <div style={{ fontSize: "1rem", fontWeight: 600, marginTop: "0.25rem" }}>
              {c.distance_meters}m
            </div>
            <div className="text-muted" style={{ fontSize: "0.7rem" }}>
              apart
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "#6c757d",
                marginTop: "0.25rem",
              }}
            >
              N/A
            </div>
            <div className="text-muted" style={{ fontSize: "0.7rem" }}>
              no coords
            </div>
          </>
        )}
      </div>
    ),

    renderHeaderMeta: (c) => (
      <>
        <span className="text-muted text-sm">
          {c.distance_meters != null ? `${c.distance_meters}m apart` : "no coords"}
        </span>
        <span className="text-muted text-sm">
          {Math.round(c.address_similarity * 100)}% address match
        </span>
      </>
    ),
  };
}

export default function PlaceDedupPage() {
  const [autoMerging, setAutoMerging] = useState(false);
  const [autoMergeStatus, setAutoMergeStatus] = useState("");

  const handleAutoMerge = async () => {
    setAutoMerging(true);
    setAutoMergeStatus("Fetching all Tier 1 candidates...");
    try {
      let allCandidates: PlaceDedupCandidate[] = [];
      let fetchOffset = 0;
      const fetchLimit = 250;
      let hasMore = true;

      while (hasMore) {
        const result = await fetchApi<PlaceDedupResponse>(
          `/api/admin/place-dedup?tier=1&limit=${fetchLimit}&offset=${fetchOffset}`
        );
        allCandidates = allCandidates.concat(result.candidates);
        hasMore = result.pagination.hasMore;
        fetchOffset += fetchLimit;
      }

      const highConfidence = allCandidates.filter(
        (c) => c.address_similarity >= 0.9 && c.distance_meters != null && c.distance_meters < 10
      );

      if (highConfidence.length === 0) {
        alert(
          "No high-confidence pairs found (need >= 90% address match AND < 10m distance)."
        );
        return;
      }

      if (
        !confirm(
          `Auto-merge ${highConfidence.length} high-confidence pairs?\n\n` +
            `Criteria: >= 90% address similarity AND < 10m apart.\n` +
            `Each merge goes through sot.place_safe_to_merge() gate.\n\n` +
            `Total Tier 1 candidates: ${allCandidates.length}\n` +
            `Qualifying for auto-merge: ${highConfidence.length}`
        )
      ) {
        return;
      }

      const batchSize = 50;
      let totalSuccess = 0;
      let totalErrors = 0;
      const errorMessages: string[] = [];

      for (let i = 0; i < highConfidence.length; i += batchSize) {
        const batch = highConfidence.slice(i, i + batchSize);
        const pairs = batch.map((c) => ({
          candidate_id: c.candidate_id,
          canonical_place_id: c.canonical_place_id,
          duplicate_place_id: c.duplicate_place_id,
        }));

        setAutoMergeStatus(
          `Merging batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(highConfidence.length / batchSize)} ` +
            `(${i + 1}-${Math.min(i + batchSize, highConfidence.length)} of ${highConfidence.length})...`
        );

        try {
          const result = await postApi<{
            success: number;
            errors: number;
            results: Array<{ success: boolean; error?: string }>;
          }>("/api/admin/place-dedup", {
            action: "merge",
            pairs,
            reason: "auto_merge_high_confidence",
          });
          totalSuccess += result.success;
          totalErrors += result.errors;
          if (result.errors > 0) {
            result.results
              .filter((r) => !r.success)
              .forEach((r) => errorMessages.push(r.error || "Unknown"));
          }
        } catch (error) {
          totalErrors += batch.length;
          errorMessages.push(error instanceof Error ? error.message : "Batch failed");
        }
      }

      alert(
        `Auto-merge complete!\n\n` +
          `Merged: ${totalSuccess}\n` +
          `Errors: ${totalErrors}` +
          (errorMessages.length > 0
            ? `\n\nFirst errors: ${errorMessages.slice(0, 5).join("; ")}`
            : "")
      );
    } catch (error) {
      console.error("Auto-merge failed:", error);
      alert(
        `Auto-merge failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setAutoMerging(false);
      setAutoMergeStatus("");
    }
  };

  const config = makeConfig(handleAutoMerge, autoMerging, autoMergeStatus);

  return <DedupPageLayout config={config} />;
}
