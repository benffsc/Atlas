"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";

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

interface CatDedupSummary {
  recommended_action: string;
  pair_count: number;
}

interface CatDedupResponse {
  candidates: CatDedupCandidate[];
  summary: CatDedupSummary[];
  pagination: {
    action: string;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  note?: string;
}

const ACTION_TABS = [
  { action: "", label: "All", color: "#6c757d" },
  { action: "auto_merge", label: "Auto-Merge", color: "#dc3545" },
  { action: "review_high", label: "High", color: "#fd7e14" },
  { action: "review_medium", label: "Medium", color: "#6f42c1" },
  { action: "review_low", label: "Low", color: "#0dcaf0" },
];

function actionColor(action: string): string {
  return ACTION_TABS.find((t) => t.action === action)?.color || "#6c757d";
}

function actionLabel(action: string): string {
  return ACTION_TABS.find((t) => t.action === action)?.label || action;
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "duplicate_microchip": return "Exact Microchip";
    case "duplicate_clinichq_id": return "Exact ClinicHQ ID";
    case "microchip_typo": return "Microchip Typo";
    case "same_name_same_owner": return "Same Name + Owner";
    case "phonetic_name_match": return "Phonetic Name";
    default: return reason;
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

export default function CatDedupPage() {
  const [data, setData] = useState<CatDedupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState(false);
  const [scanning, setScanning] = useState(false);

  const limit = 30;

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchApi<CatDedupResponse>(
        `/api/admin/cat-dedup?action=${actionFilter}&limit=${limit}&offset=${offset}`
      );
      setData(result);
    } catch (error) {
      console.error("Failed to fetch cat dedup candidates:", error);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, offset]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [actionFilter]);

  const pairKey = (c: CatDedupCandidate) => `${c.cat_id_1}|${c.cat_id_2}`;

  const handleResolve = async (c: CatDedupCandidate, action: string) => {
    const key = pairKey(c);
    setResolving(key);
    try {
      await postApi("/api/admin/cat-dedup", {
        cat_id_1: c.cat_id_1,
        cat_id_2: c.cat_id_2,
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
    if (!selected.size) return;
    if (
      !confirm(
        `${action === "merge" ? "Merge" : "Keep separate"} ${selected.size} selected pair(s)?`
      )
    )
      return;

    setBatchAction(true);
    const pairs = Array.from(selected).map((key) => {
      const [cat_id_1, cat_id_2] = key.split("|");
      return { cat_id_1, cat_id_2 };
    });

    try {
      const result = await postApi<{
        success: number;
        errors: number;
        results: Array<{ success: boolean; error?: string }>;
      }>("/api/admin/cat-dedup", { action, pairs });
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

  const handleScan = async () => {
    if (!confirm("Run dedup scan? This refreshes common cat names and re-scans all cats."))
      return;
    setScanning(true);
    try {
      const result = await postApi<{
        same_owner_count: number;
        chip_typo_count: number;
        duplicate_id_count: number;
        phonetic_count: number;
      }>("/api/admin/cat-dedup", { action: "scan" });
      alert(
        `Scan complete: ${result.duplicate_id_count} duplicate IDs, ${result.chip_typo_count} chip typos, ${result.same_owner_count} same owner, ${result.phonetic_count} phonetic`
      );
      fetchCandidates();
    } catch (error) {
      console.error("Scan failed:", error);
    } finally {
      setScanning(false);
    }
  };

  const totalPairs =
    data?.summary.reduce((sum, s) => sum + s.pair_count, 0) || 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
        }}
      >
        <h1 style={{ margin: 0 }}>Cat Dedup Review</h1>
        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            padding: "0.5rem 1rem",
            background: "#0d6efd",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: scanning ? "default" : "pointer",
            opacity: scanning ? 0.6 : 1,
            fontSize: "0.85rem",
          }}
        >
          {scanning ? "Scanning..." : "Run Dedup Scan"}
        </button>
      </div>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Microchip, identifier, name, and phonetic duplicate detection for cats.
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
              key={s.recommended_action}
              style={{
                padding: "0.75rem 1rem",
                background: "var(--bg-muted, #f8f9fa)",
                borderRadius: "8px",
                textAlign: "center",
                minWidth: "80px",
                borderLeft: `3px solid ${actionColor(s.recommended_action)}`,
              }}
            >
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                {s.pair_count}
              </div>
              <div className="text-muted text-sm">
                {actionLabel(s.recommended_action)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action filter tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        {ACTION_TABS.map((tab) => {
          const count =
            tab.action === ""
              ? totalPairs
              : data?.summary.find((s) => s.recommended_action === tab.action)
                  ?.pair_count || 0;
          return (
            <button
              key={tab.action}
              onClick={() => setActionFilter(tab.action)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background:
                  actionFilter === tab.action ? tab.color : "transparent",
                color: actionFilter === tab.action ? "#fff" : "var(--foreground)",
                cursor: "pointer",
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: "0.5rem",
                  background:
                    actionFilter === tab.action
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
          No {actionFilter ? actionLabel(actionFilter).toLowerCase() : ""} candidates
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
                borderLeft: `4px solid ${actionColor(c.recommended_action)}`,
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
                      background: actionColor(c.recommended_action),
                      color: "#fff",
                      borderRadius: "4px",
                    }}
                  >
                    {actionLabel(c.recommended_action)}
                  </span>
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
                  <span className="text-muted text-sm">
                    {Math.round(c.confidence * 100)}% confidence
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
                {/* Cat 1 */}
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

                {/* Confidence indicator */}
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

                {/* Cat 2 */}
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
