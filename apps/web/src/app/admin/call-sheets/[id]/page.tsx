"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { RowActionMenu } from "@/components/shared/RowActionMenu";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { formatPhone, formatDateLocal, formatRelativeTime } from "@/lib/formatters";
import type {
  CallSheetSummary,
  CallSheetItemDetail,
  CallSheetStatus,
  CallSheetItemStatus,
  CallDisposition,
  CreateCallSheetItemRequest,
} from "@/lib/call-sheet-types";
import {
  CALL_SHEET_STATUS_LABELS,
  CALL_SHEET_STATUS_COLORS,
  ITEM_STATUS_LABELS,
  ITEM_STATUS_COLORS,
  DISPOSITION_TO_STATUS,
} from "@/lib/call-sheet-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallSheetDetailResponse {
  sheet: CallSheetSummary;
  items: CallSheetItemDetail[];
}

// ---------------------------------------------------------------------------
// Badge helpers
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

function ItemStatusBadge({ status }: { status: CallSheetItemStatus }) {
  const colors = ITEM_STATUS_COLORS[status] || ITEM_STATUS_COLORS.pending;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.45rem",
        borderRadius: "9999px",
        fontSize: "0.65rem",
        fontWeight: 600,
        background: colors.bg,
        color: colors.color,
      }}
    >
      {ITEM_STATUS_LABELS[status] || status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Disposition labels for display
// ---------------------------------------------------------------------------

const DISPOSITION_LABELS: Record<CallDisposition, string> = {
  reached: "Reached",
  left_voicemail: "Left VM",
  left_message_person: "Left Msg (Person)",
  no_answer: "No Answer",
  busy: "Busy",
  wrong_number: "Wrong #",
  disconnected: "Disconnected",
  not_interested: "Not Interested",
  already_resolved: "Already Resolved",
  do_not_contact: "Do Not Contact",
  scheduled_trapping: "Scheduled Trapping",
  scheduled_callback: "Scheduled Callback",
  needs_more_info: "Needs More Info",
  referred_elsewhere: "Referred Elsewhere",
  appointment_booked: "Appointment Booked",
};

// ---------------------------------------------------------------------------
// Quick disposition buttons config
// ---------------------------------------------------------------------------

interface QuickDisposition {
  disposition: CallDisposition;
  label: string;
  bg: string;
  color: string;
}

const QUICK_DISPOSITIONS: QuickDisposition[] = [
  { disposition: "reached", label: "Reached", bg: "var(--success-bg)", color: "var(--success-text)" },
  { disposition: "left_voicemail", label: "VM", bg: "var(--info-bg, #dbeafe)", color: "var(--info-text, #1e40af)" },
  { disposition: "no_answer", label: "No Answer", bg: "var(--bg-secondary)", color: "var(--text-secondary)" },
  { disposition: "wrong_number", label: "Wrong #", bg: "var(--danger-bg, #fee2e2)", color: "var(--danger-text, #991b1b)" },
];

// ---------------------------------------------------------------------------
// Request status badge (for linked requests)
// ---------------------------------------------------------------------------

const REQUEST_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  new: { bg: "var(--info-bg, #dbeafe)", color: "var(--info-text, #1e40af)" },
  triaged: { bg: "var(--warning-bg)", color: "var(--warning-text)" },
  scheduled: { bg: "#f3e8ff", color: "#7c3aed" },
  in_progress: { bg: "var(--success-bg)", color: "var(--success-text)" },
  completed: { bg: "var(--bg-secondary)", color: "var(--text-tertiary)" },
};

