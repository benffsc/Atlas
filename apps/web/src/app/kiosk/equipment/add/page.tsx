"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useFormAutoSave } from "@/hooks/useFormAutoSave";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { KioskPhotoCapture } from "@/components/kiosk/KioskPhotoCapture";
import { EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";
import { getCategoryStyle } from "@/lib/equipment-styles";
import { KioskCard } from "@/components/kiosk/KioskCard";
import { kioskLabelStyle as labelStyle, kioskInputStyle as inputStyle } from "@/components/kiosk/kiosk-styles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EquipmentType {
  type_key: string;
  display_name: string;
  category: string;
  manufacturer: string;
  is_active: boolean;
  sort_order: number;
  item_count: number;
}

interface EquipmentStats {
  next_barcode: string;
}

interface CreatedEquipment {
  id: string;
  barcode: string;
  equipment_name: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_STEPS = 5;

const STEP_LABELS = ["Category", "Type", "Details", "Photo", "Review"];

const CATEGORIES = [
  { key: "trap", label: "Trap", icon: "box" },
  { key: "cage", label: "Cage", icon: "grid-3x3" },
  { key: "camera", label: "Camera", icon: "camera" },
  { key: "accessory", label: "Accessory", icon: "package-plus" },
] as const;


// ---------------------------------------------------------------------------
// Selection Context — shows what the user has picked so far
// ---------------------------------------------------------------------------

function SelectionContext({
  category,
  typeName,
}: {
  category: string | null;
  typeName?: string | null;
}) {
  if (!category) return null;
  const catLabel = CATEGORIES.find((c) => c.key === category)?.label ?? category;
  const catIcon = CATEGORIES.find((c) => c.key === category)?.icon ?? "box";
  const catStyle = getCategoryStyle(category);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        padding: "0 1.25rem",
        marginBottom: "0.75rem",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          padding: "0.2rem 0.6rem",
          borderRadius: "6px",
          fontSize: "0.75rem",
          fontWeight: 600,
          background: catStyle.bg,
          color: catStyle.text,
          border: `1px solid ${catStyle.border}`,
        }}
      >
        <Icon name={catIcon} size={12} color={catStyle.text} />
        {catLabel}
      </span>
      {typeName && (
        <>
          <Icon name="chevron-right" size={12} color="var(--text-secondary)" />
          <span
            style={{
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "var(--text-secondary)",
            }}
          >
            {typeName}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Indicator — with step labels
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ padding: "1rem 1.25rem 0.75rem" }}>
      {/* Step dots with labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "0.5rem",
        }}
      >
        {STEP_LABELS.map((label, i) => {
          const stepNum = i + 1;
          const isActive = stepNum === current;
          const isComplete = stepNum < current;
          return (
            <div
              key={label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.25rem",
                flex: 1,
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  background: isActive
                    ? "var(--primary)"
                    : isComplete
                      ? "var(--success-bg)"
                      : "var(--bg-secondary, #f3f4f6)",
                  color: isActive
                    ? "var(--primary-foreground, #fff)"
                    : isComplete
                      ? "var(--success-text)"
                      : "var(--text-secondary)",
                  border: isActive
                    ? "2px solid var(--primary)"
                    : isComplete
                      ? "2px solid var(--success-border)"
                      : "2px solid var(--card-border)",
                  transition: "all 200ms ease",
                }}
              >
                {isComplete ? (
                  <Icon name="check" size={12} color="var(--success-text)" />
                ) : (
                  stepNum
                )}
              </div>
              <span
                style={{
                  fontSize: "0.6rem",
                  fontWeight: isActive ? 700 : 500,
                  color: isActive
                    ? "var(--primary)"
                    : isComplete
                      ? "var(--success-text)"
                      : "var(--text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  transition: "color 200ms ease",
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
      {/* Progress bar */}
      <div
        style={{
          height: 3,
          borderRadius: 2,
          background: "var(--card-border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${(current / total) * 100}%`,
            background: "var(--primary)",
            borderRadius: 2,
            transition: "width 300ms ease",
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Category
// ---------------------------------------------------------------------------

function StepCategory({
  onSelect,
}: {
  onSelect: (category: string) => void;
}) {
  return (
    <div style={{ padding: "0 1.25rem 1.25rem" }}>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        Select Category
      </h2>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1.25rem" }}>
        What kind of equipment are you adding?
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        {CATEGORIES.map((cat) => {
          const catStyle = getCategoryStyle(cat.key);
          return (
            <button
              key={cat.key}
              onClick={() => onSelect(cat.key)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                height: 120,
                background: "var(--background, #fff)",
                border: `2px solid var(--card-border)`,
                borderRadius: 12,
                cursor: "pointer",
                transition: "border-color 150ms ease, background 150ms ease, box-shadow 150ms ease",
                minHeight: 48,
                padding: 12,
                WebkitTapHighlightColor: "transparent",
              }}
              onPointerDown={(e) => {
                const el = e.currentTarget;
                el.style.borderColor = catStyle.text;
                el.style.background = catStyle.bg;
                el.style.boxShadow = "var(--shadow-sm)";
              }}
              onPointerUp={(e) => {
                const el = e.currentTarget;
                el.style.borderColor = "var(--card-border)";
                el.style.background = "var(--background, #fff)";
                el.style.boxShadow = "none";
              }}
              onPointerLeave={(e) => {
                const el = e.currentTarget;
                el.style.borderColor = "var(--card-border)";
                el.style.background = "var(--background, #fff)";
                el.style.boxShadow = "none";
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: catStyle.bg,
                  border: `1px solid ${catStyle.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name={cat.icon} size={24} color={catStyle.text} />
              </div>
              <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-primary)" }}>
                {cat.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Type
// ---------------------------------------------------------------------------

function StepType({
  category,
  onSelect,
  onBack,
}: {
  category: string;
  onSelect: (type: EquipmentType) => void;
  onBack: () => void;
}) {
  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchApi<{ types: EquipmentType[] }>("/api/equipment/types")
      .then((data) => {
        if (cancelled) return;
        const all = data.types || [];
        const filtered = all
          .filter((t) => t.category === category && t.is_active)
          .sort((a, b) => a.sort_order - b.sort_order);
        setTypes(filtered);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load equipment types");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category]);

  const categoryLabel = CATEGORIES.find((c) => c.key === category)?.label ?? category;

  return (
    <div style={{ padding: "0 1.25rem 1.25rem" }}>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        Select Type
      </h2>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1.25rem" }}>
        Choose a {categoryLabel.toLowerCase()} type
      </p>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 56,
                background: "var(--bg-secondary)",
                borderRadius: 10,
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: 16,
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            borderRadius: 10,
            color: "var(--danger-text)",
            fontSize: "0.875rem",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && types.length === 0 && (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
          }}
        >
          No active types found for this category.
        </div>
      )}

      {!loading && !error && types.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {types.map((t) => (
            <button
              key={t.type_key}
              onClick={() => onSelect(t)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 16px",
                minHeight: 56,
                background: "var(--background, #fff)",
                border: "2px solid var(--card-border)",
                borderRadius: 10,
                cursor: "pointer",
                transition: "border-color 150ms ease",
                textAlign: "left",
                WebkitTapHighlightColor: "transparent",
              }}
              onPointerDown={(e) => {
                e.currentTarget.style.borderColor = "var(--primary)";
              }}
              onPointerUp={(e) => {
                e.currentTarget.style.borderColor = "var(--card-border)";
              }}
              onPointerLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--card-border)";
              }}
            >
              <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-primary)" }}>
                {t.display_name}
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  padding: "2px 10px",
                  borderRadius: 99,
                  background: "var(--bg-secondary)",
                  color: "var(--text-secondary)",
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                {t.item_count}
              </span>
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <Button variant="ghost" fullWidth onClick={onBack} style={{ minHeight: 48, borderRadius: 12 }}>
          Back
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Details
// ---------------------------------------------------------------------------

interface DetailsData {
  barcode: string;
  equipment_name: string;
  condition_status: string;
  notes: string;
}

function StepDetails({
  onNext,
  onBack,
  initial,
}: {
  onNext: (data: DetailsData) => void;
  onBack: () => void;
  initial: DetailsData;
}) {
  const [barcode, setBarcode] = useState(initial.barcode);
  const [equipmentName, setEquipmentName] = useState(initial.equipment_name);
  const [condition, setCondition] = useState(initial.condition_status);
  const [notes, setNotes] = useState(initial.notes);

  const [suggestedBarcode, setSuggestedBarcode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchApi<EquipmentStats>("/api/equipment/stats")
      .then((stats) => {
        if (!cancelled) setSuggestedBarcode(stats.next_barcode);
      })
      .catch(() => {
        // Non-critical — just won't show suggestion
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = () => {
    onNext({
      barcode: barcode.trim(),
      equipment_name: equipmentName.trim(),
      condition_status: condition,
      notes: notes.trim(),
    });
  };

  return (
    <div style={{ padding: "0 1.25rem 1.25rem" }}>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        Equipment Details
      </h2>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1.25rem" }}>
        Enter details for the new item
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* Barcode */}
        <div>
          <label style={labelStyle}>Barcode</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder={suggestedBarcode ?? "0000"}
            style={{ ...inputStyle, fontFamily: "monospace", letterSpacing: "0.1em" }}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 4 }}>
            Enter 4-digit barcode from label.
            {suggestedBarcode && (
              <span> Next available: <strong style={{ fontFamily: "monospace" }}>{suggestedBarcode}</strong></span>
            )}
          </div>
        </div>

        {/* Equipment Name */}
        <div>
          <label style={labelStyle}>Equipment Name <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
          <input
            type="text"
            value={equipmentName}
            onChange={(e) => setEquipmentName(e.target.value)}
            placeholder="Auto-generated if blank"
            style={inputStyle}
          />
        </div>

        {/* Condition */}
        <div>
          <label style={labelStyle}>Condition</label>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            style={{
              ...inputStyle,
              cursor: "pointer",
              appearance: "auto" as const,
            }}
          >
            {EQUIPMENT_CONDITION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label style={labelStyle}>Notes <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional notes..."
            rows={3}
            style={{
              ...inputStyle,
              resize: "vertical",
              fontFamily: "inherit",
              minHeight: 80,
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
        <Button
          variant="primary"
          fullWidth
          onClick={handleSubmit}
          style={{ minHeight: 56, borderRadius: 12 }}
        >
          Next
        </Button>
        <Button variant="ghost" fullWidth onClick={onBack} style={{ minHeight: 48, borderRadius: 12 }}>
          Back
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Photo (optional)
// ---------------------------------------------------------------------------

function StepPhoto({
  photoFile,
  photoPreviewUrl,
  onFileChange,
  onNext,
  onBack,
}: {
  photoFile: File | null;
  photoPreviewUrl: string | null;
  onFileChange: (file: File | null) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div style={{ padding: "0 1.25rem 1.25rem" }}>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        Equipment Photo
      </h2>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1.25rem" }}>
        Take a photo to help identify this item later
      </p>

      <KioskPhotoCapture
        value={photoPreviewUrl}
        onChange={onFileChange}
        label="Photo"
        helperText="Optional — helps identify this item at a glance"
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
        <Button
          variant="primary"
          fullWidth
          icon={photoFile ? "arrow-right" : "skip-forward"}
          onClick={onNext}
          style={{ minHeight: 56, borderRadius: 12 }}
        >
          {photoFile ? "Next" : "Skip"}
        </Button>
        <Button variant="ghost" fullWidth onClick={onBack} style={{ minHeight: 48, borderRadius: 12 }}>
          Back
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Confirm
// ---------------------------------------------------------------------------

function StepConfirm({
  category,
  type,
  details,
  photoFile,
  photoPreviewUrl,
  onBack,
  onCreated,
}: {
  category: string;
  type: EquipmentType;
  details: DetailsData;
  photoFile: File | null;
  photoPreviewUrl: string | null;
  onBack: () => void;
  onCreated?: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedEquipment | null>(null);

  const categoryLabel = CATEGORIES.find((c) => c.key === category)?.label ?? category;

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const result = await postApi<CreatedEquipment>("/api/equipment", {
        equipment_type_key: type.type_key,
        barcode: details.barcode || undefined,
        equipment_name: details.equipment_name || undefined,
        condition_status: details.condition_status,
        notes: details.notes || undefined,
      });

      // Upload photo if captured
      if (photoFile) {
        try {
          const formData = new FormData();
          formData.append("file", photoFile);
          await fetch(`/api/equipment/${result.id}/photo`, {
            method: "POST",
            body: formData,
          });
        } catch {
          // Photo upload failure is non-blocking — equipment was already created
          toast.warning("Equipment created but photo upload failed");
        }
      }

      setCreated(result);
      onCreated?.();
      toast.success("Equipment created successfully");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create equipment";
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }, [type, details, photoFile, toast, onCreated]);

  // Success state
  if (created) {
    return (
      <div
        style={{
          padding: "1.5rem 1.25rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "var(--success-bg)",
            border: "2px solid var(--success-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={32} color="var(--success-text)" />
        </div>

        <div>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
            Equipment Created
          </h2>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: 0 }}>
            {created.equipment_name}
          </p>
        </div>

        {/* Show photo if one was captured */}
        {photoPreviewUrl && (
          <div style={{ width: "100%", maxWidth: 200 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoPreviewUrl}
              alt={created.equipment_name}
              style={{
                width: "100%",
                maxHeight: 140,
                objectFit: "contain",
                borderRadius: 10,
                border: "1px solid var(--card-border)",
              }}
            />
          </div>
        )}

        <div
          style={{
            width: "100%",
            padding: "0.75rem 1rem",
            background: "var(--background, #fff)",
            border: "1px solid var(--card-border)",
            borderRadius: 10,
            textAlign: "left",
          }}
        >
          <SummaryRow label="Barcode" value={created.barcode} mono />
          <SummaryRow label="Name" value={created.equipment_name} last />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", marginTop: 4 }}>
          <Button
            variant="primary"
            fullWidth
            icon="scan-barcode"
            onClick={() => router.push(`/kiosk/equipment/scan?barcode=${encodeURIComponent(created.barcode)}`)}
            style={{ minHeight: 56, borderRadius: 12 }}
          >
            Scan This Item
          </Button>
          <Button
            variant="ghost"
            fullWidth
            icon="plus"
            onClick={() => {
              // Clear the auto-saved form state so the next add starts fresh
              try { sessionStorage.removeItem("kiosk_form_equipment_add_v2"); } catch {}
              window.location.href = "/kiosk/equipment/add";
            }}
            style={{ minHeight: 48, borderRadius: 12 }}
          >
            Add Another
          </Button>
        </div>
      </div>
    );
  }

  // Confirm state
  return (
    <div style={{ padding: "0 1.25rem 1.25rem" }}>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        Review &amp; Create
      </h2>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1.25rem" }}>
        Confirm details before creating
      </p>

      {/* Photo preview in confirm */}
      {photoPreviewUrl && (
        <div
          style={{
            marginBottom: "1rem",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid var(--card-border)",
            background: "var(--muted-bg, #f3f4f6)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoPreviewUrl}
            alt="Equipment preview"
            style={{
              width: "100%",
              maxHeight: 160,
              objectFit: "contain",
              display: "block",
            }}
          />
        </div>
      )}

      <div
        style={{
          padding: "0.75rem 1rem",
          background: "var(--background, #fff)",
          border: "1px solid var(--card-border)",
          borderRadius: 10,
        }}
      >
        <SummaryRow label="Category" value={categoryLabel} />
        <SummaryRow label="Type" value={type.display_name} />
        <SummaryRow
          label="Barcode"
          value={details.barcode || "(auto-assigned)"}
          mono={!!details.barcode}
        />
        <SummaryRow
          label="Name"
          value={details.equipment_name || "(auto-generated)"}
        />
        <SummaryRow
          label="Condition"
          value={EQUIPMENT_CONDITION_OPTIONS.find((o) => o.value === details.condition_status)?.label ?? details.condition_status}
        />
        {!photoPreviewUrl && <SummaryRow label="Photo" value="None" />}
        <SummaryRow label="Notes" value={details.notes || "None"} last />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
        <Button
          variant="primary"
          fullWidth
          loading={creating}
          onClick={handleCreate}
          icon="plus"
          style={{
            minHeight: 56,
            borderRadius: 12,
            background: "var(--success-text, #16a34a)",
            color: "#fff",
            border: "1px solid transparent",
          }}
        >
          Create Equipment
        </Button>
        <Button variant="ghost" fullWidth onClick={onBack} disabled={creating} style={{ minHeight: 48, borderRadius: 12 }}>
          Back
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Row helper
// ---------------------------------------------------------------------------

function SummaryRow({
  label,
  value,
  last = false,
  mono = false,
}: {
  label: string;
  value: string;
  last?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "0.5rem 0",
        borderBottom: last ? "none" : "1px solid var(--card-border)",
        gap: 12,
      }}
    >
      <span
        style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          flexShrink: 0,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "0.9rem",
          fontWeight: 500,
          color: "var(--text-primary)",
          textAlign: "right",
          wordBreak: "break-word",
          ...(mono ? { fontFamily: "monospace", letterSpacing: "0.05em" } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page (wizard orchestrator)
// ---------------------------------------------------------------------------

export default function KioskEquipmentAddPage() {
  return (
    <Suspense fallback={null}>
      <KioskEquipmentAddContent />
    </Suspense>
  );
}

function KioskEquipmentAddContent() {
  const searchParams = useSearchParams();
  const prefillBarcode = searchParams.get("barcode") || "";

  const [showResumed, setShowResumed] = useState(false);

  // Photo state (not auto-saved — File objects can't be serialized)
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  const handlePhotoChange = (file: File | null) => {
    setPhotoFile(file);
    if (file) {
      setPhotoPreviewUrl(URL.createObjectURL(file));
    } else {
      setPhotoPreviewUrl(null);
    }
  };

  // Auto-saved wizard state
  const [saved, setSaved, clearSaved, wasRestored] = useFormAutoSave(
    "equipment_add_v2",
    {
      step: 1,
      selectedCategory: null as string | null,
      selectedType: null as EquipmentType | null,
      details: {
        barcode: prefillBarcode,
        equipment_name: "",
        condition_status: "new",
        notes: "",
      } as DetailsData,
    },
  );

  // If URL has a barcode prefill that differs from the restored session, clear the stale session
  useEffect(() => {
    if (prefillBarcode && wasRestored && saved.details.barcode !== prefillBarcode) {
      clearSaved();
    }
  }, [prefillBarcode, wasRestored, saved.details.barcode, clearSaved]);

  useEffect(() => {
    if (wasRestored && !(prefillBarcode && saved.details.barcode !== prefillBarcode)) {
      setShowResumed(true);
      const t = setTimeout(() => setShowResumed(false), 3000);
      return () => clearTimeout(t);
    }
  }, [wasRestored, prefillBarcode, saved.details.barcode]);

  const step = saved.step;
  const selectedCategory = saved.selectedCategory;
  const selectedType = saved.selectedType;
  const details = saved.details;

  const setStep = (s: number) => setSaved((p) => ({ ...p, step: s }));

  // Step handlers
  const handleCategorySelect = (category: string) => {
    setSaved((p) => ({ ...p, selectedCategory: category, selectedType: null, step: 2 }));
  };

  const handleTypeSelect = (type: EquipmentType) => {
    setSaved((p) => ({ ...p, selectedType: type, step: 3 }));
  };

  const handleDetailsNext = (data: DetailsData) => {
    setSaved((p) => ({ ...p, details: data, step: 4 }));
  };

  const handlePhotoNext = () => {
    setSaved((p) => ({ ...p, step: 5 }));
  };

  const handleBack = (toStep: number) => {
    setStep(toStep);
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <KioskCard icon="plus" title="Add Equipment" showResumed={showResumed} style={{ marginTop: "1rem" }}>
        {/* Step indicator */}
        <StepIndicator current={step} total={TOTAL_STEPS} />

        {/* Selection context breadcrumb (visible from step 2+) */}
        {step >= 2 && (
          <SelectionContext
            category={selectedCategory}
            typeName={step >= 3 ? selectedType?.display_name : null}
          />
        )}

        {/* Steps */}
        {step === 1 && (
          <StepCategory onSelect={handleCategorySelect} />
        )}

        {step === 2 && selectedCategory && (
          <StepType
            category={selectedCategory}
            onSelect={handleTypeSelect}
            onBack={() => handleBack(1)}
          />
        )}

        {step === 3 && selectedCategory && selectedType && (
          <StepDetails
            initial={details}
            onNext={handleDetailsNext}
            onBack={() => handleBack(2)}
          />
        )}

        {step === 4 && selectedCategory && selectedType && (
          <StepPhoto
            photoFile={photoFile}
            photoPreviewUrl={photoPreviewUrl}
            onFileChange={handlePhotoChange}
            onNext={handlePhotoNext}
            onBack={() => handleBack(3)}
          />
        )}

        {step === 5 && selectedCategory && selectedType && (
          <StepConfirm
            category={selectedCategory}
            type={selectedType}
            details={details}
            photoFile={photoFile}
            photoPreviewUrl={photoPreviewUrl}
            onBack={() => handleBack(4)}
            onCreated={() => {
              clearSaved();
              setPhotoFile(null);
              setPhotoPreviewUrl(null);
            }}
          />
        )}
      </KioskCard>
    </div>
  );
}
