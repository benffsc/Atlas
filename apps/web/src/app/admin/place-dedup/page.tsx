"use client";

import { useState, useEffect, useCallback } from "react";

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
}

interface PlaceDedupSummary {
  match_tier: number;
  tier_label: string;
  pair_count: number;
}

interface PlaceDedupResponse {
  candidates: PlaceDedupCandidate[];
  summary: PlaceDedupSummary[];
  pagination: {
    tier: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  note?: string;
}

const TIER_TABS = [
  { tier: 0, label: "All", color: "#6c757d" },
  { tier: 1, label: "Close + Similar", color: "#198754" },
  { tier: 2, label: "Close + Different", color: "#fd7e14" },
  { tier: 3, label: "Farther + Similar", color: "#6f42c1" },
];

function tierColor(tier: number): string {
  return TIER_TABS.find((t) => t.tier === tier)?.color || "#6c757d";
}

function tierLabel(tier: number): string {
  return TIER_TABS.find((t) => t.tier === tier)?.label || `Tier ${tier}`;
}

function PlaceStats({
  requests,
  cats,
  children,
  kind,
}: {
  requests: number;
  cats: number;
  children: number;
  kind: string;
}) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.8rem", flexWrap: "wrap" }}>
      <span title="Service requests">{requests} requests</span>
      <span title="Cat relationships">{cats} cats</span>
      {children > 0 && <span title="Child units">{children} units</span>}
      {kind && <span title="Place kind" style={{ opacity: 0.7 }}>{kind}</span>}
    </div>
  );
}