function RequestBadge({ status, summary }: { status: string; summary: string | null }) {
  const colors = REQUEST_STATUS_COLORS[status] || { bg: "var(--bg-secondary)", color: "var(--text-secondary)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        padding: "0.1rem 0.4rem",
        borderRadius: "4px",
        fontSize: "0.65rem",
        background: colors.bg,
        color: colors.color,
        fontWeight: 500,
        maxWidth: "200px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      title={summary || undefined}
    >
      {status.replace("_", " ")}
      {summary && ` - ${summary}`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Item Card
// ---------------------------------------------------------------------------

function ItemCard({
  item,
  onDisposition,
  onEdit,
  onFollowUp,
  onConvert,
  onSkip,
  onRemove,
  isUpdating,
}: {
  item: CallSheetItemDetail;
  onDisposition: (disposition: CallDisposition) => void;
  onEdit: () => void;
  onFollowUp: () => void;
  onConvert: () => void;
  onSkip: () => void;
  onRemove: () => void;
  isUpdating: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFollowUpOverdue =
    item.follow_up_at && new Date(item.follow_up_at) < new Date();

  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        border: `1px solid ${isFollowUpOverdue ? "var(--warning-border, #fde68a)" : "var(--card-border)"}`,
        borderRadius: "8px",
        background: item.status === "dead_end" || item.status === "skipped"
          ? "var(--bg-secondary)"
          : isFollowUpOverdue
          ? "var(--warning-bg)"
          : "var(--card-bg)",
        opacity: item.status === "dead_end" || item.status === "skipped" ? 0.7 : 1,
      }}
    >
      {/* Row 1: Contact info + Status + Actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.35rem",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--foreground)" }}>
              {item.contact_name}
            </span>
            <ItemStatusBadge status={item.status} />
            {item.disposition && (
              <span
                style={{
                  fontSize: "0.65rem",
                  padding: "0.1rem 0.35rem",
                  borderRadius: "4px",
                  background: "var(--section-bg, #f9fafb)",
                  color: "var(--text-secondary)",
                  fontWeight: 500,
                }}
              >
                {DISPOSITION_LABELS[item.disposition] || item.disposition}
              </span>
            )}
            {isFollowUpOverdue && (
              <span
                style={{
                  fontSize: "0.6rem",
                  padding: "0.1rem 0.3rem",
                  borderRadius: "3px",
                  background: "var(--warning-bg)",
                  color: "var(--warning-text)",
                  fontWeight: 600,
                }}
              >
                FOLLOW-UP OVERDUE
              </span>
            )}
          </div>

          {/* Phone + Address */}
          <div
            style={{
              display: "flex",
              gap: "1rem",
              marginTop: "0.2rem",
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              flexWrap: "wrap",
            }}
          >
            {(item.contact_phone || item.primary_phone) && (
              <a
                href={`tel:${item.contact_phone || item.primary_phone}`}
                style={{ color: "var(--primary)", textDecoration: "none" }}
              >
                {formatPhone(item.contact_phone || item.primary_phone)}
              </a>
            )}
            {(item.place_address || item.place_full_address) && (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "300px" }}>
                {item.place_address || item.place_full_address}
              </span>
            )}
          </div>
        </div>

        <div onClick={(e) => e.stopPropagation()}>
          <RowActionMenu
            actions={[
              { label: "Edit Details", onClick: onEdit },
              { label: "Set Follow-up", onClick: onFollowUp },
              { label: "Convert to Assignment", onClick: onConvert, dividerBefore: true },
              { label: "Skip", onClick: onSkip },
              { label: "Remove", onClick: onRemove, variant: "danger", dividerBefore: true },
            ]}
          />
        </div>
      </div>

      {/* Row 2: Context summary */}
      {item.context_summary && (
        <div
          style={{
            fontSize: "0.78rem",
            color: "var(--text-secondary)",
            marginBottom: "0.35rem",
            lineHeight: 1.4,
          }}
        >
          {item.context_summary}
        </div>
      )}

      {/* Row 3: Request link */}
      {item.request_id && item.request_status && (
        <div style={{ marginBottom: "0.35rem" }}>
          <a
            href={`/requests/${item.request_id}`}
            style={{ textDecoration: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            <RequestBadge status={item.request_status} summary={item.request_summary} />
          </a>
        </div>
      )}

      {/* Row 4: Attempt count + Follow-up + Last attempted */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          fontSize: "0.72rem",
          color: "var(--text-tertiary)",
          marginBottom: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        {item.attempt_count > 0 && (
          <span>
            {item.attempt_count} attempt{item.attempt_count !== 1 ? "s" : ""}
          </span>
        )}
        {item.last_attempted_at && (
          <span>Last: {formatRelativeTime(item.last_attempted_at) || formatDateLocal(item.last_attempted_at)}</span>
        )}
        {item.follow_up_at && (
          <span
            style={{
              color: isFollowUpOverdue ? "var(--warning-text)" : "var(--text-secondary)",
              fontWeight: isFollowUpOverdue ? 600 : 400,
            }}
          >
            Follow-up: {formatDateLocal(item.follow_up_at)}
          </span>
        )}
      </div>

      {/* Row 5: Quick disposition buttons */}
      {item.status !== "converted" && item.status !== "dead_end" && item.status !== "skipped" && (
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          {QUICK_DISPOSITIONS.map((qd) => (
            <button
              key={qd.disposition}
              onClick={() => onDisposition(qd.disposition)}
              disabled={isUpdating}
              style={{
                padding: "0.25rem 0.6rem",
                fontSize: "0.72rem",
                fontWeight: 600,
                border: "1px solid transparent",
                borderRadius: "4px",
                cursor: isUpdating ? "not-allowed" : "pointer",
                background: qd.bg,
                color: qd.color,
                opacity: isUpdating ? 0.6 : 1,
                transition: "opacity 150ms ease",
              }}
            >
              {qd.label}
            </button>
          ))}
        </div>
      )}

      {/* Row 6: Expandable notes */}
      {item.notes && (
        <div style={{ marginTop: "0.35rem" }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "0.72rem",
              color: "var(--primary)",
              padding: 0,
            }}
          >
            {expanded ? "Hide notes" : "Show notes"}
          </button>
          {expanded && (
            <div
              style={{
                marginTop: "0.25rem",
                padding: "0.5rem",
                background: "var(--section-bg, #f9fafb)",
                borderRadius: "4px",
                fontSize: "0.78rem",
                color: "var(--text-secondary)",
                lineHeight: 1.5,
              }}
            >
              {item.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Items Drawer
// ---------------------------------------------------------------------------

interface AddItemRow {
  contact_name: string;
  contact_phone: string;
  place_address: string;
  context_summary: string;
}

const emptyAddRow = (): AddItemRow => ({
  contact_name: "",
  contact_phone: "",
  place_address: "",
  context_summary: "",
});

function AddItemsDrawer({
  isOpen,
  onClose,
  sheetId,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  sheetId: string;
  onAdded: () => void;
}) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [items, setItems] = useState<AddItemRow[]>([emptyAddRow()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) setItems([emptyAddRow()]);
  }, [isOpen]);

  const updateItem = (idx: number, field: keyof AddItemRow, value: string) => {
    setItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const removeItem = (idx: number) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const addRow = () => setItems((prev) => [...prev, emptyAddRow()]);

  const handleSubmit = async () => {
    const validItems: CreateCallSheetItemRequest[] = items
      .filter((item) => item.contact_name.trim())
      .map((item) => ({
        contact_name: item.contact_name.trim(),
        contact_phone: item.contact_phone.trim() || null,
        place_address: item.place_address.trim() || null,
        context_summary: item.context_summary.trim() || null,
      }));

    if (validItems.length === 0) {
      toastError("At least one call with a contact name is required");
      return;
    }

    setSubmitting(true);
    try {
      await postApi(`/api/admin/call-sheets/${sheetId}/items`, { items: validItems });
      toastSuccess(`Added ${validItems.length} call${validItems.length > 1 ? "s" : ""}`);
      onAdded();
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to add items");
    } finally {
      setSubmitting(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "0.2rem",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.375rem 0.5rem",
    fontSize: "0.8rem",
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
      title="Add Calls"
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={submitting} onClick={handleSubmit}>
            Add {items.filter((i) => i.contact_name.trim()).length} Call
            {items.filter((i) => i.contact_name.trim()).length !== 1 ? "s" : ""}
          </Button>
        </>
      }
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>New Calls</span>
        <Button variant="ghost" size="sm" icon="plus" onClick={addRow}>
          Add another
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
            <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text-tertiary)" }}>
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
                  fontSize: "0.75rem",
                }}
              >
                Remove
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <div>
              <label style={labelStyle}>Contact Name *</label>
              <input
                type="text"
                value={item.contact_name}
                onChange={(e) => updateItem(idx, "contact_name", e.target.value)}
                style={inputStyle}
                placeholder="Name"
              />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input
                type="text"
                value={item.contact_phone}
                onChange={(e) => updateItem(idx, "contact_phone", e.target.value)}
                style={inputStyle}
                placeholder="(707) 555-1234"
              />
            </div>
          </div>
          <div style={{ marginBottom: "0.5rem" }}>
            <label style={labelStyle}>Address</label>
            <input
              type="text"
              value={item.place_address}
              onChange={(e) => updateItem(idx, "place_address", e.target.value)}
              style={inputStyle}
              placeholder="123 Main St, Santa Rosa"
            />
          </div>
          <div>
            <label style={labelStyle}>Context</label>
            <input
              type="text"
              value={item.context_summary}
              onChange={(e) => updateItem(idx, "context_summary", e.target.value)}
              style={inputStyle}
              placeholder="Brief context for this call..."
            />
          </div>
        </div>
      ))}
    </ActionDrawer>
  );
}

// ---------------------------------------------------------------------------
// Follow-up Drawer
// ---------------------------------------------------------------------------

function SetFollowUpDrawer({
  isOpen,
  onClose,
  sheetId,
  item,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  sheetId: string;
  item: CallSheetItemDetail | null;
  onSaved: () => void;
}) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [followUpDate, setFollowUpDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && item) {
      setFollowUpDate(item.follow_up_at ? item.follow_up_at.split("T")[0] : "");
      setNotes(item.notes || "");
    }
  }, [isOpen, item]);

  const handleSubmit = async () => {
    if (!item) return;
    setSubmitting(true);
    try {
      await postApi(
        `/api/admin/call-sheets/${sheetId}/items/${item.item_id}`,
        {
          follow_up_at: followUpDate || null,
          notes: notes.trim() || null,
          status: followUpDate ? "follow_up" : undefined,
        },
        { method: "PATCH" }
      );
      toastSuccess(`Follow-up set for ${item.contact_name}`);
      onSaved();
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to set follow-up");
    } finally {
      setSubmitting(false);
    }
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

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "0.25rem",
  };

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={`Follow-up: ${item?.contact_name || ""}`}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={submitting} onClick={handleSubmit}>
            Save
          </Button>
        </>
      }
    >
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Follow-up Date</label>
        <input
          type="date"
          value={followUpDate}
          onChange={(e) => setFollowUpDate(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...inputStyle, minHeight: "100px", resize: "vertical" }}
          placeholder="Notes about this follow-up..."
        />
      </div>
    </ActionDrawer>
  );
}

