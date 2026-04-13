"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { fetchApi } from "@/lib/api-client";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { PRINT_BASE_CSS, PRINT_EDITABLE_CSS } from "@/lib/print-styles";
import { formatPrintDate } from "@/lib/print-helpers";
import {
  EditableField,
  PrintHeader,
  PrintFooter,
  PrintControlsPanel,
} from "@/components/print";

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
  pay_type: "hourly" | "flat" | "stipend" | null;
  hourly_rate: number | null;
  total_pay: number | null;
  status: "draft" | "submitted" | "approved";
  submitted_at: string | null;
  approved_at: string | null;
  notes: string | null;
  work_summary: string | null;
  created_at: string;
  updated_at: string | null;
}

interface HoursResponse {
  entries: HoursEntry[];
  stats: unknown;
  pagination: unknown;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function parseDateLocal(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, y, m, d] = match;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  }
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function getWeekDays(startStr: string): { date: Date; label: string; dateStr: string }[] {
  const start = parseDateLocal(startStr);
  if (!start) return [];
  const days: { date: Date; label: string; dateStr: string }[] = [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    days.push({
      date: d,
      label: dayNames[d.getDay()],
      dateStr: d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }),
    });
  }
  return days;
}

function formatPeriodRange(start: string, end: string, periodType: string): string {
  const s = parseDateLocal(start);
  const e = parseDateLocal(end);
  if (!s || !e) return `${start} – ${end}`;

  if (periodType === "monthly") {
    return s.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  const sameMonth = s.getMonth() === e.getMonth();
  const startFmt = s.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  if (sameMonth) {
    return `${startFmt}–${e.getDate()}, ${e.getFullYear()}`;
  }
  const endFmt = e.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `${startFmt} – ${endFmt}, ${e.getFullYear()}`;
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatHours(val: number | null | undefined): string {
  if (val == null || val === 0) return "0.0";
  return val.toFixed(1);
}

function getMondayOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return toDateStr(monday);
}

// ---------------------------------------------------------------------------
// PRINT CSS (shared between both modes)
// ---------------------------------------------------------------------------

const TIMESHEET_CSS = `
  ${PRINT_BASE_CSS}
  ${PRINT_EDITABLE_CSS}

  /* Timesheet-specific styles */
  .ts-header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #166534;
    color: #fff;
    padding: 5px 12px;
    border-radius: 5px;
    margin-bottom: 10px;
  }
  .ts-header-bar .ts-name { font-size: 12pt; font-weight: 600; }
  .ts-header-bar .ts-period { font-size: 9.5pt; opacity: 0.9; }
  .ts-header-bar .ts-status {
    font-size: 9pt;
    padding: 2px 8px;
    border-radius: 3px;
    background: rgba(255,255,255,0.2);
  }

  /* Info grid */
  .ts-info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 10px;
  }

  /* Daily log table (blank form) */
  .ts-daily-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
    margin-bottom: 10px;
  }
  .ts-daily-table th {
    text-align: left;
    font-size: 7.5pt;
    font-weight: 700;
    color: #7f8c8d;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 4px 6px;
    border-bottom: 2px solid #27ae60;
    background: #f0fdf4;
  }
  .ts-daily-table th:not(:first-child) { text-align: center; }
  .ts-daily-table td {
    padding: 0;
    border-bottom: 1px solid #bdc3c7;
    height: 0.42in;
    vertical-align: bottom;
  }
  .ts-daily-table td:first-child {
    padding: 4px 6px;
    font-weight: 600;
    width: 70px;
    vertical-align: middle;
  }
  .ts-daily-table td:nth-child(2) {
    padding: 4px 6px;
    font-size: 8.5pt;
    color: #555;
    width: 50px;
    vertical-align: middle;
  }
  .ts-daily-table td.ts-write-cell {
    border-left: 1px solid #ecf0f1;
  }
  .ts-daily-table td.ts-write-cell input {
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    width: 100%;
    height: 100%;
    text-align: center;
    padding: 4px 2px;
  }
  .ts-daily-table .ts-total-row td {
    border-top: 2.5px solid #27ae60;
    border-bottom: none;
    font-weight: 700;
    font-size: 10pt;
    background: #f0fdf4;
    height: 0.36in;
    vertical-align: middle;
    padding: 4px 6px;
  }
  .ts-daily-table .ts-total-row td:not(:first-child):not(:nth-child(2)) {
    text-align: center;
  }

  /* Summary hours table (completed entry) */
  .ts-hours-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
    margin-bottom: 4px;
  }
  .ts-hours-table th {
    text-align: left;
    font-size: 7.5pt;
    font-weight: 700;
    color: #7f8c8d;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 3px 8px;
    border-bottom: 2px solid #27ae60;
  }
  .ts-hours-table th:last-child { text-align: right; }
  .ts-hours-table td {
    padding: 4px 8px;
    border-bottom: 1px solid #ecf0f1;
  }
  .ts-hours-table td:last-child {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .ts-hours-table .ts-total-row td {
    border-top: 2px solid #27ae60;
    border-bottom: none;
    font-weight: 700;
    font-size: 10pt;
    padding-top: 5px;
  }

  /* Pay grid */
  .ts-pay-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
    margin-bottom: 6px;
  }
  .ts-pay-item {
    text-align: center;
    padding: 6px 8px;
    background: #f0fdf4;
    border-radius: 4px;
    border: 1px solid #86efac;
  }
  .ts-pay-item .ts-pay-label {
    font-size: 7.5pt;
    font-weight: 700;
    color: #7f8c8d;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 2px;
  }
  .ts-pay-item .ts-pay-value {
    font-size: 11pt;
    font-weight: 700;
    color: #166534;
  }

  /* Notes */
  .ts-notes-box {
    background: #f8f9fa;
    border-radius: 4px;
    padding: 6px 8px;
    border-left: 3px solid #27ae60;
    font-size: 9pt;
    line-height: 1.4;
    margin-bottom: 6px;
    white-space: pre-wrap;
  }

  /* Signature section */
  .ts-sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-top: 10px;
  }
  .ts-sig-label {
    font-size: 7.5pt;
    font-weight: 700;
    color: #7f8c8d;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-bottom: 4px;
  }
  .ts-sig-line {
    border-bottom: 1px solid #2c3e50;
    min-height: 30px;
    margin-bottom: 4px;
  }
  .ts-sig-date-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .ts-sig-date-label {
    font-size: 8pt;
    color: #7f8c8d;
    white-space: nowrap;
  }
  .ts-sig-date-line {
    flex: 1;
    border-bottom: 1px solid #2c3e50;
    min-height: 18px;
  }

  /* Write-line fields for blank form */
  .ts-write-line {
    border-bottom: 1.5px solid #888;
    min-height: 0.40in;
    padding: 3px 0;
  }

  /* Prevent sections from splitting across pages */
  .ts-no-break { break-inside: avoid; }

  @media print {
    .ts-daily-table td.ts-write-cell input::placeholder { color: transparent; }
  }
`;

// ---------------------------------------------------------------------------
// BLANK TIMESHEET FORM
// ---------------------------------------------------------------------------

function BlankTimesheetForm({
  weekStart,
  employeeName,
  orgName,
}: {
  weekStart: string;
  employeeName: string;
  orgName: string;
}) {
  const weekEnd = toDateStr(addDays(parseDateLocal(weekStart)!, 6));
  const periodLabel = formatPeriodRange(weekStart, weekEnd, "weekly");
  const days = getWeekDays(weekStart);
  const categories = ["Trapping", "Admin", "Transport", "Training", "Other"];

  return (
    <div className="print-wrapper">
      <style jsx global>{TIMESHEET_CSS}</style>

      <PrintControlsPanel
        title="Weekly Timesheet (Blank)"
        description="Print this blank form for hand-entry. Ctrl+P or Cmd+P."
        backHref="/admin/trapper-hours"
        backLabel="Back to Trapper Hours"
      >
        <div className="ctrl-hint">
          {employeeName && <>{employeeName}<br /></>}
          Week of {periodLabel}
        </div>
      </PrintControlsPanel>

      <div className="print-page">
        <PrintHeader title="Weekly Timesheet" subtitle={orgName} />

        {/* Header bar */}
        <div className="ts-header-bar">
          <div className="ts-name">{employeeName || "________________________"}</div>
          <div className="ts-period">Week of {periodLabel}</div>
        </div>

        {/* Employee + Period info */}
        <div className="ts-info-grid ts-no-break">
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Employee</div>
            <EditableField
              label="Name"
              value={employeeName || null}
              placeholder="Employee name"
              style={{ marginBottom: "4px" }}
            />
            <EditableField
              label="Position / Role"
              placeholder="e.g., Trapping Coordinator"
              style={{ marginBottom: 0 }}
            />
          </div>
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Pay Period</div>
            <EditableField
              label="Week Starting"
              value={weekStart ? periodLabel : null}
              placeholder="Week of ___________"
              style={{ marginBottom: "4px" }}
            />
            <EditableField
              label="Pay Rate"
              placeholder="$____/hr"
              style={{ marginBottom: 0 }}
            />
          </div>
        </div>

        {/* Daily hours table */}
        <div className="section ts-no-break">
          <div className="section-title">Daily Hours Log</div>
          <table className="ts-daily-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Date</th>
                {categories.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                <th style={{ fontWeight: 800 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.label}>
                  <td>{day.label}</td>
                  <td>{day.dateStr}</td>
                  {categories.map((c) => (
                    <td key={c} className="ts-write-cell">
                      <input type="text" placeholder="—" />
                    </td>
                  ))}
                  <td className="ts-write-cell">
                    <input type="text" placeholder="—" />
                  </td>
                </tr>
              ))}
              <tr className="ts-total-row">
                <td colSpan={2}>Weekly Total</td>
                {categories.map((c) => (
                  <td key={c} className="ts-write-cell">
                    <input type="text" placeholder="" />
                  </td>
                ))}
                <td className="ts-write-cell" style={{ fontWeight: 800 }}>
                  <input type="text" placeholder="" style={{ fontWeight: 800 }} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Work summary */}
        <div className="section ts-no-break">
          <div className="section-title">Work Summary</div>
          <div
            className="ts-write-line"
            style={{ minHeight: "0.45in", marginBottom: "6px" }}
          >
            <input
              type="text"
              placeholder="Brief description of key activities this week..."
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                font: "inherit",
                width: "100%",
                padding: "4px 0",
              }}
            />
          </div>
          <div className="ts-write-line" style={{ minHeight: "0.45in" }}>
            <input
              type="text"
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                font: "inherit",
                width: "100%",
                padding: "4px 0",
              }}
            />
          </div>
        </div>

        {/* Pay calculation (staff use) */}
        <div
          className="staff-box ts-no-break"
          style={{ marginTop: "8px", marginBottom: "8px" }}
        >
          <div className="section-title">Pay Calculation (Office Use)</div>
          <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
            <EditableField
              label="Total Hours"
              placeholder="____"
              style={{ flex: "0 0 90px" }}
            />
            <span style={{ fontSize: "11pt", fontWeight: 700, paddingTop: "14px" }}>×</span>
            <EditableField
              label="Rate"
              placeholder="$____/hr"
              style={{ flex: "0 0 90px" }}
            />
            <span style={{ fontSize: "11pt", fontWeight: 700, paddingTop: "14px" }}>=</span>
            <EditableField
              label="Total Pay"
              placeholder="$________"
              style={{ flex: "0 0 110px" }}
            />
            <div style={{ flex: 1 }} />
            <EditableField
              label="Processed by"
              placeholder="Staff initials"
              style={{ flex: "0 0 110px" }}
            />
          </div>
        </div>

        {/* Signatures */}
        <div className="section ts-no-break" style={{ marginTop: "10px" }}>
          <div className="section-title">Signatures</div>
          <div className="ts-sig-grid">
            <div>
              <div className="ts-sig-label">Employee Signature</div>
              <div className="ts-sig-line" />
              <div className="ts-sig-date-row">
                <span className="ts-sig-date-label">Date:</span>
                <div className="ts-sig-date-line" />
              </div>
            </div>
            <div>
              <div className="ts-sig-label">Supervisor Signature</div>
              <div className="ts-sig-line" />
              <div className="ts-sig-date-row">
                <span className="ts-sig-date-label">Date:</span>
                <div className="ts-sig-date-line" />
              </div>
            </div>
          </div>
        </div>

        <PrintFooter
          left={`${orgName} • Weekly Timesheet`}
          right={`Week of ${periodLabel}`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COMPLETED ENTRY PRINTOUT
// ---------------------------------------------------------------------------

function CompletedEntryPrintout({
  entry,
  orgName,
}: {
  entry: HoursEntry;
  orgName: string;
}) {
  const sheetTitle =
    entry.period_type === "monthly" ? "Monthly Timesheet" : "Weekly Timesheet";
  const periodLabel = formatPeriodRange(
    entry.period_start,
    entry.period_end,
    entry.period_type
  );

  const hoursBreakdown = [
    { label: "Trapping", value: entry.hours_trapping },
    { label: "Admin", value: entry.hours_admin },
    { label: "Transport", value: entry.hours_transport },
    { label: "Training", value: entry.hours_training },
    { label: "Other", value: entry.hours_other },
  ];

  const statusLabel =
    entry.status === "approved"
      ? "Approved"
      : entry.status === "submitted"
        ? "Submitted"
        : "Draft";

  return (
    <div className="print-wrapper">
      <style jsx global>{TIMESHEET_CSS}</style>

      <PrintControlsPanel
        title={sheetTitle}
        description="Print via Ctrl+P or Cmd+P."
        backHref="/admin/trapper-hours"
        backLabel="Back to Trapper Hours"
      >
        <div className="ctrl-hint">
          {entry.trapper_name}<br />
          {periodLabel}<br />
          Status: {statusLabel}<br />
          ID: {entry.entry_id.slice(0, 8)}
        </div>
      </PrintControlsPanel>

      <div className="print-page">
        <PrintHeader title={sheetTitle} subtitle={orgName} />

        {/* Header bar */}
        <div className="ts-header-bar">
          <div className="ts-name">{entry.trapper_name}</div>
          <div className="ts-status">{statusLabel}</div>
        </div>

        {/* Employee + Period info */}
        <div className="ts-info-grid ts-no-break">
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Employee</div>
            <div style={{ marginBottom: "3px" }}>
              <strong>{entry.trapper_name}</strong>
              {entry.trapper_type && (
                <span style={{ marginLeft: "8px", fontSize: "8.5pt", color: "#7f8c8d" }}>
                  ({entry.trapper_type.replace(/_/g, " ")})
                </span>
              )}
            </div>
          </div>
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Period</div>
            <div style={{ marginBottom: "3px" }}>
              <strong>{periodLabel}</strong>
            </div>
            <div style={{ fontSize: "8.5pt", color: "#555" }}>
              {entry.period_type === "monthly" ? "Monthly" : "Weekly"} Period
              {entry.submitted_at && <> · Submitted {formatPrintDate(entry.submitted_at)}</>}
              {entry.approved_at && <> · Approved {formatPrintDate(entry.approved_at)}</>}
            </div>
          </div>
        </div>

        {/* Hours breakdown */}
        <div className="section ts-no-break">
          <div className="section-title">Hours Breakdown</div>
          <table className="ts-hours-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              {hoursBreakdown.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{formatHours(row.value)}</td>
                </tr>
              ))}
              <tr className="ts-total-row">
                <td>Total</td>
                <td>{formatHours(entry.hours_total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Pay */}
        <div className="section ts-no-break">
          <div className="section-title">Pay</div>
          <div className="ts-pay-grid">
            <div className="ts-pay-item">
              <div className="ts-pay-label">Pay Type</div>
              <div className="ts-pay-value">
                {entry.pay_type === "hourly" ? "Hourly" : entry.pay_type === "flat" ? "Flat Rate" : entry.pay_type === "stipend" ? "Stipend" : "—"}
              </div>
            </div>
            <div className="ts-pay-item">
              <div className="ts-pay-label">Rate</div>
              <div className="ts-pay-value">
                {entry.hourly_rate != null ? `${formatCurrency(entry.hourly_rate)}/hr` : "—"}
              </div>
            </div>
            <div className="ts-pay-item">
              <div className="ts-pay-label">Total</div>
              <div className="ts-pay-value">{formatCurrency(entry.total_pay)}</div>
            </div>
          </div>
        </div>

        {/* Work summary */}
        {entry.work_summary && (
          <div className="section ts-no-break">
            <div className="section-title">Work Summary</div>
            <div className="ts-notes-box">{entry.work_summary}</div>
          </div>
        )}

        {/* Notes */}
        {entry.notes && (
          <div className="section ts-no-break">
            <div className="section-title">Notes</div>
            <div className="ts-notes-box">{entry.notes}</div>
          </div>
        )}

        {/* Signatures */}
        <div className="section ts-no-break" style={{ marginTop: "12px" }}>
          <div className="section-title">Signatures</div>
          <div className="ts-sig-grid">
            <div>
              <div className="ts-sig-label">Employee Signature</div>
              <div className="ts-sig-line" />
              <div className="ts-sig-date-row">
                <span className="ts-sig-date-label">Date:</span>
                <div className="ts-sig-date-line" />
              </div>
            </div>
            <div>
              <div className="ts-sig-label">Supervisor Signature</div>
              <div className="ts-sig-line" />
              <div className="ts-sig-date-row">
                <span className="ts-sig-date-label">Date:</span>
                <div className="ts-sig-date-line" />
              </div>
            </div>
          </div>
        </div>

        <PrintFooter
          left={`${entry.trapper_name} | ${entry.entry_id.slice(0, 8)} | ${formatPrintDate(entry.created_at)}`}
          right="Page 1 of 1"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MAIN COMPONENT — routes between blank form and completed entry
// ---------------------------------------------------------------------------

function TimesheetPrintContent() {
  const searchParams = useSearchParams();
  const { nameFull } = useOrgConfig();

  // URL params
  const entryId = searchParams.get("entry_id");
  const isBlank = searchParams.get("blank") === "true" || (!entryId);
  const weekStartParam = searchParams.get("week_start");
  const nameParam = searchParams.get("name");

  // State for blank form controls
  const [weekStart, setWeekStart] = useState(weekStartParam || getMondayOfCurrentWeek());
  const [employeeName, setEmployeeName] = useState(nameParam || "Crystal Furtado");

  // State for completed entry
  const [entry, setEntry] = useState<HoursEntry | null>(null);
  const [loading, setLoading] = useState(!isBlank);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isBlank) {
      // Auto-print blank form after short delay
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [isBlank]);

  useEffect(() => {
    if (!entryId || isBlank) return;

    async function fetchEntry() {
      try {
        const result = await fetchApi<HoursResponse>(
          `/api/admin/trapper-hours?limit=200`
        );
        const match = result.entries.find((e: HoursEntry) => e.entry_id === entryId);
        if (!match) {
          setError("Time entry not found");
        } else {
          setEntry(match);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading entry");
      } finally {
        setLoading(false);
      }
    }
    fetchEntry();
  }, [entryId, isBlank]);

  // ── Blank form mode ──
  if (isBlank) {
    return (
      <>
        {/* Extra controls for blank form (only on screen) */}
        <div
          className="print-controls"
          style={{
            position: "fixed",
            right: 0,
            top: 0,
            width: "280px",
            height: "100vh",
            padding: "1.5rem",
            background: "#fff",
            borderLeft: "1px solid #e5e7eb",
            zIndex: 100,
            overflowY: "auto",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <a
            href="/admin/trapper-hours"
            style={{
              display: "inline-block",
              marginBottom: "1rem",
              color: "#27ae60",
              textDecoration: "none",
              fontSize: "13px",
            }}
          >
            ← Back to Trapper Hours
          </a>
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "15px" }}>
            Blank Weekly Timesheet
          </h3>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "1rem" }}>
            Prefill name and week, then print. Ctrl+P or Cmd+P.
          </p>

          <div style={{ marginBottom: "10px" }}>
            <label style={{ display: "block", fontSize: "11px", color: "#666", marginBottom: "3px" }}>
              Employee Name
            </label>
            <input
              type="text"
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              style={{
                width: "100%",
                padding: "7px",
                border: "1px solid #ddd",
                borderRadius: "6px",
                fontSize: "13px",
              }}
            />
          </div>

          <div style={{ marginBottom: "10px" }}>
            <label style={{ display: "block", fontSize: "11px", color: "#666", marginBottom: "3px" }}>
              Week Starting (Monday)
            </label>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              style={{
                width: "100%",
                padding: "7px",
                border: "1px solid #ddd",
                borderRadius: "6px",
                fontSize: "13px",
              }}
            />
          </div>

          <button
            onClick={() => window.print()}
            style={{
              width: "100%",
              padding: "10px",
              background: "#27ae60",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              marginTop: "8px",
            }}
          >
            Print Timesheet
          </button>
        </div>

        <BlankTimesheetForm
          weekStart={weekStart}
          employeeName={employeeName}
          orgName={nameFull}
        />
      </>
    );
  }

  // ── Loading / Error states ──
  if (loading) {
    return (
      <div style={{ padding: "2rem", fontFamily: "Helvetica, Arial, sans-serif" }}>
        Loading...
      </div>
    );
  }
  if (error || !entry) {
    return (
      <div style={{ padding: "2rem", color: "#e74c3c", fontFamily: "Helvetica, Arial, sans-serif" }}>
        {error || "Entry not found"}
      </div>
    );
  }

  // ── Completed entry mode ──
  return <CompletedEntryPrintout entry={entry} orgName={nameFull} />;
}

// ---------------------------------------------------------------------------
// Page wrapper
// ---------------------------------------------------------------------------

export default function TimesheetPrintPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: "2rem", fontFamily: "Helvetica, Arial, sans-serif" }}>
          Loading...
        </div>
      }
    >
      <TimesheetPrintContent />
    </Suspense>
  );
}
