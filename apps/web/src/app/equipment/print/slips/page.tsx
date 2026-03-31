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
 * Checkout slips — two half-sheets per page (portrait).
 * Hand one to each person at checkout, they fill it in, staff enters it later.
 * Accessible from both /equipment/print/slips (main app) and /kiosk/equipment/print/slip (kiosk).
 */
export default function CheckoutSlipsPage() {
  const { nameShort, phone: orgPhone } = useOrgConfig();
  const [barcode, setBarcode] = useState("");
  const [equipment, setEquipment] = useState<ScannedEquipment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copies, setCopies] = useState(2);

  const handleScan = useCallback(async () => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
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

  const slipCount = Math.max(1, Math.min(copies, 4));

  return (
    <>
      <style jsx global>{`
        /* ── Printable slips ── */
        .slip-page {
          width: 8.5in;
          margin: 1rem auto;
          background: #fff;
          border: 1px solid var(--card-border, #e5e7eb);
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }
        .slip {
          width: 8.5in; height: 5.5in; box-sizing: border-box;
          padding: 0.3in 0.4in 0.25in; position: relative; overflow: hidden;
        }
        .slip + .slip { border-top: 2px dashed #bbb; }

        .slip-header {
          display: flex; justify-content: space-between; align-items: flex-end;
          border-bottom: 2px solid #16a34a; padding-bottom: 4px; margin-bottom: 8px;
        }
        .slip-header h1 { font-size: 12pt; font-weight: 700; margin: 0; }
        .slip-header .slip-meta { font-size: 7.5pt; color: #666; text-align: right; }
        .slip-header img { height: 32px; margin-left: 8px; }

        .slip-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px;
        }
        .slip-field {
          border-bottom: 1px solid #d5d8dc; padding: 2px 0 1px; margin-bottom: 5px;
          min-height: 20px; display: flex; align-items: flex-end;
        }
        .slip-field-label {
          font-size: 6.5pt; font-weight: 700; color: #16a34a;
          text-transform: uppercase; letter-spacing: 0.4px; white-space: nowrap;
          margin-right: 6px; padding-bottom: 1px;
        }
        .slip-field-value { font-size: 8.5pt; font-weight: 500; flex: 1; }
        .slip-field.full { grid-column: 1 / -1; }
        .slip-field.tall { min-height: 32px; }

        .slip-checkboxes {
          display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 7.5pt; padding: 3px 0;
        }
        .slip-cb { display: inline-flex; align-items: center; gap: 3px; }
        .slip-cb-box {
          display: inline-block; width: 10px; height: 10px;
          border: 1.5px solid #333; border-radius: 2px;
        }

        .slip-section-label {
          font-size: 7pt; font-weight: 700; color: #999;
          text-transform: uppercase; letter-spacing: 0.5px;
          margin: 6px 0 2px; grid-column: 1 / -1;
        }

        .slip-footer {
          position: absolute; bottom: 0.2in; left: 0.4in; right: 0.4in;
          display: flex; justify-content: space-between;
          font-size: 6.5pt; color: #999; border-top: 1px solid #eee; padding-top: 3px;
        }
        .slip-footer-scissors {
          position: absolute; top: -1px; left: -0.4in;
          font-size: 10pt; color: #bbb; transform: translateY(-50%);
        }

        @media print {
          @page { size: letter portrait; margin: 0; }
          body { background: #fff !important; }
          .slip-controls-panel, .tippy-fab, .tippy-chat-panel,
          nav, aside, header, [data-sidebar] { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; max-width: none !important; }
          .slip-page { border: none; margin: 0; box-shadow: none; }
        }
      `}</style>

      {/* Screen controls */}
      <div className="slip-controls-panel" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <Icon name="receipt" size={24} color="var(--primary)" />
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Checkout Slips</h1>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 1.25rem" }}>
          Print half-sheet forms — hand one to each person at checkout.
          They fill it in, you enter the data into the system later.
        </p>

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
            placeholder="Optional: scan barcode to pre-fill equipment..."
            style={{
              flex: 1,
              padding: "0.5rem 0.75rem",
              border: "1px solid var(--card-border)",
              borderRadius: 8,
              fontFamily: "monospace",
              fontSize: "0.95rem",
              outline: "none",
            }}
          />
          <Button variant="primary" size="sm" onClick={handleScan} disabled={loading || !barcode.trim()}>
            {loading ? "..." : "Look Up"}
          </Button>
        </div>

        {error && (
          <div style={{ color: "var(--danger-text)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
            {error}
          </div>
        )}
        {equipment && (
          <div
            style={{
              background: "var(--success-bg)",
              border: "1px solid var(--success-border, #bbf7d0)",
              borderRadius: 8,
              padding: "0.5rem 0.75rem",
              marginBottom: "0.75rem",
              fontSize: "0.85rem",
              color: "var(--success-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>
              Pre-filling: <strong>{equipment.display_name}</strong> [{equipment.barcode}]
            </span>
            <button
              onClick={() => { setEquipment(null); setBarcode(""); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--success-text)", fontSize: "1rem" }}
            >
              &times;
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <Button variant="primary" icon="printer" onClick={() => window.print()}>
            Print Slips
          </Button>
          <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.85rem" }}>
            Per page:
            <select
              value={copies}
              onChange={(e) => setCopies(Number(e.target.value))}
              style={{ padding: "0.25rem 0.5rem", borderRadius: 6, border: "1px solid var(--card-border)" }}
            >
              <option value={1}>1 slip</option>
              <option value={2}>2 slips</option>
            </select>
          </label>
        </div>
      </div>

      {/* Printable slips */}
      <div className="slip-page">
        {Array.from({ length: slipCount }).map((_, i) => (
          <CheckoutSlip
            key={i}
            orgName={nameShort || "FFSC"}
            orgPhone={orgPhone}
            date={today}
            equipment={equipment}
            showScissors={i > 0}
            fmtCondition={fmtCondition}
          />
        ))}
      </div>
    </>
  );
}

function CheckoutSlip({
  orgName,
  orgPhone,
  date,
  equipment,
  showScissors,
  fmtCondition,
}: {
  orgName: string;
  orgPhone: string;
  date: string;
  equipment: ScannedEquipment | null;
  showScissors: boolean;
  fmtCondition: (s: string) => string;
}) {
  return (
    <div className="slip">
      <div className="slip-header">
        <div><h1>{orgName} — Equipment Checkout</h1></div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <div className="slip-meta"><div>{date}</div></div>
          <img src="/logo.png" alt="" />
        </div>
      </div>

      <div className="slip-grid">
        <div className="slip-section-label">Your Information</div>
        <Field label="First Name" />
        <Field label="Last Name" />
        <Field label="Phone" />
        <Field label="Email" />

        <div className="slip-section-label">Equipment</div>
        <Field label="Equipment" value={equipment?.display_name} />
        <Field label="Barcode" value={equipment?.barcode || undefined} mono />
        <div className="slip-field">
          <span className="slip-field-label">Type:</span>
          <div className="slip-checkboxes">
            <span className="slip-cb"><span className="slip-cb-box" /> Client</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Trapper</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Internal</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Foster</span>
          </div>
        </div>
        <Field label="Condition" value={equipment ? fmtCondition(equipment.condition_status) : undefined} />

        <div className="slip-section-label">Purpose &amp; Location</div>
        <div className="slip-field full">
          <span className="slip-field-label">Purpose:</span>
          <div className="slip-checkboxes">
            <span className="slip-cb"><span className="slip-cb-box" /> TNR Appt</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Kitten Rescue</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Colony Check</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Feeding Station</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Personal Pet</span>
          </div>
        </div>
        <Field label="Trapping Address" full />
        <Field label="City / ZIP" />
        <Field label="Appointment Date" />

        <div className="slip-section-label">Checkout Details</div>
        <Field label="Deposit $" />
        <Field label="Due Date" />
        <Field label="Notes" full tall />

        <div className="slip-section-label">Staff Use Only</div>
        <Field label="Staff Initials" />
        <Field label="Entered in System" />
      </div>

      <div className="slip-footer">
        {showScissors && <span className="slip-footer-scissors">✂</span>}
        <span>Please return equipment by the due date. Call {orgPhone} with questions.</span>
        <span>Deposits refunded on return in good condition.</span>
      </div>
    </div>
  );
}

function Field({ label, value, full, tall, mono }: {
  label: string; value?: string; full?: boolean; tall?: boolean; mono?: boolean;
}) {
  return (
    <div className={`slip-field${full ? " full" : ""}${tall ? " tall" : ""}`}>
      <span className="slip-field-label">{label}:</span>
      {value && (
        <span className="slip-field-value" style={mono ? { fontFamily: "monospace", fontWeight: 600 } : undefined}>
          {value}
        </span>
      )}
    </div>
  );
}
