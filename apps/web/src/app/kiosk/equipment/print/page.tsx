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

const TOTAL_ROWS = 20;

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
        body { margin: 0; background: var(--bg-secondary, #f5f5f5); }

        /* ── Screen controls ── */
        .print-controls {
          max-width: 700px;
          margin: 1rem auto;
          padding: 1rem 1.25rem;
          background: var(--card-bg, #fff);
          border-radius: 10px;
          border: 1px solid var(--border-default, #e5e7eb);
          font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        }
        .print-controls h2 { margin: 0 0 0.25rem; font-size: 1.1rem; }
        .print-controls p { margin: 0 0 1rem; font-size: 0.85rem; color: var(--text-secondary, #6b7280); }

        .mode-btns { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
        .mode-btns button {
          padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--border-default, #d1d5db);
          background: var(--card-bg, #fff); cursor: pointer; font-size: 0.85rem; font-weight: 500;
        }
        .mode-btns button.active { background: var(--healthy-text, #16a34a); color: #fff; border-color: var(--healthy-text, #16a34a); }

        .scan-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
        .scan-row input {
          flex: 1; padding: 0.5rem 0.75rem; border: 2px solid var(--border-default, #d1d5db); border-radius: 8px;
          font-family: monospace; font-size: 1rem; outline: none;
        }
        .scan-row input:focus { border-color: var(--healthy-text, #16a34a); }
        .scan-row button {
          padding: 0.5rem 1rem; background: var(--healthy-text, #16a34a); color: #fff; border: none;
          border-radius: 8px; font-weight: 600; cursor: pointer;
        }
        .scan-row button:disabled { opacity: 0.5; }

        .scan-ok { background: var(--healthy-bg, #f0fdf4); border: 1px solid var(--healthy-border, #86efac); border-radius: 8px; padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; font-size: 0.85rem; color: #166534; }
        .scan-err { color: var(--danger-text, #dc2626); font-size: 0.85rem; margin-bottom: 0.75rem; }

        .ctrl-actions { display: flex; gap: 0.75rem; align-items: center; }
        .ctrl-actions button {
          padding: 0.5rem 1.25rem; background: var(--healthy-text, #16a34a); color: #fff; border: none;
          border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem;
        }
        .ctrl-actions a { color: var(--healthy-text, #16a34a); font-size: 0.85rem; text-decoration: none; }

        /* ── Printable form ── */
        .print-sheet {
          width: 10in;
          margin: 1rem auto;
          padding: 0.35in 0.4in;
          background: #fff;
          border: 1px solid var(--border-default, #e5e7eb);
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-size: 8.5pt;
          box-sizing: border-box;
        }

        .sheet-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          border-bottom: 2.5px solid #16a34a;
          padding-bottom: 6px;
          margin-bottom: 8px;
        }
        .sheet-header h1 { font-size: 14pt; font-weight: 700; margin: 0 0 1px; letter-spacing: -0.3px; }
        .sheet-header .date { font-size: 8.5pt; color: #666; }
        .sheet-header img { height: 40px; }

        /* Main table — 7 practical columns */
        .sheet-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 6px;
          table-layout: fixed;
        }
        .sheet-table th {
          background: #f0fdf4;
          border: 1px solid #bdc3c7;
          padding: 3px 4px;
          font-size: 6.5pt;
          font-weight: 700;
          color: #16a34a;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          text-align: left;
        }
        .sheet-table td {
          border-bottom: 1px solid #d5d8dc;
          border-left: 1px solid #ecf0f1;
          border-right: 1px solid #ecf0f1;
          padding: 0 4px;
          height: 24px;
          vertical-align: bottom;
        }
        .sheet-table tr:last-child td { border-bottom: 1px solid #bdc3c7; }
        .sheet-table td.filled { background: #f0fdf4; font-weight: 500; vertical-align: middle; font-size: 8pt; }
        .sheet-table .rn {
          color: #bdc3c7; font-size: 6.5pt; text-align: center; width: 16px;
          border-right: 1px solid #ecf0f1; border-left: 1px solid #bdc3c7;
          padding: 1px; vertical-align: middle;
        }

        /* Column widths (percentage of table) */
        .col-name     { width: 22%; }
        .col-phone    { width: 14%; }
        .col-equip    { width: 22%; }
        .col-type     { width: 10%; }
        .col-deposit  { width: 9%; }
        .col-due      { width: 12%; }
        .col-staff    { width: 11%; }

        .sheet-legend {
          display: flex;
          gap: 1.5rem;
          font-size: 7pt;
          color: #666;
          margin-bottom: 5px;
          flex-wrap: wrap;
        }
        .sheet-legend b { font-weight: 700; color: #333; }

        .sheet-footer {
          display: flex; justify-content: space-between;
          font-size: 7.5pt; color: #666; border-top: 1px solid #ddd; padding-top: 4px;
        }

        @media print {
          @page { size: letter landscape; margin: 0.25in; }
          body { background: #fff; }
          .print-controls, .tippy-fab, .tippy-chat-panel { display: none !important; }
          .print-sheet { border: none; margin: 0; padding: 0.2in 0.25in; max-width: none; width: auto; box-shadow: none; }
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

      {/* Printable sheet — 7 columns, landscape letter */}
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
              <th className="col-name">Name (First &amp; Last)</th>
              <th className="col-phone">Phone</th>
              <th className="col-equip">Equipment / Barcode</th>
              <th className="col-type">Type</th>
              <th className="col-deposit">Deposit</th>
              <th className="col-due">Due Date</th>
              <th className="col-staff">Staff / Notes</th>
            </tr>
          </thead>
          <tbody>
            {mode === "prefilled" && equipment && (
              <tr>
                <td className="rn">1</td>
                <td />
                <td />
                <td className="filled">
                  {equipment.display_name}
                  {equipment.barcode && (
                    <span style={{ fontFamily: "monospace", fontSize: "7.5pt", marginLeft: 6, color: "#666" }}>
                      [{equipment.barcode}]
                    </span>
                  )}
                </td>
                <td />
                <td />
                <td />
                <td />
              </tr>
            )}
            {Array.from({ length: mode === "prefilled" && equipment ? TOTAL_ROWS - 1 : TOTAL_ROWS }).map((_, i) => {
              const n = mode === "prefilled" && equipment ? i + 2 : i + 1;
              return (
                <tr key={i}>
                  <td className="rn">{n}</td>
                  <td /><td /><td /><td /><td /><td /><td />
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="sheet-legend">
          <span><b>Type:</b> C = Client &nbsp; T = Trapper &nbsp; I = Internal &nbsp; F = Foster</span>
          <span><b>Deposit:</b> $ amount collected</span>
          <span><b>Condition note:</b> mark if damaged or poor</span>
        </div>

        <div className="sheet-footer">
          <span>{nameFull || "Forgotten Felines of Sonoma County"}</span>
          <span>{[phone, website].filter(Boolean).join(" · ")}</span>
        </div>
      </div>
    </>
  );
}
