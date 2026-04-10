"use client";

import { useState, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { KioskPersonAutosuggest, type PersonReference } from "@/components/kiosk/KioskPersonAutosuggest";
import { EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS } from "@/lib/form-options";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Admin Quick Checkout — batch paper-slip entry.
 *
 * FFS-1224 (Equipment Overhaul epic FFS-1201).
 *
 * When Jami has paper checkout slips from the old form, she needs a fast
 * way to enter them: barcode + name + date + purpose → system resolves
 * the person, finds their active request, calculates due date, posts the
 * check_out event. ~30 seconds per slip instead of the full kiosk wizard.
 *
 * This page is admin-only (behind /admin/ layout auth).
 */

interface ScannedEquipment {
  equipment_id: string;
  barcode: string | null;
  display_name: string;
  custody_status: string;
}

interface EntryResult {
  barcode: string;
  equipmentName: string;
  borrowerName: string;
  success: boolean;
  error?: string;
}

export default function QuickCheckoutPage() {
  const toast = useToast();
  const { user: adminUser } = useCurrentUser();
  const { value: PURPOSE_DUE_OFFSET } = useAppConfig<Record<string, number>>("kiosk.purpose_due_offsets");

  // Form state (reset after each entry)
  const [barcode, setBarcode] = useState("");
  const [equipment, setEquipment] = useState<ScannedEquipment | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [person, setPerson] = useState<PersonReference>({
    person_id: null,
    display_name: "",
    is_resolved: false,
  });

  const [checkoutDate, setCheckoutDate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [depositAmount, setDepositAmount] = useState("50");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // History of entries in this session
  const [history, setHistory] = useState<EntryResult[]>([]);

  // Look up equipment by barcode
  const handleLookup = useCallback(async () => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    setLookupLoading(true);
    setLookupError(null);
    setEquipment(null);
    try {
      const data = await fetchApi<ScannedEquipment>(
        `/api/equipment/scan?barcode=${encodeURIComponent(trimmed)}`,
      );
      setEquipment(data);
      if (data.custody_status !== "available") {
        setLookupError(
          `${data.display_name} is currently ${data.custody_status}. Check it in first before re-checking out.`,
        );
      }
    } catch {
      setLookupError(`No equipment found for barcode "${trimmed}"`);
    } finally {
      setLookupLoading(false);
    }
  }, [barcode]);

  // Calculate due date from purpose offset
  const computeDueDate = (purposeKey: string, fromDate: string): string => {
    const offset = PURPOSE_DUE_OFFSET?.[purposeKey] || 14;
    const base = fromDate ? new Date(fromDate) : new Date();
    base.setDate(base.getDate() + offset);
    return base.toISOString().split("T")[0];
  };

  // Submit the checkout
  const handleSubmit = async () => {
    if (!equipment || !person.display_name.trim() || !purpose) return;

    setSubmitting(true);
    const entry: EntryResult = {
      barcode: barcode.trim(),
      equipmentName: equipment.display_name,
      borrowerName: person.display_name,
      success: false,
    };

    try {
      const dueDate = computeDueDate(purpose, checkoutDate);
      const deposit = parseFloat(depositAmount) || 0;

      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: "check_out",
        actor_person_id: adminUser?.staff_id || undefined,
        custodian_person_id: person.person_id || undefined,
        custodian_name: person.display_name.trim(),
        custodian_name_raw: person.display_name.trim(),
        checkout_purpose: purpose,
        due_date: dueDate,
        deposit_amount: deposit > 0 ? deposit : undefined,
        notes: [
          notes.trim(),
          checkoutDate
            ? `Actual checkout date: ${checkoutDate}`
            : null,
          "Entered via admin quick-checkout",
        ]
          .filter(Boolean)
          .join(". "),
        resolution_status: person.is_resolved ? "resolved" : "unresolved",
      });

      entry.success = true;
      toast.success(
        `✓ ${equipment.display_name} → ${person.display_name}`,
      );

      // Reset for next entry (keep purpose + deposit as likely the same)
      setBarcode("");
      setEquipment(null);
      setLookupError(null);
      setPerson({ person_id: null, display_name: "", is_resolved: false });
      setCheckoutDate("");
      setNotes("");
    } catch (err) {
      entry.error =
        err instanceof Error ? err.message : "Checkout failed";
      toast.error(entry.error);
    } finally {
      setSubmitting(false);
      setHistory((h) => [entry, ...h]);
    }
  };

  const canSubmit =
    equipment &&
    equipment.custody_status === "available" &&
    person.display_name.trim().length > 0 &&
    purpose.length > 0;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "1.5rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "0.25rem",
          }}
        >
          <Icon name="zap" size={24} color="var(--primary)" />
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>
            Quick Checkout
          </h1>
        </div>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.85rem",
            margin: 0,
          }}
        >
          Fast entry for paper checkout slips. Barcode → Name → Purpose → Submit.
          Repeats automatically for the next slip.
        </p>
      </div>

      {/* ── Barcode lookup ── */}
      <div
        style={{
          background: "var(--card-bg)",
          border: "1px solid var(--card-border)",
          borderRadius: 12,
          padding: "1rem",
          marginBottom: "1rem",
        }}
      >
        <label
          style={{
            display: "block",
            fontSize: "0.75rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--text-secondary)",
            marginBottom: "0.375rem",
          }}
        >
          1. Equipment Barcode
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            inputMode="numeric"
            value={barcode}
            onChange={(e) =>
              setBarcode(e.target.value.replace(/\D/g, "").slice(0, 4))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLookup();
            }}
            placeholder="4-digit barcode"
            autoFocus
            style={{
              flex: 1,
              padding: "0.625rem 0.875rem",
              fontSize: "1.1rem",
              fontFamily: "monospace",
              fontWeight: 700,
              letterSpacing: "0.1em",
              border: "1px solid var(--card-border)",
              borderRadius: 8,
              outline: "none",
            }}
          />
          <Button
            variant="primary"
            onClick={handleLookup}
            loading={lookupLoading}
            disabled={!barcode.trim()}
          >
            Look Up
          </Button>
        </div>

        {lookupError && (
          <div
            style={{
              marginTop: "0.5rem",
              fontSize: "0.85rem",
              color: "var(--danger-text)",
            }}
          >
            {lookupError}
          </div>
        )}

        {equipment && !lookupError && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 0.75rem",
              background: "var(--success-bg)",
              border: "1px solid var(--success-border)",
              borderRadius: 8,
              fontSize: "0.85rem",
              color: "var(--success-text)",
              fontWeight: 600,
            }}
          >
            {equipment.display_name} — {equipment.custody_status}
          </div>
        )}
      </div>

      {/* ── Borrower + details (only show after lookup) ── */}
      {equipment && equipment.custody_status === "available" && (
        <div
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--card-border)",
            borderRadius: 12,
            padding: "1rem",
            marginBottom: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.875rem",
          }}
        >
          {/* Name */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.75rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--text-secondary)",
                marginBottom: "0.375rem",
              }}
            >
              2. Borrower Name *
            </label>
            <KioskPersonAutosuggest
              value={person}
              onChange={setPerson}
              placeholder="Type the borrower's name..."
            />
          </div>

          {/* Checkout date + purpose row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0.75rem",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--text-secondary)",
                  marginBottom: "0.375rem",
                }}
              >
                3. Checkout Date
              </label>
              <input
                type="date"
                value={checkoutDate}
                onChange={(e) => setCheckoutDate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  border: "1px solid var(--card-border)",
                  borderRadius: 8,
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "var(--muted)",
                  marginTop: 2,
                }}
              >
                Leave blank for today
              </div>
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: purpose
                    ? "var(--text-secondary)"
                    : "var(--danger-text, #dc2626)",
                  marginBottom: "0.375rem",
                }}
              >
                4. Purpose *
              </label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  border: `1px solid ${purpose ? "var(--card-border)" : "var(--danger-border, #fca5a5)"}`,
                  borderRadius: 8,
                  fontSize: "0.9rem",
                  outline: "none",
                  appearance: "auto" as const,
                }}
              >
                <option value="">Select purpose...</option>
                {(
                  EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS as readonly {
                    value: string;
                    label: string;
                  }[]
                ).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Deposit + notes row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              gap: "0.75rem",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--text-secondary)",
                  marginBottom: "0.375rem",
                }}
              >
                Deposit $
              </label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                min={0}
                step={1}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  border: "1px solid var(--card-border)",
                  borderRadius: 8,
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--text-secondary)",
                  marginBottom: "0.375rem",
                }}
              >
                Notes (optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Appt date, staff initials, etc."
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  border: "1px solid var(--card-border)",
                  borderRadius: 8,
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
            </div>
          </div>

          {/* Submit */}
          <Button
            variant="primary"
            size="lg"
            icon="log-out"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
            style={{
              minHeight: 52,
              borderRadius: 10,
              background: canSubmit
                ? "var(--success-text, #16a34a)"
                : undefined,
              color: canSubmit ? "#fff" : undefined,
              border: canSubmit ? "1px solid transparent" : undefined,
            }}
          >
            Check Out {equipment.display_name} →{" "}
            {person.display_name || "..."}
          </Button>
        </div>
      )}

      {/* ── Session history ── */}
      {history.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h2
            style={{
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: "0.5rem",
            }}
          >
            This Session ({history.filter((h) => h.success).length} entered)
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
            }}
          >
            {history.map((entry, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.375rem 0.625rem",
                  background: entry.success
                    ? "var(--success-bg)"
                    : "var(--danger-bg)",
                  border: `1px solid ${entry.success ? "var(--success-border)" : "var(--danger-border)"}`,
                  borderRadius: 6,
                  fontSize: "0.8rem",
                }}
              >
                <Icon
                  name={entry.success ? "check-circle" : "alert-circle"}
                  size={14}
                  color={
                    entry.success
                      ? "var(--success-text)"
                      : "var(--danger-text)"
                  }
                />
                <code style={{ fontWeight: 600 }}>{entry.barcode}</code>
                <span style={{ flex: 1 }}>
                  {entry.equipmentName} → {entry.borrowerName}
                </span>
                {entry.error && (
                  <span
                    style={{
                      color: "var(--danger-text)",
                      fontSize: "0.7rem",
                    }}
                  >
                    {entry.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
