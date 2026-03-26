"use client";

import { useState, useCallback } from "react";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { formatPrintDate } from "@/lib/print-helpers";
import { fetchApi } from "@/lib/api-client";

interface ScannedEquipment {
  barcode: string | null;
  display_name: string;
  condition_status: string;
  custody_status: string;
}

const TOTAL_ROWS = 15;

export default function EquipmentCheckoutPrintPage() {
  const { nameFull, phone, website } = useOrgConfig();
  const [mode, setMode] = useState<"blank" | "prefilled">("blank");
  const [barcode, setBarcode] = useState("");
  const [equipment, setEquipment] = useState<ScannedEquipment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setEquipment(null);
    try {
      const data = await fetchApi<ScannedEquipment>(
        `/api/equipment/scan?barcode=${encodeURIComponent(trimmed)}`
      );
      setEquipment(data);
    } catch {
      setError(`No equipment found for "${trimmed}"`);
    } finally {
      setLoading(false);
    }
  }, [barcode]);

  const today = formatPrintDate(new Date().toISOString());
  const fmtCondition = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <>
      <style jsx global>{`
        /* Reset for print page */
        body { margin: 0; background: #f5f5f5; }

        /* Screen controls */
        .print-controls {
          max-width: 700px;
          margin: 1rem auto;
          padding: 1rem 1.25rem;
          background: #fff;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
          font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        }
        .print-controls h2 { margin: 0 0 0.25rem; font-size: 1.1rem; }
        .print-controls p { margin: 0 0 1rem; font-size: 0.85rem; color: #6b7280; }

        .mode-btns { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
        .mode-btns button {
          padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid #d1d5db;
          background: #fff; cursor: pointer; font-size: 0.85rem; font-weight: 500;
        }
        .mode-btns button.active { background: #27ae60; color: #fff; border-color: #27ae60; }

        .scan-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
        .scan-row input {
          flex: 1; padding: 0.5rem 0.75rem; border: 2px solid #d1d5db; border-radius: 8px;
          font-family: monospace; font-size: 1rem; outline: none;
        }
        .scan-row input:focus { border-color: #27ae60; }
        .scan-row button {
          padding: 0.5rem 1rem; background: #27ae60; color: #fff; border: none;
          border-radius: 8px; font-weight: 600; cursor: pointer;
        }
        .scan-row button:disabled { opacity: 0.5; }

        .scan-ok { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; font-size: 0.85rem; color: #166534; }
        .scan-err { color: #dc2626; font-size: 0.85rem; margin-bottom: 0.75rem; }

        .ctrl-actions { display: flex; gap: 0.75rem; align-items: center; }
        .ctrl-actions button {
          padding: 0.5rem 1.25rem; background: #27ae60; color: #fff; border: none;
          border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem;
        }
        .ctrl-actions a { color: #27ae60; font-size: 0.85rem; text-decoration: none; }

        /* Print page (visible on screen as preview, sole content on print) */
        .print-sheet {
          max-width: 1050px;
          margin: 1rem auto;
          padding: 0.4in 0.5in;
          background: #fff;
          border: 1px solid #e5e7eb;
          font-family: 'Raleway', Helvetica, Arial, sans-serif;
          font-size: 9pt;
        }

        .sheet-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px solid #27ae60;
          padding-bottom: 8px;
          margin-bottom: 10px;
        }
        .sheet-header h1 { font-size: 16pt; font-weight: 700; margin: 0 0 2px; }
        .sheet-header .date { font-size: 9pt; color: #666; }
        .sheet-header img { height: 48px; }

        .sheet-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 8px;
        }
        .sheet-table th {
          background: #f0fdf4;
          border: 1px solid #bdc3c7;
          padding: 4px 5px;
          font-size: 7pt;
          font-weight: 700;
          color: #27ae60;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          white-space: nowrap;
          text-align: left;
        }
        .sheet-table td {
          border-bottom: 1px solid #d5d8dc;
          border-left: 1px solid #ecf0f1;
          border-right: 1px solid #ecf0f1;
          padding: 5px 4px;
          height: 28px;
          vertical-align: bottom;
        }
        .sheet-table tr:last-child td { border-bottom: 1px solid #bdc3c7; }
        .sheet-table td.filled { background: #f0fdf4; font-weight: 500; vertical-align: middle; }
        .sheet-table .rn {
          color: #bdc3c7; font-size: 7pt; text-align: center; width: 18px;
          border-right: 1px solid #ecf0f1; border-left: 1px solid #bdc3c7;
          padding: 2px; vertical-align: middle;
        }

        .sheet-hint { font-size: 7pt; color: #95a5a6; margin-bottom: 6px; }
        .sheet-hint b { font-weight: 600; }
        .sheet-footer {
          display: flex; justify-content: space-between;
          font-size: 8pt; color: #666; border-top: 1px solid #ddd; padding-top: 4px;
        }

        @media print {
          @page { size: letter landscape; margin: 0.3in; }
          body { background: #fff; }
          .print-controls, .tippy-fab, .tippy-chat-panel { display: none !important; }
          .print-sheet { border: none; margin: 0; padding: 0; max-width: none; box-shadow: none; }
        }
      `}</style>

      {/* Screen-only controls */}
      <div className="print-controls">
        <h2>Equipment Checkout Log</h2>
        <p>Print a blank or pre-filled checkout form for the front desk.</p>

        <div className="mode-btns">
          <button
            className={mode === "blank" ? "active" : ""}
            onClick={() => { setMode("blank"); setEquipment(null); setError(null); }}
          >
            Blank Form
          </button>
          <button
            className={mode === "prefilled" ? "active" : ""}
            onClick={() => setMode("prefilled")}
          >
            Pre-filled
          </button>
        </div>

        {mode === "prefilled" && (
          <>
            <div className="scan-row">
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
                placeholder="Scan barcode..."
                autoFocus
              />
              <button onClick={handleScan} disabled={loading || !barcode.trim()}>
                {loading ? "..." : "Look Up"}
              </button>
            </div>
            {error && <div className="scan-err">{error}</div>}
            {equipment && (
              <div className="scan-ok">
                <strong>{equipment.display_name}</strong> — Barcode: {equipment.barcode || "N/A"} | Condition: {fmtCondition(equipment.condition_status)}
              </div>
            )}
          </>
        )}

        <div className="ctrl-actions">
          <button onClick={() => window.print()}>Print / Save PDF</button>
          <a href="/kiosk/equipment/scan">Back to Kiosk</a>
        </div>
      </div>

      {/* Printable sheet */}
      <div className="print-sheet">
        <div className="sheet-header">
          <div>
            <h1>Equipment Checkout Log</h1>
            <div className="date">{today}</div>
          </div>
          <img src="/logo.png" alt="FFSC" />
        </div>

        <table className="sheet-table">
          <thead>
            <tr>
              <th className="rn">#</th>
              <th style={{ width: "9%" }}>Date / Time</th>
              <th style={{ width: "15%" }}>Name</th>
              <th style={{ width: "10%" }}>Phone</th>
              <th style={{ width: "7%" }}>Barcode</th>
              <th style={{ width: "16%" }}>Equipment Description</th>
              <th style={{ width: "9%" }}>Checkout Type</th>
              <th style={{ width: "6%" }}>Deposit</th>
              <th style={{ width: "9%" }}>Condition</th>
              <th style={{ width: "8%" }}>Due Date</th>
              <th style={{ width: "6%" }}>Staff</th>
            </tr>
          </thead>
          <tbody>
            {mode === "prefilled" && equipment && (
              <tr>
                <td className="rn">1</td>
                <td className="filled">{today}</td>
                <td />
                <td />
                <td className="filled" style={{ fontFamily: "monospace", fontWeight: 600 }}>{equipment.barcode || ""}</td>
                <td className="filled">{equipment.display_name}</td>
                <td />
                <td />
                <td className="filled">{fmtCondition(equipment.condition_status)}</td>
                <td />
                <td />
              </tr>
            )}
            {Array.from({ length: mode === "prefilled" && equipment ? TOTAL_ROWS - 1 : TOTAL_ROWS }).map((_, i) => {
              const n = mode === "prefilled" && equipment ? i + 2 : i + 1;
              return (
                <tr key={i}>
                  <td className="rn">{n}</td>
                  <td /><td /><td /><td /><td /><td /><td /><td /><td /><td />
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="sheet-hint">
          <b>Checkout Type:</b> Client / Trapper / Internal / Foster &nbsp;&nbsp;
          <b>Condition:</b> Good / Fair / Needs Repair &nbsp;&nbsp;
          <b>Deposit:</b> Record amount collected, if any
        </div>

        <div className="sheet-footer">
          <span>{nameFull || "Forgotten Felines of Sonoma County"}</span>
          <span>{[phone, website].filter(Boolean).join(" | ")}</span>
        </div>
      </div>
    </>
  );
}
