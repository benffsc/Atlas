"use client";

import { useState, useEffect, useCallback } from "react";

export interface RequestFilters {
  status?: string[];
  priority?: string[];
  assignedTo?: string;
  placeLocality?: string;
  hasKittens?: boolean;
  dateRange?: string;
  search?: string;
  trapperStatus?: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  filters: RequestFilters;
  isPreset?: boolean;
  createdAt?: string;
}

interface SavedFiltersProps {
  currentFilters: RequestFilters;
  onApplyFilter: (filters: RequestFilters) => void;
  currentStaffId?: string | null;
}

const PRESET_FILTERS: SavedFilter[] = [
  {
    id: "all-active",
    name: "All Active",
    filters: { status: ["new", "triaged", "scheduled", "in_progress", "on_hold"] },
    isPreset: true,
  },
  {
    id: "needs-triage",
    name: "Needs Triage",
    filters: { status: ["new"] },
    isPreset: true,
  },
  {
    id: "urgent",
    name: "Urgent",
    filters: { priority: ["urgent"] },
    isPreset: true,
  },
  {
    id: "with-kittens",
    name: "Has Kittens",
    filters: { hasKittens: true },
    isPreset: true,
  },
  {
    id: "on-hold",
    name: "On Hold",
    filters: { status: ["on_hold"] },
    isPreset: true,
  },
  {
    id: "scheduled",
    name: "Scheduled",
    filters: { status: ["scheduled"] },
    isPreset: true,
  },
  {
    id: "in-progress",
    name: "In Progress",
    filters: { status: ["in_progress"] },
    isPreset: true,
  },
];

const STORAGE_KEY = "atlas-saved-request-filters";

