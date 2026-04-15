"use client";

import { useState, useCallback } from "react";
import { postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { KioskPersonAutosuggest, type PersonReference } from "@/components/kiosk/KioskPersonAutosuggest";
import { EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS } from "@/lib/form-options";

/**
 * Checkout Slip Batch Scanner
 *
 * FFS-1234. Upload scanned checkout slips (images), AI extracts the
 * fields, staff reviews + corrects, then one-click batch commit.
 *
 * Flow: Upload images → AI extraction → Review cards → Commit all
 */

interface ExtractedSlip {
  confidence: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  appointment_date: string | null;
  date_checked_out: string | null;
  barcode: string | null;
  equipment_description: string | null;
  purpose: string | null;
  deposit: string | null;
  due_date: string | null;
  staff_name: string | null;
  notes: string | null;
  additional_notes: string | null;
}

interface SlipEntry {
  id: string;
  imageDataUrl: string; // for preview
  extracting: boolean;
  extracted: ExtractedSlip | null;
  extractError: string | null;
  // Editable review fields
  person: PersonReference;
  barcode: string;
  purpose: string;
  depositAmount: string;
  checkoutDate: string;
  appointmentDate: string;
  address: string;
  phone: string;
  email: string;
  staffName: string;
  notes: string;
  // Commit state
  committed: boolean;
  commitError: string | null;
}

type Phase = "upload" | "review" | "done";

export default function ScanSlipsPage() {
  const toast = useToast();
  const { user: adminUser } = useCurrentUser();
  const { value: PURPOSE_DUE_OFFSET } = useAppConfig<Record<string, number>>("kiosk.purpose_due_offsets");

  const [phase, setPhase] = useState<Phase>("upload");
  const [committing, setCommitting] = useState(false);
  const [entries, setEntries] = useState<SlipEntry[]>([]);

  // Handle file selection (images + PDFs)
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const isPdf = file.type === "application/pdf";
      const isImage = file.type.startsWith("image/");

      if (!isPdf && !isImage) {
        toast.warning(`Skipped ${file.name} — use JPEG, PNG, or PDF.`);
        continue;
      }

      const dataUrl = await fileToDataUrl(file);
      const base64 = dataUrl.split(",")[1];

      if (isPdf) {
        // PDF: send the whole document to Claude — it handles multi-page natively
        const placeholderId = `slip-pdf-${Date.now()}`;
        const placeholder: SlipEntry = {
          id: placeholderId,
          imageDataUrl: "", // no preview for PDF
          extracting: true,
          extracted: null,
          extractError: null,
          person: { person_id: null, display_name: "", is_resolved: false },
          barcode: "",
          purpose: "",
          depositAmount: "50",
          checkoutDate: "",
          appointmentDate: "",
          address: "",
          phone: "",
          email: "",
          staffName: "",
          notes: "",
          committed: false,
          commitError: null,
        };
        setEntries((prev) => [...prev, placeholder]);
        setPhase("review");

        // Extract PDF — returns multiple slips for multi-page docs
        extractPdf(placeholderId, base64, file.name);
      } else {
        // Image: one slip per image
        const id = `slip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const entry: SlipEntry = {
          id,
          imageDataUrl: dataUrl,
          extracting: true,
          extracted: null,
          extractError: null,
          person: { person_id: null, display_name: "", is_resolved: false },
          barcode: "",
          purpose: "",
          depositAmount: "50",
          checkoutDate: "",
          appointmentDate: "",
          address: "",
          phone: "",
          email: "",
          staffName: "",
          notes: "",
          committed: false,
          commitError: null,
        };
        setEntries((prev) => [...prev, entry]);
        setPhase("review");
        extractSlip(id, base64, file.type);
      }
    }
  }, [toast]);

  // Extract a multi-page PDF — Claude handles all pages in one call
  const extractPdf = async (placeholderId: string, base64: string, filename: string) => {
    try {
      const result = await postApi<{ slips: ExtractedSlip[]; page_count: number }>(
        "/api/equipment/scan-slips/extract",
        { pdf: base64 },
      );
      const slips = result.slips || [];

      if (slips.length === 0) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === placeholderId
              ? { ...e, extracting: false, extractError: "No checkout slips found in PDF" }
              : e,
          ),
        );
        return;
      }

      // Replace the placeholder with one entry per extracted slip
      setEntries((prev) => {
        const without = prev.filter((e) => e.id !== placeholderId);
        const newEntries: SlipEntry[] = slips.map((slip, i) => ({
          id: `${placeholderId}-p${i + 1}`,
          imageDataUrl: "", // no per-page preview for PDF
          extracting: false,
          extracted: slip,
          extractError: null,
          person: {
            person_id: null,
            display_name: slip.name || "",
            is_resolved: false,
          },
          barcode: slip.barcode || "",
          purpose: mapPurpose(slip.purpose),
          depositAmount: slip.deposit || "50",
          checkoutDate: slip.date_checked_out || "",
          appointmentDate: slip.appointment_date || "",
          address: slip.address || "",
          phone: slip.phone || "",
          email: slip.email || "",
          staffName: slip.staff_name || "",
          notes: [slip.notes, slip.additional_notes].filter(Boolean).join(". "),
          committed: false,
          commitError: null,
        }));
        return [...without, ...newEntries];
      });

      toast.success(`Extracted ${slips.length} slip${slips.length !== 1 ? "s" : ""} from ${filename}`);
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === placeholderId
            ? {
                ...e,
                extracting: false,
                extractError: err instanceof Error ? err.message : "PDF extraction failed",
              }
            : e,
        ),
      );
    }
  };

  // Extract a single slip via the AI API
  const extractSlip = async (id: string, base64: string, mediaType: string) => {
    try {
      const result = await postApi<{ slip: ExtractedSlip }>(
        "/api/equipment/scan-slips/extract",
        { image: base64, media_type: mediaType },
      );
      const slip = result.slip;

      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                extracting: false,
                extracted: slip,
                // Pre-fill editable fields from extraction
                person: {
                  person_id: null,
                  display_name: slip.name || "",
                  is_resolved: false,
                },
                barcode: slip.barcode || "",
                purpose: mapPurpose(slip.purpose),
                depositAmount: slip.deposit || "50",
                checkoutDate: slip.date_checked_out || "",
                appointmentDate: slip.appointment_date || "",
                address: slip.address || "",
                phone: slip.phone || "",
                email: slip.email || "",
                staffName: slip.staff_name || "",
                notes: [slip.notes, slip.additional_notes]
                  .filter(Boolean)
                  .join(". "),
              }
            : e,
        ),
      );
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? {
                ...e,
                extracting: false,
                extractError:
                  err instanceof Error ? err.message : "Extraction failed",
              }
            : e,
        ),
      );
    }
  };

  // Update a single entry's field
  const updateEntry = (id: string, field: string, value: string | PersonReference) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, [field]: value } : e,
      ),
    );
  };

  // Remove an entry
  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (entries.length <= 1) setPhase("upload");
  };

  // Commit all entries
  const handleCommitAll = async () => {
    setCommitting(true);
    const toCommit = entries.filter((e) => !e.committed && e.barcode);

    for (const entry of toCommit) {
      try {
        // Look up equipment by barcode
        const equipLookup = await postApi<{ equipment_id?: string }>(
          "/api/equipment/scan-slips/commit",
          {
            barcode: entry.barcode,
            person_name: entry.person.display_name || entry.notes,
            person_id: entry.person.person_id || null,
            phone: entry.phone,
            email: entry.email,
            address: entry.address,
            purpose: entry.purpose,
            deposit_amount: parseFloat(entry.depositAmount) || 0,
            checkout_date: entry.checkoutDate,
            appointment_date: entry.appointmentDate,
            staff_name: entry.staffName,
            notes: entry.notes,
            actor_person_id: adminUser?.staff_id || null,
          },
        );

        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, committed: true, commitError: null } : e,
          ),
        );
      } catch (err) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id
              ? {
                  ...e,
                  commitError:
                    err instanceof Error ? err.message : "Commit failed",
                }
              : e,
          ),
        );
      }
    }

    setCommitting(false);
    setPhase("done");
    toast.success("Slips committed");
  };

  const allExtracting = entries.some((e) => e.extracting);
  const readyToCommit = entries.filter((e) => !e.committed && e.barcode && e.person.display_name).length;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
          <Icon name="scan-barcode" size={24} color="var(--primary)" />
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>Scan Checkout Slips</h1>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: 0 }}>
          Upload photos of completed checkout slips. AI reads the handwriting
          and extracts the data. Review, correct, and commit.
        </p>
      </div>

      {/* Upload area */}
      {(phase === "upload" || phase === "review") && (
        <div
          style={{
            border: "2px dashed var(--border)",
            borderRadius: 12,
            padding: "2rem",
            textAlign: "center",
            marginBottom: "1.5rem",
            background: "var(--card-bg)",
            cursor: "pointer",
          }}
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*,application/pdf";
            input.multiple = true;
            input.onchange = (e) => {
              const files = (e.target as HTMLInputElement).files;
              if (files) handleFiles(files);
            };
            input.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = "var(--primary)";
            e.currentTarget.style.background = "var(--primary-bg, rgba(59,130,246,0.04))";
          }}
          onDragLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.background = "var(--card-bg)";
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.background = "var(--card-bg)";
            if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
          }}
        >
          <Icon name="upload-cloud" size={40} color="var(--muted)" />
          <p style={{ fontSize: "1rem", fontWeight: 600, margin: "0.75rem 0 0.25rem" }}>
            Drop checkout slip photos here
          </p>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>
            or tap to select · JPEG / PNG / <strong>PDF</strong> (multi-page supported)
          </p>
        </div>
      )}

      {/* Review cards */}
      {entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {entries.map((entry) => (
            <SlipReviewCard
              key={entry.id}
              entry={entry}
              onUpdate={(field, value) => updateEntry(entry.id, field, value)}
              onRemove={() => removeEntry(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Action bar */}
      {entries.length > 0 && phase !== "done" && (
        <div
          style={{
            position: "sticky",
            bottom: 0,
            padding: "1rem 0",
            background: "var(--bg, #fff)",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "1rem",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            {entries.length} slip{entries.length !== 1 ? "s" : ""} ·{" "}
            {readyToCommit} ready to commit
            {allExtracting && " · extracting..."}
          </span>
          <Button
            variant="primary"
            size="lg"
            icon="check"
            loading={committing}
            disabled={readyToCommit === 0 || allExtracting}
            onClick={handleCommitAll}
            style={{
              background: "var(--success-text, #16a34a)",
              color: "#fff",
              border: "1px solid transparent",
            }}
          >
            Commit {readyToCommit} Slip{readyToCommit !== 1 ? "s" : ""}
          </Button>
        </div>
      )}

      {/* Done state */}
      {phase === "done" && (
        <div style={{ textAlign: "center", padding: "2rem", marginTop: "1rem" }}>
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              setEntries([]);
              setPhase("upload");
            }}
          >
            Scan More Slips
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Review card for a single slip ────────────────────────────────────────────

function SlipReviewCard({
  entry,
  onUpdate,
  onRemove,
}: {
  entry: SlipEntry;
  onUpdate: (field: string, value: string | PersonReference) => void;
  onRemove: () => void;
}) {
  const statusColor = entry.committed
    ? "var(--success-text)"
    : entry.commitError
      ? "var(--danger-text)"
      : entry.extractError
        ? "var(--danger-text)"
        : entry.extracting
          ? "var(--info-text)"
          : "var(--text-primary)";

  const statusBg = entry.committed
    ? "var(--success-bg)"
    : entry.commitError
      ? "var(--danger-bg)"
      : entry.extractError
        ? "var(--danger-bg)"
        : entry.extracting
          ? "var(--info-bg)"
          : "var(--card-bg)";

  return (
    <div
      style={{
        border: `1.5px solid ${entry.committed ? "var(--success-border)" : "var(--card-border)"}`,
        borderRadius: 12,
        overflow: "hidden",
        background: statusBg,
        opacity: entry.committed ? 0.7 : 1,
      }}
    >
      {/* Header with image preview + status */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          padding: "0.75rem",
          borderBottom: "1px solid var(--card-border)",
          background: "var(--card-bg)",
        }}
      >
        {/* Thumbnail (image) or PDF icon (no preview) */}
        {entry.imageDataUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={entry.imageDataUrl}
            alt="Slip scan"
            style={{
              width: 80,
              height: 100,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid var(--card-border)",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 80,
              height: 100,
              borderRadius: 6,
              border: "1px solid var(--card-border)",
              background: "var(--muted-bg, #f3f4f6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon name="file-text" size={28} color="var(--muted)" />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {entry.extracting && (
            <div style={{ color: "var(--info-text)", fontSize: "0.85rem", fontWeight: 600 }}>
              <Icon name="zap" size={14} color="var(--info-text)" /> Reading handwriting...
            </div>
          )}
          {entry.extractError && (
            <div style={{ color: "var(--danger-text)", fontSize: "0.85rem" }}>
              {entry.extractError}
            </div>
          )}
          {entry.committed && (
            <div style={{ color: "var(--success-text)", fontSize: "0.85rem", fontWeight: 700 }}>
              <Icon name="check-circle" size={14} /> Committed
            </div>
          )}
          {entry.commitError && (
            <div style={{ color: "var(--danger-text)", fontSize: "0.85rem" }}>
              {entry.commitError}
            </div>
          )}
          {!entry.extracting && !entry.extractError && !entry.committed && entry.extracted && (
            <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              Confidence: {Math.round((entry.extracted.confidence || 0) * 100)}%
              {entry.barcode && <> · Barcode: <strong>{entry.barcode}</strong></>}
            </div>
          )}
        </div>

        {!entry.committed && (
          <button
            onClick={onRemove}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted)",
              padding: "0.25rem",
              flexShrink: 0,
            }}
          >
            <Icon name="x" size={18} />
          </button>
        )}
      </div>

      {/* Editable fields (only show after extraction, before commit) */}
      {!entry.extracting && !entry.committed && entry.extracted && (
        <div
          style={{
            padding: "0.75rem",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.625rem",
          }}
        >
          {/* Name (full width) */}
          <div style={{ gridColumn: "1 / -1" }}>
            <FieldLabel>Name *</FieldLabel>
            <KioskPersonAutosuggest
              value={entry.person}
              onChange={(ref) => onUpdate("person", ref)}
              placeholder="Borrower name..."
            />
          </div>

          {/* Barcode + Purpose */}
          <div>
            <FieldLabel>Barcode *</FieldLabel>
            <FieldInput
              value={entry.barcode}
              onChange={(v) => onUpdate("barcode", v)}
              placeholder="4 digits"
              mono
            />
          </div>
          <div>
            <FieldLabel>Purpose</FieldLabel>
            <select
              value={entry.purpose}
              onChange={(e) => onUpdate("purpose", e.target.value)}
              style={selectStyle}
            >
              <option value="">Select...</option>
              {(EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS as readonly { value: string; label: string }[]).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Phone + Email */}
          <div>
            <FieldLabel>Phone</FieldLabel>
            <FieldInput value={entry.phone} onChange={(v) => onUpdate("phone", v)} placeholder="Phone" />
          </div>
          <div>
            <FieldLabel>Email</FieldLabel>
            <FieldInput value={entry.email} onChange={(v) => onUpdate("email", v)} placeholder="Email" />
          </div>

          {/* Address (full width) */}
          <div style={{ gridColumn: "1 / -1" }}>
            <FieldLabel>Address</FieldLabel>
            <FieldInput value={entry.address} onChange={(v) => onUpdate("address", v)} placeholder="Where equipment will be used" />
          </div>

          {/* Dates + deposit */}
          <div>
            <FieldLabel>Checked Out</FieldLabel>
            <FieldInput value={entry.checkoutDate} onChange={(v) => onUpdate("checkoutDate", v)} placeholder="MM/DD/YY" />
          </div>
          <div>
            <FieldLabel>Appt Date</FieldLabel>
            <FieldInput value={entry.appointmentDate} onChange={(v) => onUpdate("appointmentDate", v)} placeholder="MM/DD/YY" />
          </div>
          <div>
            <FieldLabel>Deposit $</FieldLabel>
            <FieldInput value={entry.depositAmount} onChange={(v) => onUpdate("depositAmount", v)} placeholder="50" />
          </div>
          <div>
            <FieldLabel>Staff</FieldLabel>
            <FieldInput value={entry.staffName} onChange={(v) => onUpdate("staffName", v)} placeholder="Staff name/initials" />
          </div>

          {/* Notes (full width) */}
          <div style={{ gridColumn: "1 / -1" }}>
            <FieldLabel>Notes</FieldLabel>
            <FieldInput value={entry.notes} onChange={(v) => onUpdate("notes", v)} placeholder="Any additional notes" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "block",
        fontSize: "0.7rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--text-secondary)",
        marginBottom: "0.2rem",
      }}
    >
      {children}
    </label>
  );
}

function FieldInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        padding: "0.4rem 0.6rem",
        border: "1px solid var(--card-border)",
        borderRadius: 6,
        fontSize: "0.85rem",
        outline: "none",
        fontFamily: mono ? "monospace" : "inherit",
        fontWeight: mono ? 700 : 400,
        boxSizing: "border-box",
      }}
    />
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.4rem 0.6rem",
  border: "1px solid var(--card-border)",
  borderRadius: 6,
  fontSize: "0.85rem",
  outline: "none",
  appearance: "auto",
  boxSizing: "border-box",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Map extracted purpose text to our enum values */
function mapPurpose(raw: string | null): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("ffr") || lower.includes("appt")) return "ffr";
  if (lower.includes("feed")) return "well_check";
  if (lower.includes("transport")) return "transport";
  if (lower.includes("rescue") || lower.includes("relo")) return "rescue_recovery";
  if (lower.includes("train")) return "trap_training";
  return "ffr"; // default
}
