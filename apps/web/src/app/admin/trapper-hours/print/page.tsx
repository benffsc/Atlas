"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { fetchApi } from "@/lib/api-client";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { PRINT_BASE_CSS, PRINT_EDITABLE_CSS } from "@/lib/print-styles";
import { formatPrintDate } from "@/lib/print-helpers";
import {
  PrintHeader,
  PrintFooter,
  PrintControlsPanel,
} from "@/components/print";

// ---------------------------------------------------------------------------
// Types (mirrors HoursEntry from the list page)
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
// Helpers
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

function formatPeriodRange(entry: HoursEntry): string {
  const start = parseDateLocal(entry.period_start);
  const end = parseDateLocal(entry.period_end);
  if (!start || !end) return `${entry.period_start} \u2013 ${entry.period_end}`;

  if (entry.period_type === "monthly") {
    return start.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  }

  // Weekly: "April 7-13, 2026" or "March 28 - April 3, 2026"
  const sameMonth = start.getMonth() === end.getMonth();
  const startFmt = start.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  if (sameMonth) {
    return `${startFmt}\u2013${end.getDate()}, ${end.getFullYear()}`;
  }
  const endFmt = end.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  return `${startFmt} \u2013 ${endFmt}, ${end.getFullYear()}`;
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return "\u2014";
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

function formatPayType(payType: string | null): string {
  switch (payType) {
    case "hourly":
      return "Hourly";
    case "flat":
      return "Flat Rate";
    case "stipend":
      return "Stipend";
    default:
      return "\u2014";
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Submitted";
    case "approved":
      return "Approved";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// Inner component (needs useSearchParams inside Suspense)
// ---------------------------------------------------------------------------

function TimesheetPrintContent() {
  const searchParams = useSearchParams();
  const entryId = searchParams.get("entry_id");
  const { nameFull } = useOrgConfig();

  const [entry, setEntry] = useState<HoursEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entryId) {
      setError("No entry_id provided in URL");
      setLoading(false);
      return;
    }

    async function fetchEntry() {
      try {
        // Fetch entries list and find the matching one
        const result = await fetchApi<HoursResponse>(
          `/api/admin/trapper-hours?limit=200`
        );
        const match = result.entries.find(
          (e: HoursEntry) => e.entry_id === entryId
        );
        if (!match) {
          setError("Time entry not found");
        } else {
          setEntry(match);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error loading time entry"
        );
      } finally {
        setLoading(false);
      }
    }
    fetchEntry();
  }, [entryId]);

  if (loading) {
    return (
      <div
        style={{
          padding: "2rem",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: "2rem",
          color: "var(--danger-text, #e74c3c)",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        {error}
      </div>
    );
  }

  if (!entry) {
    return (
      <div
        style={{
          padding: "2rem",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        Time entry not found
      </div>
    );
  }

  const sheetTitle =
    entry.period_type === "monthly" ? "Monthly Timesheet" : "Weekly Timesheet";

  // Hours breakdown rows
  const hoursBreakdown = [
    { label: "Trapping", value: entry.hours_trapping },
    { label: "Admin", value: entry.hours_admin },
    { label: "Transport", value: entry.hours_transport },
    { label: "Training", value: entry.hours_training },
    { label: "Other", value: entry.hours_other },
  ];

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        ${PRINT_BASE_CSS}
        ${PRINT_EDITABLE_CSS}

        /* Timesheet-specific styles */
        .ts-header-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #166534;
          color: #fff;
          padding: 4px 10px;
          border-radius: 5px;
          margin-bottom: 8px;
        }
        .ts-header-bar .ts-name {
          font-size: 11pt;
          font-weight: 600;
        }
        .ts-header-bar .ts-status {
          font-size: 9.5pt;
          padding: 2px 8px;
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.2);
        }

        /* Summary grid */
        .ts-summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 8px;
        }

        /* Hours table */
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
        .ts-hours-table th:last-child {
          text-align: right;
        }
        .ts-hours-table td {
          padding: 4px 8px;
          border-bottom: 1px solid #ecf0f1;
        }
        .ts-hours-table td:last-child {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .ts-hours-table tr:last-child td {
          border-bottom: none;
        }
        .ts-hours-table .ts-total-row td {
          border-top: 2px solid #27ae60;
          border-bottom: none;
          font-weight: 700;
          font-size: 10pt;
          padding-top: 5px;
        }

        /* Pay section */
        .ts-pay-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 8px;
          margin-bottom: 4px;
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

        /* Signature section */
        .ts-sig-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-top: 8px;
        }
        .ts-sig-block {
          padding-top: 4px;
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
          min-height: 28px;
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

        /* Notes box */
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
        .ts-notes-label {
          font-size: 7.5pt;
          font-weight: 700;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          margin-bottom: 2px;
        }
      `}</style>

      {/* Print Controls (screen only) */}
      <PrintControlsPanel
        title={sheetTitle}
        description="Print via Ctrl+P or Cmd+P."
        backHref="/admin/trapper-hours"
        backLabel="Back to Trapper Hours"
      >
        <div className="ctrl-hint">
          {entry.trapper_name}
          <br />
          {formatPeriodRange(entry)}
          <br />
          Status: {formatStatus(entry.status)}
          <br />
          ID: {entry.entry_id.slice(0, 8)}
        </div>
      </PrintControlsPanel>

      {/* ═══════════════════ PAGE 1 ═══════════════════ */}
      <div className="print-page">
        <PrintHeader title={sheetTitle} subtitle={nameFull} />

        {/* Employee info bar */}
        <div className="ts-header-bar">
          <div className="ts-name">{entry.trapper_name}</div>
          <div className="ts-status">{formatStatus(entry.status)}</div>
        </div>

        {/* Summary grid: Employee info + Period */}
        <div className="ts-summary-grid">
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Employee</div>
            <div style={{ marginBottom: "3px" }}>
              <strong>{entry.trapper_name}</strong>
              {entry.trapper_type && (
                <span
                  style={{
                    marginLeft: "8px",
                    fontSize: "8.5pt",
                    color: "#7f8c8d",
                  }}
                >
                  ({entry.trapper_type.replace(/_/g, " ")})
                </span>
              )}
            </div>
            <div style={{ fontSize: "8.5pt", color: "#555" }}>
              Person ID: {entry.person_id.slice(0, 8)}
            </div>
          </div>
          <div className="section" style={{ marginBottom: 0 }}>
            <div className="section-title">Period</div>
            <div style={{ marginBottom: "3px" }}>
              <strong>{formatPeriodRange(entry)}</strong>
            </div>
            <div style={{ fontSize: "8.5pt", color: "#555" }}>
              {entry.period_type === "monthly" ? "Monthly" : "Weekly"} Period
              {entry.submitted_at && (
                <>
                  {" "}
                  &middot; Submitted {formatPrintDate(entry.submitted_at)}
                </>
              )}
              {entry.approved_at && (
                <>
                  {" "}
                  &middot; Approved {formatPrintDate(entry.approved_at)}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Hours Breakdown */}
        <div className="section">
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

        {/* Pay Section */}
        <div className="section">
          <div className="section-title">Pay</div>
          <div className="ts-pay-grid">
            <div className="ts-pay-item">
              <div className="ts-pay-label">Pay Type</div>
              <div className="ts-pay-value">{formatPayType(entry.pay_type)}</div>
            </div>
            <div className="ts-pay-item">
              <div className="ts-pay-label">Rate</div>
              <div className="ts-pay-value">
                {entry.hourly_rate != null
                  ? `${formatCurrency(entry.hourly_rate)}/hr`
                  : "\u2014"}
              </div>
            </div>
            <div className="ts-pay-item">
              <div className="ts-pay-label">Total</div>
              <div className="ts-pay-value">
                {formatCurrency(entry.total_pay)}
              </div>
            </div>
          </div>
        </div>

        {/* Work Summary */}
        {entry.work_summary && (
          <div className="section">
            <div className="section-title">Work Summary</div>
            <div className="ts-notes-box">{entry.work_summary}</div>
          </div>
        )}

        {/* Notes */}
        {entry.notes && (
          <div className="section">
            <div className="section-title">Notes</div>
            <div className="ts-notes-box">{entry.notes}</div>
          </div>
        )}

        {/* Signature Section */}
        <div className="section" style={{ marginTop: "12px" }}>
          <div className="section-title">Signatures</div>
          <div className="ts-sig-grid">
            <div className="ts-sig-block">
              <div className="ts-sig-label">Employee Signature</div>
              <div className="ts-sig-line" />
              <div className="ts-sig-date-row">
                <span className="ts-sig-date-label">Date:</span>
                <div className="ts-sig-date-line" />
              </div>
            </div>
            <div className="ts-sig-block">
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

      {/* Confidential footer note (prints below the page footer) */}
      <div
        style={{
          textAlign: "center",
          fontSize: "7pt",
          color: "#95a5a6",
          marginTop: "4px",
          fontStyle: "italic",
        }}
      >
        Confidential &mdash; {nameFull}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper with Suspense (useSearchParams requires it)
// ---------------------------------------------------------------------------

export default function TimesheetPrintPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            padding: "2rem",
            fontFamily: "Helvetica, Arial, sans-serif",
          }}
        >
          Loading...
        </div>
      }
    >
      <TimesheetPrintContent />
    </Suspense>
  );
}
