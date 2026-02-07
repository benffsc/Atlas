"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ReviewComparisonCard,
  BatchActionBar,
  ReviewStatsBar,
  ReviewFilterTabs,
} from "@/components/reviews";

interface UnifiedReviewItem {
  id: string;
  source: "dedup" | "tier4" | "data_engine";
  tier: number;
  tierLabel: string;
  tierColor: string;
  similarity: number;
  matchReason: string;
  queueHours: number;
  left: {
    id: string;
    name: string;
    emails: string[] | null;
    phones: string[] | null;
    address: string | null;
    createdAt: string | null;
    cats: number;
    requests: number;
    appointments: number;
    places: number;
  };
  right: {
    id: string | null;
    name: string;
    emails: string[] | null;
    phones: string[] | null;
    address: string | null;
    source: string | null;
  };
}

interface ReviewStats {
  total: number;
  tier1: number;
  tier2: number;
  tier3: number;
  tier4: number;
  tier5: number;
  uncertain: number;
}

interface ReviewResponse {
  items: UnifiedReviewItem[];
  stats: ReviewStats;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

const FILTER_TABS = [
  { key: "all", label: "All", color: "#6c757d" },
  { key: "tier4", label: "Name + Address", color: "#6f42c1" },
  { key: "tier2", label: "Phone + Name", color: "#0d6efd" },
  { key: "tier1", label: "Email", color: "#198754" },
  { key: "tier3", label: "Phone Only", color: "#fd7e14" },
  { key: "tier5", label: "Name Only", color: "#dc3545" },
  { key: "uncertain", label: "Uncertain", color: "#6c757d" },
];

function formatQueueTime(hours: number): string {
  if (hours < 1) return "< 1 hour";
  if (hours < 24) return `${Math.round(hours)} hours`;
  const days = Math.round(hours / 24);
  return `${days} day${days !== 1 ? "s" : ""}`;
}

export default function IdentityReviewPage() {
  return (
    <Suspense fallback={<div className="loading">Loading reviews...</div>}>
      <IdentityReviewContent />
    </Suspense>
  );
}

function IdentityReviewContent() {
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get("filter") || "all";

  const [data, setData] = useState<ReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolving, setResolving] = useState<string | null>(null);
  const [batchProcessing, setBatchProcessing] = useState(false);

