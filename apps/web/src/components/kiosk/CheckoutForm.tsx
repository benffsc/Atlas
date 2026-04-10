"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { postApi, fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Skeleton } from "@/components/feedback/Skeleton";
import { useFormAutoSave } from "@/hooks/useFormAutoSave";
import { type PersonReference } from "@/components/ui/PersonReferencePicker";
import { KioskPersonCollector, resolveCollectedPerson, type CollectedPerson } from "./KioskPersonCollector";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  getLabel,
  EQUIPMENT_CHECKOUT_TYPE_OPTIONS,
  EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS,
} from "@/lib/form-options";
import type { EquipmentContextResponse } from "@/lib/types/view-contracts";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useKioskStaff } from "./KioskStaffContext";
import { useKioskPreview } from "@/hooks/useKioskPreview";
import { KioskAgreementModal, type AgreementResult } from "./KioskAgreementModal";
import { KioskCard } from "./KioskCard";
import { kioskLabelStyle as labelStyle, kioskInputStyle as inputStyle } from "./kiosk-styles";

interface CheckoutFormProps {
  equipmentId: string;
  equipmentName: string;
  onComplete: () => void;
  onCancel: () => void;
}

type ResolutionStatus = "resolved" | "unresolved" | "created";

function dueDateFromOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function defaultDueDate(): string {
  return dueDateFromOffset(14);
}


/**
 * Single-screen checkout form for kiosk — replaces the 3-step CheckoutWizard.
 * Layout: WHO → PURPOSE → TYPE + DEPOSIT → CONTEXT (auto-fill) → DUE DATE + NOTES → Submit
 */
