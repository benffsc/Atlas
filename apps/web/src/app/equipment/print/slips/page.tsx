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
 * Checkout slips — two half-sheets per page (portrait).
 * Clients fill in their info, staff enters it into the system later.
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
        /*
         * Layout math (2 slips per letter portrait page):
         * - Letter portrait: 8.5" × 11"
         * - Browser default margins: ~0.4" each side → printable area ~10.2" tall
         * - Each slip is 5.0" tall → 2 slips = 10.0" → fits comfortably even
         *   without explicitly setting Margins: None in the print dialog
         * - Slip width is full letter width (8.5") so it can use the natural
         *   printable area regardless of browser margin settings
         *
         * Previously slips were 5.5" tall which made 2 slips = 11.0" — exactly
         * matching the page height with ZERO room for browser print margins,
         * so the second slip always spilled to page 2. (Trap 0106 audit prep
         * 2026-04-08.)
         */
        .slip-page {
          width: 8.5in; margin: 1rem auto; background: #fff;
          border: 1px solid var(--card-border, #e5e7eb);
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }
        .slip {
          width: 8.5in; height: 5.0in; box-sizing: border-box;
          padding: 0.2in 0.4in 0.18in; position: relative; overflow: hidden;
          page-break-inside: avoid; break-inside: avoid;
        }
        .slip + .slip { border-top: 2px dashed #bbb; }
        .slip-page { page-break-after: always; break-after: page; }

        .slip-hdr {
          display: flex; justify-content: space-between; align-items: flex-end;
          border-bottom: 2.5px solid #16a34a; padding-bottom: 2px; margin-bottom: 4px;
        }
        .slip-hdr h1 { font-size: 12pt; font-weight: 700; margin: 0; }
        .slip-hdr .meta { font-size: 7pt; color: #666; text-align: right; }
        .slip-hdr img { height: 26px; margin-left: 6px; }

        .slip-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px;
        }

        .sf {
          border-bottom: 1px solid #ccc; padding: 0; margin-bottom: 4px;
          min-height: 19px; display: flex; align-items: flex-end;
        }
        .sf-lbl {
          font-size: 6.5pt; font-weight: 700; color: #16a34a;
          text-transform: uppercase; letter-spacing: 0.4px; white-space: nowrap;
          margin-right: 6px; padding-bottom: 1px; flex-shrink: 0;
        }
        .sf-val { font-size: 9pt; font-weight: 500; flex: 1; padding-bottom: 1px; }
        .sf.full { grid-column: 1 / -1; }
        .sf.xl { min-height: 26px; }

        .sf-cbs {
          display: flex; gap: 11px; flex-wrap: wrap; align-items: center;
          font-size: 7.5pt; padding: 1px 0;
        }
        .sf-cb { display: inline-flex; align-items: center; gap: 3px; }
        .sf-box {
          display: inline-block; width: 10px; height: 10px;
          border: 1.5px solid #333; border-radius: 2px;
        }

        .sf-sec {
          font-size: 6.5pt; font-weight: 800; color: #888;
          text-transform: uppercase; letter-spacing: 0.6px;
          margin: 5px 0 2px; grid-column: 1 / -1;
          border-bottom: 1px solid #eee; padding-bottom: 1px;
        }

        .slip-staff-box {
          margin-top: 3px; padding: 3px 8px;
          border: 1.5px solid #ddd; border-radius: 4px;
          background: #fafafa; grid-column: 1 / -1;
          display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 16px;
        }
        .slip-staff-box .sf { border-color: #ddd; margin-bottom: 1px; min-height: 16px; }
        .slip-staff-box .sf-lbl { color: #999; font-size: 6pt; }

        .slip-ft {
          position: absolute; bottom: 0.1in; left: 0.4in; right: 0.4in;
          display: flex; justify-content: space-between;
          font-size: 6pt; color: #aaa;
        }
        .slip-ft-cut {
          position: absolute; top: -1px; left: -0.4in;
          font-size: 10pt; color: #bbb; transform: translateY(-50%);
        }

        @media print {
          /* @page margin: 0 is honored when the user picks "Margins: None" in
           * the print dialog. With Chrome's default margins (~0.4in), the
           * page-default takes precedence, but the .slip-page flex centering
           * below makes the slips center themselves within whatever printable
           * area the browser provides. */
          @page { size: letter portrait; margin: 0; }
          /* html + body need an explicit height for the slip-page's
           * 100vh / flex-column-center to actually fill the page. Without
           * these the slip-page collapses to its content height and the
           * vertical centering doesn't take effect. */
          html, body { height: 100% !important; margin: 0 !important; padding: 0 !important; }
          body { background: #fff !important; }
          .slip-ctrl, .tippy-fab, .tippy-chat-panel,
          nav, aside, header, footer, [data-sidebar],
          [role="alert"], [data-banner], .transition-banner { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; max-width: none !important; }

          /* Vertical centering for guillotine alignment.
           *
           * The 10in of slip content needs to sit DEAD CENTER on the 11in
           * letter page so the dashed border between slip 1 and slip 2
           * lands at exactly 5.5in from the top edge of the paper. That way,
           * when Ben cuts on the guillotine at the paper midline, both halves
           * come out the same height and stack cleanly.
           *
           * height: 100vh + flex-column + justify-content: center makes the
           * slip-page fill the printable area and center its children
           * vertically, regardless of whether browser margins are 0 (Margins:
           * None) or ~0.4in default. The dashed cut border lands at the
           * midline either way.
           *
           * For the 1-slip case, the single slip also centers — staff still
           * cuts at the paper midline if they want to trim the bottom blank
           * area, and the slip is balanced left/right and top/bottom on the
           * sheet. */
          .slip-page {
            border: none;
            margin: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }

          /* Force browser to print background colors (the green header line,
           * the gray staff box) so slips look the same as the screen preview. */
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
          Half-sheet forms — hand one to each person at checkout.
        </p>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 10, padding: "0.75rem 1rem", alignItems: "center" }}>
          <input
            type="text" value={barcode}
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

        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <Button variant="primary" icon="printer" onClick={() => window.print()}>Print Slips</Button>
          <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.85rem" }}>
            Per page:
            <select value={copies} onChange={(e) => setCopies(Number(e.target.value))} style={{ padding: "0.25rem 0.5rem", borderRadius: 6, border: "1px solid var(--card-border)" }}>
              <option value={1}>1 slip</option>
              <option value={2}>2 slips</option>
            </select>
          </label>
        </div>

        {/* Print tip — helps staff get a clean 2-up layout */}
        {copies === 2 && (
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
              alignItems: "center",
              gap: "0.5rem",
              lineHeight: 1.4,
            }}
          >
            <Icon name="help-circle" size={14} color="var(--info-text, #1d4ed8)" />
            <span>
              <strong>Tip:</strong> Slips are vertically centered so the dashed
              cut line lands at exactly the paper midpoint — guillotine cut at
              5.5&quot; from the top edge and both halves stack cleanly. If
              anything looks off, set <strong>Margins → None</strong> and{" "}
              <strong>Scale → Default</strong> in the print dialog.
            </span>
          </div>
        )}
      </div>

      {/* ── Printable slips ── */}
      <div className="slip-page">
        {Array.from({ length: slipCount }).map((_, i) => (
          <Slip key={i} org={nameShort || "FFSC"} phone={orgPhone} date={today} eq={equipment} cut={i > 0} fmt={fmtCondition} />
        ))}
      </div>
    </>
  );
}