  const limit = 30;

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (filter && filter !== "all") {
        params.set("filter", filter);
      }
      const res = await fetch(`/api/admin/reviews/identity?${params}`);
      const result = await res.json();
      setData(result);
    } catch (error) {
      console.error("Failed to fetch identity reviews:", error);
    } finally {
      setLoading(false);
    }
  }, [filter, offset]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [filter]);

  const handleResolve = async (id: string, action: "merge" | "keep_separate" | "dismiss") => {
    setResolving(id);
    try {
      const res = await fetch("/api/admin/reviews/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (res.ok) {
        fetchItems();
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
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

  const handleBatchResolve = async (action: "merge" | "keep_separate" | "dismiss") => {
    if (!selected.size) return;
    const actionLabel =
      action === "merge" ? "Merge" : action === "keep_separate" ? "Keep separate" : "Dismiss";
    if (!confirm(`${actionLabel} ${selected.size} selected item(s)?`)) return;

    setBatchProcessing(true);
    const ids = Array.from(selected);
    let successCount = 0;
    let errorCount = 0;

    for (const id of ids) {
      try {
        const res = await fetch("/api/admin/reviews/identity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        if (res.ok) successCount++;
        else errorCount++;
      } catch {
        errorCount++;
      }
    }

    if (errorCount > 0) {
      alert(`${successCount} succeeded, ${errorCount} failed`);
    }
    setSelected(new Set());
    fetchItems();
    setBatchProcessing(false);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!data) return;
    if (selected.size === data.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.items.map((item) => item.id)));
    }
  };

  // Build tab counts
  const tabsWithCounts = FILTER_TABS.map((tab) => ({
    ...tab,
    count:
      tab.key === "all"
        ? data?.stats.total || 0
        : tab.key === "tier1"
          ? data?.stats.tier1 || 0
          : tab.key === "tier2"
            ? data?.stats.tier2 || 0
            : tab.key === "tier3"
              ? data?.stats.tier3 || 0
              : tab.key === "tier4"
                ? data?.stats.tier4 || 0
                : tab.key === "tier5"
                  ? data?.stats.tier5 || 0
                  : data?.stats.uncertain || 0,
  }));

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Identity Review</h1>
          <p className="text-muted">
            Unified person duplicate detection and identity matching review
          </p>
        </div>
        <a
          href="/admin/reviews"
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            textDecoration: "none",
            color: "var(--foreground)",
          }}
        >
          Back to Hub
        </a>
      </div>

      {/* Stats */}
      {data?.stats && (
        <ReviewStatsBar
          showTotal={true}
          stats={[
            { label: "Tier 4", count: data.stats.tier4, color: "#6f42c1" },
            { label: "Phone+Name", count: data.stats.tier2, color: "#0d6efd" },
            { label: "Email", count: data.stats.tier1, color: "#198754" },
            { label: "Phone Only", count: data.stats.tier3, color: "#fd7e14" },
            { label: "Name Only", count: data.stats.tier5, color: "#dc3545" },
            { label: "Uncertain", count: data.stats.uncertain, color: "#6c757d" },
          ]}
        />
      )}

      {/* Guidance */}
      <div
        className="card"
        style={{
          padding: "1rem",
          marginBottom: "1.5rem",
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "0.5rem", fontSize: "0.875rem" }}>
          Review Guide:
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8125rem", color: "#334155" }}>
          <li>
            <strong>Same name, different phone/email:</strong> Usually same person with new contact info. <strong>Merge</strong>.
          </li>
          <li>
            <strong>Different names, shared identifier:</strong> Likely household members or organization. <strong>Keep Separate</strong>.
          </li>
          <li>
            <strong>Name + Address match:</strong> High confidence same person. <strong>Merge</strong> unless different contacts suggest otherwise.
          </li>
          <li>
            <strong>Uncertain (50-80%):</strong> Review carefully. Business names or similar names at different locations.
          </li>
        </ul>
      </div>

      {/* Filter Tabs */}
      <ReviewFilterTabs
        tabs={tabsWithCounts}
        activeTab={filter}
        onTabChange={setFilter}
      />

      {/* Batch Actions */}
      <BatchActionBar
        selectedCount={selected.size}
        isProcessing={batchProcessing}
        onMergeAll={() => handleBatchResolve("merge")}
        onKeepAllSeparate={() => handleBatchResolve("keep_separate")}
        onDismissAll={() => handleBatchResolve("dismiss")}
        onClear={() => setSelected(new Set())}
      />

      {loading && <div className="loading">Loading reviews...</div>}

      {!loading && data?.items.length === 0 && (
        <div className="card" style={{ padding: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>All clear!</div>
          <p className="text-muted">
            No {filter !== "all" ? `${FILTER_TABS.find((t) => t.key === filter)?.label.toLowerCase()} ` : ""}
            identity reviews pending
          </p>
        </div>
      )}

      {/* Select All */}
      {!loading && data && data.items.length > 0 && (
        <div style={{ marginBottom: "0.5rem" }}>
          <label style={{ cursor: "pointer", fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={selected.size === data.items.length}
              onChange={selectAll}
              style={{ marginRight: "0.5rem" }}
            />
            Select all on this page
          </label>
        </div>
      )}

      {/* Review Cards */}
      {!loading &&
        data?.items.map((item) => (
          <ReviewComparisonCard
            key={item.id}
            id={item.id}
            matchType={item.source}
            matchTypeLabel={item.tierLabel}
            matchTypeColor={item.tierColor}
            similarity={item.similarity}
            similarityLabel="name match"
            leftEntity={{
              id: item.left.id,
              name: item.left.name,
              emails: item.left.emails,
              phones: item.left.phones,
              address: item.left.address,
              createdAt: item.left.createdAt,
              stats: {
                cats: item.left.cats,
                requests: item.left.requests,
                appointments: item.left.appointments,
                places: item.left.places,
              },
            }}
            rightEntity={{
              id: item.right.id || "",
              name: item.right.name,
              emails: item.right.emails,
              phones: item.right.phones,
              address: item.right.address,
              source: item.right.source,
            }}
            leftLabel="Existing (Keep)"
            rightLabel={item.source === "data_engine" ? "Incoming Data" : "Merge Into Existing"}
            queueTime={formatQueueTime(item.queueHours)}
            decisionReason={item.matchReason}
            isSelected={selected.has(item.id)}
            isResolving={resolving === item.id}
            onSelect={toggleSelect}
            onMerge={(id) => handleResolve(id, "merge")}
            onKeepSeparate={(id) => handleResolve(id, "keep_separate")}
            onDismiss={(id) => handleResolve(id, "dismiss")}
          />
        ))}

      {/* Pagination */}
      {!loading && data && data.pagination.hasMore && (
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
            Showing {offset + 1}–{offset + data.items.length}
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
