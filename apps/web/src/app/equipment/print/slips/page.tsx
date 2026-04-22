"use client";

import { useState, useCallback } from "react";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import { fetchApi } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

interface ScannedEquipment {
  barcode: string | null;
  display_name: string;
  condition_status: string;
  custody_status: string;
  type_display_name: string | null;
  type_category: string | null;
}

/**
 * Equipment Checkout Slip — full-letter, professionally branded.
 *
 * v3 (2026-04-09): Box-styled sections, bordered field write boxes,
 * explicit barcode field, purpose as FFR Appt/Feeding/Transport/Other
 * with write-in, appointment date added, date field left blank for
 * mass-printing. Visual treatment follows ABS Forms Design Standards
 * (10% shaded section boxes, 0.5pt field borders, 1.5pt section borders).
 *
 * See docs/PAPER_FORM_DESIGN.md + apps/web/src/lib/paper-form-design.ts.
 */
export default function CheckoutSlipsPage() {
  const { nameFull, nameShort, phone: orgPhone, website, tagline } =
    useOrgConfig();
  const [barcode, setBarcode] = useState("");
  const [equipment, setEquipment] = useState<ScannedEquipment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const orgDisplayName =
    nameFull || nameShort || "Forgotten Felines of Sonoma County";

  return (
    <>
      <style jsx global>{`
        /* ═══════════════════════════════════════════════════════════════
         *  Equipment Checkout Slip — v3
         *
         *  ABS Forms Design Standards (2023) influence:
         *  - 10% screened (shaded) boxes for grouped sections
         *  - 0.5pt lines for field borders, 1.5pt for section borders
         *  - Logo top-left, form title right of logo
         *  - Form identifier top-right
         *  - Checkbox 4mm+ square, 3mm gap from label
         *  - Free text boxes 8mm+ per line height
         *
         *  Sources:
         *  abs.gov.au/statistics/standards/abs-forms-design-standards
         *  booqable.com/blog/equipment-sign-out-sheets
         *  rentman.io/blog/equipment-check-out-form
         * ═══════════════════════════════════════════════════════════════ */

        .slip-page {
          max-width: 8.5in;
          margin: 1rem auto;
          background: #fff;
          border: 1px solid var(--card-border, #e5e7eb);
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #000;
        }

        .slip {
          width: 8.5in;
          min-height: 11.0in;
          box-sizing: border-box;
          padding: 0.35in 0.50in 0.30in;
          position: relative;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #000;
          page-break-after: always;
          break-after: page;
        }

        /* ── Masthead ─────────────────────────────────────────────── */
        .pf-masthead {
          display: flex;
          align-items: flex-start;
          gap: 0.22in;
          margin-bottom: 0.08in;
        }
        .pf-masthead-logo {
          width: 0.95in;
          height: 0.95in;
          flex-shrink: 0;
          object-fit: contain;
        }
        .pf-masthead-text {
          flex: 1;
          padding-top: 0.02in;
        }
        .pf-masthead-org {
          font-size: 16pt;
          font-weight: 800;
          line-height: 1.05;
          color: #000;
          margin: 0;
        }
        .pf-masthead-tagline {
          font-size: 9pt;
          font-style: italic;
          color: #555;
          margin-top: 3px;
          line-height: 1.2;
        }
        .pf-masthead-form-title {
          margin-top: 0.06in;
          padding-top: 0.04in;
          border-top: 1px solid #ccc;
          font-size: 13pt;
          font-weight: 700;
          color: #1a7f3a;
          line-height: 1.1;
        }
        .pf-masthead-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.06in;
          padding-top: 0.02in;
          flex-shrink: 0;
        }
        .pf-meta-badge {
          font-size: 7pt;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #999;
          text-align: right;
        }

        /* ── Green banner bar under masthead ──────────────────────── */
        .pf-banner {
          background: #1a7f3a;
          color: #fff;
          padding: 5px 12px;
          font-size: 9pt;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          margin-bottom: 0.10in;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .pf-banner-right {
          font-weight: 400;
          text-transform: none;
          font-size: 8pt;
          letter-spacing: 0;
        }

        /* ── Section box (ABS 10% screened box with border) ──────── */
        .pf-section {
          border: 1.5pt solid #ccc;
          border-radius: 4px;
          margin-bottom: 0.10in;
          overflow: hidden;
        }
        .pf-section-heading {
          background: #e8e8e8;
          padding: 5px 12px;
          font-size: 10pt;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #333;
          border-bottom: 1pt solid #ccc;
        }
        .pf-section-body {
          padding: 0.08in 0.14in 0.04in;
          background: #fafbfc;
        }

        /* ── Staff-use section (darker) ──────────────────────────── */
        .pf-section-staff .pf-section-heading {
          background: #d0d0d0;
          color: #222;
        }
        .pf-section-staff .pf-section-body {
          background: #f0f1f2;
        }

        /* ── Field — label above, bordered write box below ───────── */
        .pf-field {
          margin-bottom: 0.08in;
        }
        .pf-field-label {
          display: block;
          font-size: 10pt;
          font-weight: 700;
          color: #000;
          margin-bottom: 0.03in;
          line-height: 1.2;
        }
        .pf-field-helper {
          font-weight: 400;
          font-style: italic;
          color: #666;
          font-size: 8pt;
          margin-left: 4px;
        }
        /* The bordered write box — ABS-style: 0.5pt border, enclosed rectangle.
         * Feels like a REAL form field, not a bare underline. */
        .pf-field-box {
          height: 0.36in;
          border: 0.5pt solid #999;
          border-radius: 2px;
          background: #fff;
          display: flex;
          align-items: flex-end;
          padding: 0 8px 3px;
        }
        .pf-field-box-tall {
          height: 0.42in;
        }
        .pf-field-value {
          font-size: 12pt;
          color: #000;
          font-weight: 500;
          line-height: 1.2;
        }
        .pf-field-value-mono {
          font-weight: 700;
          letter-spacing: 0.05em;
          font-size: 14pt;
        }

        /* ── Barcode field — prominent, large-text ───────────────── */
        .pf-barcode-box {
          height: 0.45in;
          border: 2pt solid #000;
          border-radius: 3px;
          background: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 12px;
          font-size: 20pt;
          font-weight: 800;
          letter-spacing: 0.15em;
          font-family: 'Courier New', Courier, monospace;
          color: #000;
        }

        /* ── Multi-column rows ───────────────────────────────────── */
        .pf-row-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0 0.20in;
        }
        .pf-row-3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 0 0.18in;
        }
        .pf-row-barcode {
          display: grid;
          grid-template-columns: 1.2in 1fr;
          gap: 0 0.20in;
          align-items: end;
        }

        /* ── Checkbox group (Purpose) ────────────────────────────── */
        .pf-checkbox-group {
          margin-bottom: 0.10in;
        }
        .pf-checkbox-row {
          display: flex;
          align-items: center;
          gap: 0.20in;
          flex-wrap: wrap;
          margin-top: 0.04in;
        }
        .pf-checkbox {
          display: inline-flex;
          align-items: center;
          gap: 0.08in;
          font-size: 11pt;
          color: #000;
          line-height: 1.2;
        }
        .pf-checkbox-box {
          display: inline-block;
          width: 0.22in;
          height: 0.22in;
          border: 1.5px solid #000;
          box-sizing: border-box;
          flex-shrink: 0;
          border-radius: 2px;
          background: #fff;
        }
        .pf-other-line {
          display: inline-flex;
          align-items: flex-end;
          gap: 0.06in;
          font-size: 11pt;
          font-weight: 700;
        }
        .pf-other-write {
          width: 2.0in;
          border-bottom: 1.5px solid #999;
          height: 0.30in;
        }

        /* ── Notes (multi-line bordered boxes) ───────────────────── */
        .pf-notes-box {
          height: 0.34in;
          border: 0.5pt solid #999;
          border-radius: 2px;
          background: #fff;
          margin-bottom: 0.06in;
        }

        /* ── Footer / colophon ───────────────────────────────────── */
        .pf-footer {
          margin-top: 0.14in;
          padding-top: 0.08in;
          border-top: 2pt solid #1a7f3a;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.30in;
        }
        .pf-footer-org {
          flex: 1;
          font-size: 9pt;
          color: #000;
          line-height: 1.5;
        }
        .pf-footer-org strong {
          font-size: 10pt;
          font-weight: 800;
          display: block;
          margin-bottom: 1px;
        }
        .pf-footer-policy {
          flex: 1;
          font-size: 8pt;
          font-style: italic;
          color: #555;
          line-height: 1.4;
          text-align: right;
          padding-top: 1px;
        }

        /* ── Print mode ──────────────────────────────────────────── */
        @media print {
          @page { size: letter portrait; margin: 0; }
          html, body { height: auto !important; margin: 0 !important; padding: 0 !important; }
          body { background: #fff !important; }
          .slip-ctrl, .tippy-fab, .tippy-chat-panel,
          nav, aside, header, footer, [data-sidebar],
          [role="alert"], [data-banner], .transition-banner { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; max-width: none !important; }
          .slip-page { border: none; margin: 0; max-width: none; }
          .slip { margin: 0; }
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
          Professional equipment checkout form — one slip per page.
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
            placeholder="Optional: scan barcode to pre-fill..."
            style={{ flex: 1, padding: "0.5rem 0.75rem", border: "1px solid var(--card-border)", borderRadius: 8, fontFamily: "monospace", fontSize: "0.95rem", outline: "none" }}
          />
          <Button variant="primary" size="sm" onClick={handleScan} disabled={loading || !barcode.trim()}>
            {loading ? "..." : "Look Up"}
          </Button>
        </div>

        {error && <div style={{ color: "var(--danger-text)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{error}</div>}
        {equipment && (
          <div style={{ background: "var(--success-bg)", border: "1px solid var(--success-border, #bbf7d0)", borderRadius: 8, padding: "0.5rem 0.75rem", marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--success-text)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Pre-filling: <strong>{equipment.display_name}</strong> [{equipment.barcode}]</span>
            <button onClick={() => { setEquipment(null); setBarcode(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--success-text)", fontSize: "1rem" }}>&times;</button>
          </div>
        )}

        <Button variant="primary" icon="printer" onClick={() => window.print()}>Print Slip</Button>
      </div>

      {/* ── Printable slip ── */}
      <div className="slip-page">
        <Slip
          orgName={orgDisplayName}
          tagline={tagline || "Trap-Neuter-Return for Sonoma County's community cats"}
          phone={orgPhone}
          website={website || ""}
          eq={equipment}
        />
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Single slip — full-letter, ABS-style box sections, branded
 * ══════════════════════════════════════════════════════════════════════════ */

function Slip({
  orgName,
  tagline,
  phone,
  website,
  eq,
}: {
  orgName: string;
  tagline: string;
  phone: string;
  website: string;
  eq: ScannedEquipment | null;
}) {
  return (
    <div className="slip">
      {/* ── Masthead ───────────────────────────────────────────────── */}
      <div className="pf-masthead">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="pf-masthead-logo" src="/logo.png" alt={orgName} />
        <div className="pf-masthead-text">
          <h1 className="pf-masthead-org">{orgName}</h1>
          <div className="pf-masthead-tagline">{tagline}</div>
          <div className="pf-masthead-form-title">Equipment Checkout Form</div>
        </div>
        <div className="pf-masthead-meta">
          <div className="pf-meta-badge">Form EC-001 · Rev 2</div>
        </div>
      </div>

      {/* ── Green banner bar ──────────────────────────────────────── */}
      <div className="pf-banner">
        <span>Equipment Loan Agreement</span>
        <span className="pf-banner-right">Please print clearly in all fields</span>
      </div>

      {/* ═══ Section 1 — Borrower Information ═══════════════════════ */}
      <div className="pf-section">
        <div className="pf-section-heading">Borrower Information</div>
        <div className="pf-section-body">
          <Field label="Full Name" />
          <div className="pf-row-2">
            <Field label="Phone" />
            <Field label="Email" helper="For booking confirmation and follow-up" />
          </div>
          <Field label="Address" helper="Where the equipment will be used" />
          <div className="pf-row-2">
            <Field label="Appointment Date" />
            <Field label="Date Checked Out" />
          </div>
        </div>
      </div>

      {/* ═══ Section 2 — Equipment ═════════════════════════════════ */}
      <div className="pf-section">
        <div className="pf-section-heading">Equipment</div>
        <div className="pf-section-body">
          {/* Barcodes + Type on same row */}
          <div style={{ display: "flex", gap: "0.12in", marginBottom: "0.10in", alignItems: "flex-end" }}>
            {/* 3 barcode boxes */}
            {[0, 1, 2].map((i) => (
              <div key={i} className="pf-field" style={{ width: "0.9in" }}>
                {i === 0 && (
                  <span className="pf-field-label">
                    Barcode(s) <span className="pf-field-helper">4 digits</span>
                  </span>
                )}
                <div className="pf-barcode-box">
                  {i === 0 ? (eq?.barcode || "") : ""}
                </div>
              </div>
            ))}
            {/* Type checkboxes — compact, same row */}
            <div style={{ flex: 1 }}>
              <span className="pf-field-label">Type</span>
              <div className="pf-checkbox-row" style={{ marginTop: "0.04in" }}>
                {["Trap", "Gadget", "Transfer Cage", "Wire Cage"].map((t) => (
                  <span key={t} className="pf-checkbox">
                    <span className="pf-checkbox-box" />
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Purpose */}
          <div className="pf-checkbox-group">
            <span className="pf-field-label">Purpose</span>
            <div className="pf-checkbox-row">
              {["FFR Appt", "Feeding", "Transport"].map((p) => (
                <span key={p} className="pf-checkbox">
                  <span className="pf-checkbox-box" />
                  {p}
                </span>
              ))}
              <span className="pf-other-line">
                <span className="pf-checkbox">
                  <span className="pf-checkbox-box" />
                  Other:
                </span>
                <span className="pf-other-write" />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Section 3 — Checkout Details (staff use) ══════════════ */}
      <div className="pf-section pf-section-staff">
        <div className="pf-section-heading">Checkout Details — Staff Use</div>
        <div className="pf-section-body">
          <div className="pf-row-3">
            <Field label="Deposit $" />
            <Field label="Due Date" />
            <Field label="Staff Name" />
          </div>
          <div className="pf-field">
            <span className="pf-field-label">Notes</span>
            <div className="pf-notes-box" />
            <div className="pf-notes-box" />
          </div>
        </div>
      </div>

      {/* ── Footer / colophon ──────────────────────────────────────── */}
      <div className="pf-footer">
        <div className="pf-footer-org">
          <strong>{orgName}</strong>
          1814 Empire Industrial Court, Suite F · Santa Rosa, CA 95404
          <br />
          {phone || "(707) 576-7999"}
          {website && <>{" · "}{website.replace(/^https?:\/\//, "")}</>}
        </div>
        <div className="pf-footer-policy">
          Equipment is loaned in good faith. Please return by the due date
          listed above. Deposits are refunded on return when the equipment
          comes back in good condition. Call us with any questions.
        </div>
      </div>
    </div>
  );
}

/* ── Field primitive ──────────────────────────────────────────────────── */

function Field({
  label,
  value,
  valueMono,
  helper,
  tall,
}: {
  label: string;
  value?: string | null;
  valueMono?: boolean;
  helper?: string;
  tall?: boolean;
}) {
  return (
    <div className="pf-field">
      <span className="pf-field-label">
        {label}
        {helper && <span className="pf-field-helper">{helper}</span>}
      </span>
      <div className={`pf-field-box${tall ? " pf-field-box-tall" : ""}`}>
        {value && (
          <span className={`pf-field-value${valueMono ? " pf-field-value-mono" : ""}`}>
            {value}
          </span>
        )}
      </div>
    </div>
  );
}
