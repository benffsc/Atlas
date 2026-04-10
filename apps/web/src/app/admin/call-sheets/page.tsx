"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { FilterBar, SearchInput, ToggleButtonGroup } from "@/components/filters";
import { Pagination } from "@/components/ui/Pagination";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/feedback/EmptyState";
import { RowActionMenu } from "@/components/shared/RowActionMenu";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { formatPhone, formatDateLocal, formatRelativeTime } from "@/lib/formatters";
import type {
  CallSheetSummary,
  CallSheetStatus,
  CreateCallSheetRequest,
  CreateCallSheetItemRequest,
} from "@/lib/call-sheet-types";
import {
  CALL_SHEET_STATUS_LABELS,
  CALL_SHEET_STATUS_COLORS,
} from "@/lib/call-sheet-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallSheetsResponse {
  sheets: CallSheetSummary[];
  stats: {
    total: number;
    active: number;
    follow_ups_pending: number;
    conversion_rate: number;
  };
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
    total: number;
  };
}

// ---------------------------------------------------------------------------
// Badge helper
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: CallSheetStatus }) {
  const colors = CALL_SHEET_STATUS_COLORS[status] || CALL_SHEET_STATUS_COLORS.draft;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: colors.bg,
        color: colors.color,
      }}
    >
      {CALL_SHEET_STATUS_LABELS[status] || status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div
      style={{
        height: "6px",
        borderRadius: "3px",
        background: "var(--bg-secondary)",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          borderRadius: "3px",
          background: "var(--success, #16a34a)",
          transition: "width 300ms ease",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet Card
// ---------------------------------------------------------------------------

function SheetCard({
  sheet,
  onClick,
  onPrint,
  onComplete,
  onDelete,
}: {
  sheet: CallSheetSummary;
  onClick: () => void;
  onPrint: () => void;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const isActive = sheet.status === "assigned" || sheet.status === "in_progress";

  return (
    <div
      onClick={onClick}
      style={{
        padding: "1rem",
        border: `1px solid ${sheet.is_overdue ? "var(--danger-border, #fca5a5)" : "var(--card-border)"}`,
        borderRadius: "8px",
        cursor: "pointer",
        background: sheet.is_overdue
          ? "var(--danger-bg, #fee2e2)"
          : "var(--card-bg)",
        transition: "border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = sheet.is_overdue
          ? "var(--danger-border, #fca5a5)"
          : "var(--card-border)";
      }}
    >
      {/* Row 1: Title + Status + Actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: "0.95rem",
              color: "var(--foreground)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sheet.title}
          </span>
          <StatusBadge status={sheet.status} />
          {sheet.is_overdue && (
            <span
              style={{
                fontSize: "0.65rem",
                padding: "0.1rem 0.35rem",
                borderRadius: "4px",
                background: "var(--danger-bg, #fee2e2)",
                color: "var(--danger-text, #991b1b)",
                fontWeight: 600,
              }}
            >
              OVERDUE
            </span>
          )}
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "View", onClick },
              { label: "Print", onClick: onPrint },
              ...(isActive
                ? [{ label: "Mark Complete", onClick: onComplete, dividerBefore: true }]
                : []),
              { label: "Delete", onClick: onDelete, variant: "danger" as const, dividerBefore: true },
            ]}
          />
        </div>
      </div>

      {/* Row 2: Trapper + Due date */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
        }}
      >
        <span>
          {sheet.assigned_to_name || (
            <span style={{ color: "var(--text-tertiary)" }}>Unassigned</span>
          )}
        </span>
        {sheet.due_date && (
          <span style={{ color: sheet.is_overdue ? "var(--danger-text, #991b1b)" : "var(--text-secondary)" }}>
            Due: {formatDateLocal(sheet.due_date)}
          </span>
        )}
      </div>

      {/* Row 3: Progress bar */}
      <div style={{ marginBottom: "0.5rem" }}>
        <ProgressBar completed={sheet.completed_items} total={sheet.total_items} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "0.25rem",
            fontSize: "0.7rem",
            color: "var(--text-tertiary)",
          }}
        >
          <span>
            {sheet.completed_items} / {sheet.total_items} completed
          </span>
          <span>
            {sheet.total_items > 0
              ? Math.round((sheet.completed_items / sheet.total_items) * 100)
              : 0}
            %
          </span>
        </div>
      </div>

      {/* Row 4: Quick stats */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
        }}
      >
        {sheet.pending_count > 0 && (
          <span>
            <strong style={{ color: "var(--text-primary)" }}>{sheet.pending_count}</strong> pending
          </span>
        )}
        {sheet.follow_up_count > 0 && (
          <span>
            <strong style={{ color: "var(--warning-text)" }}>{sheet.follow_up_count}</strong> follow-up
          </span>
        )}
        {sheet.converted_count > 0 && (
          <span>
            <strong style={{ color: "var(--success-text)" }}>{sheet.converted_count}</strong> converted
          </span>
        )}
        {sheet.dead_end_count > 0 && (
          <span>
            <strong style={{ color: "var(--text-tertiary)" }}>{sheet.dead_end_count}</strong> dead end
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Call Sheet Drawer
// ---------------------------------------------------------------------------

interface CallItemRow {
  contact_name: string;
  contact_phone: string;
  place_address: string;
  context_summary: string;
}

const emptyCallRow = (): CallItemRow => ({
  contact_name: "",
  contact_phone: "",
  place_address: "",
  context_summary: "",
});

function CreateCallSheetDrawer({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { success: toastSuccess, error: toastError } = useToast();

  const today = new Date().toISOString().split("T")[0];
  const defaultTitle = `${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} Call Sheet`;

  const [title, setTitle] = useState(defaultTitle);
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<CallItemRow[]>([emptyCallRow()]);
  const [submitting, setSubmitting] = useState(false);

  // Reset form when drawer opens
  useEffect(() => {
    if (isOpen) {
      const nowTitle = `${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} Call Sheet`;
      setTitle(nowTitle);
      setAssignedTo("");
      setDueDate(new Date().toISOString().split("T")[0]);
      setNotes("");
      setItems([emptyCallRow()]);
    }
  }, [isOpen]);

  const updateItem = (idx: number, field: keyof CallItemRow, value: string) => {
    setItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const removeItem = (idx: number) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const addItem = () => {
    setItems((prev) => [...prev, emptyCallRow()]);
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toastError("Title is required");
      return;
    }

    const validItems: CreateCallSheetItemRequest[] = items
      .filter((item) => item.contact_name.trim())
      .map((item) => ({
        contact_name: item.contact_name.trim(),
        contact_phone: item.contact_phone.trim() || null,
        place_address: item.place_address.trim() || null,
        context_summary: item.context_summary.trim() || null,
      }));

    const body: CreateCallSheetRequest = {
      title: title.trim(),
      due_date: dueDate || null,
      notes: notes.trim() || null,
      items: validItems.length > 0 ? validItems : undefined,
    };

    // assigned_to_person_id would be set if we had a person picker;
    // for now we store the name in notes or a future field

    setSubmitting(true);
    try {
      await postApi("/api/admin/call-sheets", body);
      toastSuccess(`Call sheet "${title}" created`);
      onCreated();
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to create call sheet");
    } finally {
      setSubmitting(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "0.25rem",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    border: "1px solid var(--border, #e5e7eb)",
    borderRadius: "6px",
    background: "var(--card-bg, #fff)",
    color: "var(--foreground)",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="New Call Sheet"
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={submitting} onClick={handleSubmit}>
            Create Call Sheet
          </Button>
        </>
      }
    >
      {/* Title */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
          placeholder="e.g. Apr 10, 2026 Call Sheet"
        />
      </div>

      {/* Assigned To */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Assigned To</label>
        <input
          type="text"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          style={inputStyle}
          placeholder="Trapper name"
        />
      </div>

      {/* Due Date */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Due Date</label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* Notes */}
      <div style={{ marginBottom: "1.25rem" }}>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
          placeholder="Optional notes for this call sheet..."
        />
      </div>

      {/* Divider */}
      <div
        style={{
          borderTop: "1px solid var(--border, #e5e7eb)",
          margin: "0 -1.25rem",
          padding: "0 1.25rem",
          paddingTop: "1rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Calls</span>
          <Button variant="ghost" size="sm" icon="plus" onClick={addItem}>
            Add another call
          </Button>
        </div>

        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              padding: "0.75rem",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: "6px",
              marginBottom: "0.5rem",
              background: "var(--section-bg, #f9fafb)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: "var(--text-tertiary)",
                }}
              >
                Call #{idx + 1}
              </span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-tertiary)",
                    fontSize: "0.8rem",
                    padding: "0.1rem 0.3rem",
                  }}
                >
                  Remove
                </button>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <div>
                <label style={{ ...labelStyle, fontSize: "0.7rem" }}>Contact Name *</label>
                <input
                  type="text"
                  value={item.contact_name}
                  onChange={(e) => updateItem(idx, "contact_name", e.target.value)}
                  style={{ ...inputStyle, fontSize: "0.8rem", padding: "0.375rem 0.5rem" }}
                  placeholder="Name"
                />
              </div>
              <div>
                <label style={{ ...labelStyle, fontSize: "0.7rem" }}>Phone</label>
                <input
                  type="text"
                  value={item.contact_phone}
                  onChange={(e) => updateItem(idx, "contact_phone", e.target.value)}
                  style={{ ...inputStyle, fontSize: "0.8rem", padding: "0.375rem 0.5rem" }}
                  placeholder="(707) 555-1234"
                />
              </div>
            </div>

            <div style={{ marginBottom: "0.5rem" }}>
              <label style={{ ...labelStyle, fontSize: "0.7rem" }}>Address</label>
              <input
                type="text"
                value={item.place_address}
                onChange={(e) => updateItem(idx, "place_address", e.target.value)}
                style={{ ...inputStyle, fontSize: "0.8rem", padding: "0.375rem 0.5rem" }}
                placeholder="123 Main St, Santa Rosa"
              />
            </div>

            <div>
              <label style={{ ...labelStyle, fontSize: "0.7rem" }}>Context</label>
              <input
                type="text"
                value={item.context_summary}
                onChange={(e) => updateItem(idx, "context_summary", e.target.value)}
                style={{ ...inputStyle, fontSize: "0.8rem", padding: "0.375rem 0.5rem" }}
                placeholder="Brief context for this call..."
              />
            </div>
          </div>
        ))}
      </div>
    </ActionDrawer>
  );
}

// ---------------------------------------------------------------------------
// Filter defaults
// ---------------------------------------------------------------------------

const FILTER_DEFAULTS = {
  status: "",
  search: "",
  page: "0",
};

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
];

// ---------------------------------------------------------------------------
// Inner content component
// ---------------------------------------------------------------------------

function CallSheetsContent() {
  const router = useRouter();
  const { success: toastSuccess, error: toastError } = useToast();
  const { filters, setFilter, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);

  const [data, setData] = useState<CallSheetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(filters.search);

  const limit = 20;
  const page = parseInt(filters.page) || 0;

  const fetchSheets = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.search) params.set("search", filters.search);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const result = await fetchApi<CallSheetsResponse>(
        `/api/admin/call-sheets?${params.toString()}`
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.search, page]);

  useEffect(() => {
    fetchSheets();
  }, [fetchSheets]);

  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  const handleComplete = async (sheetId: string) => {
    try {
      await postApi(`/api/admin/call-sheets/${sheetId}`, { status: "completed" }, { method: "PATCH" });
      toastSuccess("Call sheet marked as completed");
      fetchSheets();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleDelete = async (sheetId: string) => {
    if (!window.confirm("Are you sure you want to delete this call sheet?")) return;
    try {
      await postApi(`/api/admin/call-sheets/${sheetId}`, {}, { method: "DELETE" });
      toastSuccess("Call sheet deleted");
      fetchSheets();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const stats = data?.stats;

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ margin: 0 }}>Call Sheets</h1>
        <Button variant="primary" icon="plus" onClick={() => setDrawerOpen(true)}>
          New Call Sheet
        </Button>
      </div>

      {/* Stats row */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <StatCard label="Total Sheets" value={stats.total} />
          <StatCard
            label="Active"
            value={stats.active}
            accentColor="var(--warning-text)"
          />
          <StatCard
            label="Follow-ups Pending"
            value={stats.follow_ups_pending}
            accentColor="var(--info-text, #1e40af)"
          />
          <StatCard
            label="Conversion Rate"
            value={`${stats.conversion_rate}%`}
            accentColor="var(--success-text)"
          />
        </div>
      )}

      {/* Filter bar */}
      <FilterBar showClear={!isDefault} onClear={clearFilters}>
        <ToggleButtonGroup
          options={STATUS_FILTER_OPTIONS}
          value={filters.status}
          onChange={(val) => {
            setFilter("status", val);
            setFilter("page", "0");
          }}
          aria-label="Filter by status"
        />
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onDebouncedChange={(val) => {
            setFilter("search", val);
            setFilter("page", "0");
          }}
          placeholder="Search sheets..."
        />
      </FilterBar>

      {/* Loading */}
      {loading && (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
          Loading call sheets...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--danger-text, #991b1b)" }}>
          {error}
        </div>
      )}

      {/* Content */}
      {!loading && !error && data && (
        <>
          {data.sheets.length === 0 ? (
            <EmptyState
              variant={filters.search || filters.status ? "filtered" : "default"}
              title={
                filters.search || filters.status
                  ? "No call sheets match your filters"
                  : "No call sheets yet"
              }
              description={
                filters.search || filters.status
                  ? "Try adjusting your filters or search query"
                  : "Create your first call sheet to start tracking outreach calls"
              }
              action={
                filters.search || filters.status
                  ? { label: "Clear filters", onClick: clearFilters }
                  : { label: "New Call Sheet", onClick: () => setDrawerOpen(true) }
              }
            />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {data.sheets.map((sheet) => (
                <SheetCard
                  key={sheet.call_sheet_id}
                  sheet={sheet}
                  onClick={() => router.push(`/admin/call-sheets/${sheet.call_sheet_id}`)}
                  onPrint={() => router.push(`/admin/call-sheets/${sheet.call_sheet_id}/print`)}
                  onComplete={() => handleComplete(sheet.call_sheet_id)}
                  onDelete={() => handleDelete(sheet.call_sheet_id)}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {data.sheets.length > 0 && (
            <Pagination
              offset={page * limit}
              limit={limit}
              hasMore={data.pagination.hasMore}
              total={data.pagination.total}
              onPrevious={() => setFilter("page", String(Math.max(0, page - 1)))}
              onNext={() => setFilter("page", String(page + 1))}
            />
          )}
        </>
      )}

      {/* Create Drawer */}
      <CreateCallSheetDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={fetchSheets}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default export with Suspense
// ---------------------------------------------------------------------------

export default function CallSheetsPage() {
  return (
    <Suspense fallback={<div className="loading">Loading call sheets...</div>}>
      <CallSheetsContent />
    </Suspense>
  );
}