/* ── Single slip ── */

function Slip({ org, phone, date, eq, cut, fmt }: {
  org: string; phone: string; date: string;
  eq: ScannedEquipment | null; cut: boolean;
  fmt: (s: string) => string;
}) {
  return (
    <div className="slip">
      {/* Header */}
      <div className="slip-hdr">
        <h1>{org} — Equipment Checkout</h1>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
          <div className="meta">{date}</div>
          <img src="/logo.png" alt="" />
        </div>
      </div>

      <div className="slip-grid">
        {/* ── YOUR INFORMATION ── */}
        <div className="sf-sec">Your Information (please print clearly)</div>
        <F label="First Name" />
        <F label="Last Name" />
        <F label="Phone" />
        <F label="Email" />
        <F label="Address (where trapping)" full />
        <F label="City / ZIP" />
        <F label="Appointment Date" />

        {/* ── EQUIPMENT ── */}
        <div className="sf-sec">Equipment</div>
        <F label="Equipment" val={eq?.display_name} />
        <F label="Barcode" val={eq?.barcode || undefined} mono />

        {/* Type — staff circles one */}
        <div className="sf full">
          <span className="sf-lbl">Type:</span>
          <div className="sf-cbs">
            {["Public", "Trapper", "Foster", "Relo", "Clinic"].map((t) => (
              <span key={t} className="sf-cb"><span className="sf-box" /> {t}</span>
            ))}
          </div>
        </div>

        {/* Condition — circle one */}
        <div className="sf full">
          <span className="sf-lbl">Condition Out:</span>
          <div className="sf-cbs">
            {["New", "Good", "Fair", "Poor", "Damaged"].map((c) => (
              <span key={c} className="sf-cb"><span className="sf-box" /> {c}</span>
            ))}
          </div>
        </div>

        {/* ── DETAILS ── */}
        <div className="sf-sec">Details</div>
        <F label="Deposit $" />
        <F label="Due Date" />
        <F label="Notes" full xl />

        {/* ── STAFF USE ── */}
        <div className="slip-staff-box">
          <div className="sf full" style={{ marginBottom: 4 }}>
            <span className="sf-lbl">Purpose:</span>
            <div className="sf-cbs">
              {["TNR", "Kitten", "Colony", "Feeding", "Pet", "Other"].map((p) => (
                <span key={p} className="sf-cb"><span className="sf-box" /> {p}</span>
              ))}
            </div>
          </div>
          <F label="Staff" />
          <F label="Entered" />
          <F label="Deposit Returned" />
        </div>
      </div>

      {/* Footer */}
      <div className="slip-ft">
        {cut && <span className="slip-ft-cut">✂</span>}
        <span>Return by due date. Call {phone} with questions.</span>
        <span>Deposits refunded on return in good condition.</span>
      </div>
    </div>
  );
}

function F({ label, val, full, xl, mono }: {
  label: string; val?: string; full?: boolean; xl?: boolean; mono?: boolean;
}) {
  return (
    <div className={`sf${full ? " full" : ""}${xl ? " xl" : ""}`}>
      <span className="sf-lbl">{label}:</span>
      {val && <span className="sf-val" style={mono ? { fontFamily: "monospace", fontWeight: 600 } : undefined}>{val}</span>}
    </div>
  );
}
