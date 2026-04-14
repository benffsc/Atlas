"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { PRINT_BASE_CSS, PRINT_EDITABLE_CSS } from "@/lib/print-styles";
import {
  EditableField,
  PrintHeader,
  PrintFooter,
  PrintControlsPanel,
} from "@/components/print";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function parseDateLocal(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  return null;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

function getMondayOfCurrentWeek(): string {
  return toDateStr(getMondayOfWeek(new Date()));
}

function formatPeriodRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth();
  const startFmt = start.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  if (sameMonth) {
    return `${startFmt}–${end.getDate()}, ${end.getFullYear()}`;
  }
  const endFmt = end.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  return `${startFmt} – ${endFmt}, ${end.getFullYear()}`;
}

interface WeekData {
  start: Date;
  end: Date;
  label: string;
  days: { dayName: string; fullDate: string }[];
}

function generateWeeks(fromStr: string, toStr: string): WeekData[] {
  const from = parseDateLocal(fromStr);
  const to = parseDateLocal(toStr);
  if (!from || !to || to < from) return [];

  const weeks: WeekData[] = [];
  let cursor = getMondayOfWeek(from);
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  while (cursor <= to) {
    const weekEnd = addDays(cursor, 6);
    const days = dayNames.map((name, i) => {
      const d = addDays(cursor, i);
      return {
        dayName: name,
        fullDate: `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`,
      };
    });

    weeks.push({
      start: new Date(cursor),
      end: weekEnd,
      label: formatPeriodRange(cursor, weekEnd),
      days,
    });

    cursor = addDays(cursor, 7);
  }

  return weeks;
}

// ---------------------------------------------------------------------------
// Batch print CSS
// ---------------------------------------------------------------------------

const BATCH_CSS = `
  ${PRINT_BASE_CSS}
  ${PRINT_EDITABLE_CSS}

  /* Blue brand accent */
  .print-wrapper {
    --print-accent: #2563eb;
    --print-accent-dark: #1e40af;
    --print-accent-bg: #eff6ff;
    --print-accent-border: #93c5fd;
    --print-screen-bg: #eff6ff;
  }

  .print-page {
    padding: 0.40in 0.55in 0.35in !important;
  }

  @media print {
    @page { margin: 0 !important; }
    .print-page {
      padding: 0.40in 0.55in 0.35in !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      margin: 0 !important;
    }
  }

  .ts-header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--print-accent-dark);
    color: #fff;
    padding: 5px 12px;
    border-radius: 5px;
    margin-bottom: 8px;
  }
  .ts-header-bar .ts-name { font-size: 12pt; font-weight: 600; }
  .ts-header-bar .ts-period { font-size: 9.5pt; opacity: 0.9; }

  .ts-daily-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
    margin-bottom: 8px;
    table-layout: fixed;
  }
  .ts-daily-table th {
    text-align: left;
    font-size: 7.5pt;
    font-weight: 700;
    color: #7f8c8d;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 4px 6px;
    border-bottom: 2px solid var(--print-accent);
    background: var(--print-accent-bg);
  }
  .ts-daily-table th:not(:first-child) { text-align: center; }
  .ts-daily-table td {
    padding: 0;
    border-bottom: 1px solid #bdc3c7;
    height: 0.92in;
    vertical-align: bottom;
  }
  .ts-daily-table td:first-child {
    padding: 4px 6px;
    font-weight: 600;
    vertical-align: middle;
  }
  .ts-daily-table td.ts-write-cell {
    border-left: 1px solid #bdc3c7;
    border-right: 1px solid #bdc3c7;
  }
  .ts-daily-table td.ts-write-cell input {
    border: none; outline: none; background: transparent;
    font: inherit; width: 100%; height: 100%;
    text-align: center; padding: 4px 2px;
  }
  .ts-daily-table .ts-total-row td {
    border-top: 2.5px solid var(--print-accent);
    border-bottom: none;
    font-weight: 700;
    font-size: 10pt;
    background: var(--print-accent-bg);
    height: 0.36in;
    vertical-align: middle;
    padding: 4px 6px;
  }

  .ts-sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-top: 8px;
  }
  .ts-sig-label {
    font-size: 7.5pt; font-weight: 700; color: #7f8c8d;
    text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px;
  }
  .ts-sig-line { border-bottom: 1px solid #2c3e50; min-height: 28px; margin-bottom: 4px; }
  .ts-sig-date-row { display: flex; align-items: flex-end; gap: 8px; }
  .ts-sig-date-label { font-size: 8pt; color: #7f8c8d; white-space: nowrap; }
  .ts-sig-date-line { flex: 1; border-bottom: 1px solid #2c3e50; min-height: 18px; }

  .ts-no-break { break-inside: avoid; }

  @media print {
    .ts-daily-table td.ts-write-cell input::placeholder { color: transparent; }
  }
`;

