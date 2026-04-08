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

/**
 * Equipment Checkout Slips — half-sheet, 2-up per letter portrait page.
 *
 * Redesigned 2026-04-08 for big-handwriting walk-ins. Field set reduced
 * to the 9 essentials per the field-reduction principle in
 * docs/PAPER_FORM_DESIGN.md. Typography calibrated against the
 * accessibility minimums in apps/web/src/lib/paper-form-design.ts.
 *
 * Email is intentionally KEPT — the slip is often the FIRST data
 * collection point for walk-ins not yet in Atlas, and email is the
 * canonical identifier for the data engine downstream.
 *
 * This is the canonical example of the Atlas paper form design language.
 * When building any new printable form, read this file alongside
 * docs/PAPER_FORM_DESIGN.md and apps/web/src/lib/paper-form-design.ts.
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
        `/api/equipment/scan?barcode=${encodeURIComponent(trimmed)}`,
      );
      setEquipment(data);
    } catch {
      setError(`No equipment found for "${trimmed}"`);
    } finally {
      setLoading(false);
    }
  }, [barcode]);

  const today = formatPrintDate(new Date().toISOString());
  const slipCount = Math.max(1, Math.min(copies, 4));

  return (
    <>
      <style jsx global>{`
        /*
         * ─────────────────────────────────────────────────────────────────────
         *  Equipment Checkout Slip — paper form CSS
         * ─────────────────────────────────────────────────────────────────────
         *
         * Values mirror apps/web/src/lib/paper-form-design.ts (PAPER_FORM
         * tokens). They're written as literal CSS here because we're inside
         * a styled-jsx string and can't interpolate the tokens directly,
         * but each section labels which token it matches so future-you can
         * see the connection.
         *
         * Layout math (half-sheet 8.5" × 5.0", 2-up per letter portrait):
         *
         *   Page padding (top + bottom):        0.40" + 0.40" = 0.80"
         *   Content area:                       4.20"
         *
         *   Header (org / date / logo)          0.38"
         *   Hairline rule                       0.04"
         *   Name field                          0.55"
         *   Phone + Email row                   0.55"
         *   Address field                       0.55"
         *   Hairline rule                       0.04"
         *   Equipment field                     0.45"
         *   Purpose checkboxes row              0.40"
         *   Hairline rule                       0.04"
         *   Deposit / Due Date / Staff row      0.50"
         *   Notes field                         0.45"
         *   Footer (return policy + phone)      0.18"
         *                                      ─────
         *   Total content:                      4.13"  ≤ 4.20" ✓
         *
         * The 0.07" of slack absorbs font line-height rounding.
         */

        /* Screen-side container */
        .slip-page {
          width: 8.5in;
          margin: 1rem auto;
          background: #fff;
          border: 1px solid var(--card-border, #e5e7eb);
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #000;
        }

        /* Half-sheet slip — matches PAPER_FORM.page.halfSheet */
        .slip {
          width: 8.5in;
          height: 5.0in;
          box-sizing: border-box;
          /* PAPER_FORM.spacing.pageMarginY top/bottom + pageMarginX left/right */
          padding: 0.40in 0.45in;
          position: relative;
          overflow: hidden;
          page-break-inside: avoid;
          break-inside: avoid;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #000;
        }

        /* Screen-only: dashed line between adjacent slips so the screen
         * preview shows where the cut will land. In print mode this rule
         * is overridden and the cut line moves to the .slip-page::after
         * pseudo-element so it can be positioned at the exact paper
         * midpoint regardless of slip dimensions. */
        .slip + .slip { border-top: 2px dashed #bbb; }
        .slip-page { page-break-after: always; break-after: page; }

        /* ── Header ─────────────────────────────────────────────────────── */
        .pf-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          /* Single color accent — matches PAPER_FORM.color.rule */
          border-bottom: 2px solid #1a7f3a;
          padding-bottom: 4px;
          margin-bottom: 0.10in;
        }
        .pf-header h1 {
          /* PAPER_FORM.font.h1 */
          font-size: 14pt;
          font-weight: 700;
          margin: 0;
          line-height: 1.1;
          color: #000;
        }
        .pf-header-right {
          display: flex;
          align-items: flex-end;
          gap: 8px;
        }
        .pf-header-meta {
          font-size: 9pt;
          color: #555;
          text-align: right;
          line-height: 1.2;
        }
        .pf-header img {
          height: 28px;
          margin-left: 4px;
        }

        /* ── Field — label above, write line below ─────────────────────── */
        .pf-field {
          /* PAPER_FORM.spacing.fieldGap */
          margin-bottom: 0.10in;
        }
        .pf-field-label {
          display: block;
          /* PAPER_FORM.font.label + weight.label */
          font-size: 11pt;
          font-weight: 700;
          color: #000;
          /* PAPER_FORM.field.labelMarginBottom */
          margin-bottom: 0.04in;
          line-height: 1.2;
        }
        .pf-field-line {
          /* PAPER_FORM.field.writeLineHeight — the most important number
           * in this whole CSS file. 0.45in fits adult/senior handwriting
           * and chunky pens comfortably. */
          height: 0.45in;
          border-bottom: 1.5px solid #888;
          display: flex;
          align-items: flex-end;
          padding-bottom: 3px;
        }
        .pf-field-value {
          /* PAPER_FORM.font.body */
          font-size: 13pt;
          color: #000;
          font-weight: 500;
          line-height: 1.2;
        }
        .pf-field-value-mono {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        /* ── Multi-column rows ─────────────────────────────────────────── */
        .pf-row-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0 0.30in;
        }
        .pf-row-3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 0 0.25in;
        }

        /* ── Hairline rule between groups ──────────────────────────────── */
        .pf-rule {
          border: none;
          border-top: 0.5px solid #ccc;
          margin: 0.06in 0;
          height: 0;
        }

        /* ── Checkbox row (Purpose) ────────────────────────────────────── */
        .pf-checkbox-row {
          display: flex;
          align-items: center;
          gap: 0.18in;
          flex-wrap: wrap;
          margin-bottom: 0.10in;
          /* Match the field write-line height so spacing budget stays consistent */
          min-height: 0.45in;
        }
        .pf-checkbox-row-label {
          /* Same style as field label so it reads as a label, not a heading */
          font-size: 11pt;
          font-weight: 700;
          color: #000;
          margin-right: 0.05in;
        }
        .pf-checkbox {
          display: inline-flex;
          align-items: center;
          gap: 0.06in;
          font-size: 11pt;
          color: #000;
        }
        .pf-checkbox-box {
          /* PAPER_FORM.checkbox.size — 0.22in is large enough for a chunky
           * pen check without overflow */
          display: inline-block;
          width: 0.22in;
          height: 0.22in;
          border: 1.5px solid #000;
          box-sizing: border-box;
          flex-shrink: 0;
        }

        /* ── Footer ────────────────────────────────────────────────────── */
        .pf-footer {
          position: absolute;
          /* Inset to clear the page margin */
          bottom: 0.18in;
          left: 0.45in;
          right: 0.45in;
          display: flex;
          justify-content: space-between;
          /* PAPER_FORM.font.footer + color.muted */
          font-size: 8pt;
          font-style: italic;
          color: #555;
          line-height: 1.2;
        }
        .pf-footer-cut {
          position: absolute;
          top: -2px;
          left: -0.45in;
          font-size: 10pt;
          color: #bbb;
          transform: translateY(-50%);
        }

        /* ── Print mode ────────────────────────────────────────────────── */
        @media print {
          /* @page margin: 0 is honored when the user picks "Margins: None"
           * in the print dialog. With Chrome's default margins, .slip-page
           * uses 100vh + flex centering so the slips center within whatever
           * printable area the browser provides. */
          @page { size: letter portrait; margin: 0; }

          /* html + body need explicit height so 100vh resolves to the actual
           * page height (not the collapsed content height). Without this the
           * .slip-page collapses and the vertical centering doesn't engage. */
          html, body { height: 100% !important; margin: 0 !important; padding: 0 !important; }
          body { background: #fff !important; }

          /* Hide screen chrome */
          .slip-ctrl, .tippy-fab, .tippy-chat-panel,
          nav, aside, header, footer, [data-sidebar],
          [role="alert"], [data-banner], .transition-banner { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; max-width: none !important; }

          /* Vertical layout for guillotine alignment.
           *
           * justify-content: space-around distributes the 1in of free space
           * (11in page minus 10in of slip content) equally:
           *   0.25in above slip 1
           *   5.0in slip 1
           *   0.25in below slip 1
           *   0.25in above slip 2
           *   5.0in slip 2
           *   0.25in below slip 2
           *
           * Both slips look identical visually, with equal breathing room.
           * The dashed cut line is on a pseudo-element at the page midpoint
           * (50% of slip-page height = 5.5in from paper top) so cutting
           * there yields two equal halves. */
          .slip-page {
            border: none;
            margin: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: space-around;
            position: relative;
          }

          /* Print-mode: cut line on pseudo-element, not slip 2's top border.
           * :has() so the line only renders when there are 2+ slips. */
          .slip + .slip { border-top: none !important; }
          .slip-page:has(.slip + .slip)::after {
            content: "";
            position: absolute;
            top: 50%;
            left: 0.45in;
            right: 0.45in;
            height: 0;
            border-top: 2px dashed #bbb;
            pointer-events: none;
            transform: translateY(-1px);
          }

          /* Force background colors so the green header rule prints */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* ── Screen controls ── */}
      <div className="slip-ctrl" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <Icon name="receipt" size={24} color="var(--primary)" />
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Checkout Slips</h1>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0 0 1.25rem" }}>
          Half-sheet forms — hand one to each person at checkout. Designed for
          older walk-ins, big handwriting, and photocopier survivability.
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
            onKeyDown={(e) => {
              if (e.key === "Enter") handleScan();
            }}
            placeholder="Optional: scan barcode to pre-fill..."
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
          <div style={{ color: "var(--danger-text)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{error}</div>
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
              onClick={() => {
                setEquipment(null);
                setBarcode("");
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--success-text)",
                fontSize: "1rem",
              }}
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

        {/* Print tip — guillotine + paper form design language reference */}
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.625rem 0.875rem",
            background: "var(--info-bg, rgba(59,130,246,0.06))",
            border: "1px solid var(--info-border, #93c5fd)",
            borderRadius: 8,
            fontSize: "0.78rem",
            color: "var(--info-text, #1d4ed8)",
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            lineHeight: 1.4,
          }}
        >
          <Icon name="help-circle" size={14} color="var(--info-text, #1d4ed8)" />
          <div>
            {copies === 2 ? (
              <>
                <strong>Cut line at exactly 5.5&quot; from the top edge.</strong>{" "}
                Slips are vertically centered so guillotine cut at the paper
                midpoint gives two equal halves. If anything looks off, set{" "}
                <strong>Margins → None</strong> in the print dialog.
              </>
            ) : (
              <>
                One full-width slip per page, vertically centered. No cut line.
              </>
            )}
            <div style={{ marginTop: 4, opacity: 0.85 }}>
              Designed for big handwriting (13pt body, 0.45&quot; write lines,
              0.22&quot; checkboxes). See{" "}
              <code style={{ fontSize: "0.72rem" }}>docs/PAPER_FORM_DESIGN.md</code>{" "}
              for the full design language.
            </div>
          </div>
        </div>
      </div>

      {/* ── Printable slips ── */}
      <div className="slip-page">
        {Array.from({ length: slipCount }).map((_, i) => (
          <Slip
            key={i}
            org={nameShort || "FFSC"}
            phone={orgPhone}
            date={today}
            eq={equipment}
            cut={i > 0}
          />
        ))}
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  Single slip component
 *
 *  Field set (9 essentials, per docs/PAPER_FORM_DESIGN.md):
 *    1. Name              (full width)
 *    2. Phone + Email     (2-col row — paired identity fields)
 *    3. Address           (full width — where the trapping happens)
 *    4. Equipment         (full width, auto-filled if pre-scanned)
 *    5. Purpose           (checkbox row — TNR / Kitten / Colony / etc.)
 *    6. Deposit / Due Date / Staff  (3-col row)
 *    7. Notes             (full width)
 *    + Header + Footer
 *
 *  Email is intentionally KEPT — paper slip is often the first data
 *  collection point for walk-ins not yet in Atlas, and email is the
 *  canonical identifier in the data engine for downstream identity
 *  resolution.
 * ─────────────────────────────────────────────────────────────────────── */

