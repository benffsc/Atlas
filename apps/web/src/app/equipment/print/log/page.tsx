"use client";

import { useState, useCallback } from "react";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { formatPrintDate } from "@/lib/print-helpers";
import { fetchApi } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

interface ScannedEquipment {
  barcode: string | null;
  display_name: string;
  condition_status: string;
  custody_status: string;
}

const TOTAL_ROWS = 20;

/**
 * Multi-row checkout log — landscape letter, multiple entries per sheet.
 * Good for high-volume days when staff logs checkouts on one shared sheet.
 */
export default function CheckoutLogPage() {
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
        .log-sheet {
          width: 10in; margin: 1rem auto; padding: 0.35in 0.4in;
          background: #fff; border: 1px solid var(--card-border, #e5e7eb);
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 8.5pt;
          box-sizing: border-box;
        }
        .log-header {
          display: flex; justify-content: space-between; align-items: flex-end;
          border-bottom: 2.5px solid #16a34a; padding-bottom: 6px; margin-bottom: 8px;
        }
        .log-header h1 { font-size: 14pt; font-weight: 700; margin: 0; }
        .log-header .date { font-size: 8.5pt; color: #666; }
        .log-header img { height: 40px; }

        .log-table {
          width: 100%; border-collapse: collapse; margin-bottom: 6px; table-layout: fixed;
        }
        .log-table th {
          background: #f0fdf4; border: 1px solid #bdc3c7; padding: 3px 4px;
          font-size: 6.5pt; font-weight: 700; color: #16a34a;
          text-transform: uppercase; letter-spacing: 0.4px; text-align: left;
        }
        .log-table td {
          border-bottom: 1px solid #d5d8dc;
          border-left: 1px solid #ecf0f1; border-right: 1px solid #ecf0f1;
          padding: 0 4px; height: 24px; vertical-align: bottom;
        }
        .log-table tr:last-child td { border-bottom: 1px solid #bdc3c7; }
        .log-table td.filled { background: #f0fdf4; font-weight: 500; vertical-align: middle; font-size: 8pt; }
        .log-table .rn {
          color: #bdc3c7; font-size: 6.5pt; text-align: center; width: 16px;
          border-right: 1px solid #ecf0f1; border-left: 1px solid #bdc3c7;
          padding: 1px; vertical-align: middle;
        }
        .col-name { width: 22%; } .col-phone { width: 14%; } .col-equip { width: 22%; }
        .col-type { width: 10%; } .col-deposit { width: 9%; } .col-due { width: 12%; }
        .col-staff { width: 11%; }

        .log-legend { display: flex; gap: 1.5rem; font-size: 7pt; color: #666; margin-bottom: 5px; flex-wrap: wrap; }
        .log-legend b { font-weight: 700; color: #333; }
        .log-footer {
          display: flex; justify-content: space-between;
          font-size: 7.5pt; color: #666; border-top: 1px solid #ddd; padding-top: 4px;
        }

        @media print {
          @page { size: letter landscape; margin: 0.25in; }
          body { background: #fff !important; }
          .log-controls, .tippy-fab, .tippy-chat-panel,
          nav, aside, header, [data-sidebar] { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; max-width: none !important; }
          .log-sheet { border: none; margin: 0; padding: 0.2in 0.25in; max-width: none; width: auto; }
        }
      `}</style>

      {/* Screen controls */}
      <div className="log-controls" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <Icon name="file-output" size={24} color="var(--primary)" />
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Checkout Log Sheet</h1>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 1.25rem" }}>
          Multi-row log for high-volume days. Staff writes each checkout on one shared sheet.
        </p>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <Button
            variant={mode === "blank" ? "primary" : "outline"}
            size="sm"
            onClick={() => { setMode("blank"); setEquipment(null); setError(null); }}
          >
            Blank Form
          </Button>
          <Button
            variant={mode === "prefilled" ? "primary" : "outline"}
            size="sm"
            onClick={() => setMode("prefilled")}
          >
            Pre-filled
          </Button>
        </div>

        {mode === "prefilled" && (
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              marginBottom: "1rem",
              background: "var(--card-bg)",
              border: "1px solid var(--card-border)",
              borderRadius: 10,
              padding: "0.75rem 1rem",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
              placeholder="Scan barcode..."
              autoFocus
              style={{
                flex: 1, padding: "0.5rem 0.75rem", border: "1px solid var(--card-border)",
                borderRadius: 8, fontFamily: "monospace", fontSize: "0.95rem", outline: "none",
              }}
            />
            <Button variant="primary" size="sm" onClick={handleScan} disabled={loading || !barcode.trim()}>
              {loading ? "..." : "Look Up"}
            </Button>
          </div>
        )}

        {error && <div style={{ color: "var(--danger-text)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{error}</div>}
        {equipment && (
          <div style={{ background: "var(--success-bg)", border: "1px solid var(--success-border, #bbf7d0)", borderRadius: 8, padding: "0.5rem 0.75rem", marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--success-text)" }}>
            <strong>{equipment.display_name}</strong> [{equipment.barcode}] — {fmtCondition(equipment.condition_status)}
          </div>
        )}

        <Button variant="primary" icon="printer" onClick={() => window.print()}>
          Print Log Sheet
        </Button>
      </div>

      {/* Printable sheet */}
      <div className="log-sheet">
        <div className="log-header">
          <div>
            <h1>Equipment Checkout Log</h1>
            <div className="date">{today}</div>
          </div>
          <img src="/logo.png" alt="" />
        </div>

        <table className="log-table">
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
                <td /><td /><td /><td />
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

        <div className="log-legend">
          <span><b>Type:</b> C = Client · T = Trapper · I = Internal · F = Foster</span>
          <span><b>Deposit:</b> $ amount collected</span>
          <span><b>Condition note:</b> mark if damaged or poor</span>
        </div>

        <div className="log-footer">
          <span>{nameFull || "Forgotten Felines of Sonoma County"}</span>
          <span>{[phone, website].filter(Boolean).join(" · ")}</span>
        </div>
      </div>
    </>
  );
}
