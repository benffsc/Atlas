"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { BarcodeInput } from "@/components/equipment/BarcodeInput";
import { HeroCheckinCard } from "@/components/equipment/HeroCheckinCard";
import { AvailableTrapCard } from "@/components/equipment/AvailableTrapCard";
import { FoundTrapFlow } from "@/components/equipment/FoundTrapFlow";
import { KioskEquipmentCard } from "@/components/kiosk/KioskEquipmentCard";
import { KioskPersonAutosuggest, type PersonReference } from "@/components/kiosk/KioskPersonAutosuggest";
import { SimpleActionConfirm } from "@/components/kiosk/SimpleActionConfirm";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/feedback/EmptyState";
import { getLabel, EQUIPMENT_EVENT_TYPE_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

interface ScanResult extends VEquipmentInventoryRow {
  available_actions: string[];
  primary_action?: string | null;
}

type DrawerState = "idle" | "loading" | "found" | "action";

interface EquipmentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

/**
 * Unified equipment drawer — scan-first, status-aware.
 * One button on the dashboard opens this. Scan a barcode (or type 4-digit ID),
 * and the drawer shows the right action: check-in if out, check-out if available.
 * Same intelligence as the kiosk scan page, but in a slide-over.
 */
export function EquipmentDrawer({ isOpen, onClose, onComplete }: EquipmentDrawerProps) {
  const toast = useToast();
  const [state, setState] = useState<DrawerState>("idle");
  const [equipment, setEquipment] = useState<ScanResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastBarcode, setLastBarcode] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [forceGenericCard, setForceGenericCard] = useState(false);
  const [actionCount, setActionCount] = useState(0);

  // Inline checkout state (lightweight — no kiosk context needed)
  const [checkoutCustodian, setCheckoutCustodian] = useState<PersonReference>({
    person_id: null, display_name: "", is_resolved: false,
  });
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);

  const abortRef = useRef<AbortController>();
  const scanIdRef = useRef(0);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setState("idle");
      setEquipment(null);
      setErrorMessage("");
      setLastBarcode("");
      setActiveAction(null);
      setForceGenericCard(false);
      setActionCount(0);
      setCheckoutCustodian({ person_id: null, display_name: "", is_resolved: false });
      setCheckoutNotes("");
    }
    return () => { abortRef.current?.abort(); };
  }, [isOpen]);

  const handleClose = () => {
    if (actionCount > 0) onComplete?.();
    onClose();
  };

  const handleScan = useCallback(async (barcode: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const currentScanId = ++scanIdRef.current;

    setLastBarcode(barcode);
    setActiveAction(null);
    setForceGenericCard(false);
    setState("loading");
    setErrorMessage("");

    try {
      const result = await fetchApi<ScanResult>(
        `/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`,
        { signal: controller.signal },
      );
      if (scanIdRef.current !== currentScanId) return;
      setEquipment(result);
      setState("found");
    } catch (err) {
      if (controller.signal.aborted) return;
      if (scanIdRef.current !== currentScanId) return;
      const message = err instanceof Error ? err.message : "Failed to look up equipment";
      setErrorMessage(message);
      setEquipment(null);
      setState("idle");
      toast.error(message);
    }
  }, [toast]);

  const handleAction = useCallback((action: string) => {
    setActiveAction(action);
    setState("action");
  }, []);

  const reFetch = useCallback(async () => {
    if (!lastBarcode) { setState("idle"); setEquipment(null); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("loading");
    try {
      const result = await fetchApi<ScanResult>(
        `/api/equipment/scan?barcode=${encodeURIComponent(lastBarcode)}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setEquipment(result);
        setForceGenericCard(false);
        setState("found");
      }
    } catch {
      if (!controller.signal.aborted) { setState("idle"); setEquipment(null); }
    }
  }, [lastBarcode]);

  const handleSmartCardComplete = useCallback(() => {
    setActionCount((c) => c + 1);
    reFetch();
  }, [reFetch]);

  const handleActionComplete = useCallback(() => {
    toast.success("Action completed");
    setActiveAction(null);
    setActionCount((c) => c + 1);
    reFetch();
  }, [toast, reFetch]);

  const handleActionCancel = useCallback(() => {
    setActiveAction(null);
    setState("found");
  }, []);

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
    setEquipment(null);
    setActiveAction(null);
    setForceGenericCard(false);
    setErrorMessage("");
    setLastBarcode("");
  }, []);

  // Inline checkout handler (for AvailableTrapCard → check_out)
  const handleInlineCheckout = useCallback(async () => {
    if (!equipment || !checkoutCustodian.display_name.trim()) {
      toast.error("Enter who is taking this equipment");
      return;
    }
    setCheckoutSubmitting(true);
    try {
      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: "check_out",
        custodian_person_id: checkoutCustodian.person_id || undefined,
        custodian_name: checkoutCustodian.display_name.trim(),
        custodian_name_raw: checkoutCustodian.display_name.trim(),
        notes: checkoutNotes.trim() || undefined,
      });
      toast.success(`${equipment.display_name} → ${checkoutCustodian.display_name.trim()}`);
      setActionCount((c) => c + 1);
      // Keep custodian for batch checkouts, reset notes
      setCheckoutNotes("");
      setActiveAction(null);
      reFetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-out failed");
    } finally {
      setCheckoutSubmitting(false);
    }
  }, [equipment, checkoutCustodian, checkoutNotes, toast, reFetch]);

  // Smart card display logic
  const showSmartCard = state === "found" && equipment && !forceGenericCard;
  const smartCardStatus = equipment?.custody_status;
  const useSmartCard = showSmartCard && (smartCardStatus === "checked_out" || smartCardStatus === "missing" || smartCardStatus === "available");

  const footer = actionCount > 0 ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <Icon name="check-circle" size={18} color="var(--success-text)" />
        <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--success-text)" }}>
          {actionCount} action{actionCount !== 1 ? "s" : ""} completed
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={handleReset}>
        Scan Another
      </Button>
    </div>
  ) : undefined;

  return (
    <ActionDrawer isOpen={isOpen} onClose={handleClose} title="Equipment" width="lg" footer={footer}>
      {/* Barcode input — always visible */}
      <div style={{ marginBottom: "1rem" }}>
        <BarcodeInput
          onScan={handleScan}
          loading={state === "loading"}
          placeholder="Scan barcode or type 4-digit ID..."
          autoFocus={isOpen}
        />
      </div>

      {/* Not found */}
      {state === "idle" && errorMessage && (
        <div style={{
          padding: "1rem",
          background: "var(--warning-bg)",
          border: "1px solid var(--warning-border)",
          borderRadius: 10,
          textAlign: "center",
          marginBottom: "1rem",
        }}>
          <Icon name="help-circle" size={28} color="var(--warning-text)" />
          <p style={{ color: "var(--warning-text)", fontWeight: 600, fontSize: "0.95rem", margin: "0.5rem 0 0.25rem" }}>
            Not Recognized
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: 0 }}>
            {errorMessage}
          </p>
        </div>
      )}

      {/* Smart cards — same as kiosk */}
      {useSmartCard && smartCardStatus === "checked_out" && (
        <HeroCheckinCard
          equipmentId={equipment.equipment_id}
          equipmentName={equipment.display_name}
          custodianName={equipment.custodian_name || equipment.current_holder_name || null}
          custodianId={equipment.current_custodian_id || null}
          currentCondition={equipment.condition_status}
          daysOut={equipment.days_checked_out}
          onComplete={handleSmartCardComplete}
          onOtherActions={() => setForceGenericCard(true)}
        />
      )}

      {useSmartCard && smartCardStatus === "missing" && (
        <FoundTrapFlow
          equipmentId={equipment.equipment_id}
          equipmentName={equipment.display_name}
          onComplete={handleSmartCardComplete}
        />
      )}

      {useSmartCard && smartCardStatus === "available" && (
        <AvailableTrapCard
          equipmentId={equipment.equipment_id}
          equipmentName={equipment.display_name}
          onComplete={handleSmartCardComplete}
          onCheckOut={() => {
            setForceGenericCard(true);
            handleAction("check_out");
          }}
        />
      )}

      {/* Generic card fallback + action forms */}
      {(state === "found" || state === "action") && equipment && (forceGenericCard || !useSmartCard) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Hide equipment card when in checkout action — the inline form has context */}
          {!(state === "action" && activeAction === "check_out") && (
            <KioskEquipmentCard
              equipment={equipment}
              onAction={handleAction}
            />
          )}

          {/* Inline checkout form — lightweight, no kiosk context needed */}
          {state === "action" && activeAction === "check_out" && (
            <div style={{
              borderRadius: 12,
              border: "2px solid var(--warning-border)",
              background: "var(--warning-bg)",
              padding: "1.25rem",
            }}>
              <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                <Icon name="log-out" size={28} color="var(--warning-text)" />
                <h3 style={{ margin: "0.5rem 0 0.25rem", fontSize: "1.05rem", fontWeight: 700 }}>
                  Check out {equipment.display_name}
                </h3>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <KioskPersonAutosuggest
                  value={checkoutCustodian}
                  onChange={setCheckoutCustodian}
                  placeholder="Who is taking this equipment?"
                  label="Check out to"
                />
                <div>
                  <label style={{
                    display: "block", fontSize: "0.7rem", fontWeight: 700,
                    color: "var(--text-secondary)", textTransform: "uppercase",
                    letterSpacing: "0.04em", marginBottom: 4,
                  }}>
                    Notes <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={checkoutNotes}
                    onChange={(e) => setCheckoutNotes(e.target.value)}
                    placeholder="e.g. Paper form, for trapping at Dutton..."
                    style={{
                      width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8,
                      border: "1px solid var(--card-border)", background: "var(--background, #fff)",
                      fontSize: "0.85rem", fontFamily: "inherit", color: "var(--text-primary)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <Button variant="ghost" size="lg" onClick={handleActionCancel} style={{ flex: 1, borderRadius: 10 }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    icon="log-out"
                    loading={checkoutSubmitting}
                    disabled={!checkoutCustodian.display_name.trim()}
                    onClick={handleInlineCheckout}
                    style={{ flex: 2, borderRadius: 10 }}
                  >
                    Check Out
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Generic action forms (not check_out) */}
          {state === "action" && activeAction && activeAction !== "check_out" && activeAction !== "check_in" && (
            <SimpleActionConfirm
              equipmentId={equipment.equipment_id}
              action={activeAction}
              actionLabel={getLabel(EQUIPMENT_EVENT_TYPE_OPTIONS, activeAction)}
              currentCondition={equipment.condition_status}
              onComplete={handleActionComplete}
              onCancel={handleActionCancel}
            />
          )}

          {state === "found" && (
            <Button
              variant="ghost"
              size="lg"
              icon="scan-barcode"
              fullWidth
              onClick={handleReset}
              style={{ marginTop: "0.25rem" }}
            >
              Scan Another
            </Button>
          )}
        </div>
      )}

      {/* Idle hint */}
      {state === "idle" && !errorMessage && (
        <EmptyState
          title="Scan or type a barcode"
          description="Type the 4-digit barcode ID or scan with a USB scanner. The right action will appear based on the item's status."
          size="lg"
        />
      )}
    </ActionDrawer>
  );
}
