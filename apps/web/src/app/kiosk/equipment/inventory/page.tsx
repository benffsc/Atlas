"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApiWithMeta } from "@/lib/api-client";
import { getCustodyStyle } from "@/lib/equipment-styles";
import { Button } from "@/components/ui/Button";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

const FILTER_OPTIONS: { label: string; value: string }[] = [
  { label: "Available", value: "available" },
  { label: "Checked Out", value: "checked_out" },
  { label: "Maintenance", value: "maintenance" },
  { label: "Missing", value: "missing" },
];

// ---------------------------------------------------------------------------
// Skeleton cards for loading state
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div
      style={{
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        border: "1px solid var(--card-border)",
        background: "var(--card-bg, #fff)",
        boxShadow: "var(--shadow-xs)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              width: "60%",
              height: 18,
              borderRadius: 4,
              background: "var(--muted-bg, #e5e7eb)",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          <div
            style={{
              width: "35%",
              height: 14,
              borderRadius: 4,
              marginTop: 8,
              background: "var(--muted-bg, #e5e7eb)",
              animation: "pulse 1.5s ease-in-out infinite",
              animationDelay: "0.1s",
            }}
          />
        </div>
        <div
          style={{
            width: 80,
            height: 24,
            borderRadius: 12,
            background: "var(--muted-bg, #e5e7eb)",
            animation: "pulse 1.5s ease-in-out infinite",
            animationDelay: "0.2s",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function KioskEquipmentInventoryPage() {
  const router = useRouter();

  // State
  const [equipment, setEquipment] = useState<VEquipmentInventoryRow[]>([]);
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  // Refs for debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Build API URL from current filters
  const buildUrl = useCallback(
    (currentOffset: number) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(currentOffset));
      if (search.trim()) {
        params.set("search", search.trim());
      }
      // When multiple filters are active, we need to send them individually.
      // The API accepts a single custody_status, so for multi-filter we fetch
      // without custody_status and filter client-side, OR we only allow one at a time.
      // Given the API accepts one value, we handle multi-select by fetching
      // without a custody_status filter and filtering client-side.
      // Actually, for better UX with server-side filtering when only one is active:
      if (activeFilters.size === 1) {
        params.set("custody_status", [...activeFilters][0]);
      }
      return `/api/equipment?${params.toString()}`;
    },
    [search, activeFilters],
  );

  // Fetch equipment
  const fetchEquipment = useCallback(
    async (isLoadMore = false) => {
      // Abort previous request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      const currentOffset = isLoadMore ? offset + PAGE_SIZE : 0;
      if (!isLoadMore) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const url = buildUrl(currentOffset);
        const result = await fetchApiWithMeta<{ equipment: VEquipmentInventoryRow[] }>(url, {
          signal: controller.signal,
        });

        let items = result.data.equipment;

        // Client-side filter when multiple custody filters active
        if (activeFilters.size > 1) {
          items = items.filter((e) => activeFilters.has(e.custody_status));
        }

        if (isLoadMore) {
          setEquipment((prev) => [...prev, ...items]);
        } else {
          setEquipment(items);
        }

        setOffset(currentOffset);
        setHasMore(result.meta?.hasMore ?? false);
        setTotal(result.meta?.total ?? 0);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to fetch equipment:", err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [buildUrl, offset, activeFilters],
  );

  // Debounced fetch on search/filter change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      fetchEquipment(false);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeFilters]);

  // Initial load (immediate, not debounced)
  useEffect(() => {
    fetchEquipment(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle filter chip
  const toggleFilter = (value: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  // Navigate to scan page with barcode pre-filled
  const handleCardTap = (barcode: string | null) => {
    if (!barcode) return;
    router.push(`/kiosk/equipment/scan?barcode=${encodeURIComponent(barcode)}`);
  };

  // Format custody status for display
  const formatStatus = (status: string): string => {
    return status
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  return (
    <div style={{ padding: 16, maxWidth: 600, margin: "0 auto" }}>
      {/* Pulse animation keyframe */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Page header */}
      <h1
        style={{
          fontSize: "1.25rem",
          fontWeight: 700,
          color: "var(--text-primary)",
          margin: "0 0 16px 0",
        }}
      >
        Equipment Inventory
      </h1>

      {/* Search bar */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        {/* Magnifying glass icon */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-tertiary, #9ca3af)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: "absolute",
            left: 14,
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
          }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search by name, barcode, or custodian..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            height: 48,
            borderRadius: 12,
            border: "2px solid var(--card-border)",
            padding: "0 16px 0 44px",
            fontSize: "1rem",
            color: "var(--text-primary)",
            background: "var(--card-bg, #fff)",
            outline: "none",
            boxSizing: "border-box",
            WebkitAppearance: "none",
            transition: "border-color 150ms ease",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--primary)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--card-border)";
          }}
        />
      </div>

      {/* Filter chips */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          paddingBottom: 4,
        }}
      >
        {FILTER_OPTIONS.map((opt) => {
          const isActive = activeFilters.has(opt.value);
          const style = getCustodyStyle(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => toggleFilter(opt.value)}
              style={{
                height: 36,
                minWidth: 48,
                padding: "0 12px",
                borderRadius: 18,
                border: `1px solid ${isActive ? style.border : "var(--card-border)"}`,
                background: isActive ? style.bg : "var(--card-bg, #fff)",
                color: isActive ? style.text : "var(--text-secondary)",
                fontSize: "0.85rem",
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 150ms ease",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Result count */}
      {!loading && (
        <p
          style={{
            fontSize: "0.8rem",
            color: "var(--text-tertiary, #6b7280)",
            margin: "0 0 12px 0",
          }}
        >
          {total} item{total !== 1 ? "s" : ""} found
        </p>
      )}

      {/* Loading skeleton */}
      {loading && (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}

      {/* Equipment cards */}
      {!loading && equipment.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "48px 16px",
            color: "var(--text-tertiary, #6b7280)",
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginBottom: 12, opacity: 0.5 }}
          >
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <polyline points="16 21 12 17 8 21" />
            <line x1="12" y1="3" x2="12" y2="7" />
          </svg>
          <p style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 4px 0" }}>
            No equipment found
          </p>
          <p style={{ fontSize: "0.875rem", margin: 0 }}>
            Try adjusting your search or filters
          </p>
        </div>
      )}

      {!loading &&
        equipment.map((item) => {
          const custodyStyle = getCustodyStyle(item.custody_status);
          const isCheckedOut = item.custody_status === "checked_out" || item.custody_status === "in_field";

          return (
            <button
              key={item.equipment_id}
              onClick={() => handleCardTap(item.barcode)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                borderRadius: 12,
                padding: 16,
                marginBottom: 12,
                border: "1px solid var(--card-border)",
                background: "var(--card-bg, #fff)",
                boxShadow: "var(--shadow-xs)",
                cursor: item.barcode ? "pointer" : "default",
                WebkitTapHighlightColor: "transparent",
                transition: "box-shadow 150ms ease, border-color 150ms ease",
                outline: "none",
                fontFamily: "inherit",
              }}
              onTouchStart={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                e.currentTarget.style.borderColor = "var(--primary)";
              }}
              onTouchEnd={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-xs)";
                e.currentTarget.style.borderColor = "var(--card-border)";
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                e.currentTarget.style.borderColor = "var(--primary)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow-xs)";
                e.currentTarget.style.borderColor = "var(--card-border)";
              }}
            >
              {/* Top row: name + badge */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: "1rem",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.display_name}
                  </p>
                  {item.barcode && (
                    <p
                      style={{
                        fontSize: "0.8rem",
                        fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
                        color: "var(--text-tertiary, #6b7280)",
                        margin: "4px 0 0 0",
                        letterSpacing: "0.02em",
                      }}
                    >
                      {item.barcode}
                    </p>
                  )}
                </div>

                {/* Status badge */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    height: 26,
                    padding: "0 10px",
                    borderRadius: 13,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    background: custodyStyle.bg,
                    border: `1px solid ${custodyStyle.border}`,
                    color: custodyStyle.text,
                    flexShrink: 0,
                  }}
                >
                  {formatStatus(item.custody_status)}
                </span>
              </div>

              {/* Checked-out details */}
              {isCheckedOut && (item.custodian_name || item.days_checked_out != null) && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid var(--border, #e5e7eb)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {item.custodian_name && (
                    <span
                      style={{
                        fontSize: "0.85rem",
                        color: "var(--text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {item.custodian_name}
                    </span>
                  )}
                  {item.days_checked_out != null && item.days_checked_out > 0 && (
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-tertiary, #6b7280)",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      ({item.days_checked_out} day{item.days_checked_out !== 1 ? "s" : ""})
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}

      {/* Load More */}
      {!loading && hasMore && (
        <div style={{ padding: "8px 0 24px", textAlign: "center" }}>
          <Button
            variant="outline"
            size="lg"
            loading={loadingMore}
            fullWidth
            onClick={() => fetchEquipment(true)}
            style={{ minHeight: 48 }}
          >
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
