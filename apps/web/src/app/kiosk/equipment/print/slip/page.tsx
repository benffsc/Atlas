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

/**
 * Printable checkout slip — two half-sheets per letter page (portrait).
 *
 * Each slip captures everything needed for a proper digital checkout:
 * identity (first/last/phone/email), equipment info, purpose, location,
 * appointment date, deposit, due date, condition, and staff initials.
 *
 * Staff hands one slip to the person at checkout. They fill it out.
 * Staff later enters the data into the kiosk system.
 *
 * Optionally pre-fill equipment info by scanning a barcode.
 */
export default function CheckoutSlipPage() {
  const { nameFull, nameShort, phone: orgPhone } = useOrgConfig();
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
        body { margin: 0; background: #f5f5f5; }

        /* ── Screen controls ── */
        .slip-controls {
          max-width: 600px;
          margin: 1rem auto;
          padding: 1rem 1.25rem;
          background: #fff;
          border-radius: 10px;
          border: 1px solid #e5e7eb;
          font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        }
        .slip-controls h2 { margin: 0 0 0.25rem; font-size: 1.1rem; }
        .slip-controls p { margin: 0 0 1rem; font-size: 0.85rem; color: #6b7280; }

        .slip-scan-row { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
        .slip-scan-row input {
          flex: 1; padding: 0.5rem 0.75rem; border: 2px solid #d1d5db; border-radius: 8px;
          font-family: monospace; font-size: 1rem; outline: none;
        }
        .slip-scan-row input:focus { border-color: #16a34a; }
        .slip-scan-row button {
          padding: 0.5rem 1rem; background: #16a34a; color: #fff; border: none;
          border-radius: 8px; font-weight: 600; cursor: pointer;
        }
        .slip-scan-row button:disabled { opacity: 0.5; }

        .slip-ok { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 0.5rem 0.75rem; margin-bottom: 0.75rem; font-size: 0.85rem; color: #166534; }
        .slip-err { color: #dc2626; font-size: 0.85rem; margin-bottom: 0.75rem; }

        .slip-option-row { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; font-size: 0.85rem; }
        .slip-option-row label { display: flex; align-items: center; gap: 0.375rem; }
        .slip-option-row select { padding: 0.375rem 0.5rem; border-radius: 6px; border: 1px solid #d1d5db; font-size: 0.85rem; }

        .slip-actions { display: flex; gap: 0.75rem; align-items: center; }
        .slip-actions button {
          padding: 0.5rem 1.25rem; background: #16a34a; color: #fff; border: none;
          border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem;
        }
        .slip-actions a { color: #16a34a; font-size: 0.85rem; text-decoration: none; }

        /* ── Printable slips ── */
        .slip-page {
          width: 8.5in;
          margin: 1rem auto;
          background: #fff;
          border: 1px solid #e5e7eb;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .slip {
          width: 8.5in;
          height: 5.5in;
          box-sizing: border-box;
          padding: 0.3in 0.4in 0.25in;
          position: relative;
          overflow: hidden;
        }
        .slip + .slip {
          border-top: 2px dashed #bbb;
        }

        /* ── Slip internal layout ── */
        .slip-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          border-bottom: 2px solid #16a34a;
          padding-bottom: 4px;
          margin-bottom: 8px;
        }
        .slip-header h1 { font-size: 12pt; font-weight: 700; margin: 0; letter-spacing: -0.2px; }
        .slip-header .slip-meta { font-size: 7.5pt; color: #666; text-align: right; }
        .slip-header img { height: 32px; margin-left: 8px; }

        .slip-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0 16px;
        }

        .slip-field {
          border-bottom: 1px solid #d5d8dc;
          padding: 2px 0 1px;
          margin-bottom: 5px;
          min-height: 20px;
          display: flex;
          align-items: flex-end;
        }
        .slip-field-label {
          font-size: 6.5pt;
          font-weight: 700;
          color: #16a34a;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          white-space: nowrap;
          margin-right: 6px;
          padding-bottom: 1px;
        }
        .slip-field-value {
          font-size: 8.5pt;
          font-weight: 500;
          flex: 1;
        }
        .slip-field.full { grid-column: 1 / -1; }
        .slip-field.tall { min-height: 32px; }

        .slip-checkboxes {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          font-size: 7.5pt;
          padding: 3px 0;
        }
        .slip-cb {
          display: inline-flex;
          align-items: center;
          gap: 3px;
        }
        .slip-cb-box {
          display: inline-block;
          width: 10px;
          height: 10px;
          border: 1.5px solid #333;
          border-radius: 2px;
        }

        .slip-section-label {
          font-size: 7pt;
          font-weight: 700;
          color: #999;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 6px 0 2px;
          grid-column: 1 / -1;
        }

        .slip-footer {
          position: absolute;
          bottom: 0.2in;
          left: 0.4in;
          right: 0.4in;
          display: flex;
          justify-content: space-between;
          font-size: 6.5pt;
          color: #999;
          border-top: 1px solid #eee;
          padding-top: 3px;
        }
        .slip-footer-scissors {
          position: absolute;
          top: -1px;
          left: -0.4in;
          font-size: 10pt;
          color: #bbb;
          transform: translateY(-50%);
        }

        @media print {
          @page { size: letter portrait; margin: 0; }
          body { background: #fff; }
          .slip-controls, .tippy-fab, .tippy-chat-panel { display: none !important; }
          .slip-page { border: none; margin: 0; box-shadow: none; }
          .slip + .slip { border-top: 2px dashed #bbb; }
        }
      `}</style>

      {/* ── Screen controls ── */}
      <div className="slip-controls">
        <h2>Equipment Checkout Slips</h2>
        <p>
          Print half-sheet checkout forms. Hand one to each person checking out equipment.
          They fill it out, you enter it into the system later.
        </p>

        <div className="slip-scan-row">
          <input
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
            placeholder="Optional: scan barcode to pre-fill equipment..."
          />
          <button onClick={handleScan} disabled={loading || !barcode.trim()}>
            {loading ? "..." : "Look Up"}
          </button>
        </div>
        {error && <div className="slip-err">{error}</div>}
        {equipment && (
          <div className="slip-ok">
            Pre-filling: <strong>{equipment.display_name}</strong> [{equipment.barcode}] — {fmtCondition(equipment.condition_status)}
          </div>
        )}

        <div className="slip-option-row">
          <label>
            Slips per page:
            <select value={copies} onChange={(e) => setCopies(Number(e.target.value))}>
              <option value={1}>1 (half page)</option>
              <option value={2}>2 (full page)</option>
            </select>
          </label>
          {equipment && (
            <button
              onClick={() => { setEquipment(null); setBarcode(""); setError(null); }}
              style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "0.25rem 0.75rem", fontSize: "0.8rem", cursor: "pointer" }}
            >
              Clear pre-fill
            </button>
          )}
        </div>

        <div className="slip-actions">
          <button onClick={() => window.print()}>Print Slips</button>
          <a href="/kiosk/equipment/print">Log form</a>
          <a href="/kiosk/equipment/scan">Back to Kiosk</a>
        </div>
      </div>

      {/* ── Printable slips ── */}
      <div className="slip-page">
        {Array.from({ length: slipCount }).map((_, i) => (
          <CheckoutSlip
            key={i}
            orgName={nameShort || "FFSC"}
            orgPhone={orgPhone}
            date={today}
            equipment={equipment}
            showScissors={i > 0}
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
}: {
  orgName: string;
  orgPhone: string;
  date: string;
  equipment: ScannedEquipment | null;
  showScissors: boolean;
}) {
  const fmtCondition = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="slip">
      {/* Header */}
      <div className="slip-header">
        <div>
          <h1>{orgName} — Equipment Checkout</h1>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <div className="slip-meta">
            <div>{date}</div>
          </div>
          <img src="/logo.png" alt="" />
        </div>
      </div>

      {/* Form fields */}
      <div className="slip-grid">
        {/* ── Your Information ── */}
        <div className="slip-section-label">Your Information</div>

        <Field label="First Name" />
        <Field label="Last Name" />
        <Field label="Phone" />
        <Field label="Email" />

        {/* ── Equipment ── */}
        <div className="slip-section-label">Equipment</div>

        <Field
          label="Equipment"
          value={equipment ? equipment.display_name : undefined}
        />
        <Field
          label="Barcode"
          value={equipment?.barcode || undefined}
          mono
        />

        <div className="slip-field">
          <span className="slip-field-label">Type:</span>
          <div className="slip-checkboxes">
            <span className="slip-cb"><span className="slip-cb-box" /> Client</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Trapper</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Internal</span>
            <span className="slip-cb"><span className="slip-cb-box" /> Foster</span>
          </div>
        </div>

        <Field
          label="Condition"
          value={equipment ? fmtCondition(equipment.condition_status) : undefined}
        />

        {/* ── Purpose & Location ── */}
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

        {/* ── Checkout Details ── */}
        <div className="slip-section-label">Checkout Details</div>

        <Field label="Deposit $" />
        <Field label="Due Date" />
        <Field label="Notes" full tall />

        {/* ── Staff Use ── */}
        <div className="slip-section-label">Staff Use Only</div>
        <Field label="Staff Initials" />
        <Field label="Entered in System" />
      </div>

      {/* Footer */}
      <div className="slip-footer">
        {showScissors && <span className="slip-footer-scissors">✂</span>}
        <span>Please return equipment by the due date. Call {orgPhone} with questions.</span>
        <span>Deposits refunded on return in good condition.</span>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  full,
  tall,
  mono,
}: {
  label: string;
  value?: string;
  full?: boolean;
  tall?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={`slip-field${full ? " full" : ""}${tall ? " tall" : ""}`}>
      <span className="slip-field-label">{label}:</span>
      {value && (
        <span
          className="slip-field-value"
          style={mono ? { fontFamily: "monospace", fontWeight: 600 } : undefined}
        >
          {value}
        </span>
      )}
    </div>
  );
}
