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
 * Equipment Checkout Slip — full-letter, professionally branded.
 *
 * Redesigned 2026-04-08 (v2) after the half-sheet attempt failed: 9
 * essential fields don't fit a 5.0in half-sheet at the accessibility
 * specs in docs/PAPER_FORM_DESIGN.md (each field needs ~0.78in once
 * label + write line + margin are accounted for, totaling ~6in of
 * content vs 4.2in of available space).
 *
 * Pivoted to full-letter portrait (8.5×11), one slip per page. The
 * format gives room for a real masthead, sectioned layout, full
 * footer, and abundant breathing room — feels like an organization's
 * official intake form, not a stopgap.
 *
 * This is the canonical example of the Atlas paper form design
 * language. See:
 *   - apps/web/src/lib/paper-form-design.ts (PAPER_FORM tokens)
 *   - docs/PAPER_FORM_DESIGN.md (full design language + rationale)
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

  const today = formatPrintDate(new Date().toISOString());
  const orgDisplayName = nameFull || nameShort || "Forgotten Felines of Sonoma County";

  return (
    <>
      <style jsx global>{`
        /*
         * ═════════════════════════════════════════════════════════════════
         *  Equipment Checkout Slip — full-letter, branded
         * ═════════════════════════════════════════════════════════════════
         *
         * Token values mirror apps/web/src/lib/paper-form-design.ts.
         * See docs/PAPER_FORM_DESIGN.md for the full design language and
         * the design rules every paper form in Atlas should follow.
         */

        /* Screen-side container */
        .slip-page {
          max-width: 8.5in;
          margin: 1rem auto;
          background: #fff;
          border: 1px solid var(--card-border, #e5e7eb);
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #000;
        }

        /* Full-letter slip — matches PAPER_FORM.page.fullSheet */
        .slip {
          width: 8.5in;
          min-height: 11.0in;
          box-sizing: border-box;
          /* Generous letter-quality margins */
          padding: 0.6in 0.65in 0.55in;
          position: relative;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #000;
          page-break-after: always;
          break-after: page;
        }

        /* ── Masthead ─────────────────────────────────────────────────── */
        .pf-masthead {
          display: flex;
          align-items: flex-start;
          gap: 0.35in;
          padding-bottom: 0.18in;
          border-bottom: 3px solid #1a7f3a;
          margin-bottom: 0.08in;
        }
        .pf-masthead-logo {
          /* Big, prominent — feels like a real organization */
          width: 1.4in;
          height: 1.4in;
          flex-shrink: 0;
          object-fit: contain;
        }
        .pf-masthead-text {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          padding-top: 0.05in;
        }
        .pf-masthead-org {
          font-size: 22pt;
          font-weight: 800;
          line-height: 1.05;
          color: #000;
          letter-spacing: -0.01em;
          margin: 0;
        }
        .pf-masthead-tagline {
          font-size: 10pt;
          font-style: italic;
          color: #555;
          margin-top: 4px;
          line-height: 1.2;
        }
        .pf-masthead-form-title {
          margin-top: 0.16in;
          padding-top: 0.10in;
          border-top: 1px solid #ddd;
          font-size: 16pt;
          font-weight: 700;
          color: #000;
          line-height: 1.1;
          letter-spacing: 0.01em;
        }
        .pf-masthead-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.10in;
          font-size: 10pt;
          color: #555;
          padding-top: 0.05in;
        }
        .pf-masthead-meta-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }
        .pf-masthead-meta-label {
          font-weight: 700;
          color: #000;
          font-size: 9pt;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .pf-masthead-meta-value {
          min-width: 1.2in;
          border-bottom: 1.5px solid #888;
          padding: 0 4px 1px;
          font-size: 11pt;
          color: #000;
        }

        /* ── Section heading ──────────────────────────────────────────── */
        .pf-section {
          margin-top: 0.25in;
        }
        .pf-section-heading {
          font-size: 11pt;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #1a7f3a;
          padding-bottom: 4px;
          border-bottom: 1.5px solid #1a7f3a;
          margin-bottom: 0.16in;
        }

        /* ── Field — label above, write line below ────────────────────── */
        .pf-field {
          margin-bottom: 0.22in;
        }
        .pf-field-label {
          display: block;
          /* PAPER_FORM.font.label + weight.label */
          font-size: 12pt;
          font-weight: 700;
          color: #000;
          margin-bottom: 0.06in;
          line-height: 1.2;
        }
        .pf-field-line {
          /* PAPER_FORM.field.writeLineHeight — comfortable for chunky pens
           * and senior handwriting. Slightly more breathing room than the
           * compact slip since we now have full-letter space. */
          height: 0.50in;
          border-bottom: 2px solid #999;
          display: flex;
          align-items: flex-end;
          padding-bottom: 4px;
        }
        .pf-field-value {
          font-size: 13pt;
          color: #000;
          font-weight: 500;
          line-height: 1.2;
        }
        .pf-field-value-mono {
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .pf-field-helper {
          display: block;
          font-size: 9pt;
          font-style: italic;
          color: #777;
          margin-top: 2px;
          line-height: 1.2;
        }

        /* ── Multi-column rows ─────────────────────────────────────────── */
        .pf-row-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0 0.40in;
        }
        .pf-row-3 {
          display: grid;
          grid-template-columns: 0.9fr 0.9fr 1.2fr;
          gap: 0 0.35in;
        }

        /* ── Checkbox group (Purpose) ──────────────────────────────────── */
        .pf-checkbox-group {
          margin-bottom: 0.22in;
        }
        .pf-checkbox-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 0.16in 0.30in;
          padding: 0.05in 0;
        }
        .pf-checkbox {
          display: inline-flex;
          align-items: center;
          gap: 0.10in;
          font-size: 13pt;
          color: #000;
          line-height: 1.2;
        }
        .pf-checkbox-box {
          /* PAPER_FORM.checkbox.size — larger than half-sheet version
           * since full-letter has the room */
          display: inline-block;
          width: 0.26in;
          height: 0.26in;
          border: 2px solid #000;
          box-sizing: border-box;
          flex-shrink: 0;
          border-radius: 2px;
        }

        /* ── Notes (multi-line write area) ─────────────────────────────── */
        .pf-notes {
          margin-bottom: 0.20in;
        }
        .pf-notes-line {
          height: 0.50in;
          border-bottom: 2px solid #999;
        }
        .pf-notes-line + .pf-notes-line {
          margin-top: 0;
        }

        /* ── Footer / colophon ────────────────────────────────────────── */
        .pf-footer {
          margin-top: 0.40in;
          padding-top: 0.20in;
          border-top: 3px solid #1a7f3a;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.40in;
        }
        .pf-footer-org {
          flex: 1;
          font-size: 10pt;
          color: #000;
          line-height: 1.5;
        }
        .pf-footer-org strong {
          font-size: 11pt;
          font-weight: 800;
          display: block;
          margin-bottom: 2px;
        }
        .pf-footer-policy {
          flex: 1;
          font-size: 9pt;
          font-style: italic;
          color: #555;
          line-height: 1.4;
          text-align: right;
          padding-top: 2px;
        }

        /* ── Print mode ────────────────────────────────────────────────── */
        @media print {
          @page { size: letter portrait; margin: 0; }
          html, body { height: auto !important; margin: 0 !important; padding: 0 !important; }
          body { background: #fff !important; }

          /* Hide screen chrome */
          .slip-ctrl, .tippy-fab, .tippy-chat-panel,
          nav, aside, header, footer, [data-sidebar],
          [role="alert"], [data-banner], .transition-banner { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; max-width: none !important; }

          .slip-page {
            border: none;
            margin: 0;
            max-width: none;
          }
          .slip {
            margin: 0;
          }

          /* Force background colors so the green accent rules print */
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
          Full-letter intake form — one slip per page. Designed to feel like an
          organization&apos;s official document, with prominent branding, generous
          spacing, and accessibility-friendly typography (13pt body, 0.50&quot;
          write lines, 0.26&quot; checkboxes).
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
            Print Slip
          </Button>
        </div>

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
            <strong>One full-letter slip per page.</strong> Designed for big
            handwriting, photocopier survivability, and a professional feel.
            See{" "}
            <code style={{ fontSize: "0.72rem" }}>docs/PAPER_FORM_DESIGN.md</code>{" "}
            for the design language used in this and all future Atlas paper
            forms.
          </div>
        </div>
      </div>

      {/* ── Printable slip ── */}
      <div className="slip-page">
        <Slip
          orgName={orgDisplayName}
          tagline={tagline || "Trap-Neuter-Return for Sonoma County's community cats"}
          phone={orgPhone}
          website={website || ""}
          date={today}
          eq={equipment}
        />
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 *  Single slip — full-letter, branded
 * ─────────────────────────────────────────────────────────────────────── */

function Slip({
  orgName,
  tagline,
  phone,
  website,
  date,
  eq,
}: {
  orgName: string;
  tagline: string;
  phone: string;
  website: string;
  date: string;
  eq: ScannedEquipment | null;
}) {
  const equipmentDisplay = eq
    ? `${eq.display_name}${eq.barcode ? `   ·   ${eq.barcode}` : ""}`
    : null;

  return (
    <div className="slip">
      {/* ── Masthead ───────────────────────────────────────────────────── */}
      <div className="pf-masthead">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="pf-masthead-logo" src="/logo.png" alt={orgName} />
        <div className="pf-masthead-text">
          <h1 className="pf-masthead-org">{orgName}</h1>
          <div className="pf-masthead-tagline">{tagline}</div>
          <div className="pf-masthead-form-title">Equipment Checkout Form</div>
        </div>
        <div className="pf-masthead-meta">
          <div className="pf-masthead-meta-row">
            <span className="pf-masthead-meta-label">Date</span>
            <span className="pf-masthead-meta-value">{date}</span>
          </div>
          <div className="pf-masthead-meta-row">
            <span className="pf-masthead-meta-label">Slip&nbsp;#</span>
            <span className="pf-masthead-meta-value" />
          </div>
        </div>
      </div>

      {/* ── Caller Information ─────────────────────────────────────────── */}
      <div className="pf-section">
        <div className="pf-section-heading">Caller Information</div>

        <Field label="Name" />
        <div className="pf-row-2">
          <Field label="Phone" />
          <Field label="Email" helper="So we can confirm your booking and follow up" />
        </div>
        <Field
          label="Address"
          helper="Where the cats are being trapped"
        />
      </div>

      {/* ── Equipment ──────────────────────────────────────────────────── */}
      <div className="pf-section">
        <div className="pf-section-heading">Equipment</div>

        <Field
          label="Equipment / Barcode"
          value={equipmentDisplay}
          valueMono={!!equipmentDisplay}
        />

        <div className="pf-checkbox-group">
          <span className="pf-field-label">Purpose</span>
          <div className="pf-checkbox-grid">
            {["TNR", "Kitten", "Colony", "Feeding", "Pet", "Other"].map((p) => (
              <span key={p} className="pf-checkbox">
                <span className="pf-checkbox-box" />
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Checkout Details ───────────────────────────────────────────── */}
      <div className="pf-section">
        <div className="pf-section-heading">Checkout Details</div>

        <div className="pf-row-3">
          <Field label="Deposit $" />
          <Field label="Due Date" />
          <Field label="Staff" />
        </div>

        <div className="pf-notes">
          <span className="pf-field-label">Notes</span>
          <div className="pf-notes-line" />
          <div className="pf-notes-line" />
        </div>
      </div>

      {/* ── Footer / colophon ──────────────────────────────────────────── */}
      <div className="pf-footer">
        <div className="pf-footer-org">
          <strong>{orgName}</strong>
          1814 Empire Industrial Court, Suite F<br />
          Santa Rosa, CA 95404
          <br />
          {phone || "(707) 576-7999"}
          {website && (
            <>
              {" · "}
              {website.replace(/^https?:\/\//, "")}
            </>
          )}
        </div>
        <div className="pf-footer-policy">
          Please return by the due date listed above. Deposits are refunded
          on return when the equipment comes back in good condition.
          <br />
          Call us with any questions — we&apos;re happy to help.
        </div>
      </div>
    </div>
  );
}

/* Single field — label above, write line below */
function Field({
  label,
  value,
  valueMono,
  helper,
}: {
  label: string;
  value?: string | null;
  valueMono?: boolean;
  helper?: string;
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
      {helper && <span className="pf-field-helper">{helper}</span>}
    </div>
  );
}
