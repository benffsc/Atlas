"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useOrgConfig } from "@/hooks/useOrgConfig";

/**
 * Equipment QR Label Print Sheet
 *
 * FFS-1226. Generates a sheet of QR code labels for equipment items.
 * Each label has: QR code (links to kiosk scan page), barcode number,
 * equipment type, and org name. Designed for weatherproof sticker sheets
 * (Avery 5160 / 30-up layout or similar).
 *
 * Per HumanePro/HSUS: "Operation Catnip places QR codes on weatherproof
 * stickers on traps. Staff scan with smartphones during checkouts and
 * returns." Per FCCO: "Assigns bar codes to 300 traps, prints and
 * laminates them, attaches via zip tie."
 */

interface EquipmentItem {
  equipment_id: string;
  barcode: string | null;
  display_name: string;
  type_display_name: string | null;
  custody_status: string;
}

const KIOSK_BASE_URL = typeof window !== "undefined"
  ? `${window.location.origin}/kiosk/equipment/scan`
  : "/kiosk/equipment/scan";

function qrUrl(barcode: string): string {
  const target = `${KIOSK_BASE_URL}?barcode=${encodeURIComponent(barcode)}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(target)}`;
}

export default function EquipmentLabelsPage() {
  const { nameShort } = useOrgConfig();
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "available" | "checked_out">("all");

  useEffect(() => {
    fetchApi<{ equipment: EquipmentItem[] }>("/api/equipment?limit=300")
      .then((data) => setItems(data.equipment || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter((item) => {
    if (!item.barcode) return false;
    if (filter === "all") return true;
    return item.custody_status === filter;
  });

  const org = nameShort || "FFSC";

  return (
    <>
      <style jsx global>{`
        .label-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0;
          width: 8.5in;
          margin: 0 auto;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }
        .label {
          width: 2.625in;
          height: 1in;
          box-sizing: border-box;
          padding: 0.06in 0.08in;
          display: flex;
          align-items: center;
          gap: 0.08in;
          border: 0.5px dashed #ccc;
          overflow: hidden;
        }
        .label-qr {
          width: 0.8in;
          height: 0.8in;
          flex-shrink: 0;
        }
        .label-qr img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .label-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 1px;
        }
        .label-barcode {
          font-size: 18pt;
          font-weight: 800;
          font-family: 'Courier New', Courier, monospace;
          letter-spacing: 0.1em;
          color: #000;
          line-height: 1;
        }
        .label-type {
          font-size: 6pt;
          color: #555;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .label-org {
          font-size: 5.5pt;
          font-weight: 700;
          color: #1a7f3a;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          line-height: 1;
        }

        @media print {
          @page { size: letter portrait; margin: 0.5in 0.19in; }
          body { background: #fff !important; }
          .label-ctrl, .tippy-fab, .tippy-chat-panel,
          nav, aside, header, footer, [data-sidebar],
          [role="alert"], [data-banner], .transition-banner { display: none !important; }
          main { margin: 0 !important; padding: 0 !important; max-width: none !important; }
          .label { border: none; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Screen controls */}
      <div className="label-ctrl" style={{ maxWidth: "8.5in", margin: "0 auto", padding: "1.5rem 1rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <Icon name="qr-code" size={24} color="var(--primary)" />
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Equipment QR Labels</h1>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
          Print on Avery 5160 or similar 30-up label sheets (1&quot; × 2⅝&quot;).
          Each label has a QR code that opens the kiosk scan page with the barcode pre-filled.
          Attach to equipment with a zip tie or weatherproof adhesive.
        </p>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
          <Button variant="primary" icon="printer" onClick={() => window.print()}>
            Print Labels
          </Button>
          <label style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.85rem" }}>
            Show:
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              style={{ padding: "0.25rem 0.5rem", borderRadius: 6, border: "1px solid var(--card-border)" }}
            >
              <option value="all">All ({items.filter((i) => i.barcode).length})</option>
              <option value="available">Available ({items.filter((i) => i.barcode && i.custody_status === "available").length})</option>
              <option value="checked_out">Checked Out ({items.filter((i) => i.barcode && i.custody_status === "checked_out").length})</option>
            </select>
          </label>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            {filtered.length} label{filtered.length !== 1 ? "s" : ""} · {Math.ceil(filtered.length / 30)} page{Math.ceil(filtered.length / 30) !== 1 ? "s" : ""}
          </span>
        </div>

        {loading && <div style={{ color: "var(--muted)", padding: "2rem", textAlign: "center" }}>Loading equipment...</div>}
      </div>

      {/* Printable label grid */}
      {!loading && filtered.length > 0 && (
        <div className="label-grid">
          {filtered.map((item) => (
            <div key={item.equipment_id} className="label">
              <div className="label-qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrUrl(item.barcode!)}
                  alt={`QR ${item.barcode}`}
                  loading="lazy"
                />
              </div>
              <div className="label-info">
                <div className="label-barcode">{item.barcode}</div>
                <div className="label-type">{item.type_display_name || item.display_name}</div>
                <div className="label-org">{org}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          No equipment with barcodes found.
        </div>
      )}
    </>
  );
}