export default function PlaceDedupPage() {
  const [data, setData] = useState<PlaceDedupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState(0);
  const [offset, setOffset] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState(false);

  const limit = 30;

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/place-dedup?tier=${tier}&limit=${limit}&offset=${offset}`
      );
      const result = await res.json();
      setData(result);
    } catch (error) {
      console.error("Failed to fetch place dedup candidates:", error);
    } finally {
      setLoading(false);
    }
  }, [tier, offset]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [tier]);

  const pairKey = (c: PlaceDedupCandidate) =>
    `${c.canonical_place_id}|${c.duplicate_place_id}|${c.candidate_id}`;

  const handleResolve = async (
    c: PlaceDedupCandidate,
    action: string
  ) => {
    const key = pairKey(c);
    setResolving(key);
    try {
      const res = await fetch("/api/admin/place-dedup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_id: c.candidate_id,
          canonical_place_id: c.canonical_place_id,
          duplicate_place_id: c.duplicate_place_id,
          action,
        }),
      });
      if (res.ok) {
        fetchCandidates();
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (error) {
      console.error("Failed to resolve:", error);
    } finally {
      setResolving(null);
    }
  };

  const handleBatchResolve = async (action: string) => {
    if (!selected.size) return;
    if (
      !confirm(
        `${action === "merge" ? "Merge" : action === "keep_separate" ? "Keep separate" : "Dismiss"} ${selected.size} selected pair(s)?`
      )
    )
      return;

    setBatchAction(true);
    const pairs = Array.from(selected).map((key) => {
      const [canonical_place_id, duplicate_place_id, candidate_id] = key.split("|");
      return { candidate_id, canonical_place_id, duplicate_place_id };
    });

    try {
      const res = await fetch("/api/admin/place-dedup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, pairs }),
      });
      const result = await res.json();
      if (result.errors > 0) {
        const failed = result.results
          .filter((r: { success: boolean; error?: string }) => !r.success)
          .map((r: { error?: string }) => r.error)
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

  const totalPairs =
    data?.summary.reduce((sum, s) => sum + s.pair_count, 0) || 0;

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem" }}>Place Dedup Review</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Geographic proximity + address similarity duplicate detection.
        Review and resolve candidate pairs.
      </p>

      {data?.note && (
        <div
          style={{
            padding: "1rem",
            background: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: "6px",
            marginBottom: "1.5rem",
          }}
        >
          {data.note}
        </div>
      )}

      {/* Dashboard summary */}
      {data?.summary && data.summary.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--bg-muted, #f8f9fa)",
              borderRadius: "8px",
              textAlign: "center",
              minWidth: "80px",
            }}
          >
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
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                {s.pair_count}
              </div>
              <div className="text-muted text-sm">{s.tier_label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tier filter tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        {TIER_TABS.map((tab) => {
          const count =
            tab.tier === 0
              ? totalPairs
              : data?.summary.find((s) => s.match_tier === tab.tier)
                  ?.pair_count || 0;
          return (
            <button
              key={tab.tier}
              onClick={() => setTier(tab.tier)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background:
                  tier === tab.tier ? tab.color : "transparent",
                color: tier === tab.tier ? "#fff" : "var(--foreground)",
                cursor: "pointer",
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: "0.5rem",
                  background:
                    tier === tab.tier
                      ? "rgba(255,255,255,0.2)"
                      : "var(--bg-muted)",
                  padding: "0.15rem 0.4rem",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Batch actions bar */}
      {selected.size > 0 && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            padding: "0.75rem 1rem",
            background: "var(--bg-muted, #f8f9fa)",
            borderRadius: "8px",
            marginBottom: "1rem",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 500, marginRight: "0.5rem" }}>
            {selected.size} selected
          </span>
          <button
            onClick={() => handleBatchResolve("merge")}
            disabled={batchAction}
            style={{
              padding: "0.4rem 0.75rem",
              background: "#fd7e14",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Merge All
          </button>
          <button
            onClick={() => handleBatchResolve("keep_separate")}
            disabled={batchAction}
            style={{
              padding: "0.4rem 0.75rem",
              background: "#198754",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Keep Separate All
          </button>
          <button
            onClick={() => handleBatchResolve("dismiss")}
            disabled={batchAction}
            style={{
              padding: "0.4rem 0.75rem",
              background: "#6c757d",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Dismiss All
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{
              padding: "0.4rem 0.75rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Clear Selection
          </button>
        </div>
      )}

      {loading && <div className="loading">Loading candidates...</div>}

      {!loading && data?.candidates.length === 0 && (
        <div className="empty">
          No {tier > 0 ? tierLabel(tier).toLowerCase() : ""} candidates
          remaining. All pairs have been resolved.
        </div>
      )}

      {/* Select all checkbox */}
      {!loading && data && data.candidates.length > 0 && (
        <div style={{ marginBottom: "0.5rem" }}>
          <label style={{ cursor: "pointer", fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={selected.size === data.candidates.length}
              onChange={selectAll}
              style={{ marginRight: "0.5rem" }}
            />
            Select all on this page
          </label>
        </div>
      )}

      {/* Candidate cards */}
      {!loading &&
        data?.candidates.map((c) => {
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
                background: isSelected
                  ? "rgba(13, 110, 253, 0.05)"
                  : undefined,
              }}
            >
              {/* Header row */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(key)}
                  />
                  <span
                    style={{
                      fontSize: "0.75rem",
                      padding: "0.2rem 0.5rem",
                      background: tierColor(c.match_tier),
                      color: "#fff",
                      borderRadius: "4px",
                    }}
                  >
                    {tierLabel(c.match_tier)}
                  </span>
                  <span className="text-muted text-sm">
                    {c.distance_meters}m apart
                  </span>
                  <span className="text-muted text-sm">
                    {Math.round(c.address_similarity * 100)}% address match
                  </span>
                </div>
              </div>

              {/* Side-by-side comparison */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  gap: "1rem",
                  alignItems: "stretch",
                }}
              >
                {/* Canonical place (keep) */}
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
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "1rem",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <a href={`/places/${c.canonical_place_id}`}>
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
                    kind={c.canonical_kind}
                  />
                </div>

                {/* Distance + similarity indicator */}
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
                  <div
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      marginTop: "0.25rem",
                    }}
                  >
                    {c.distance_meters}m
                  </div>
                  <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                    apart
                  </div>
                </div>

                {/* Duplicate place (absorb) */}
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
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: "1rem",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <a href={`/places/${c.duplicate_place_id}`}>
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
                    kind={c.duplicate_kind}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  marginTop: "0.75rem",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={() => handleResolve(c, "keep_separate")}
                  disabled={isResolving}
                  style={{
                    padding: "0.4rem 0.75rem",
                    background: "#198754",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Keep Separate
                </button>
                <button
                  onClick={() => handleResolve(c, "merge")}
                  disabled={isResolving}
                  style={{
                    padding: "0.4rem 0.75rem",
                    background: "#fd7e14",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Merge
                </button>
                <button
                  onClick={() => handleResolve(c, "dismiss")}
                  disabled={isResolving}
                  style={{
                    padding: "0.4rem 0.75rem",
                    background: "#6c757d",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Skip
                </button>
              </div>
            </div>
          );
        })}

      {/* Pagination */}
      {!loading && data && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "1.5rem",
          }}
        >
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "transparent",
              cursor: offset === 0 ? "default" : "pointer",
              opacity: offset === 0 ? 0.5 : 1,
            }}
          >
            Previous
          </button>
          <span className="text-muted text-sm">
            Showing {offset + 1}–
            {Math.min(offset + limit, offset + (data.candidates.length || 0))}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={!data.pagination.hasMore}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "transparent",
              cursor: !data.pagination.hasMore ? "default" : "pointer",
              opacity: !data.pagination.hasMore ? 0.5 : 1,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
