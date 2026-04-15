"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { FilterBar, ToggleButtonGroup } from "@/components/filters";
import { Pagination } from "@/components/ui/Pagination";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/feedback/EmptyState";
import { RowActionMenu } from "@/components/shared/RowActionMenu";
import { ActionDrawer } from "@/components/shared/ActionDrawer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HoursEntry {
  entry_id: string;
  person_id: string;
  trapper_name: string;
  trapper_type: string | null;
  period_type: "weekly" | "monthly";
  period_start: string;
  period_end: string;
  hours_total: number;
  hours_trapping: number;
  hours_admin: number;
  hours_transport: number;
  hours_training: number;
  hours_other: number;
  pay_type: "hourly" | "flat" | "stipend";
  hourly_rate: number | null;
  total_pay: number | null;
  status: "draft" | "submitted" | "approved";
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  work_summary: string | null;
  created_at: string;
  updated_at: string;
  attachment_path: string | null;
  attachment_filename: string | null;
  attachment_mime_type: string | null;
}

interface HoursStats {
  total_entries: number;
  total_hours: number;
  total_pay: number;
  draft_count: number;
  submitted_count: number;
  approved_count: number;
}

interface HoursResponse {
  entries: HoursEntry[];
  stats: HoursStats;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
    total: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number | null): string {
  if (amount == null) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatPeriod(entry: HoursEntry): string {
  const start = parseDateLocal(entry.period_start);
  const end = parseDateLocal(entry.period_end);
  if (!start || !end) return entry.period_start;

  if (entry.period_type === "monthly") {
    return start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  // Weekly: "Apr 7-13, 2026" or "Mar 28 - Apr 3, 2026" if crossing months
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (sameMonth) {
    return `${startStr}\u2013${end.getDate()}, ${end.getFullYear()}`;
  }
  const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startStr} \u2013 ${endStr}, ${end.getFullYear()}`;
}

function parseDateLocal(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, y, m, d] = match;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  }
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

function getEndOfMonth(dateStr: string): string {
  const d = parseDateLocal(dateStr);
  if (!d) return dateStr;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return formatDateISO(last);
}

function addDays(dateStr: string, days: number): string {
  const d = parseDateLocal(dateStr);
  if (!d) return dateStr;
  d.setDate(d.getDate() + days);
  return formatDateISO(d);
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayISO(): string {
  return formatDateISO(new Date());
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  draft: { bg: "var(--bg-secondary)", color: "var(--text-secondary)" },
  submitted: { bg: "var(--info-bg, #eff6ff)", color: "var(--info-text, #1e40af)" },
  approved: { bg: "var(--success-bg)", color: "var(--success-text)" },
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.draft;
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
      {STATUS_LABELS[status] || status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hours Breakdown Mini Display
// ---------------------------------------------------------------------------

function HoursBreakdown({ entry }: { entry: HoursEntry }) {
  const parts: string[] = [];
  if (entry.hours_trapping > 0) parts.push(`${entry.hours_trapping}h trap`);
  if (entry.hours_admin > 0) parts.push(`${entry.hours_admin}h admin`);
  if (entry.hours_transport > 0) parts.push(`${entry.hours_transport}h transport`);
  if (entry.hours_training > 0) parts.push(`${entry.hours_training}h training`);
  if (entry.hours_other > 0) parts.push(`${entry.hours_other}h other`);

  if (parts.length === 0) return null;

  return (
    <span style={{ fontSize: "0.7rem", color: "var(--text-tertiary)" }}>
      {parts.join(" / ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Trapper Select (supports "Other" freeform input)
// ---------------------------------------------------------------------------

const KNOWN_TRAPPERS = ["Crystal Furtado"];
const OTHER_SENTINEL = "__other__";

function TrapperSelect({
  value,
  onChange,
  inputStyle,
}: {
  value: string;
  onChange: (val: string) => void;
  inputStyle: React.CSSProperties;
}) {
  const isKnown = KNOWN_TRAPPERS.includes(value);
  const [showOther, setShowOther] = useState(!isKnown && value !== "");
  const [otherValue, setOtherValue] = useState(!isKnown ? value : "");

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === OTHER_SENTINEL) {
      setShowOther(true);
      setOtherValue("");
      onChange("");
    } else {
      setShowOther(false);
      onChange(val);
    }
  };

  return (
    <>
      <select
        value={showOther ? OTHER_SENTINEL : value}
        onChange={handleSelectChange}
        style={inputStyle}
      >
        {KNOWN_TRAPPERS.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={OTHER_SENTINEL}>-- Other --</option>
      </select>
      {showOther && (
        <input
          type="text"
          placeholder="Enter trapper name"
          value={otherValue}
          onChange={(e) => {
            setOtherValue(e.target.value);
            onChange(e.target.value);
          }}
          style={{ ...inputStyle, marginTop: "0.5rem" }}
          autoFocus
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Create/Edit Drawer
// ---------------------------------------------------------------------------

interface DailyEntry {
  date: string;       // ISO date
  dayLabel: string;   // "Mon", "Tue", etc.
  location: string;
  hours: number;
}

interface DrawerFormState {
  trapper_name: string;
  period_type: "weekly" | "monthly";
  period_start: string;
  period_end: string;
  hours_total: number;
  hours_trapping: number;
  hours_admin: number;
  hours_transport: number;
  hours_training: number;
  hours_other: number;
  pay_type: "hourly" | "flat" | "stipend";
  hourly_rate: number | null;
  total_pay: number | null;
  work_summary: string;
  notes: string;
  attachment_path: string | null;
  attachment_filename: string | null;
  attachment_mime_type: string | null;
  daily_entries: DailyEntry[];
}

function generateDailyEntries(startDate: string, days: number = 7): DailyEntry[] {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const entries: DailyEntry[] = [];
  const start = new Date(startDate + "T00:00:00");
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    entries.push({
      date: d.toISOString().split("T")[0],
      dayLabel: dayNames[d.getDay()],
      location: "",
      hours: 0,
    });
  }
  return entries;
}

function defaultFormState(): DrawerFormState {
  const start = todayISO();
  return {
    trapper_name: "Crystal Furtado",
    period_type: "weekly",
    period_start: start,
    period_end: addDays(start, 6),
    hours_total: 0,
    hours_trapping: 0,
    hours_admin: 0,
    hours_transport: 0,
    hours_training: 0,
    hours_other: 0,
    pay_type: "hourly",
    hourly_rate: 20,
    total_pay: null,
    work_summary: "",
    notes: "",
    attachment_path: null,
    attachment_filename: null,
    attachment_mime_type: null,
    daily_entries: generateDailyEntries(start, 7),
  };
}

function entryToFormState(entry: HoursEntry): DrawerFormState {
  return {
    trapper_name: entry.trapper_name,
    period_type: entry.period_type,
    period_start: entry.period_start,
    period_end: entry.period_end,
    hours_total: entry.hours_total,
    hours_trapping: entry.hours_trapping,
    hours_admin: entry.hours_admin,
    hours_transport: entry.hours_transport,
    hours_training: entry.hours_training,
    hours_other: entry.hours_other,
    pay_type: entry.pay_type,
    hourly_rate: entry.hourly_rate,
    total_pay: entry.total_pay,
    work_summary: entry.work_summary || "",
    notes: entry.notes || "",
    attachment_path: entry.attachment_path || null,
    attachment_filename: entry.attachment_filename || null,
    attachment_mime_type: entry.attachment_mime_type || null,
    daily_entries: generateDailyEntries(entry.period_start, entry.period_type === "monthly" ? 28 : 7),
  };
}

// ---------------------------------------------------------------------------
// Timesheet Scanner — upload photo, extract hours via Claude Vision
// ---------------------------------------------------------------------------

function TimesheetScanner({
  onExtracted,
}: {
  onExtracted: (data: {
    employee_name?: string | null;
    total_hours?: number | null;
    hourly_rate?: number | null;
    period_type?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    notes?: string | null;
    entries?: { date?: string | null; address?: string | null; hours?: number | null }[];
  }, attachment?: {
    path: string | null;
    url: string | null;
    filename: string | null;
    mime_type: string | null;
  }) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Convert HEIC/non-JPEG to JPEG via canvas (Claude Vision needs JPEG/PNG/WebP)
  const convertToJpeg = async (file: File): Promise<File> => {
    if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") {
      return file;
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) { resolve(file); return; }
            resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }));
          },
          "image/jpeg",
          0.92
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
      img.src = url;
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setScanResult(null);
    setScanError(null);

    try {
      // Convert HEIC/other formats to JPEG for Claude Vision
      const convertedFile = await convertToJpeg(file);

      const formData = new FormData();
      formData.append("file", convertedFile);

      const res = await fetch("/api/admin/trapper-hours/extract", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Extraction failed");
      }

      const result = await res.json();
      const extracted = result.data?.extracted || result.extracted;

      if (extracted) {
        const attachment = result.data?.attachment || result.attachment;
        onExtracted(extracted, attachment);
        setScanResult(
          `Extracted ${extracted.entries?.filter((e: { hours?: number | null }) => e.hours).length || 0} days, ` +
          `${extracted.total_hours ?? 0} total hours` +
          (extracted.confidence ? ` (${extracted.confidence} confidence)` : "")
        );
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div
      style={{
        marginBottom: "1rem",
        padding: "0.75rem",
        border: "2px dashed var(--border-primary, #d1d5db)",
        borderRadius: "8px",
        background: "var(--bg-secondary, #f9fafb)",
        textAlign: "center",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />
      <Button
        variant="outline"
        size="sm"
        loading={scanning}
        onClick={() => fileInputRef.current?.click()}
        icon="camera"
      >
        {scanning ? "Reading timesheet..." : "Scan Handwritten Timesheet"}
      </Button>
      <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginTop: "0.35rem" }}>
        Upload a photo or PDF — AI reads the handwriting and fills in the form
      </div>
      {scanResult && (
        <div style={{ fontSize: "0.75rem", color: "var(--success-text)", marginTop: "0.35rem", fontWeight: 500 }}>
          {scanResult}
        </div>
      )}
      {scanError && (
        <div style={{ fontSize: "0.75rem", color: "var(--danger-text, #dc2626)", marginTop: "0.35rem" }}>
          {scanError}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hours Drawer
// ---------------------------------------------------------------------------

function HoursDrawer({
  isOpen,
  onClose,
  onSaved,
  editEntry,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editEntry: HoursEntry | null;
}) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [form, setForm] = useState<DrawerFormState>(defaultFormState);
  const [submitting, setSubmitting] = useState(false);
  const [payOverride, setPayOverride] = useState(false);

  // Reset form when drawer opens
  useEffect(() => {
    if (isOpen) {
      if (editEntry) {
        setForm(entryToFormState(editEntry));
        // If the existing total_pay doesn't match rate * hours, it was overridden
        if (editEntry.pay_type === "hourly" && editEntry.hourly_rate != null) {
          const calc = editEntry.hours_total * editEntry.hourly_rate;
          setPayOverride(editEntry.total_pay !== calc);
        } else {
          setPayOverride(true);
        }
      } else {
        setForm(defaultFormState());
        setPayOverride(false);
      }
    }
  }, [isOpen, editEntry]);

  // Auto-compute period_end when period_start or period_type changes
  const handlePeriodStartChange = (newStart: string) => {
    const days = form.period_type === "weekly" ? 7 : 28;
    const newEnd =
      form.period_type === "weekly"
        ? addDays(newStart, 6)
        : getEndOfMonth(newStart);
    setForm((prev) => ({
      ...prev,
      period_start: newStart,
      period_end: newEnd,
      daily_entries: generateDailyEntries(newStart, days),
    }));
  };

  const handlePeriodTypeChange = (newType: "weekly" | "monthly") => {
    const days = newType === "weekly" ? 7 : 28;
    const newEnd =
      newType === "weekly"
        ? addDays(form.period_start, 6)
        : getEndOfMonth(form.period_start);
    setForm((prev) => ({
      ...prev,
      period_type: newType,
      period_end: newEnd,
      daily_entries: generateDailyEntries(form.period_start, days),
    }));
  };

  // Auto-sum category hours into total
  const handleCategoryChange = (field: keyof DrawerFormState, value: number) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      next.hours_total =
        next.hours_trapping +
        next.hours_admin +
        next.hours_transport +
        next.hours_training +
        next.hours_other;
      // Auto-calculate pay if hourly and not overridden
      if (!payOverride && next.pay_type === "hourly" && next.hourly_rate != null) {
        next.total_pay = Math.round(next.hours_total * next.hourly_rate * 100) / 100;
      }
      return next;
    });
  };

  // When total hours changed directly, recalc pay
  const handleTotalHoursChange = (val: number) => {
    setForm((prev) => {
      const next = { ...prev, hours_total: val };
      if (!payOverride && next.pay_type === "hourly" && next.hourly_rate != null) {
        next.total_pay = Math.round(val * next.hourly_rate * 100) / 100;
      }
      return next;
    });
  };

  // When rate changes, recalc pay
  const handleRateChange = (val: number | null) => {
    setForm((prev) => {
      const next = { ...prev, hourly_rate: val };
      if (!payOverride && val != null && next.pay_type === "hourly") {
        next.total_pay = Math.round(next.hours_total * val * 100) / 100;
      }
      return next;
    });
  };

  const handlePayTypeChange = (val: "hourly" | "flat" | "stipend") => {
    setForm((prev) => {
      const next = { ...prev, pay_type: val };
      if (val === "hourly" && next.hourly_rate != null) {
        setPayOverride(false);
        next.total_pay = Math.round(next.hours_total * next.hourly_rate * 100) / 100;
      } else {
        setPayOverride(true);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!form.trapper_name.trim()) {
      toastError("Trapper name is required");
      return;
    }
    if (form.hours_total <= 0) {
      toastError("Total hours must be greater than 0");
      return;
    }

    // Build work summary from daily entries if not manually written
    let workSummary = form.work_summary.trim();
    if (!workSummary) {
      const lines = form.daily_entries
        .filter((d) => d.location || d.hours > 0)
        .map((d) => `${d.dayLabel}: ${d.location || "—"} (${d.hours}h)`);
      if (lines.length > 0) workSummary = lines.join("\n");
    }

    const body: Record<string, unknown> = {
      trapper_name: form.trapper_name.trim(),
      period_type: form.period_type,
      period_start: form.period_start,
      period_end: form.period_end,
      hours_total: form.hours_total,
      hours_trapping: form.hours_trapping,
      hours_admin: form.hours_admin,
      hours_transport: form.hours_transport,
      hours_training: form.hours_training,
      hours_other: form.hours_other,
      pay_type: form.pay_type,
      hourly_rate: form.hourly_rate,
      total_pay: form.total_pay,
      work_summary: workSummary || null,
      notes: form.notes.trim() || null,
      attachment_path: form.attachment_path,
      attachment_filename: form.attachment_filename,
      attachment_mime_type: form.attachment_mime_type,
    };

    if (editEntry) {
      body.entry_id = editEntry.entry_id;
    }

    setSubmitting(true);
    try {
      if (editEntry) {
        await postApi("/api/admin/trapper-hours", body, { method: "PATCH" });
        toastSuccess("Hours entry updated");
      } else {
        await postApi("/api/admin/trapper-hours", body);
        toastSuccess("Hours entry created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to save hours entry");
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

  const smallInputStyle: React.CSSProperties = {
    ...inputStyle,
    fontSize: "0.8rem",
    padding: "0.375rem 0.5rem",
  };

  return (
    <ActionDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={editEntry ? "Edit Hours Entry" : "Log Hours"}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={submitting} onClick={handleSubmit}>
            {editEntry ? "Save Changes" : "Log Hours"}
          </Button>
        </>
      }
    >
      {/* Scan Timesheet */}
      {!editEntry && (
        <TimesheetScanner
          onExtracted={(data, attachment) => {
            // Store attachment info
            if (attachment?.path) {
              setForm((prev) => ({
                ...prev,
                attachment_path: attachment.path,
                attachment_filename: attachment.filename || null,
                attachment_mime_type: attachment.mime_type || null,
              }));
            }
            if (data.employee_name) {
              setForm((prev) => ({ ...prev, trapper_name: data.employee_name! }));
            }
            if (data.total_hours != null) {
              setForm((prev) => ({ ...prev, hours_total: data.total_hours! }));
            }
            if (data.hourly_rate != null) {
              setForm((prev) => ({ ...prev, hourly_rate: data.hourly_rate!, pay_type: "hourly" as const }));
            }
            if (data.period_type && data.period_type !== "unknown") {
              setForm((prev) => ({ ...prev, period_type: data.period_type as "weekly" | "monthly" }));
            }
            // Apply dates, daily entries, and notes in one batch update
            setForm((prev) => {
              // Normalize date to ISO format
              const normalizeDate = (d: string): string => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
                const parsed = new Date(d);
                if (!isNaN(parsed.getTime())) {
                  return parsed.toISOString().split("T")[0];
                }
                return d;
              };

              let next = { ...prev };

              // Set period dates
              if (data.period_start) {
                const isoStart = normalizeDate(data.period_start);
                const numDays = (data.period_type === "monthly") ? 28 : 7;
                const isoEnd = data.period_end ? normalizeDate(data.period_end) : addDays(isoStart, numDays - 1);
                next.period_start = isoStart;
                next.period_end = isoEnd;
                next.daily_entries = generateDailyEntries(isoStart, numDays);
              }

              // Populate daily entries from AI extraction
              if (data.entries && data.entries.length > 0) {
                const updated = [...next.daily_entries];
                data.entries.forEach((extracted: { date?: string | null; address?: string | null; hours?: number | null }, i: number) => {
                  if (i < updated.length) {
                    updated[i] = {
                      ...updated[i],
                      location: extracted.address || "",
                      hours: extracted.hours ?? 0,
                    };
                  }
                });
                const newTotal = updated.reduce((sum, d) => sum + d.hours, 0);
                next.daily_entries = updated;
                next.hours_total = newTotal;
                if (next.hourly_rate) {
                  next.total_pay = Math.round(newTotal * next.hourly_rate * 100) / 100;
                }
              }

              if (data.notes) next.work_summary = data.notes;

              return next;
            });
          }}
        />
      )}

      {/* Trapper Name */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Trapper</label>
        <TrapperSelect
          value={form.trapper_name}
          onChange={(val) => setForm((prev) => ({ ...prev, trapper_name: val }))}
          inputStyle={inputStyle}
        />
      </div>

      {/* Period Type */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Period Type</label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            variant={form.period_type === "weekly" ? "primary" : "outline"}
            size="sm"
            onClick={() => handlePeriodTypeChange("weekly")}
          >
            Weekly
          </Button>
          <Button
            variant={form.period_type === "monthly" ? "primary" : "outline"}
            size="sm"
            onClick={() => handlePeriodTypeChange("monthly")}
          >
            Monthly
          </Button>
        </div>
      </div>

      {/* Period Dates */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
        <div>
          <label style={labelStyle}>Period Start</label>
          <input
            type="date"
            value={form.period_start}
            onChange={(e) => handlePeriodStartChange(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Period End</label>
          <input
            type="date"
            value={form.period_end}
            readOnly
            style={{ ...inputStyle, background: "var(--bg-secondary)", cursor: "not-allowed" }}
          />
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginTop: "0.2rem" }}>
            Auto-calculated from {form.period_type === "weekly" ? "start + 6 days" : "end of month"}
          </div>
        </div>
      </div>

      {/* Daily Log — day by day entry like Crystal's paper form */}
      <div
        style={{
          borderTop: "1px solid var(--border, #e5e7eb)",
          margin: "0 -1.25rem",
          padding: "0 1.25rem",
          paddingTop: "1rem",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.9rem", display: "block", marginBottom: "0.5rem" }}>
          Daily Log
        </span>
        <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginBottom: "0.5rem" }}>
          Enter each day&apos;s locations and hours — totals auto-calculate
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "55px 1fr 60px", gap: "0.25rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-tertiary)", marginBottom: "0.25rem", padding: "0 0.25rem" }}>
          <span>Day</span>
          <span>Location / Address</span>
          <span style={{ textAlign: "right" }}>Hours</span>
        </div>
        {form.daily_entries.map((entry, idx) => (
          <div
            key={entry.date}
            style={{
              display: "grid",
              gridTemplateColumns: "55px 1fr 60px",
              gap: "0.25rem",
              marginBottom: "0.25rem",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)" }}>
              {entry.dayLabel}
            </span>
            <input
              type="text"
              value={entry.location}
              placeholder="e.g., FFSC, Berg, VCA"
              onChange={(e) => {
                const updated = [...form.daily_entries];
                updated[idx] = { ...updated[idx], location: e.target.value };
                setForm((prev) => ({ ...prev, daily_entries: updated }));
              }}
              style={{ ...smallInputStyle, fontSize: "0.75rem" }}
            />
            <input
              type="number"
              step="0.5"
              min="0"
              value={entry.hours || ""}
              placeholder="0"
              onChange={(e) => {
                const updated = [...form.daily_entries];
                updated[idx] = { ...updated[idx], hours: parseFloat(e.target.value) || 0 };
                const newTotal = updated.reduce((sum, d) => sum + d.hours, 0);
                setForm((prev) => ({
                  ...prev,
                  daily_entries: updated,
                  hours_total: newTotal,
                  total_pay: prev.hourly_rate ? newTotal * prev.hourly_rate : prev.total_pay,
                }));
              }}
              style={{ ...smallInputStyle, fontSize: "0.75rem", textAlign: "right" }}
            />
          </div>
        ))}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "55px 1fr 60px",
            gap: "0.25rem",
            padding: "0.35rem 0.25rem 0",
            borderTop: "2px solid var(--primary, #2563eb)",
            marginTop: "0.25rem",
          }}
        >
          <span />
          <span style={{ fontSize: "0.8rem", fontWeight: 700, textAlign: "right" }}>Total</span>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, textAlign: "right" }}>
            {form.daily_entries.reduce((sum, d) => sum + d.hours, 0).toFixed(1)}
          </span>
        </div>
      </div>

      {/* Divider: Hours Category Breakdown (optional detail) */}
      <div
        style={{
          borderTop: "1px solid var(--border, #e5e7eb)",
          margin: "0 -1.25rem",
          padding: "0 1.25rem",
          paddingTop: "1rem",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.9rem", display: "block", marginBottom: "0.75rem" }}>
          Hours Breakdown
        </span>

        {/* Total Hours (prominent) */}
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={labelStyle}>Total Hours</label>
          <input
            type="number"
            step="0.5"
            min="0"
            value={form.hours_total || ""}
            onChange={(e) => handleTotalHoursChange(parseFloat(e.target.value) || 0)}
            style={{ ...inputStyle, fontWeight: 600, fontSize: "1rem" }}
            placeholder="0"
          />
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", marginTop: "0.2rem" }}>
            Auto-sums from categories below, or enter manually
          </div>
        </div>

        {/* Category breakdown */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          {[
            { field: "hours_trapping" as const, label: "Trapping" },
            { field: "hours_admin" as const, label: "Admin" },
            { field: "hours_transport" as const, label: "Transport" },
            { field: "hours_training" as const, label: "Training" },
            { field: "hours_other" as const, label: "Other" },
          ].map(({ field, label }) => (
            <div key={field}>
              <label style={{ ...labelStyle, fontSize: "0.7rem" }}>{label}</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={form[field] || ""}
                onChange={(e) => handleCategoryChange(field, parseFloat(e.target.value) || 0)}
                style={smallInputStyle}
                placeholder="0"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Divider: Pay */}
      <div
        style={{
          borderTop: "1px solid var(--border, #e5e7eb)",
          margin: "1rem -1.25rem 0",
          padding: "0 1.25rem",
          paddingTop: "1rem",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.9rem", display: "block", marginBottom: "0.75rem" }}>
          Pay
        </span>

        {/* Pay Type */}
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={labelStyle}>Pay Type</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(["hourly", "flat", "stipend"] as const).map((pt) => (
              <Button
                key={pt}
                variant={form.pay_type === pt ? "primary" : "outline"}
                size="sm"
                onClick={() => handlePayTypeChange(pt)}
              >
                {pt.charAt(0).toUpperCase() + pt.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {/* Rate + Total */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
          {form.pay_type === "hourly" && (
            <div>
              <label style={labelStyle}>Hourly Rate ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.hourly_rate ?? ""}
                onChange={(e) => handleRateChange(e.target.value ? parseFloat(e.target.value) : null)}
                style={inputStyle}
                placeholder="20.00"
              />
            </div>
          )}
          <div style={form.pay_type !== "hourly" ? { gridColumn: "1 / -1" } : undefined}>
            <label style={labelStyle}>
              Total Pay ($)
              {form.pay_type === "hourly" && !payOverride && (
                <span style={{ fontWeight: 400, color: "var(--text-tertiary)", marginLeft: "0.25rem" }}>
                  (auto)
                </span>
              )}
            </label>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.total_pay ?? ""}
                onChange={(e) => {
                  setPayOverride(true);
                  setForm((prev) => ({
                    ...prev,
                    total_pay: e.target.value ? parseFloat(e.target.value) : null,
                  }));
                }}
                style={inputStyle}
                placeholder="0.00"
              />
              {payOverride && form.pay_type === "hourly" && (
                <button
                  type="button"
                  onClick={() => {
                    setPayOverride(false);
                    if (form.hourly_rate != null) {
                      setForm((prev) => ({
                        ...prev,
                        total_pay: Math.round(prev.hours_total * (prev.hourly_rate ?? 0) * 100) / 100,
                      }));
                    }
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "0.7rem",
                    color: "var(--primary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Reset to auto
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Divider: Notes */}
      <div
        style={{
          borderTop: "1px solid var(--border, #e5e7eb)",
          margin: "0.5rem -1.25rem 0",
          padding: "0 1.25rem",
          paddingTop: "1rem",
        }}
      >
        <div style={{ marginBottom: "0.75rem" }}>
          <label style={labelStyle}>Work Summary</label>
          <textarea
            value={form.work_summary}
            onChange={(e) => setForm((prev) => ({ ...prev, work_summary: e.target.value }))}
            style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
            placeholder="What was accomplished this period..."
          />
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <label style={labelStyle}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
            placeholder="Internal notes (mileage, special circumstances, etc.)..."
          />
        </div>
      </div>
    </ActionDrawer>
  );
}

// ---------------------------------------------------------------------------
// Filter defaults
// ---------------------------------------------------------------------------

const FILTER_DEFAULTS = {
  period_type: "",
  status: "",
  page: "0",
};

const PERIOD_TYPE_OPTIONS = [
  { value: "", label: "All" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
];

// ---------------------------------------------------------------------------
// Table Row
// ---------------------------------------------------------------------------

function EntryRow({
  entry,
  onEdit,
  onSubmitForApproval,
  onApprove,
  onDelete,
}: {
  entry: HoursEntry;
  onEdit: () => void;
  onSubmitForApproval: () => void;
  onApprove: () => void;
  onDelete: () => void;
}) {
  const actions = [
    { label: "Edit", onClick: onEdit },
    ...(entry.status === "draft"
      ? [
          { label: "Submit for Approval", onClick: onSubmitForApproval, dividerBefore: true },
          { label: "Delete", onClick: onDelete, variant: "danger" as const, dividerBefore: true },
        ]
      : []),
    ...(entry.status === "submitted"
      ? [
          { label: "Approve", onClick: onApprove, dividerBefore: true },
        ]
      : []),
  ];

  return (
    <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
      {/* Period */}
      <td
        style={{
          padding: "0.75rem 1rem",
          fontSize: "0.875rem",
          fontWeight: 500,
          color: "var(--foreground)",
          whiteSpace: "nowrap",
        }}
      >
        <div>{formatPeriod(entry)}</div>
        <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", fontWeight: 400 }}>
          {entry.period_type === "weekly" ? "Weekly" : "Monthly"}
        </div>
      </td>

      {/* Trapper */}
      <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem", color: "var(--foreground)" }}>
        {entry.trapper_name}
      </td>

      {/* Hours */}
      <td style={{ padding: "0.75rem 1rem" }}>
        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--foreground)" }}>
          {entry.hours_total}h
        </div>
        <HoursBreakdown entry={entry} />
      </td>

      {/* Pay */}
      <td
        style={{
          padding: "0.75rem 1rem",
          fontSize: "0.875rem",
          fontWeight: 500,
          color: "var(--foreground)",
          whiteSpace: "nowrap",
        }}
      >
        {formatCurrency(entry.total_pay)}
      </td>

      {/* Status */}
      <td style={{ padding: "0.75rem 1rem" }}>
        <StatusBadge status={entry.status} />
      </td>

      {/* Print */}
      <td style={{ padding: "0.75rem 1rem" }}>
        <Link
          href={`/admin/trapper-hours/print?entry_id=${entry.entry_id}`}
          style={{
            fontSize: "0.75rem",
            color: "var(--primary)",
            textDecoration: "none",
          }}
        >
          Print
        </Link>
      </td>

      {/* Actions */}
      <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
        <RowActionMenu actions={actions} />
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function TrapperHoursContent() {
  const { success: toastSuccess, error: toastError } = useToast();
  const { filters, setFilter, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);

  const [data, setData] = useState<HoursResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<HoursEntry | null>(null);

  const limit = 20;
  const page = parseInt(filters.page) || 0;

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.period_type) params.set("period_type", filters.period_type);
    if (filters.status) params.set("status", filters.status);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const result = await fetchApi<HoursResponse>(
        `/api/admin/trapper-hours?${params.toString()}`
      );
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters.period_type, filters.status, page]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleOpenCreate = () => {
    setEditEntry(null);
    setDrawerOpen(true);
  };

  const handleOpenEdit = (entry: HoursEntry) => {
    setEditEntry(entry);
    setDrawerOpen(true);
  };

  const handleSubmitForApproval = async (entry: HoursEntry) => {
    try {
      await postApi("/api/admin/trapper-hours", { entry_id: entry.entry_id, status: "submitted" }, { method: "PATCH" });
      toastSuccess(`Submitted ${entry.trapper_name}'s hours for approval`);
      fetchEntries();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to submit");
    }
  };

  const handleApprove = async (entry: HoursEntry) => {
    try {
      await postApi("/api/admin/trapper-hours", { entry_id: entry.entry_id, status: "approved" }, { method: "PATCH" });
      toastSuccess(`Approved ${entry.trapper_name}'s hours`);
      fetchEntries();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to approve");
    }
  };

  const handleDelete = async (entry: HoursEntry) => {
    if (!window.confirm(`Delete this hours entry for ${entry.trapper_name}?`)) return;
    try {
      await fetchApi(`/api/admin/trapper-hours?entry_id=${entry.entry_id}`, { method: "DELETE" });
      toastSuccess("Hours entry deleted");
      fetchEntries();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const stats = data?.stats;

  // Compute this month's hours from stats (we use total_hours as all-time since that's what the API gives us)
  // For "This Month" we'd ideally have it from the API; for now show total_hours
  // The stats come from the API which can include a month filter in the future

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
        <div>
          <h1 style={{ margin: 0, marginBottom: "0.25rem" }}>Trapper Hours</h1>
          <div style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>
            <Link
              href="/admin/call-sheets"
              style={{ color: "var(--primary)", textDecoration: "none" }}
            >
              Call Sheets
            </Link>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Link
            href="/admin/trapper-hours/print?blank=true"
            target="_blank"
            style={{
              padding: "0.45rem 0.75rem",
              border: "1px solid var(--border-primary)",
              borderRadius: "6px",
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Print Timesheets
          </Link>
          <Button variant="primary" icon="plus" onClick={handleOpenCreate}>
            Log Hours
          </Button>
        </div>
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
          <StatCard
            label="Total Hours"
            value={stats.total_hours}
            subtitle="All time"
            accentColor="var(--primary)"
          />
          <StatCard
            label="Total Entries"
            value={stats.total_entries}
          />
          <StatCard
            label="Pending Approval"
            value={stats.submitted_count}
            accentColor="var(--warning-text)"
          />
          <StatCard
            label="Total Pay"
            value={formatCurrency(stats.total_pay)}
            accentColor="var(--success-text)"
          />
        </div>
      )}

      {/* Filter bar */}
      <FilterBar showClear={!isDefault} onClear={clearFilters}>
        <ToggleButtonGroup
          options={PERIOD_TYPE_OPTIONS}
          value={filters.period_type}
          onChange={(val) => {
            setFilter("period_type", val);
            setFilter("page", "0");
          }}
          aria-label="Filter by period type"
        />
        <ToggleButtonGroup
          options={STATUS_FILTER_OPTIONS}
          value={filters.status}
          onChange={(val) => {
            setFilter("status", val);
            setFilter("page", "0");
          }}
          aria-label="Filter by status"
        />
      </FilterBar>

      {/* Loading */}
      {loading && (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
          Loading hours entries...
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
          {data.entries.length === 0 ? (
            <EmptyState
              variant={filters.period_type || filters.status ? "filtered" : "default"}
              title={
                filters.period_type || filters.status
                  ? "No entries match your filters"
                  : "No hours logged yet"
              }
              description={
                filters.period_type || filters.status
                  ? "Try adjusting your filters"
                  : "Log your first hours entry to start tracking trapper time"
              }
              action={
                filters.period_type || filters.status
                  ? { label: "Clear filters", onClick: clearFilters }
                  : { label: "Log Hours", onClick: handleOpenCreate }
              }
            />
          ) : (
            <div
              style={{
                border: "1px solid var(--card-border)",
                borderRadius: "8px",
                overflow: "hidden",
                background: "var(--card-bg)",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.875rem",
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--card-border)",
                      background: "var(--bg-secondary)",
                    }}
                  >
                    <th style={thStyle}>Period</th>
                    <th style={thStyle}>Trapper</th>
                    <th style={thStyle}>Hours</th>
                    <th style={thStyle}>Pay</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}></th>
                    <th style={{ ...thStyle, width: "40px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <EntryRow
                      key={entry.entry_id}
                      entry={entry}
                      onEdit={() => handleOpenEdit(entry)}
                      onSubmitForApproval={() => handleSubmitForApproval(entry)}
                      onApprove={() => handleApprove(entry)}
                      onDelete={() => handleDelete(entry)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.entries.length > 0 && (
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

      {/* Create/Edit Drawer */}
      <HoursDrawer
        isOpen={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditEntry(null);
        }}
        onSaved={fetchEntries}
        editEntry={editEntry}
      />
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "0.625rem 1rem",
  textAlign: "left",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

// ---------------------------------------------------------------------------
// Default export with Suspense
// ---------------------------------------------------------------------------

export default function TrapperHoursPage() {
  return (
    <Suspense fallback={<div className="loading">Loading trapper hours...</div>}>
      <TrapperHoursContent />
    </Suspense>
  );
}
