"use client";

import { useState, useCallback } from "react";
import { PRINT_BASE_CSS } from "@/lib/print-styles";
import {
  PrintHeader,
  PrintFooter,
  PrintControlsPanel,
} from "@/components/print/PrintPrimitives";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { formatPrintDate } from "@/lib/print-helpers";
import { fetchApi } from "@/lib/api-client";

interface ScannedEquipment {
  barcode: string | null;
  display_name: string;
  condition_status: string;
  custody_status: string;
  equipment_type_key: string | null;
  type_display_name: string | null;
}

const TOTAL_ROWS = 15;

const CHECKOUT_TYPES = ["Loan", "Field Deploy", "Event"];
const CONDITIONS = ["Good", "Fair", "Needs Repair"];

export default function EquipmentCheckoutPrintPage() {
  const { nameFull, nameShort, phone, website } = useOrgConfig();
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
      const data = await fetchApi<ScannedEquipment>(`/api/equipment/scan?barcode=${encodeURIComponent(trimmed)}`);
      setEquipment({
        barcode: data.barcode,
        display_name: data.display_name,
        condition_status: data.condition_status,
        custody_status: data.custody_status,
        equipment_type_key: data.equipment_type_key,
        type_display_name: data.type_display_name,
      });
    } catch {
      setError(`No equipment found for "${trimmed}"`);
    } finally {
      setLoading(false);
    }
  }, [barcode]);

  const today = formatPrintDate(new Date().toISOString());

  const formatCondition = (status: string) =>
    status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <>
      <style jsx global>{`
        ${PRINT_BASE_CSS}

        @media print {
          @page { size: letter landscape; margin: 0.3in; }
        }

        .checkout-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 8.5pt;
          margin-top: 6px;
        }
        .checkout-table th {
          background: #f0fdf4;
          border: 1px solid #bdc3c7;
          padding: 4px 5px;
          text-align: left;
          font-size: 7.5pt;
          font-weight: 700;
          color: #27ae60;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          white-space: nowrap;
        }
        .checkout-table td {
          border-bottom: 1px solid #d5d8dc;
          border-left: 1px solid #ecf0f1;
          border-right: 1px solid #ecf0f1;
          padding: 6px 5px;
          min-height: 22px;
          height: 22px;
          vertical-align: bottom;
        }
        .checkout-table tr:last-child td {
          border-bottom: 1px solid #bdc3c7;
        }
        .checkout-table td.prefilled {
          background: #f0fdf4;
          font-weight: 500;
          vertical-align: middle;
        }

        /* Column widths — landscape gives us ~10in of usable width */
        .col-datetime  { width: 10%; }
        .col-name      { width: 14%; }
        .col-phone     { width: 10%; }
        .col-barcode   { width: 7%; }
        .col-desc      { width: 16%; }
        .col-type      { width: 10%; }
        .col-deposit   { width: 7%; }
        .col-condition  { width: 10%; }
        .col-due       { width: 8%; }
        .col-staff     { width: 8%; }

        .checkout-table .row-num {
          color: #bdc3c7;
          font-size: 7pt;
          text-align: center;
          width: 16px;
          border-right: 1px solid #ecf0f1;
          border-left: 1px solid #bdc3c7;
          padding: 2px;
          vertical-align: middle;
        }

        .checkout-hint {
          font-size: 7pt;
          color: #95a5a6;
          margin-top: 4px;
        }
        .checkout-hint span {
          margin-right: 14px;
        }

        /* Controls input for barcode in pre-filled mode */
        .ctrl-barcode-row {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .ctrl-barcode-row input {
          flex: 1;
          padding: 8px 10px;
          border: 2px solid #ddd;
          border-radius: 8px;
          font-family: monospace;
          font-size: 14px;
          outline: none;
        }
        .ctrl-barcode-row input:focus {
          border-color: #27ae60;
        }
        .ctrl-barcode-row button {
          padding: 8px 14px;
          background: #27ae60;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          font-size: 13px;
          white-space: nowrap;
        }
        .ctrl-barcode-row button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .ctrl-error {
          color: #dc2626;
          font-size: 12px;
          margin-bottom: 8px;
        }
        .ctrl-success {
          background: #f0fdf4;
          border: 1px solid #86efac;
          border-radius: 8px;
          padding: 8px 10px;
          margin-bottom: 12px;
          font-size: 12px;
          color: #166534;
        }
      `}</style>

      <div className="print-wrapper">
        {/* Screen-only controls panel */}
        <PrintControlsPanel
          title="Checkout Log"
          description="Print a blank or pre-filled equipment checkout form for the front desk."
          backHref="/kiosk/equipment/scan"
          backLabel="Back to Kiosk"
        >
          <div className="mode-selector">
            <button
              className={mode === "blank" ? "active" : ""}
              onClick={() => {
                setMode("blank");
                setEquipment(null);
                setError(null);
              }}
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
              <div className="ctrl-barcode-row">
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleScan();
                  }}
                  placeholder="Scan barcode..."
                  autoFocus
                />
                <button onClick={handleScan} disabled={loading || !barcode.trim()}>
                  {loading ? "..." : "Look Up"}
                </button>
              </div>
              {error && <div className="ctrl-error">{error}</div>}
              {equipment && (
                <div className="ctrl-success">
                  <strong>{equipment.display_name}</strong>
                  <br />
                  Barcode: {equipment.barcode || "N/A"} | Condition:{" "}
                  {formatCondition(equipment.condition_status)}
                </div>
              )}
            </>
          )}
        </PrintControlsPanel>

        {/* Printable page */}
        <div className="print-page">
          <PrintHeader
            title="Equipment Checkout Log"
            subtitle={today}
          />

          <table className="checkout-table">
            <thead>
              <tr>
                <th className="row-num">#</th>
                <th className="col-datetime">Date / Time</th>
                <th className="col-name">Name</th>
                <th className="col-phone">Phone</th>
                <th className="col-barcode">Barcode</th>
                <th className="col-desc">Equipment Description</th>
                <th className="col-type">Checkout Type</th>
                <th className="col-deposit">Deposit ($)</th>
                <th className="col-condition">Condition Out</th>
                <th className="col-due">Due Date</th>
                <th className="col-staff">Staff Init.</th>
              </tr>
            </thead>
            <tbody>
              {/* Pre-filled first row if equipment scanned */}
              {mode === "prefilled" && equipment && (
                <tr>
                  <td className="row-num">1</td>
                  <td className="prefilled">{today}</td>
                  <td></td>
                  <td></td>
                  <td className="prefilled" style={{ fontFamily: "monospace", fontWeight: 600 }}>
                    {equipment.barcode || ""}
                  </td>
                  <td className="prefilled">{equipment.display_name}</td>
                  <td></td>
                  <td></td>
                  <td className="prefilled">{formatCondition(equipment.condition_status)}</td>
                  <td></td>
                  <td></td>
                </tr>
              )}

              {/* Remaining blank rows */}
              {Array.from({
                length:
                  mode === "prefilled" && equipment
                    ? TOTAL_ROWS - 1
                    : TOTAL_ROWS,
              }).map((_, i) => {
                const rowNum =
                  mode === "prefilled" && equipment ? i + 2 : i + 1;
                return (
                  <tr key={i}>
                    <td className="row-num">{rowNum}</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="checkout-hint">
            <span><strong>Checkout Type:</strong> {CHECKOUT_TYPES.join(" / ")}</span>
            <span><strong>Condition:</strong> {CONDITIONS.join(" / ")}</span>
            <span><strong>Deposit:</strong> Record amount collected, if any</span>
          </div>

          <PrintFooter
            left={nameFull || "Forgotten Felines of Sonoma County"}
            right={[phone, website].filter(Boolean).join(" | ")}
          />
        </div>
      </div>
    </>
  );
}