// ---------------------------------------------------------------------------
// Inner content component
// ---------------------------------------------------------------------------

function CallSheetDetailContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { success: toastSuccess, error: toastError } = useToast();

  const [data, setData] = useState<CallSheetDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingItem, setUpdatingItem] = useState<string | null>(null);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [followUpItem, setFollowUpItem] = useState<CallSheetItemDetail | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchApi<CallSheetDetailResponse>(
        `/api/admin/call-sheets/${id}`
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleDisposition = async (itemId: string, disposition: CallDisposition, contactName: string) => {
    setUpdatingItem(itemId);
    try {
      await postApi(
        `/api/admin/call-sheets/${id}/items/${itemId}`,
        { disposition },
        { method: "PATCH" }
      );
      toastSuccess(`Logged: ${DISPOSITION_LABELS[disposition]} for ${contactName}`);
      fetchDetail();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setUpdatingItem(null);
    }
  };

  const handleComplete = async () => {
    try {
      await postApi(`/api/admin/call-sheets/${id}`, { status: "completed" }, { method: "PATCH" });
      toastSuccess("Call sheet marked as completed");
      fetchDetail();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleSkipItem = async (itemId: string) => {
    setUpdatingItem(itemId);
    try {
      await postApi(
        `/api/admin/call-sheets/${id}/items/${itemId}`,
        { status: "skipped" },
        { method: "PATCH" }
      );
      toastSuccess("Item skipped");
      fetchDetail();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to skip");
    } finally {
      setUpdatingItem(null);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      await postApi(
        `/api/admin/call-sheets/${id}/items/${itemId}`,
        {},
        { method: "DELETE" }
      );
      toastSuccess("Item removed");
      fetchDetail();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setPendingRemoveId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
        Loading call sheet...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--danger-text, #991b1b)" }}>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState variant="error" title="Call sheet not found" />
    );
  }

  const { sheet, items } = data;
  const isActive = sheet.status === "assigned" || sheet.status === "in_progress";

  return (
    <div>
      {/* Breadcrumbs */}
      <div style={{ marginBottom: "0.75rem" }}>
        <Breadcrumbs
          items={[
            { label: "Call Sheets", href: "/admin/call-sheets" },
            { label: sheet.title },
          ]}
        />
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.25rem",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.35rem" }}>
            <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{sheet.title}</h1>
            <StatusBadge status={sheet.status} />
            {sheet.is_overdue && (
              <span
                style={{
                  fontSize: "0.7rem",
                  padding: "0.15rem 0.4rem",
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
          <div
            style={{
              display: "flex",
              gap: "1rem",
              fontSize: "0.85rem",
              color: "var(--text-secondary)",
            }}
          >
            {sheet.assigned_to_name && <span>Assigned to: <strong>{sheet.assigned_to_name}</strong></span>}
            {sheet.due_date && <span>Due: {formatDateLocal(sheet.due_date)}</span>}
            <span>Created: {formatDateLocal(sheet.created_at)}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
          <Button variant="outline" size="sm" icon="plus" onClick={() => setAddDrawerOpen(true)}>
            Add Items
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon="printer"
            onClick={() => router.push(`/admin/call-sheets/${id}/print`)}
          >
            Print
          </Button>
          {isActive && (
            <Button variant="primary" size="sm" onClick={handleComplete}>
              Mark Complete
            </Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.25rem",
        }}
      >
        <StatCard label="Total" value={sheet.total_items} />
        <StatCard label="Pending" value={sheet.pending_count} accentColor="var(--text-secondary)" />
        <StatCard label="Follow-up" value={sheet.follow_up_count} accentColor="var(--warning-text)" />
        <StatCard label="Converted" value={sheet.converted_count} accentColor="var(--success-text)" />
        <StatCard label="Dead End" value={sheet.dead_end_count} accentColor="var(--text-tertiary)" />
      </div>

      {/* Notes */}
      {sheet.notes && (
        <div
          style={{
            padding: "0.5rem 0.75rem",
            background: "var(--section-bg, #f9fafb)",
            borderRadius: "6px",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            borderLeft: "3px solid var(--primary)",
          }}
        >
          {sheet.notes}
        </div>
      )}

      {/* Items list */}
      {items.length === 0 ? (
        <EmptyState
          variant="default"
          title="No calls on this sheet"
          description="Add some calls to get started"
          action={{ label: "Add Calls", onClick: () => setAddDrawerOpen(true) }}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {items.map((item) => (
            <ItemCard
              key={item.item_id}
              item={item}
              onDisposition={(d) => handleDisposition(item.item_id, d, item.contact_name)}
              onEdit={() => {
                // For now, edit opens the follow-up drawer
                // A full edit drawer can be built later
                setFollowUpItem(item);
              }}
              onFollowUp={() => setFollowUpItem(item)}
              onConvert={() => {
                toastSuccess(`Converting ${item.contact_name} to assignment (not yet implemented)`);
              }}
              onSkip={() => handleSkipItem(item.item_id)}
              onRemove={() => setPendingRemoveId(item.item_id)}
              isUpdating={updatingItem === item.item_id}
            />
          ))}
        </div>
      )}

      {/* Add Items Drawer */}
      <AddItemsDrawer
        isOpen={addDrawerOpen}
        onClose={() => setAddDrawerOpen(false)}
        sheetId={id}
        onAdded={fetchDetail}
      />

      {/* Follow-up Drawer */}
      <SetFollowUpDrawer
        isOpen={!!followUpItem}
        onClose={() => setFollowUpItem(null)}
        sheetId={id}
        item={followUpItem}
        onSaved={fetchDetail}
      />

      <ConfirmDialog
        open={!!pendingRemoveId}
        title="Remove call?"
        message="Remove this call from the sheet? This cannot be undone."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => pendingRemoveId && handleRemoveItem(pendingRemoveId)}
        onCancel={() => setPendingRemoveId(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default export with Suspense
// ---------------------------------------------------------------------------

export default function CallSheetDetailPage() {
  return (
    <Suspense fallback={<div className="loading">Loading call sheet...</div>}>
      <CallSheetDetailContent />
    </Suspense>
  );
}