function filtersEqual(a: RequestFilters, b: RequestFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function filtersEmpty(filters: RequestFilters): boolean {
  return (
    (!filters.status || filters.status.length === 0) &&
    (!filters.priority || filters.priority.length === 0) &&
    !filters.assignedTo &&
    !filters.placeLocality &&
    filters.hasKittens === undefined &&
    !filters.dateRange &&
    !filters.search
  );
}

export function SavedFilters({ currentFilters, onApplyFilter, currentStaffId }: SavedFiltersProps) {
  const [customFilters, setCustomFilters] = useState<SavedFilter[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newFilterName, setNewFilterName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load custom filters from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setCustomFilters(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Add "My Assigned" preset if we have a staff ID
  const presetsWithAssigned = currentStaffId
    ? [
        {
          id: "my-assigned",
          name: "My Assigned",
          filters: { assignedTo: currentStaffId },
          isPreset: true,
        },
        ...PRESET_FILTERS,
      ]
    : PRESET_FILTERS;

  const allFilters = [...presetsWithAssigned, ...customFilters];

  // Find active filter (if current filters match any saved filter)
  const activeFilter = allFilters.find((f) => filtersEqual(f.filters, currentFilters));

  const saveFilter = useCallback(() => {
    if (!newFilterName.trim()) {
      setSaveError("Please enter a filter name");
      return;
    }

    if (filtersEmpty(currentFilters)) {
      setSaveError("No filters to save - apply some filters first");
      return;
    }

    const newFilter: SavedFilter = {
      id: `custom-${Date.now()}`,
      name: newFilterName.trim(),
      filters: { ...currentFilters },
      createdAt: new Date().toISOString(),
    };

    const updated = [...customFilters, newFilter];
    setCustomFilters(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore localStorage errors
    }

    setNewFilterName("");
    setShowSaveModal(false);
    setSaveError(null);
  }, [newFilterName, currentFilters, customFilters]);

  const deleteFilter = useCallback((filterId: string) => {
    const updated = customFilters.filter((f) => f.id !== filterId);
    setCustomFilters(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore localStorage errors
    }
  }, [customFilters]);

  const handleApplyFilter = (filter: SavedFilter) => {
    onApplyFilter(filter.filters);
    setShowDropdown(false);
  };

  const clearFilters = () => {
    onApplyFilter({});
    setShowDropdown(false);
  };

  const hasActiveFilters = !filtersEmpty(currentFilters);
  const isCustomFilterActive = hasActiveFilters && !activeFilter;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        {/* Filter chips for quick access */}
        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
          {presetsWithAssigned.slice(0, 4).map((filter) => {
            const isActive = filtersEqual(filter.filters, currentFilters);
            return (
              <button
                key={filter.id}
                onClick={() => handleApplyFilter(filter)}
                style={{
                  padding: "0.35rem 0.75rem",
                  fontSize: "0.8rem",
                  borderRadius: "16px",
                  border: isActive ? "1px solid var(--primary)" : "1px solid var(--border)",
                  background: isActive ? "var(--primary)" : "var(--background)",
                  color: isActive ? "white" : "var(--foreground)",
                  cursor: "pointer",
                  fontWeight: isActive ? 600 : 400,
                  transition: "all 0.15s",
                }}
              >
                {filter.name}
              </button>
            );
          })}
        </div>

        {/* More filters dropdown */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.8rem",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--foreground)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
            }}
          >
            <span>More</span>
            <span style={{ fontSize: "0.7rem" }}>{showDropdown ? "▲" : "▼"}</span>
          </button>

          {showDropdown && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                minWidth: "200px",
                background: "var(--background)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                zIndex: 100,
                overflow: "hidden",
              }}
            >
              {/* Preset filters */}
              <div style={{ padding: "0.5rem 0" }}>
                <div
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    padding: "0.25rem 0.75rem",
                    textTransform: "uppercase",
                  }}
                >
                  Preset Filters
                </div>
                {presetsWithAssigned.map((filter) => {
                  const isActive = filtersEqual(filter.filters, currentFilters);
                  return (
                    <button
                      key={filter.id}
                      onClick={() => handleApplyFilter(filter)}
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        textAlign: "left",
                        background: isActive ? "var(--section-bg)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: "0.85rem",
                        color: "var(--foreground)",
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = "var(--section-bg)";
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = isActive ? "var(--section-bg)" : "transparent";
                      }}
                    >
                      <span>{filter.name}</span>
                      {isActive && <span style={{ color: "var(--primary)", fontSize: "0.75rem" }}>Active</span>}
                    </button>
                  );
                })}
              </div>

              {/* Custom filters */}
              {customFilters.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0" }}>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      padding: "0.25rem 0.75rem",
                      textTransform: "uppercase",
                    }}
                  >
                    My Saved Filters
                  </div>
                  {customFilters.map((filter) => {
                    const isActive = filtersEqual(filter.filters, currentFilters);
                    return (
                      <div
                        key={filter.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "0.5rem 0.75rem",
                          background: isActive ? "var(--section-bg)" : "transparent",
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.background = "var(--section-bg)";
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.background = isActive ? "var(--section-bg)" : "transparent";
                        }}
                      >
                        <button
                          onClick={() => handleApplyFilter(filter)}
                          style={{
                            flex: 1,
                            textAlign: "left",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                            color: "var(--foreground)",
                            padding: 0,
                          }}
                        >
                          {filter.name}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteFilter(filter.id);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "#dc3545",
                            fontSize: "0.75rem",
                            padding: "0.25rem",
                          }}
                          title="Delete filter"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Clear filters */}
              {hasActiveFilters && (
                <div style={{ borderTop: "1px solid var(--border)", padding: "0.5rem" }}>
                  <button
                    onClick={clearFilters}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      background: "transparent",
                      border: "1px dashed var(--border)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    Clear All Filters
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Save current filter button */}
        {isCustomFilterActive && (
          <button
            onClick={() => setShowSaveModal(true)}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.8rem",
              borderRadius: "16px",
              border: "1px dashed var(--primary)",
              background: "transparent",
              color: "var(--primary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
            }}
          >
            <span>+</span>
            <span>Save Filter</span>
          </button>
        )}

        {/* Active filter indicator */}
        {activeFilter && (
          <span
            style={{
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              padding: "0.35rem 0",
            }}
          >
            Viewing: <strong>{activeFilter.name}</strong>
          </span>
        )}
      </div>

      {/* Save modal */}
      {showSaveModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowSaveModal(false)}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              width: "100%",
              maxWidth: "400px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Save Current Filters</h3>

            {saveError && (
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "#f8d7da",
                  color: "#721c24",
                  borderRadius: "6px",
                  marginBottom: "1rem",
                  fontSize: "0.85rem",
                }}
              >
                {saveError}
              </div>
            )}

            <div style={{ marginBottom: "1rem" }}>
              <label
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontWeight: 500,
                  fontSize: "0.9rem",
                }}
              >
                Filter Name
              </label>
              <input
                type="text"
                value={newFilterName}
                onChange={(e) => setNewFilterName(e.target.value)}
                placeholder="e.g., Petaluma Urgent, This Week's Schedule"
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  fontSize: "0.9rem",
                }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    saveFilter();
                  }
                }}
              />
            </div>

            <div style={{ marginBottom: "1rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Current filters:
              <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
                {currentFilters.status && currentFilters.status.length > 0 && (
                  <li>Status: {currentFilters.status.join(", ")}</li>
                )}
                {currentFilters.priority && currentFilters.priority.length > 0 && (
                  <li>Priority: {currentFilters.priority.join(", ")}</li>
                )}
                {currentFilters.assignedTo && <li>Assigned to: {currentFilters.assignedTo}</li>}
                {currentFilters.placeLocality && <li>Location: {currentFilters.placeLocality}</li>}
                {currentFilters.hasKittens && <li>Has kittens</li>}
                {currentFilters.dateRange && <li>Date range: {currentFilters.dateRange}</li>}
                {currentFilters.search && <li>Search: {currentFilters.search}</li>}
              </ul>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowSaveModal(false);
                  setSaveError(null);
                  setNewFilterName("");
                }}
                style={{
                  padding: "0.5rem 1rem",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveFilter}
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--primary)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Save Filter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close dropdown */}
      {showDropdown && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99 }}
          onClick={() => setShowDropdown(false)}
        />
      )}
    </div>
  );
}
