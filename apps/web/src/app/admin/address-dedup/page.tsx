"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";

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

interface AddressDedupSummary {
  match_tier: number;
  tier_label: string;
  pair_count: number;
}

interface AddressDedupResponse {
  candidates: AddressDedupCandidate[];
  summary: AddressDedupSummary[];
  pagination: { tier: number; limit: number; offset: number; hasMore: boolean };
  note?: string;
}

const TIER_TABS = [
  { tier: 0, label: "All", color: "#6c757d" },
  { tier: 1, label: "Exact Key", color: "#dc3545" },
  { tier: 2, label: "High Similarity", color: "#fd7e14" },
  { tier: 3, label: "Close Proximity", color: "#6f42c1" },
];

function tierColor(tier: number): string {
  return TIER_TABS.find((t) => t.tier === tier)?.color || "#6c757d";
}

function tierLabel(tier: number): string {
  return TIER_TABS.find((t) => t.tier === tier)?.label || `Tier ${tier}`;
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
          <span>{placeCount} place{placeCount !== 1 ? "s" : ""}</span>
          <span>{peopleCount} {peopleCount !== 1 ? "people" : "person"}</span>
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

export default function AddressDedupPage() {
  const [data, setData] = useState<AddressDedupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState(0);
  const [offset, setOffset] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const limit = 30;

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchApi<AddressDedupResponse>(
        `/api/admin/address-dedup?tier=${tierFilter}&limit=${limit}&offset=${offset}`
      );
      setData(result);
    } catch (error) {
      console.error("Failed to fetch address dedup candidates:", error);
    } finally {
      setLoading(false);
    }
  }, [tierFilter, offset]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [tierFilter]);

  const pairKey = (c: AddressDedupCandidate) =>
    `${c.canonical_address_id}|${c.duplicate_address_id}`;

  const handleResolve = async (c: AddressDedupCandidate, action: string) => {
    const key = pairKey(c);
    setResolving(key);
    try {
      await postApi("/api/admin/address-dedup", {
        canonical_address_id: c.canonical_address_id,
        duplicate_address_id: c.duplicate_address_id,
        candidate_id: c.candidate_id,
        action,
      });
      fetchCandidates();
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } catch (error) {
      console.error("Failed to resolve:", error);
      alert(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setResolving(null);
    }
  };

  const handleBatchResolve = async (action: string) => {
    if (!selected.size || !data) return;
    if (!confirm(`${action === "merge" ? "Merge" : "Keep separate"} ${selected.size} selected pair(s)?`))
      return;

    setBatchAction(true);
    const pairs = Array.from(selected).map((key) => {
      const [canonical_address_id, duplicate_address_id] = key.split("|");
      const candidate = data.candidates.find(
        (c) => c.canonical_address_id === canonical_address_id && c.duplicate_address_id === duplicate_address_id
      );
      return { canonical_address_id, duplicate_address_id, candidate_id: candidate?.candidate_id || "" };
    });

    try {
      const result = await postApi<{
        success: number;
        errors: number;
        results: Array<{ success: boolean; error?: string }>;
      }>("/api/admin/address-dedup", { action, pairs });
      if (result.errors > 0) {
        const failed = result.results
          .filter((r) => !r.success)
          .map((r) => r.error)
          .join(", ");
        alert(`${result.success} succeeded, ${result.errors} failed: ${failed}`);
      }
      setSelected(new Set());
      fetchCandidates();
    } catch (error) {
      console.error("Batch resolve failed:", error);
    } finally {
      setBatchAction(false);
    }
  };

  const handleRefresh = async () => {
    if (!confirm("Refresh address dedup candidates? This rescans all addresses.")) return;
    setRefreshing(true);
    try {
      const result = await postApi<{
        tier1_count: number;
        tier2_count: number;
        tier3_count: number;
        total: number;
      }>("/api/admin/address-dedup", { action: "refresh_candidates" });
      alert(`Refresh complete: ${result.tier1_count} exact key, ${result.tier2_count} high similarity, ${result.tier3_count} close proximity (${result.total} total)`);
      fetchCandidates();
    } catch (error) {
      console.error("Refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    if (!data) return;
    if (selected.size === data.candidates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.candidates.map(pairKey)));
    }
  };

  const totalPairs = data?.summary.reduce((sum, s) => sum + s.pair_count, 0) || 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h1 style={{ margin: 0 }}>Address Dedup Review</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            padding: "0.5rem 1rem",
            background: "#0d6efd",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: refreshing ? "default" : "pointer",
            opacity: refreshing ? 0.6 : 1,
            fontSize: "0.85rem",
          }}
        >
          {refreshing ? "Scanning..." : "Refresh Candidates"}
        </button>
      </div>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Deduplicate address records by normalized key, text similarity, and geocoding proximity.
      </p>

      {data?.note && (
        <div style={{ padding: "1rem", background: "#fff3cd", border: "1px solid #ffc107", borderRadius: "6px", marginBottom: "1.5rem" }}>
          {data.note}
        </div>
      )}

      {/* Dashboard summary */}
      {data?.summary && data.summary.length > 0 && (
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <div style={{ padding: "0.75rem 1rem", background: "var(--bg-muted, #f8f9fa)", borderRadius: "8px", textAlign: "center", minWidth: "80px" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{totalPairs}</div>
            <div className="text-muted text-sm">Total Pairs</div>
          </div>
          {data.summary.map((s) => (
            <div
              key={s.match_tier}
              style={{
                padding: "0.75rem 1rem",
                background: "var(--bg-muted, #f8f9fa)",
                borderRadius: "8px",
                textAlign: "center",
                minWidth: "80px",
                borderLeft: `3px solid ${tierColor(s.match_tier)}`,
              }}
            >
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{s.pair_count}</div>
              <div className="text-muted text-sm">{s.tier_label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tier filter tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {TIER_TABS.map((tab) => {
          const count = tab.tier === 0
            ? totalPairs
            : data?.summary.find((s) => s.match_tier === tab.tier)?.pair_count || 0;
          return (
            <button
              key={tab.tier}
              onClick={() => setTierFilter(tab.tier)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: tierFilter === tab.tier ? tab.color : "transparent",
                color: tierFilter === tab.tier ? "#fff" : "var(--foreground)",
                cursor: "pointer",
              }}
            >
              {tab.label}
              <span style={{ marginLeft: "0.5rem", background: tierFilter === tab.tier ? "rgba(255,255,255,0.2)" : "var(--bg-muted)", padding: "0.15rem 0.4rem", borderRadius: "4px", fontSize: "0.8rem" }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Batch actions bar */}
      {selected.size > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", padding: "0.75rem 1rem", background: "var(--bg-muted, #f8f9fa)", borderRadius: "8px", marginBottom: "1rem", alignItems: "center" }}>
          <span style={{ fontWeight: 500, marginRight: "0.5rem" }}>{selected.size} selected</span>
          <button onClick={() => handleBatchResolve("merge")} disabled={batchAction} style={{ padding: "0.4rem 0.75rem", background: "#fd7e14", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.85rem" }}>
            Merge All
          </button>
          <button onClick={() => handleBatchResolve("keep_separate")} disabled={batchAction} style={{ padding: "0.4rem 0.75rem", background: "#198754", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.85rem" }}>
            Keep Separate All
          </button>
          <button onClick={() => setSelected(new Set())} style={{ padding: "0.4rem 0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.85rem" }}>
            Clear Selection
          </button>
        </div>
      )}

      {loading && <div className="loading">Loading candidates...</div>}

      {!loading && data?.candidates.length === 0 && (
        <div className="empty">
          No {tierFilter > 0 ? tierLabel(tierFilter).toLowerCase() : ""} candidates remaining.
        </div>
      )}

      {/* Select all checkbox */}
      {!loading && data && data.candidates.length > 0 && (
        <div style={{ marginBottom: "0.5rem" }}>
          <label style={{ cursor: "pointer", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={selected.size === data.candidates.length} onChange={selectAll} style={{ marginRight: "0.5rem" }} />
            Select all on this page
          </label>
        </div>
      )}

      {/* Candidate cards */}
      {!loading && data?.candidates.map((c) => {
        const key = pairKey(c);
        const isSelected = selected.has(key);
        const isResolving = resolving === key;

        return (
          <div
            key={key}
            className="card"
            style={{
              padding: "1.25rem",
              marginBottom: "0.75rem",
              borderLeft: `4px solid ${tierColor(c.match_tier)}`,
              opacity: isResolving ? 0.6 : 1,
              background: isSelected ? "rgba(13, 110, 253, 0.05)" : undefined,
            }}
          >
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(key)} />
                <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", background: tierColor(c.match_tier), color: "#fff", borderRadius: "4px" }}>
                  {tierLabel(c.match_tier)}
                </span>
                <span className="text-muted text-sm">
                  {Math.round(c.address_similarity * 100)}% similarity
                </span>
                {c.distance_meters != null && (
                  <span className="text-muted text-sm">
                    {c.distance_meters < 1 ? "<1" : Math.round(c.distance_meters)}m apart
                  </span>
                )}
              </div>
            </div>

            {/* Side-by-side comparison */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1rem", alignItems: "stretch" }}>
              <AddressInfo
                formatted={c.canonical_formatted}
                city={c.canonical_city}
                placeCount={c.canonical_place_count}
                peopleCount={c.canonical_people_count}
                geocodingStatus={c.canonical_geocoding_status}
                label="Canonical"
                labelColor="#198754"
              />

              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: "70px" }}>
                <div style={{ fontSize: "1.4rem", fontWeight: 700, color: tierColor(c.match_tier) }}>
                  {Math.round(c.address_similarity * 100)}%
                </div>
                <div className="text-muted" style={{ fontSize: "0.7rem" }}>similarity</div>
              </div>

              <AddressInfo
                formatted={c.duplicate_formatted}
                city={c.duplicate_city}
                placeCount={c.duplicate_place_count}
                peopleCount={c.duplicate_people_count}
                geocodingStatus={c.duplicate_geocoding_status}
                label="Duplicate"
                labelColor="#6c757d"
              />
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => handleResolve(c, "keep_separate")}
                disabled={isResolving}
                style={{ padding: "0.4rem 0.75rem", background: "#198754", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.85rem" }}
              >
                Keep Separate
              </button>
              <button
                onClick={() => handleResolve(c, "merge")}
                disabled={isResolving}
                style={{ padding: "0.4rem 0.75rem", background: "#fd7e14", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.85rem" }}
              >
                Merge
              </button>
            </div>
          </div>
        );
      })}

      {/* Pagination */}
      {!loading && data && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.5rem" }}>
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", cursor: offset === 0 ? "default" : "pointer", opacity: offset === 0 ? 0.5 : 1 }}
          >
            Previous
          </button>
          <span className="text-muted text-sm">
            Showing {offset + 1}–{Math.min(offset + limit, offset + (data.candidates.length || 0))}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={!data.pagination.hasMore}
            style={{ padding: "0.5rem 1rem", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", cursor: !data.pagination.hasMore ? "default" : "pointer", opacity: !data.pagination.hasMore ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
