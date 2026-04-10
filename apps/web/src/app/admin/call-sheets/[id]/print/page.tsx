"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { fetchApi } from "@/lib/api-client";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { PRINT_BASE_CSS, PRINT_EDITABLE_CSS } from "@/lib/print-styles";
import { formatPhone } from "@/lib/formatters";
import { formatPrintDate } from "@/lib/print-helpers";
import {
  Check,
  PrintHeader,
  PrintFooter,
  PrintControlsPanel,
} from "@/components/print";
import type {
  CallSheetSummary,
  CallSheetItemDetail,
} from "@/lib/call-sheet-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallSheetDetailResponse {
  sheet: CallSheetSummary;
  items: CallSheetItemDetail[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Disposition checkboxes shown on the printed form */
const PRINT_DISPOSITIONS = [
  { key: "reached", label: "Reached" },
  { key: "left_voicemail", label: "VM" },
  { key: "no_answer", label: "NA" },
  { key: "wrong_number", label: "Wrong#" },
  { key: "not_interested", label: "N/I" },
  { key: "scheduled_trapping", label: "Sched" },
] as const;

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function CallSheetPrintPage() {
  const params = useParams();
  const id = params.id as string;
  const { nameFull } = useOrgConfig();

  const [data, setData] = useState<CallSheetDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await fetchApi<CallSheetDetailResponse>(
          `/api/admin/call-sheets/${id}`
        );
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading call sheet");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div style={{ padding: "2rem", fontFamily: "Helvetica, Arial, sans-serif" }}>
        Loading...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: "2rem", color: "var(--danger-text, #e74c3c)", fontFamily: "Helvetica, Arial, sans-serif" }}>
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ padding: "2rem", fontFamily: "Helvetica, Arial, sans-serif" }}>
        Call sheet not found
      </div>
    );
  }

  const { sheet, items } = data;

  // Chunk items across pages (approx 12 rows per page to stay within letter margins)
  const ROWS_PER_PAGE = 12;
  const pages: CallSheetItemDetail[][] = [];
  for (let i = 0; i < items.length; i += ROWS_PER_PAGE) {
    pages.push(items.slice(i, i + ROWS_PER_PAGE));
  }
  // Always have at least one page
  if (pages.length === 0) pages.push([]);

  const totalPages = pages.length;

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        ${PRINT_BASE_CSS}
        ${PRINT_EDITABLE_CSS}

        .cs-header-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #166534;
          color: #fff;
          padding: 4px 10px;
          border-radius: 5px;
          margin-bottom: 6px;
        }
        .cs-header-bar .cs-trapper { font-size: 11pt; font-weight: 600; }
        .cs-header-bar .cs-date { font-size: 9.5pt; }

        /* Call sheet table */
        .cs-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9pt;
          margin-bottom: 6px;
        }
        .cs-table th {
          text-align: left;
          font-size: 7.5pt;
          font-weight: 700;
          color: #7f8c8d;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          padding: 3px 5px;
          border-bottom: 2px solid #27ae60;
          white-space: nowrap;
        }
        .cs-table td {
          padding: 4px 5px;
          border-bottom: 1px solid #ecf0f1;
          vertical-align: top;
        }
        .cs-table tr:last-child td {
          border-bottom: none;
        }

        /* Priority number column */
        .cs-num {
          width: 20px;
          text-align: center;
          font-weight: 700;
          color: #27ae60;
        }

        /* Name column */
        .cs-name {
          font-weight: 600;
          white-space: nowrap;
        }

        /* Phone column */
        .cs-phone {
          white-space: nowrap;
          font-size: 9pt;
        }

        /* Address column — allow wrapping */
        .cs-address {
          max-width: 1.8in;
          font-size: 8.5pt;
          line-height: 1.3;
        }

        /* Context column — compact */
        .cs-context {
          max-width: 1.4in;
          font-size: 8pt;
          color: #555;
          line-height: 1.3;
        }

        /* Date called write line */
        .cs-date-called {
          width: 0.8in;
          border-bottom: 1px solid #888 !important;
        }

        /* Disposition checkboxes */
        .cs-disp {
          display: flex;
          gap: 3px;
          flex-wrap: nowrap;
        }
        .cs-disp .option {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          margin-right: 2px;
          font-size: 7pt;
          white-space: nowrap;
        }
        .cs-disp .checkbox {
          width: 10px;
          height: 10px;
          border: 1.5px solid #27ae60;
          border-radius: 2px;
          background: #fff;
          flex-shrink: 0;
        }

        /* Notes write line */
        .cs-notes-line {
          min-width: 1in;
          border-bottom: 1px solid #888;
          min-height: 14px;
        }

        /* Summary bar */
        .cs-summary {
          display: flex;
          gap: 16px;
          font-size: 8.5pt;
          color: #555;
          margin-bottom: 6px;
        }
        .cs-summary strong {
          color: #2c3e50;
        }
      `}</style>

      {/* Print Controls */}
      <PrintControlsPanel
        title="Call Sheet"
        description={`${items.length} calls across ${totalPages} page${totalPages > 1 ? "s" : ""}. Print via Ctrl+P.`}
        backHref={`/admin/call-sheets/${id}`}
        backLabel="Back to Call Sheet"
      >
        <div className="ctrl-hint">
          {sheet.assigned_to_name && <>Trapper: {sheet.assigned_to_name}<br /></>}
          {sheet.due_date && <>Due: {formatPrintDate(sheet.due_date)}<br /></>}
          ID: {sheet.call_sheet_id.slice(0, 8)}
        </div>
      </PrintControlsPanel>

      {/* Pages */}
      {pages.map((pageItems, pageIdx) => (
        <div key={pageIdx} className="print-page">
          {/* Header — only on first page, or repeated with "continued" */}
          <PrintHeader
            title={pageIdx === 0 ? "Call Sheet" : "Call Sheet (continued)"}
            subtitle={nameFull}
          />

          {/* Assignment bar */}
          <div className="cs-header-bar">
            <div className="cs-trapper">
              Assigned: {sheet.assigned_to_name || "_______________________"}
            </div>
            <div className="cs-date">
              {sheet.due_date
                ? `Due: ${formatPrintDate(sheet.due_date)}`
                : "Due: ______________"}
            </div>
          </div>

          {/* Summary — first page only */}
          {pageIdx === 0 && (
            <div className="cs-summary">
              <span><strong>{items.length}</strong> calls</span>
              <span><strong>{items.filter((i) => i.status === "pending").length}</strong> pending</span>
              <span><strong>{items.filter((i) => i.follow_up_at).length}</strong> follow-ups</span>
              {sheet.notes && (
                <span style={{ fontStyle: "italic" }}>Note: {sheet.notes.slice(0, 80)}{sheet.notes.length > 80 ? "..." : ""}</span>
              )}
            </div>
          )}

          {/* Table */}
          <table className="cs-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Address</th>
                <th>Context</th>
                <th>Date Called</th>
                <th>Disposition</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item, rowIdx) => {
                const globalIdx = pageIdx * ROWS_PER_PAGE + rowIdx + 1;
                const phone = item.contact_phone || item.primary_phone;
                const address = item.place_address || item.place_full_address || "";
                // Truncate long addresses for print
                const shortAddress = address.length > 40 ? address.slice(0, 38) + "..." : address;
                const context = item.context_summary || "";
                const shortContext = context.length > 50 ? context.slice(0, 48) + "..." : context;

                return (
                  <tr key={item.item_id}>
                    <td className="cs-num">{globalIdx}</td>
                    <td className="cs-name">{item.contact_name}</td>
                    <td className="cs-phone">{phone ? formatPhone(phone) : ""}</td>
                    <td className="cs-address">{shortAddress}</td>
                    <td className="cs-context">{shortContext}</td>
                    <td>
                      <div className="cs-date-called">&nbsp;</div>
                    </td>
                    <td>
                      <div className="cs-disp">
                        {PRINT_DISPOSITIONS.map((d) => (
                          <Check
                            key={d.key}
                            checked={item.disposition === d.key}
                            label={d.label}
                          />
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="cs-notes-line">
                        {item.notes ? (
                          <span style={{ fontSize: "7.5pt", color: "#555" }}>
                            {item.notes.slice(0, 30)}{item.notes.length > 30 ? "..." : ""}
                          </span>
                        ) : (
                          "\u00A0"
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <PrintFooter
            left={`${sheet.title} | ${sheet.call_sheet_id.slice(0, 8)} | ${formatPrintDate(sheet.created_at)}`}
            right={`Page ${pageIdx + 1} of ${totalPages}`}
          />
        </div>
      ))}
    </div>
  );
}