export function CheckoutForm({
  equipmentId,
  equipmentName,
  onComplete,
  onCancel,
}: CheckoutFormProps) {
  const toast = useToast();
  const isPreview = useKioskPreview();
  const { activeStaff } = useKioskStaff();
  const { value: DEPOSIT_PRESETS } = useAppConfig<number[]>("kiosk.deposit_presets");
  const { value: PURPOSE_DUE_OFFSET } = useAppConfig<Record<string, number>>("kiosk.purpose_due_offsets");
  // FFS-1207 — agreement config
  const { value: agreementText } = useAppConfig<string>("equipment.agreement_text");
  const { value: agreementVersion } = useAppConfig<string>("equipment.agreement_version");
  const [showAgreement, setShowAgreement] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showResumed, setShowResumed] = useState(false);
  const [success, setSuccess] = useState(false);
  const [successName, setSuccessName] = useState("");

  // Auto-saved form state (versioned key avoids conflict with old wizard)
  const [saved, setSaved, clearSaved, wasRestored] = useFormAutoSave(
    `checkout_v2_${equipmentId}`,
    {
      personRef: { person_id: null, display_name: "", is_resolved: false } as PersonReference,
      collectedPerson: {
        person_id: null, display_name: "", first_name: "", last_name: "",
        phone: "", email: "", is_resolved: false, resolution_type: "unresolved",
      } as CollectedPerson,
      resolutionStatus: "resolved" as ResolutionStatus,
      checkoutPurpose: "",
      selectedPurposes: [] as string[],
      clientStatedPurpose: "",
      checkoutType: "",
      depositAmount: 50, // FFS-1231: default $50 (FFSC standard) — staff must actively waive
      customDeposit: "",
      depositMethod: "" as string, // FFS-1208: cash, card, waived, none
      dueDate: defaultDueDate(),
      dueDateManuallySet: false,
      notes: "",
      // Context auto-fill
      linkedRequestId: null as string | null,
      linkedRequestLabel: null as string | null,
      linkedAppointmentId: null as string | null,
      linkedAppointmentLabel: null as string | null,
      linkedPlaceId: null as string | null,
      linkedPlaceLabel: null as string | null,
    },
  );

  // Context state (not persisted — re-fetched on person change)
  const [context, setContext] = useState<EquipmentContextResponse | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
  const isMobile = useIsMobile();

  // Show "Resumed" banner briefly
  useEffect(() => {
    if (wasRestored) {
      setShowResumed(true);
      const t = setTimeout(() => setShowResumed(false), 3000);
      return () => clearTimeout(t);
    }
  }, [wasRestored]);

  // Destructure for convenience
  const personRef = saved.personRef;
  const resolutionStatus = saved.resolutionStatus;
  const checkoutPurpose = saved.checkoutPurpose;
  const checkoutType = saved.checkoutType;
  const depositAmount = saved.depositAmount;
  const customDeposit = saved.customDeposit;
  const dueDate = saved.dueDate;
  const dueDateManuallySet = saved.dueDateManuallySet;
  const notes = saved.notes;

  // Updaters
  const setPersonRef = (ref: PersonReference) => setSaved((p) => ({ ...p, personRef: ref }));
  const setCollectedPerson = (cp: CollectedPerson) => setSaved((p) => ({ ...p, collectedPerson: cp }));
  const setResolutionStatus = (v: ResolutionStatus) => setSaved((p) => ({ ...p, resolutionStatus: v }));
  const setCheckoutPurpose = (v: string) => {
    setSaved((p) => {
      const updates: Partial<typeof p> = { checkoutPurpose: v };
      // Auto-adjust due date when purpose changes (unless manually set)
      if (!p.dueDateManuallySet && v && PURPOSE_DUE_OFFSET[v]) {
        updates.dueDate = dueDateFromOffset(PURPOSE_DUE_OFFSET[v]);
      }
      return { ...p, ...updates };
    });
  };
  const setCheckoutType = (v: string) => setSaved((p) => ({ ...p, checkoutType: v }));
  const togglePurpose = (v: string) => setSaved((p) => {
    const current = p.selectedPurposes || [];
    const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
    return { ...p, selectedPurposes: next, checkoutPurpose: next.join(",") };
  });
  const setClientStatedPurpose = (v: string) => setSaved((p) => ({ ...p, clientStatedPurpose: v }));
  const setDepositAmount = (v: number) => setSaved((p) => ({ ...p, depositAmount: v }));
  const setCustomDeposit = (v: string) => setSaved((p) => ({ ...p, customDeposit: v }));
  const setDueDate = (v: string) => setSaved((p) => ({ ...p, dueDate: v, dueDateManuallySet: true }));
  const setNotes = (v: string) => setSaved((p) => ({ ...p, notes: v }));

  // Context auto-fill setters
  const setLinkedRequest = (id: string | null, label: string | null) =>
    setSaved((p) => ({ ...p, linkedRequestId: id, linkedRequestLabel: label }));
  const setLinkedAppointment = (id: string | null, label: string | null) =>
    setSaved((p) => ({ ...p, linkedAppointmentId: id, linkedAppointmentLabel: label }));
  const setLinkedPlace = (id: string | null, label: string | null) =>
    setSaved((p) => ({ ...p, linkedPlaceId: id, linkedPlaceLabel: label }));

  // Derived: who is the custodian?
  // Prefer collectedPerson (new flow), fall back to personRef (legacy/restored sessions)
  const collectedPerson = saved.collectedPerson;
  const custodianName = collectedPerson.display_name || personRef.display_name;
  const custodianPersonId = collectedPerson.person_id || personRef.person_id;

  // FFS-1231: purpose is now REQUIRED (data showed 99.6% of checkouts had none)
  // Preview mode bypasses all validation so admin can click through flows
  const canSubmit = isPreview || (
    custodianName.length > 0 &&
    collectedPerson.first_name.trim().length > 0 &&
    checkoutType.length > 0 &&
    checkoutPurpose.length > 0
  );

  // Resolved deposit
  const resolvedDeposit = useMemo(() => {
    if (customDeposit.trim()) {
      const parsed = parseFloat(customDeposit);
      return isNaN(parsed) ? depositAmount : parsed;
    }
    return depositAmount;
  }, [customDeposit, depositAmount]);

  // Fetch equipment context when person changes
  const fetchContext = useCallback(async (personId: string) => {
    setContextLoading(true);
    try {
      const data = await fetchApi<EquipmentContextResponse>(
        `/api/people/${personId}/equipment-context`
      );
      setContext(data);

      // Auto-fill: if 1 active request, pre-select it
      if (data.active_requests.length === 1) {
        const req = data.active_requests[0];
        setLinkedRequest(req.request_id, req.place_address || `Request`);
      }
      // Auto-fill: if upcoming appointment, pre-select it
      if (data.upcoming_appointments.length > 0) {
        const appt = data.upcoming_appointments[0];
        setLinkedAppointment(appt.appointment_id, `${appt.appointment_date}${appt.place_address ? ` — ${appt.place_address}` : ""}`);
        // Adjust due date from appointment date + purpose offset
        if (!saved.dueDateManuallySet && appt.appointment_date) {
          const apptDate = new Date(appt.appointment_date + "T00:00:00");
          const offset = PURPOSE_DUE_OFFSET[saved.checkoutPurpose] || 3;
          apptDate.setDate(apptDate.getDate() + offset);
          setSaved((p) => ({ ...p, dueDate: apptDate.toISOString().split("T")[0] }));
        }
      }
      // Auto-fill: if service places, pre-select first primary
      if (data.service_places.length > 0) {
        const place = data.service_places[0];
        setLinkedPlace(place.place_id, place.place_name);
      }

      // Auto-expand context panel if we have data
      if (data.active_requests.length > 0 || data.upcoming_appointments.length > 0 || data.service_places.length > 0) {
        setContextExpanded(true);
      }
    } catch {
      // Context is optional — don't block the form
      setContext(null);
    } finally {
      setContextLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (custodianPersonId) {
      fetchContext(custodianPersonId);
    } else {
      setContext(null);
      setContextExpanded(false);
    }
  }, [custodianPersonId, fetchContext]);

  // FFS-1207 — show agreement modal before submitting (gates the checkout)
  const handleRequestSubmit = () => {
    if (agreementText) {
      setShowAgreement(true);
    } else {
      // No agreement configured — proceed directly (legacy/test mode)
      handleSubmit(null);
    }
  };

  const handleSubmit = async (agreement: AgreementResult | null) => {
    setShowAgreement(false);

    // Preview mode: show success without hitting the API
    if (isPreview) {
      toast.info("Preview mode — no data submitted");
      setSuccessName("Preview User");
      setSuccess(true);
      return;
    }

    setSubmitting(true);
    try {
      // Resolve collected person to a person_id (creates if needed)
      let resolvedPersonId = custodianPersonId;
      let resolvedStatus: string = resolutionStatus;
      if (collectedPerson.first_name.trim() && !collectedPerson.is_resolved) {
        const resolution = await resolveCollectedPerson(collectedPerson);
        resolvedPersonId = resolution.person_id;
        resolvedStatus = resolution.resolution_type;
      }

      const eventResult = await postApi<{ event_id: string }>(`/api/equipment/${equipmentId}/events`, {
        event_type: "check_out",
        actor_person_id: activeStaff?.person_id || undefined,
        custodian_person_id: resolvedPersonId || undefined,
        custodian_name: custodianName || undefined,
        checkout_type: checkoutType,
        deposit_amount: resolvedDeposit > 0 ? resolvedDeposit : undefined,
        deposit_method: saved.depositMethod || undefined, // FFS-1208
        due_date: dueDate || undefined,
        notes: notes.trim() || undefined,
        // Context links
        request_id: saved.linkedRequestId || undefined,
        appointment_id: saved.linkedAppointmentId || undefined,
        place_id: saved.linkedPlaceId || undefined,
        // MIG_2996 / MIG_3023 fields
        checkout_purpose: checkoutPurpose || undefined,
        client_stated_purpose: saved.clientStatedPurpose?.trim() || undefined,
        custodian_name_raw: custodianName || undefined,
        resolution_status: resolvedStatus,
      });

      // FFS-1207 — store the signed agreement linked to the checkout event
      if (agreement && eventResult?.event_id) {
        try {
          await postApi(`/api/equipment/${equipmentId}/agreement`, {
            event_id: eventResult.event_id,
            person_id: resolvedPersonId || undefined,
            person_name: agreement.personName,
            agreement_version: agreement.agreementVersion,
            agreement_text: agreement.agreementText,
            signature_value: agreement.signatureValue,
            signature_type: "typed_name",
          });
        } catch {
          // Agreement storage failure is non-blocking — the checkout already succeeded.
          // Staff can retroactively collect a paper signature if needed.
          console.error("[CheckoutForm] Agreement storage failed (non-blocking)");
        }
      }

      clearSaved();
      setSuccessName(custodianName);
      setSuccess(true);
      toast.success(`Checked out ${equipmentName}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAnotherCheckout = () => {
    setSuccess(false);
    setSuccessName("");
    clearSaved();
    setSaved({
      personRef: { person_id: null, display_name: "", is_resolved: false },
      collectedPerson: {
        person_id: null, display_name: "", first_name: "", last_name: "",
        phone: "", email: "", is_resolved: false, resolution_type: "unresolved",
      },
      resolutionStatus: "resolved",
      checkoutPurpose: "",
      selectedPurposes: [],
      clientStatedPurpose: "",
      checkoutType: "",
      depositAmount: 50, // FFS-1231: default $50
      customDeposit: "",
      depositMethod: "",
      dueDate: defaultDueDate(),
      dueDateManuallySet: false,
      notes: "",
      linkedRequestId: null,
      linkedRequestLabel: null,
      linkedAppointmentId: null,
      linkedAppointmentLabel: null,
      linkedPlaceId: null,
      linkedPlaceLabel: null,
    });
    setContext(null);
    setContextExpanded(false);
  };

  // Success state
  if (success) {
    return (
      <div
        style={{
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--success-border, #bbf7d0)",
          borderRadius: "16px",
          padding: "2rem 1.25rem",
          textAlign: "center",
        }}
      >
        <Icon name="check-circle" size={48} color="var(--success-text, #16a34a)" />
        <p
          style={{
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0.75rem 0 0.25rem",
          }}
        >
          Checked out to {successName}
        </p>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 1.5rem" }}>
          {equipmentName}
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
          <Button
            variant="outline"
            size="lg"
            icon="plus"
            onClick={handleAnotherCheckout}
            style={{ minHeight: "48px", borderRadius: "12px" }}
          >
            Another Checkout
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon="check"
            onClick={onComplete}
            style={{ minHeight: "48px", borderRadius: "12px" }}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
    <KioskCard icon="log-out" title="Check Out" subtitle={equipmentName} showResumed={showResumed}>
      <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {/* ===================== WHO ===================== */}
        <KioskPersonCollector
          value={collectedPerson}
          onChange={setCollectedPerson}
        />

        {/* ===================== TYPE + DEPOSIT (side by side) ===================== */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "1rem" }}>
          {/* Checkout type */}
          <div>
            <label style={labelStyle}>Type *</label>
            <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
              {EQUIPMENT_CHECKOUT_TYPE_OPTIONS.map((opt) => {
                const isSelected = checkoutType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCheckoutType(opt.value)}
                    style={{
                      minHeight: "44px",
                      padding: "0.5rem 0.875rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.25rem",
                      borderRadius: "10px",
                      border: isSelected
                        ? "2px solid var(--primary)"
                        : "2px solid var(--card-border, #e5e7eb)",
                      background: isSelected
                        ? "var(--primary-bg, rgba(59,130,246,0.08))"
                        : "var(--background, #fff)",
                      color: isSelected ? "var(--primary)" : "var(--text-primary)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: isSelected ? 700 : 500,
                      transition: "all 150ms ease",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Deposit */}
          <div>
            <label style={labelStyle}>Deposit</label>
            <div style={{ display: "flex", gap: "0.375rem", marginBottom: "0.375rem" }}>
              {DEPOSIT_PRESETS.map((amount) => {
                const isSelected = depositAmount === amount && !customDeposit.trim();
                return (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => {
                      setDepositAmount(amount);
                      setCustomDeposit("");
                    }}
                    style={{
                      flex: 1,
                      minHeight: "44px",
                      borderRadius: "10px",
                      border: isSelected
                        ? "2px solid var(--primary)"
                        : "2px solid var(--card-border, #e5e7eb)",
                      background: isSelected
                        ? "var(--primary-bg, rgba(59,130,246,0.08))"
                        : "var(--background, #fff)",
                      color: isSelected ? "var(--primary)" : "var(--text-primary)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: isSelected ? 700 : 500,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {amount === 0 ? "$0" : `$${amount}`}
                  </button>
                );
              })}
            </div>
            <input
              type="number"
              value={customDeposit}
              onChange={(e) => setCustomDeposit(e.target.value)}
              placeholder="Custom..."
              min={0}
              step={1}
              style={{ ...inputStyle, minHeight: "36px", padding: "0.5rem 0.75rem", fontSize: "0.85rem" }}
            />
            {/* FFS-1208 — deposit method (cash / card / waived) */}
            {resolvedDeposit > 0 && (
              <div style={{ marginTop: "0.375rem" }}>
                <label style={{ ...labelStyle, marginBottom: "0.25rem" }}>Payment Method</label>
                <div style={{ display: "flex", gap: "0.375rem" }}>
                  {[
                    { value: "cash", label: "Cash" },
                    { value: "card", label: "Card" },
                    { value: "waived", label: "Waived" },
                  ].map((opt) => {
                    const isSelected = saved.depositMethod === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSaved((p) => ({ ...p, depositMethod: opt.value }))}
                        style={{
                          flex: 1,
                          minHeight: "36px",
                          borderRadius: "8px",
                          border: isSelected
                            ? "2px solid var(--primary)"
                            : "2px solid var(--card-border, #e5e7eb)",
                          background: isSelected
                            ? "var(--primary-bg, rgba(59,130,246,0.08))"
                            : "var(--background, #fff)",
                          color: isSelected ? "var(--primary)" : "var(--text-primary)",
                          cursor: "pointer",
                          fontSize: "0.8rem",
                          fontWeight: isSelected ? 700 : 500,
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===================== CONTEXT AUTO-FILL ===================== */}
        {custodianPersonId && (
          <div
            style={{
              border: "1px solid var(--card-border, #e5e7eb)",
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setContextExpanded((v) => !v)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.625rem 0.875rem",
                background: "var(--section-bg, #f9fafb)",
                border: "none",
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <Icon
                name={contextExpanded ? "chevron-down" : "chevron-right"}
                size={14}
                color="var(--muted)"
              />
              Context
              {contextLoading && (
                <Skeleton width={60} height={14} style={{ display: "inline-block", verticalAlign: "middle" }} />
              )}
              {!contextLoading && context && (
                <span style={{ fontWeight: 400, textTransform: "none", color: "var(--muted)" }}>
                  {[
                    context.active_requests.length > 0 && `${context.active_requests.length} request${context.active_requests.length > 1 ? "s" : ""}`,
                    context.upcoming_appointments.length > 0 && `${context.upcoming_appointments.length} appt`,
                    context.service_places.length > 0 && `${context.service_places.length} place${context.service_places.length > 1 ? "s" : ""}`,
                  ].filter(Boolean).join(", ") || "No linked data"}
                </span>
              )}
            </button>

            {contextExpanded && (
              <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {/* Linked request pill */}
                {saved.linkedRequestId && (
                  <ContextPill
                    icon="clipboard-list"
                    label="Request"
                    value={saved.linkedRequestLabel || "Linked"}
                    onDismiss={() => setLinkedRequest(null, null)}
                  />
                )}
                {/* Linked appointment pill */}
                {saved.linkedAppointmentId && (
                  <ContextPill
                    icon="calendar"
                    label="Appointment"
                    value={saved.linkedAppointmentLabel || "Linked"}
                    onDismiss={() => setLinkedAppointment(null, null)}
                  />
                )}
                {/* Linked place pill */}
                {saved.linkedPlaceId && (
                  <ContextPill
                    icon="map-pin"
                    label="Place"
                    value={saved.linkedPlaceLabel || "Linked"}
                    onDismiss={() => setLinkedPlace(null, null)}
                  />
                )}
                {/* Show available context if nothing auto-filled */}
                {!saved.linkedRequestId && !saved.linkedAppointmentId && !saved.linkedPlaceId && context && (
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", padding: "0.25rem 0" }}>
                    {context.active_requests.length === 0 &&
                      context.upcoming_appointments.length === 0 &&
                      context.service_places.length === 0
                      ? "No active requests, appointments, or service places found."
                      : "Context available — auto-fill was cleared."}
                  </div>
                )}
                {/* Recent checkouts reference */}
                {context && context.recent_checkouts.length > 0 && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                    Recent: {context.recent_checkouts.map((c) => c.equipment_name).join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===================== DUE DATE + NOTES ===================== */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "1rem" }}>
          <div>
            <label style={labelStyle}>Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
              style={{
                ...inputStyle,
                resize: "vertical",
                fontFamily: "inherit",
                minHeight: "48px",
              }}
            />
          </div>
        </div>

        {/* ===================== STAFF: PURPOSE (multi-select) ===================== */}
        <div
          style={{
            border: "1px solid var(--card-border, #e5e7eb)",
            borderRadius: "10px",
            padding: "0.875rem",
            background: "var(--section-bg, #f9fafb)",
          }}
        >
          <label style={{ ...labelStyle, fontSize: "0.7rem", color: checkoutPurpose ? "var(--muted)" : "var(--danger-text, #dc2626)" }}>
            Staff Use — Checkout Purpose * (select at least one)
          </label>
          <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginBottom: "0.625rem" }}>
            {(EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS as readonly { value: string; label: string; shortLabel: string }[]).map((opt) => {
              const isSelected = (saved.selectedPurposes || []).includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => togglePurpose(opt.value)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: "8px",
                    border: isSelected
                      ? "2px solid var(--primary)"
                      : "1px solid var(--card-border, #e5e7eb)",
                    background: isSelected
                      ? "var(--primary-bg, rgba(59,130,246,0.08))"
                      : "var(--card-bg, #fff)",
                    color: isSelected ? "var(--primary)" : "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: isSelected ? 700 : 500,
                    fontFamily: "inherit",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {opt.shortLabel || opt.label}
                </button>
              );
            })}
          </div>
          <label style={{ ...labelStyle, fontSize: "0.7rem", color: "var(--muted)" }}>
            Client-Stated Purpose (from paper slip)
          </label>
          <input
            type="text"
            value={saved.clientStatedPurpose || ""}
            onChange={(e) => setClientStatedPurpose(e.target.value)}
            placeholder="What the client wrote..."
            style={{ ...inputStyle, minHeight: "36px", padding: "0.4rem 0.75rem", fontSize: "0.85rem" }}
          />
        </div>

        {/* ===================== ACTIONS ===================== */}
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.25rem" }}>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onClick={onCancel}
            style={{ minHeight: "56px", borderRadius: "12px" }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            icon="log-out"
            loading={submitting}
            disabled={!canSubmit}
            onClick={handleRequestSubmit}
            style={{
              minHeight: "56px",
              borderRadius: "12px",
              background: canSubmit ? "var(--success-text, #16a34a)" : undefined,
              color: canSubmit ? "#fff" : undefined,
              border: canSubmit ? "1px solid transparent" : undefined,
            }}
          >
            Check Out
          </Button>
        </div>
      </div>
    </KioskCard>

    {/* FFS-1207 — Agreement modal (gates the checkout) */}
    {showAgreement && agreementText && (
      <KioskAgreementModal
        agreementText={agreementText}
        agreementVersion={agreementVersion || "1.0"}
        defaultName={custodianName}
        onAgree={(result) => handleSubmit(result)}
        onCancel={() => setShowAgreement(false)}
      />
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ContextPill({
  icon,
  label,
  value,
  onDismiss,
}: {
  icon: string;
  label: string;
  value: string;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.375rem 0.625rem",
        background: "var(--primary-bg, rgba(59,130,246,0.08))",
        border: "1px solid var(--primary-border, rgba(59,130,246,0.2))",
        borderRadius: "8px",
        fontSize: "0.8rem",
      }}
    >
      <Icon name={icon} size={14} color="var(--primary)" />
      <span style={{ color: "var(--text-secondary)", fontWeight: 500, flexShrink: 0 }}>
        {label}:
      </span>
      <span
        style={{
          color: "var(--text-primary)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 2px",
          color: "var(--muted)",
          fontSize: "0.9rem",
          lineHeight: 1,
          flexShrink: 0,
        }}
        title="Remove"
      >
        x
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


