"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { useFormAutoSave } from "@/hooks/useFormAutoSave";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";

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

const TOTAL_STEPS = 4;

const CATEGORIES = [
  { key: "trap", label: "Trap", icon: "wrench" },
  { key: "cage", label: "Cage", icon: "list" },
  { key: "camera", label: "Camera", icon: "eye" },
  { key: "accessory", label: "Accessory", icon: "package-plus" },
] as const;

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total }: { current: number; total: number }) {
  const pct = (current / total) * 100;
  return (
    <div style={{ padding: "16px 20px 12px" }}>
      <div
        style={{
          fontSize: "0.8rem",
          fontWeight: 600,
          color: "var(--text-secondary)",
          marginBottom: 8,
          letterSpacing: "0.02em",
        }}
      >
        Step {current} of {total}
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: "var(--card-border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
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
    <div style={{ padding: "0 20px 20px" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        Select Category
      </h2>
      <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: "0 0 20px" }}>
        What kind of equipment are you adding?
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        {CATEGORIES.map((cat) => (
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
              background: "var(--card-bg)",
              border: "2px solid var(--card-border)",
              borderRadius: 12,
              cursor: "pointer",
              transition: "border-color 150ms ease, box-shadow 150ms ease",
              minHeight: 48,
              padding: 12,
            }}
            onPointerDown={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = "var(--primary)";
              el.style.boxShadow = "var(--shadow-sm)";
            }}
            onPointerUp={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = "var(--card-border)";
              el.style.boxShadow = "none";
            }}
            onPointerLeave={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = "var(--card-border)";
              el.style.boxShadow = "none";
            }}
          >
            <Icon name={cat.icon} size={32} color="var(--primary)" />
            <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)" }}>
              {cat.label}
            </span>
          </button>
        ))}
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

    fetchApi<EquipmentType[]>("/api/equipment/types")
      .then((all) => {
        if (cancelled) return;
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
    <div style={{ padding: "0 20px 20px" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        Select Type
      </h2>
      <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: "0 0 20px" }}>
        Choose a {categoryLabel.toLowerCase()} type
      </p>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 60,
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
                background: "var(--card-bg)",
                border: "2px solid var(--card-border)",
                borderRadius: 10,
                cursor: "pointer",
                transition: "border-color 150ms ease",
                textAlign: "left",
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
        <Button variant="secondary" fullWidth onClick={onBack} style={{ minHeight: 48 }}>
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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    fontSize: "1rem",
    border: "1.5px solid var(--card-border)",
    borderRadius: 8,
    background: "var(--card-bg)",
    color: "var(--text-primary)",
    outline: "none",
    minHeight: 48,
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 6,
    letterSpacing: "0.02em",
  };

  return (
    <div style={{ padding: "0 20px 20px" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        Equipment Details
      </h2>
      <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: "0 0 20px" }}>
        Enter details for the new item
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
            style={inputStyle}
          />
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 4 }}>
            Enter 4-digit barcode from label.
            {suggestedBarcode && (
              <span> Next available: <strong>{suggestedBarcode}</strong></span>
            )}
          </div>
        </div>

        {/* Equipment Name */}
        <div>
          <label style={labelStyle}>Equipment Name <span style={{ fontWeight: 400 }}>(optional)</span></label>
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
              appearance: "none",
              backgroundImage:
                "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' viewBox='0 0 12 12'%3e%3cpath d='M3 4.5L6 7.5L9 4.5' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3e%3c/svg%3e\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 14px center",
              paddingRight: 36,
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
          <label style={labelStyle}>Notes <span style={{ fontWeight: 400 }}>(optional)</span></label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional notes..."
            rows={3}
            style={{
              ...inputStyle,
              resize: "vertical",
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
          style={{ minHeight: 56 }}
        >
          Next
        </Button>
        <Button variant="secondary" fullWidth onClick={onBack} style={{ minHeight: 48 }}>
          Back
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Confirm
// ---------------------------------------------------------------------------

function StepConfirm({
  category,
  type,
  details,
  onBack,
  onCreated,
}: {
  category: string;
  type: EquipmentType;
  details: DetailsData;
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
      setCreated(result);
      onCreated?.();
      toast.success("Equipment created successfully");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create equipment";
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }, [type, details, toast, onCreated]);

  // Success state
  if (created) {
    return (
      <div
        style={{
          padding: "0 20px 20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 16,
          paddingTop: 24,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "var(--success-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={36} color="var(--success-text)" />
        </div>

        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
            Equipment Created
          </h2>
          <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", margin: 0 }}>
            {created.equipment_name}
          </p>
        </div>

        <div
          style={{
            width: "100%",
            padding: 16,
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 10,
            textAlign: "left",
          }}
        >
          <SummaryRow label="Barcode" value={created.barcode} />
          <SummaryRow label="Name" value={created.equipment_name} last />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", marginTop: 8 }}>
          <Button
            variant="primary"
            fullWidth
            icon="scan-barcode"
            onClick={() => router.push(`/kiosk/equipment/scan?barcode=${encodeURIComponent(created.barcode)}`)}
            style={{ minHeight: 56 }}
          >
            Scan This Item
          </Button>
          <Button
            variant="secondary"
            fullWidth
            icon="plus"
            onClick={() => router.push("/kiosk/equipment/add")}
            style={{ minHeight: 48 }}
          >
            Add Another
          </Button>
        </div>
      </div>
    );
  }

  // Confirm state
  return (
    <div style={{ padding: "0 20px 20px" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
        Confirm Details
      </h2>
      <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: "0 0 20px" }}>
        Review before creating
      </p>

      <div
        style={{
          padding: 16,
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 10,
        }}
      >
        <SummaryRow label="Category" value={categoryLabel} />
        <SummaryRow label="Type" value={type.display_name} />
        <SummaryRow
          label="Barcode"
          value={details.barcode || "(auto-assigned)"}
        />
        <SummaryRow
          label="Name"
          value={details.equipment_name || "(auto-generated)"}
        />
        <SummaryRow
          label="Condition"
          value={EQUIPMENT_CONDITION_OPTIONS.find((o) => o.value === details.condition_status)?.label ?? details.condition_status}
        />
        {details.notes && <SummaryRow label="Notes" value={details.notes} last />}
        {!details.notes && <SummaryRow label="Notes" value="None" last />}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
        <Button
          variant="primary"
          fullWidth
          loading={creating}
          onClick={handleCreate}
          icon="plus"
          style={{ minHeight: 56 }}
        >
          Create Equipment
        </Button>
        <Button variant="secondary" fullWidth onClick={onBack} disabled={creating} style={{ minHeight: 48 }}>
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
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "10px 0",
        borderBottom: last ? "none" : "1px solid var(--card-border)",
        gap: 12,
      }}
    >
      <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: "0.9rem",
          fontWeight: 500,
          color: "var(--text-primary)",
          textAlign: "right",
          wordBreak: "break-word",
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
  const [showResumed, setShowResumed] = useState(false);

  // Auto-saved wizard state
  const [saved, setSaved, clearSaved, wasRestored] = useFormAutoSave(
    "equipment_add",
    {
      step: 1,
      selectedCategory: null as string | null,
      selectedType: null as EquipmentType | null,
      details: {
        barcode: "",
        equipment_name: "",
        condition_status: "new",
        notes: "",
      } as DetailsData,
    },
  );

  useEffect(() => {
    if (wasRestored) {
      setShowResumed(true);
      const t = setTimeout(() => setShowResumed(false), 3000);
      return () => clearTimeout(t);
    }
  }, [wasRestored]);

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

  const handleBack = (toStep: number) => {
    setStep(toStep);
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 20px 0",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Icon name="plus-circle" size={22} color="var(--primary)" />
        <h1
          style={{
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          Add Equipment
        </h1>
      </div>

      {/* Resumed banner */}
      {showResumed && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            padding: "0.5rem 1rem",
            fontSize: "0.8rem",
            fontWeight: 600,
            background: "var(--info-bg)",
            color: "var(--info-text)",
            borderBottom: "1px solid var(--info-border)",
          }}
        >
          <Icon name="rotate-ccw" size={14} color="var(--info-text)" />
          Resumed from where you left off
        </div>
      )}

      {/* Step indicator */}
      <StepIndicator current={step} total={TOTAL_STEPS} />

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
        <StepConfirm
          category={selectedCategory}
          type={selectedType}
          details={details}
          onBack={() => handleBack(3)}
          onCreated={clearSaved}
        />
      )}
    </div>
  );
}
