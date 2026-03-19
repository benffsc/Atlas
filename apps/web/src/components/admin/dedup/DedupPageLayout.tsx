"use client";

import { useState } from "react";
import type { DedupConfig } from "./types";
import { useDedupData } from "./useDedupData";
import { useDedupSelection } from "./useDedupSelection";
import { DedupSummaryBar } from "./DedupSummaryBar";
import { DedupBatchBar } from "./DedupBatchBar";
import { DedupPagination } from "./DedupPagination";
import { DedupCard } from "./DedupCard";

interface Props<C> {
  config: DedupConfig<C>;
}

export function DedupPageLayout<C>({ config }: Props<C>) {
  const {
    data,
    loading,
    filter,
    setFilter,
    offset,
    setOffset,
    limit,
    resolving,
    batchAction,
    fetchCandidates,
    handleResolve,
    handleBatchResolve,
    totalPairs,
  } = useDedupData(config);

  const { selected, toggleSelect, selectAll, clearSelection, removeFromSelection } =
    useDedupSelection();

  // Header action loading states
  const [headerLoading, setHeaderLoading] = useState<Record<string, boolean>>({});

  const handleHeaderAction = async (key: string, handler: () => Promise<void>, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setHeaderLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await handler();
      fetchCandidates();
    } catch (err) {
      console.error(`${key} failed:`, err);
    } finally {
      setHeaderLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Filter header actions by current filter
  const visibleHeaderActions = (config.headerActions || []).filter(
    (ha) => !ha.showWhenFilter || ha.showWhenFilter === filter
  );

  // Get summary counts for tabs
  const getTabCount = (tabValue: string): number => {
    if (tabValue === config.defaultFilterValue) return totalPairs;
    return (
      data?.summary.find((s) => String(s[config.summaryGroupKey]) === tabValue)?.pair_count || 0
    );
  };

  // Reset selection when filter changes
  const handleFilterChange = (newFilter: string) => {
    setFilter(newFilter);
    clearSelection();
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
        }}
      >
        <h1 style={{ margin: 0 }}>{config.entityName} Dedup Review</h1>
        {visibleHeaderActions.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {visibleHeaderActions.map((ha) => {
              const isLoading = headerLoading[ha.key] || false;
              return (
                <button
                  key={ha.key}
                  onClick={() => handleHeaderAction(ha.key, ha.handler, ha.confirmMessage)}
                  disabled={isLoading}
                  style={{
                    padding: "0.5rem 1rem",
                    background: ha.color,
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: isLoading ? "default" : "pointer",
                    opacity: isLoading ? 0.6 : 1,
                    fontSize: "0.85rem",
                  }}
                >
                  {isLoading ? ha.loadingLabel : ha.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        {config.description}
      </p>

      {/* Note banner */}
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

      {/* Summary bar */}
      {data && (
        <DedupSummaryBar config={config} summary={data.summary} totalPairs={totalPairs} data={data} />
      )}

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {config.tabs.map((tab) => {
          const count = getTabCount(tab.value);
          return (
            <button
              key={tab.value}
              onClick={() => handleFilterChange(tab.value)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: filter === tab.value ? tab.color : "transparent",
                color: filter === tab.value ? "#fff" : "var(--foreground)",
                cursor: "pointer",
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: "0.5rem",
                  background: filter === tab.value ? "rgba(255,255,255,0.2)" : "var(--bg-muted)",
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

      {/* Batch actions */}
      <DedupBatchBar
        config={config}
        selectedCount={selected.size}
        batchAction={batchAction}
        onBatchResolve={(action) =>
          handleBatchResolve(action, selected, data?.candidates || [], clearSelection)
        }
        onClearSelection={clearSelection}
      />

      {/* Loading */}
      {loading && <div className="loading">Loading candidates...</div>}

      {/* Empty state */}
      {!loading && data?.candidates.length === 0 && (
        <div className="empty">
          No{" "}
          {filter !== config.defaultFilterValue
            ? (config.tabs.find((t) => t.value === filter)?.label || "").toLowerCase() + " "
            : ""}
          candidates remaining.
        </div>
      )}

      {/* Select all */}
      {!loading && data && data.candidates.length > 0 && (
        <div style={{ marginBottom: "0.5rem" }}>
          <label style={{ cursor: "pointer", fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={selected.size === data.candidates.length}
              onChange={() => selectAll(data.candidates.map(config.getPairKey))}
              style={{ marginRight: "0.5rem" }}
            />
            Select all on this page
          </label>
        </div>
      )}

      {/* Cards */}
      {!loading &&
        data?.candidates.map((c) => {
          const key = config.getPairKey(c);
          return (
            <DedupCard
              key={key}
              config={config}
              candidate={c}
              isSelected={selected.has(key)}
              isResolving={resolving === key}
              onToggleSelect={() => toggleSelect(key)}
              onResolve={(action) => handleResolve(c, action, removeFromSelection)}
            />
          );
        })}

      {/* Pagination */}
      {!loading && data && data.candidates.length > 0 && (
        <DedupPagination
          offset={offset}
          limit={limit}
          hasMore={data.pagination.hasMore}
          candidateCount={data.candidates.length}
          onPrevious={() => setOffset(Math.max(0, offset - limit))}
          onNext={() => setOffset(offset + limit)}
        />
      )}
    </div>
  );
}
