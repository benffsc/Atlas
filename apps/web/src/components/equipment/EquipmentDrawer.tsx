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
import { KioskPersonCollector, resolveCollectedPerson, type CollectedPerson } from "@/components/kiosk/KioskPersonCollector";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
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

interface CheckedOutItem {
  barcode: string | null;
  name: string;
}

const EMPTY_PERSON: CollectedPerson = {
  person_id: null,
  display_name: "",
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  is_resolved: false,
  resolution_type: "unresolved",
};

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
 *
 * Checkout form uses KioskPersonCollector (first/last/phone/email with background
 * matching) + PlaceResolver (Google address autocomplete) — matching the paper form.
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

  // Checkout form state — persists across "check out another" scans
  const [checkoutPerson, setCheckoutPerson] = useState<CollectedPerson>(EMPTY_PERSON);
  const [checkoutPlace, setCheckoutPlace] = useState<ResolvedPlace | null>(null);
  const [checkoutUnit, setCheckoutUnit] = useState("");
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [checkedOutItems, setCheckedOutItems] = useState<CheckedOutItem[]>([]);

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
      setCheckoutPerson(EMPTY_PERSON);
      setCheckoutPlace(null);
      setCheckoutUnit("");
      setCheckoutNotes("");
      setCheckedOutItems([]);
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

  // "Check out another" — reset scan state but keep person/place
  const handleCheckoutAnother = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
    setEquipment(null);
    setActiveAction(null);
    setForceGenericCard(false);
    setErrorMessage("");
    setLastBarcode("");
    // Keep checkoutPerson, checkoutPlace, checkoutNotes for batch
  }, []);

  // Checkout handler — resolves person, posts event, supports batch
  const handleInlineCheckout = useCallback(async () => {
    if (!equipment) return;
    const name = `${checkoutPerson.first_name} ${checkoutPerson.last_name}`.trim();
    if (!name) {
      toast.error("Enter the borrower's name");
      return;
    }

    setCheckoutSubmitting(true);
    try {
      // Resolve or create person via identity engine
      const resolution = await resolveCollectedPerson(checkoutPerson);

      const noteParts: string[] = [];
      if (checkoutNotes.trim()) noteParts.push(checkoutNotes.trim());
      if (checkoutPlace) {
        const addr = checkoutPlace.formatted_address || checkoutPlace.display_name;
        noteParts.push(`Address: ${addr}${checkoutUnit.trim() ? `, ${checkoutUnit.trim()}` : ""}`);
      } else if (checkoutUnit.trim()) {
        noteParts.push(`Unit: ${checkoutUnit.trim()}`);
      }

      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: "check_out",
        custodian_person_id: resolution.person_id || undefined,
        custodian_name: name,
        custodian_name_raw: name,
        notes: noteParts.join(" | ") || undefined,
        // Pass place if resolved so backend can link
        ...(checkoutPlace?.place_id ? { place_id: checkoutPlace.place_id } : {}),
      });

      toast.success(`${equipment.display_name} → ${name}`);
      setActionCount((c) => c + 1);
      setCheckedOutItems((prev) => [...prev, {
        barcode: equipment.barcode,
        name: equipment.display_name,
      }]);

      // Update person with resolved ID for next batch item
      if (resolution.person_id && !checkoutPerson.person_id) {
        setCheckoutPerson((prev) => ({
          ...prev,
          person_id: resolution.person_id,
          is_resolved: true,
          resolution_type: resolution.resolution_type,
        }));
      }

      setActiveAction(null);
      reFetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-out failed");
    } finally {
      setCheckoutSubmitting(false);
    }
  }, [equipment, checkoutPerson, checkoutPlace, checkoutNotes, toast, reFetch]);

  // Smart card display logic
  const showSmartCard = state === "found" && equipment && !forceGenericCard;
  const smartCardStatus = equipment?.custody_status;
  const useSmartCard = showSmartCard && (smartCardStatus === "checked_out" || smartCardStatus === "missing" || smartCardStatus === "available");

  const personName = `${checkoutPerson.first_name} ${checkoutPerson.last_name}`.trim();

  const footer = actionCount > 0 ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <Icon name="check-circle" size={18} color="var(--success-text)" />
        <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--success-text)" }}>
          {actionCount} action{actionCount !== 1 ? "s" : ""} completed
        </span>
      </div>
      {checkedOutItems.length > 0 && state !== "action" ? (
        <Button variant="ghost" size="sm" onClick={handleCheckoutAnother}>
          + Another Item
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={handleReset}>
          Scan Another
        </Button>
      )}
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

      {/* Batch checkout summary — shows items already checked out this session */}
      {checkedOutItems.length > 0 && state !== "action" && (
        <div style={{
          padding: "0.5rem 0.75rem",
          background: "var(--warning-bg)",
          border: "1px solid var(--warning-border)",
          borderRadius: 8,
          marginBottom: "1rem",
          fontSize: "0.8rem",
        }}>
          <div style={{ fontWeight: 600, color: "var(--warning-text)", marginBottom: 2 }}>
            Checked out to {personName}:
          </div>
          {checkedOutItems.map((item, i) => (
            <span key={i} style={{ color: "var(--text-secondary)" }}>
              {i > 0 && ", "}
              {item.barcode ? `#${item.barcode}` : ""} {item.name}
            </span>
          ))}
        </div>
      )}

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
          {/* Hide equipment card when in checkout action */}
          {!(state === "action" && activeAction === "check_out") && (
            <KioskEquipmentCard
              equipment={equipment}
              onAction={handleAction}
            />
          )}

          {/* ═══ CHECKOUT FORM ═══ */}
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
                {/* Person collector — first/last name, phone, email with background matching */}
                <KioskPersonCollector
                  value={checkoutPerson}
                  onChange={setCheckoutPerson}
                />

                {/* Address — Google autocomplete */}
                <div>
                  <label style={{
                    display: "block", fontSize: "0.8rem", fontWeight: 600,
                    color: "var(--text-secondary)", textTransform: "uppercase",
                    letterSpacing: "0.04em", marginBottom: "0.375rem",
                  }}>
                    Address <span style={{ fontWeight: 400, textTransform: "none", fontSize: "0.75rem" }}>(where equipment will be used)</span>
                  </label>
                  <PlaceResolver
                    value={checkoutPlace}
                    onChange={setCheckoutPlace}
                    placeholder="Search for an address..."
                  />
                </div>

                {/* Unit / Apt */}
                <div>
                  <label style={{
                    display: "block", fontSize: "0.8rem", fontWeight: 600,
                    color: "var(--text-secondary)", textTransform: "uppercase",
                    letterSpacing: "0.04em", marginBottom: "0.375rem",
                  }}>
                    Apt / Unit <span style={{ fontWeight: 400, textTransform: "none" }}>(if applicable)</span>
                  </label>
                  <input
                    type="text"
                    value={checkoutUnit}
                    onChange={(e) => setCheckoutUnit(e.target.value)}
                    placeholder="e.g. Apt 5, Unit B, Space 12"
                    style={{
                      width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8,
                      border: "1px solid var(--card-border)", background: "var(--background, #fff)",
                      fontSize: "0.85rem", fontFamily: "inherit", color: "var(--text-primary)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Notes */}
                <div>
                  <label style={{
                    display: "block", fontSize: "0.8rem", fontWeight: 600,
                    color: "var(--text-secondary)", textTransform: "uppercase",
                    letterSpacing: "0.04em", marginBottom: "0.375rem",
                  }}>
                    Notes <span style={{ fontWeight: 400, textTransform: "none" }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={checkoutNotes}
                    onChange={(e) => setCheckoutNotes(e.target.value)}
                    placeholder="e.g. Deposit $75, transport to clinic..."
                    style={{
                      width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8,
                      border: "1px solid var(--card-border)", background: "var(--background, #fff)",
                      fontSize: "0.85rem", fontFamily: "inherit", color: "var(--text-primary)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                  <Button variant="ghost" size="lg" onClick={handleActionCancel} style={{ flex: 1, borderRadius: 10 }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    icon="log-out"
                    loading={checkoutSubmitting}
                    disabled={!personName}
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
