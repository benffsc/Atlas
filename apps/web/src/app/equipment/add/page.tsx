"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";
import { getCategoryStyle } from "@/lib/equipment-styles";
import { KioskPersonAutosuggest, type PersonReference } from "@/components/kiosk/KioskPersonAutosuggest";

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

const CATEGORIES = [
  { key: "trap", label: "Trap", icon: "box" },
  { key: "cage", label: "Cage", icon: "grid-3x3" },
  { key: "camera", label: "Camera", icon: "camera" },
  { key: "accessory", label: "Accessory", icon: "package-plus" },
] as const;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EquipmentAddPage() {
  const router = useRouter();
  const toast = useToast();

  // Equipment types from API
  const [allTypes, setAllTypes] = useState<EquipmentType[]>([]);
  const [nextBarcode, setNextBarcode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [category, setCategory] = useState("");
  const [typeKey, setTypeKey] = useState("");
  const [barcode, setBarcode] = useState("");
  const [equipmentName, setEquipmentName] = useState("");
  const [condition, setCondition] = useState("new");
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // Optional checkout
  const [checkoutAfter, setCheckoutAfter] = useState(false);
  const [custodian, setCustodian] = useState<PersonReference>({
    person_id: null,
    display_name: "",
    is_resolved: false,
  });
  const [checkoutNotes, setCheckoutNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // Load types + next barcode
  useEffect(() => {
    Promise.all([
      fetchApi<{ types: EquipmentType[] }>("/api/equipment/types").then((d) =>
        setAllTypes((d.types || []).filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order))
      ),
      fetchApi<{ next_barcode: string }>("/api/equipment/stats")
        .then((d) => setNextBarcode(d.next_barcode))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const filteredTypes = allTypes.filter((t) => !category || t.category === category);

  // Photo handling
  const handlePhoto = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPhotoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setPhotoPreview(url);
    } else {
      setPhotoPreview(null);
    }
  }, []);

  const clearPhoto = () => {
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
  };

  // Submit
  const handleSubmit = async () => {
    if (!typeKey) {
      toast.error("Please select an equipment type");
      return;
    }
    if (checkoutAfter && !custodian.display_name.trim()) {
      toast.error("Enter a name for checkout");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Create equipment
      const result = await postApi<{ id: string; barcode: string; equipment_name: string }>(
        "/api/equipment",
        {
          equipment_type_key: typeKey,
          barcode: barcode.trim() || undefined,
          equipment_name: equipmentName.trim() || undefined,
          condition_status: condition,
          notes: notes.trim() || undefined,
        }
      );

      // 2. Upload photo if provided
      if (photoFile) {
        try {
          const formData = new FormData();
          formData.append("file", photoFile);
          await fetch(`/api/equipment/${result.id}/photo`, {
            method: "POST",
            body: formData,
          });
        } catch {
          toast.warning("Created but photo upload failed");
        }
      }

      // 3. Check out if requested
      if (checkoutAfter && custodian.display_name.trim()) {
        try {
          await postApi(`/api/equipment/${result.id}/events`, {
            event_type: "check_out",
            custodian_person_id: custodian.person_id || undefined,
            custodian_name: custodian.display_name.trim(),
            custodian_name_raw: custodian.display_name.trim(),
            notes: checkoutNotes.trim() || undefined,
          });
          toast.success(
            `${result.equipment_name} created & checked out to ${custodian.display_name.trim()}`
          );
        } catch (err) {
          toast.warning(
            `Created ${result.equipment_name} but checkout failed: ${err instanceof Error ? err.message : "Unknown error"}`
          );
        }
      } else {
        toast.success(`${result.equipment_name} created`);
      }

      router.push(`/equipment/${result.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create equipment");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedType = allTypes.find((t) => t.type_key === typeKey);
  const catStyle = category ? getCategoryStyle(category) : null;

  return (
    <div style={{ maxWidth: 640, padding: "0 1rem" }}>
      <Breadcrumbs
        items={[
          { label: "Equipment", href: "/equipment" },
          { label: "Add Equipment" },
        ]}
      />

      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "1rem 0 0.25rem" }}>
        Add Equipment
      </h1>
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 1.5rem" }}>
        Register a new item and optionally check it out immediately.
      </p>

      {loading ? (
        <div style={{ padding: "2rem 0", textAlign: "center", color: "var(--muted)" }}>
          Loading equipment types...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* ═══ CATEGORY ═══ */}
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={legendStyle}>Category</legend>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {CATEGORIES.map((cat) => {
                const cs = getCategoryStyle(cat.key);
                const selected = category === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => {
                      setCategory(cat.key);
                      // Reset type if it doesn't match new category
                      if (selectedType && selectedType.category !== cat.key) setTypeKey("");
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      padding: "0.5rem 0.875rem",
                      borderRadius: 8,
                      border: selected ? `2px solid ${cs.text}` : "2px solid var(--card-border)",
                      background: selected ? cs.bg : "var(--background, #fff)",
                      color: selected ? cs.text : "var(--text-primary)",
                      fontWeight: selected ? 700 : 500,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <Icon name={cat.icon} size={16} color={selected ? cs.text : "var(--muted)"} />
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* ═══ TYPE ═══ */}
          <div>
            <label style={labelStyle}>
              Type <span style={{ color: "var(--danger-text)" }}>*</span>
            </label>
            <select
              value={typeKey}
              onChange={(e) => {
                setTypeKey(e.target.value);
                // Auto-set category from type if not set
                const t = allTypes.find((x) => x.type_key === e.target.value);
                if (t && t.category !== category) setCategory(t.category);
              }}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="">Select type...</option>
              {filteredTypes.map((t) => (
                <option key={t.type_key} value={t.type_key}>
                  {t.display_name} ({t.item_count} registered)
                </option>
              ))}
            </select>
          </div>

          {/* ═══ BARCODE + NAME (side by side on desktop) ═══ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>Barcode</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder={nextBarcode ?? "0000"}
                style={{ ...inputStyle, fontFamily: "monospace", letterSpacing: "0.1em" }}
              />
              {nextBarcode && (
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 4 }}>
                  Next available: <strong style={{ fontFamily: "monospace" }}>{nextBarcode}</strong>
                  <button
                    type="button"
                    onClick={() => setBarcode(nextBarcode)}
                    style={{
                      marginLeft: 6,
                      background: "none",
                      border: "none",
                      color: "var(--primary)",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                      fontFamily: "inherit",
                      textDecoration: "underline",
                      padding: 0,
                    }}
                  >
                    Use
                  </button>
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>
                Name <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
              </label>
              <input
                type="text"
                value={equipmentName}
                onChange={(e) => setEquipmentName(e.target.value)}
                placeholder="Auto-generated if blank"
                style={inputStyle}
              />
            </div>
          </div>

          {/* ═══ CONDITION ═══ */}
          <div>
            <label style={labelStyle}>Condition</label>
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
              {EQUIPMENT_CONDITION_OPTIONS.filter((o) => o.value !== "decommissioned").map((opt) => {
                const selected = condition === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCondition(opt.value)}
                    style={{
                      padding: "0.4rem 0.75rem",
                      borderRadius: 6,
                      border: selected ? "2px solid var(--primary)" : "2px solid var(--card-border)",
                      background: selected ? "var(--primary-bg, rgba(59,130,246,0.08))" : "var(--background, #fff)",
                      color: selected ? "var(--primary)" : "var(--text-primary)",
                      fontWeight: selected ? 700 : 500,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ═══ PHOTO ═══ */}
          <div>
            <label style={labelStyle}>
              Photo <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
            </label>
            {photoPreview ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Preview"
                  style={{
                    width: 120,
                    height: 90,
                    objectFit: "cover",
                    borderRadius: 8,
                    border: "1px solid var(--card-border)",
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    {photoFile?.name}
                  </span>
                  <button
                    type="button"
                    onClick={clearPhoto}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--danger-text)",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                      fontFamily: "inherit",
                      padding: 0,
                      textAlign: "left",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.75rem 1rem",
                  border: "2px dashed var(--card-border)",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                }}
              >
                <Icon name="upload" size={18} color="var(--muted)" />
                Choose photo or drag here
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhoto}
                  style={{ display: "none" }}
                />
              </label>
            )}
          </div>

          {/* ═══ NOTES ═══ */}
          <div>
            <label style={labelStyle}>
              Notes <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              rows={2}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", minHeight: 60 }}
            />
          </div>

          {/* ═══ CHECKOUT TOGGLE ═══ */}
          <div
            style={{
              border: "1px solid var(--card-border)",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setCheckoutAfter((v) => !v)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.75rem 1rem",
                background: checkoutAfter ? "var(--warning-bg)" : "var(--background, #fff)",
                border: "none",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: checkoutAfter ? "var(--warning-text)" : "var(--text-secondary)",
                fontFamily: "inherit",
                textAlign: "left",
                transition: "background 150ms ease",
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  border: checkoutAfter
                    ? "2px solid var(--warning-text)"
                    : "2px solid var(--card-border)",
                  background: checkoutAfter ? "var(--warning-text)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {checkoutAfter && <Icon name="check" size={14} color="#fff" />}
              </div>
              Check out immediately after creating
            </button>

            {checkoutAfter && (
              <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid var(--card-border)" }}>
                <div style={{ marginBottom: "0.75rem" }}>
                  <KioskPersonAutosuggest
                    value={custodian}
                    onChange={setCustodian}
                    placeholder="Search by name..."
                    label="Check out to"
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, fontSize: "0.75rem" }}>
                    Checkout notes <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={checkoutNotes}
                    onChange={(e) => setCheckoutNotes(e.target.value)}
                    placeholder="e.g. Paper form filled, taking cage now"
                    style={{ ...inputStyle, fontSize: "0.85rem" }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ═══ SUBMIT ═══ */}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem", marginBottom: "2rem" }}>
            <Button
              variant="primary"
              size="lg"
              icon={checkoutAfter ? "log-out" : "plus"}
              loading={submitting}
              onClick={handleSubmit}
              style={{ flex: 1 }}
            >
              {checkoutAfter ? "Create & Check Out" : "Create Equipment"}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => router.push("/equipment")}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 700,
  color: "var(--text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: "0.375rem",
};

const legendStyle: React.CSSProperties = {
  ...labelStyle,
  marginBottom: "0.5rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.625rem 0.75rem",
  borderRadius: 8,
  border: "1px solid var(--card-border, #d1d5db)",
  background: "var(--background, #fff)",
  color: "var(--text-primary)",
  fontSize: "0.9rem",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