// ---------------------------------------------------------------------------
// Batch Print Content
// ---------------------------------------------------------------------------

function BatchPrintContent() {
  const searchParams = useSearchParams();
  const { nameFull } = useOrgConfig();

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const nameParam = searchParams.get("name");

  const [employeeName, setEmployeeName] = useState(nameParam || "Crystal Furtado");
  const [fromDate, setFromDate] = useState(fromParam || getMondayOfCurrentWeek());
  const [toDate, setToDate] = useState(
    toParam || toDateStr(addDays(parseDateLocal(fromParam || getMondayOfCurrentWeek())!, 27))
  );

  const weeks = generateWeeks(fromDate, toDate);

  return (
    <div className="print-wrapper">
      <style jsx global>{BATCH_CSS}</style>

      <PrintControlsPanel
        title="Batch Print Timesheets"
        description={`${weeks.length} week${weeks.length !== 1 ? "s" : ""} — one page per week.`}
        backHref="/admin/trapper-hours"
        backLabel="Back to Trapper Hours"
      >
        <div className="ctrl-field" style={{ marginBottom: "8px" }}>
          <label style={{ display: "block", fontSize: "11px", color: "#666", marginBottom: "3px" }}>
            Employee Name
          </label>
          <input
            type="text"
            value={employeeName}
            onChange={(e) => setEmployeeName(e.target.value)}
            style={{ width: "100%", padding: "7px", border: "1px solid #ddd", borderRadius: "6px", fontSize: "13px", boxSizing: "border-box" }}
          />
        </div>
        <div className="ctrl-field" style={{ marginBottom: "8px" }}>
          <label style={{ display: "block", fontSize: "11px", color: "#666", marginBottom: "3px" }}>
            From (Monday)
          </label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ width: "100%", padding: "7px", border: "1px solid #ddd", borderRadius: "6px", fontSize: "13px", boxSizing: "border-box" }}
          />
        </div>
        <div className="ctrl-field" style={{ marginBottom: "8px" }}>
          <label style={{ display: "block", fontSize: "11px", color: "#666", marginBottom: "3px" }}>
            To
          </label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ width: "100%", padding: "7px", border: "1px solid #ddd", borderRadius: "6px", fontSize: "13px", boxSizing: "border-box" }}
          />
        </div>
        <div className="ctrl-hint">
          {weeks.length} timesheet{weeks.length !== 1 ? "s" : ""} will print
        </div>
      </PrintControlsPanel>

      {weeks.map((week, idx) => (
        <div className="print-page" key={idx}>
          <PrintHeader
            title="Weekly Timesheet"
            subtitle={nameFull}
            rightContent={
              <div style={{ textAlign: "right", fontSize: "10pt" }}>
                <strong>{employeeName}</strong>
              </div>
            }
          />

          <div className="ts-header-bar">
            <div className="ts-name">{employeeName}</div>
            <div className="ts-period">{week.label}</div>
          </div>

          <table className="ts-daily-table">
            <thead>
              <tr>
                <th style={{ width: "120px" }}>Date</th>
                <th>Address / Location</th>
                <th style={{ width: "85px" }}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {week.days.map((day, i) => (
                <tr key={i}>
                  <td>
                    <span style={{ fontWeight: 600 }}>{day.dayName} {day.fullDate}</span>
                  </td>
                  <td className="ts-write-cell">
                    <input type="text" style={{ textAlign: "left", paddingLeft: "6px" }} />
                  </td>
                  <td className="ts-write-cell">
                    <input type="text" />
                  </td>
                </tr>
              ))}
              <tr className="ts-total-row">
                <td colSpan={2} style={{ textAlign: "right", paddingRight: "12px" }}>Total Hours</td>
                <td className="ts-write-cell" style={{ fontWeight: 800 }}>
                  <input type="text" style={{ fontWeight: 800 }} />
                </td>
              </tr>
            </tbody>
          </table>

          {/* Signatures */}
          <div className="section ts-no-break">
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
            left={`${nameFull} • Weekly Timesheet`}
            right={`${week.label} — Page ${idx + 1} of ${weeks.length}`}
          />
        </div>
      ))}

      {weeks.length === 0 && (
        <div style={{ padding: "2rem", textAlign: "center", color: "#666" }}>
          No weeks in the selected range. Adjust the dates.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page wrapper
// ---------------------------------------------------------------------------

export default function BatchPrintPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}>Loading...</div>}>
      <BatchPrintContent />
    </Suspense>
  );
}