function Slip({
  org,
  phone,
  date,
  eq,
  cut,
}: {
  org: string;
  phone: string;
  date: string;
  eq: ScannedEquipment | null;
  cut: boolean;
}) {
  // If we have pre-scanned equipment, show "name (barcode)" in the field;
  // otherwise leave it blank for staff to write in.
  const equipmentDisplay = eq
    ? `${eq.display_name}${eq.barcode ? ` — ${eq.barcode}` : ""}`
    : null;

  return (
    <div className="slip">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="pf-header">
        <h1>{org} — Equipment Checkout</h1>
        <div className="pf-header-right">
          <span className="pf-header-meta">{date}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" />
        </div>
      </header>

      {/* ── Caller info group ──────────────────────────────────────────── */}
      <Field label="Name" />
      <div className="pf-row-2">
        <Field label="Phone" />
        <Field label="Email" />
      </div>
      <Field label="Address (where trapping)" />

      <hr className="pf-rule" />

      {/* ── Equipment + purpose group ──────────────────────────────────── */}
      <Field
        label="Equipment"
        value={equipmentDisplay}
        valueMono={!!equipmentDisplay}
      />
      <div className="pf-checkbox-row">
        <span className="pf-checkbox-row-label">Purpose:</span>
        {["TNR", "Kitten", "Colony", "Feeding", "Pet", "Other"].map((p) => (
          <span key={p} className="pf-checkbox">
            <span className="pf-checkbox-box" />
            {p}
          </span>
        ))}
      </div>

      <hr className="pf-rule" />

      {/* ── Details group ──────────────────────────────────────────────── */}
      <div className="pf-row-3">
        <Field label="Deposit $" />
        <Field label="Due Date" />
        <Field label="Staff" />
      </div>
      <Field label="Notes" />

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="pf-footer">
        {cut && <span className="pf-footer-cut">✂</span>}
        <span>Return by due date. Call {phone} with questions.</span>
        <span>Deposits refunded on return in good condition.</span>
      </div>
    </div>
  );
}

/* Single field — label above, write line below */
function Field({
  label,
  value,
  valueMono,
}: {
  label: string;
  value?: string | null;
  valueMono?: boolean;
}) {
  return (
    <div className="pf-field">
      <span className="pf-field-label">{label}</span>
      <div className="pf-field-line">
        {value && (
          <span
            className={`pf-field-value${valueMono ? " pf-field-value-mono" : ""}`}
          >
            {value}
          </span>
        )}
      </div>
    </div>
  );
}
