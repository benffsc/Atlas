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
import { getLabel, EQUIPMENT_EVENT_TYPE_OPTIONS, EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS, EQUIPMENT_CHECKOUT_TYPE_OPTIONS } from "@/lib/form-options";
import { useAppConfig } from "@/hooks/useAppConfig";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

interface ScanResult extends VEquipmentInventoryRow {
  available_actions: string[];
  primary_action?: string | null;
}

type DrawerState = "idle" | "loading" | "found" | "action" | "checkout_cart";

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

// Shared form styles
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.8rem", fontWeight: 600,
  color: "var(--text-secondary)", textTransform: "uppercase",
  letterSpacing: "0.04em", marginBottom: "0.375rem",
};
const labelHintStyle: React.CSSProperties = {
  fontWeight: 400, textTransform: "none" as const, fontSize: "0.75rem",
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8,
  border: "1px solid var(--card-border)", background: "var(--background, #fff)",
  fontSize: "0.85rem", fontFamily: "inherit", color: "var(--text-primary)",
  boxSizing: "border-box",
};

interface EquipmentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
}

/**
 * Unified equipment drawer — scan-first, status-aware.
 *
 * Check-in: scan → HeroCheckinCard (one-tap).
 * Check-out: scan → add to cart → scan more → fill person once → "Check Out All".
 *
 * The cart model means you fill person details ONCE for N items.
 */
export function EquipmentDrawer({ isOpen, onClose, onComplete }: EquipmentDrawerProps) {
  const toast = useToast();
  const { value: PURPOSE_DUE_OFFSETS } = useAppConfig<Record<string, number>>("kiosk.purpose_due_offsets");
  const [state, setState] = useState<DrawerState>("idle");
  const [equipment, setEquipment] = useState<ScanResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastBarcode, setLastBarcode] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [forceGenericCard, setForceGenericCard] = useState(false);
  const [actionCount, setActionCount] = useState(0);

  // Checkout cart — accumulate items, fill person once, submit all
  const [checkoutCart, setCheckoutCart] = useState<ScanResult[]>([]);
  const [checkoutPerson, setCheckoutPerson] = useState<CollectedPerson>(EMPTY_PERSON);
  const [checkoutPlace, setCheckoutPlace] = useState<ResolvedPlace | null>(null);
  const [checkoutUnit, setCheckoutUnit] = useState("");
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [checkoutPurpose, setCheckoutPurpose] = useState("");
  const [checkoutType, setCheckoutType] = useState("");
  const [checkoutApptDate, setCheckoutApptDate] = useState("");
  const [checkoutDeposit, setCheckoutDeposit] = useState("0");
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);

  // Linked address from resolved person
  const [linkedAddress, setLinkedAddress] = useState<{ place_id: string; formatted_address: string } | null>(null);

  const abortRef = useRef<AbortController>();
  const scanIdRef = useRef(0);

  // Fetch person's address when resolved
  useEffect(() => {
    if (!checkoutPerson.is_resolved || !checkoutPerson.person_id) {
      setLinkedAddress(null);
      return;
    }
    let cancelled = false;
    fetchApi<{
      primary_place_id: string | null;
      primary_address: string | null;
      places: Array<{ place_id: string; formatted_address: string | null }> | null;
    }>(
      `/api/people/${checkoutPerson.person_id}`
    ).then((person) => {
      if (cancelled) return;
      // Try primary address first, fall back to first place
      if (person.primary_place_id && person.primary_address) {
        setLinkedAddress({ place_id: person.primary_place_id, formatted_address: person.primary_address });
      } else if (person.places?.length && person.places[0].formatted_address) {
        setLinkedAddress({ place_id: person.places[0].place_id, formatted_address: person.places[0].formatted_address });
      } else {
        setLinkedAddress(null);
      }
    }).catch(() => { if (!cancelled) setLinkedAddress(null); });
    return () => { cancelled = true; };
  }, [checkoutPerson.is_resolved, checkoutPerson.person_id]);

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
      setCheckoutCart([]);
      setCheckoutPerson(EMPTY_PERSON);
      setCheckoutPlace(null);
      setLinkedAddress(null);
      setCheckoutUnit("");
      setCheckoutNotes("");
      setCheckoutPurpose("");
      setCheckoutType("");
      setCheckoutApptDate("");
      setCheckoutDeposit("0");
    }
    return () => { abortRef.current?.abort(); };
  }, [isOpen]);

  const handleClose = () => {
    if (actionCount > 0) onComplete?.();
    onClose();
  };

  // ── Scan handler — context-aware ──
  // In checkout_cart mode, scanned available items auto-add to cart.
  // Otherwise, normal scan-first flow.
  const handleScan = useCallback(async (barcode: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const currentScanId = ++scanIdRef.current;

    setLastBarcode(barcode);
    setErrorMessage("");

    // If NOT in cart mode, reset action state
    if (state !== "checkout_cart") {
      setActiveAction(null);
      setForceGenericCard(false);
    }
    setState("loading");

    try {
      const result = await fetchApi<ScanResult>(
        `/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`,
        { signal: controller.signal },
      );
      if (scanIdRef.current !== currentScanId) return;

      // If we're in cart mode, try to add directly
      if (state === "checkout_cart" || checkoutCart.length > 0) {
        if (result.custody_status === "available") {
          // Check not already in cart
          if (checkoutCart.some((c) => c.equipment_id === result.equipment_id)) {
            toast.warning(`${result.display_name} is already in the cart`);
          } else {
            setCheckoutCart((prev) => [...prev, result]);
            toast.success(`Added ${result.display_name} to cart`);
          }
          setState("checkout_cart");
          setEquipment(null);
          return;
        }
        // Not available — show it normally so user can handle (check in, etc.)
        // but keep the cart alive
      }

      setEquipment(result);
      setState("found");
    } catch (err) {
      if (controller.signal.aborted) return;
      if (scanIdRef.current !== currentScanId) return;
      const message = err instanceof Error ? err.message : "Failed to look up equipment";
      setErrorMessage(message);
      setEquipment(null);
      setState(checkoutCart.length > 0 ? "checkout_cart" : "idle");
      toast.error(message);
    }
  }, [state, checkoutCart, toast]);

  const handleAction = useCallback((action: string) => {
    setActiveAction(action);
    setState("action");
  }, []);

  const reFetch = useCallback(async () => {
    if (!lastBarcode) { setState(checkoutCart.length > 0 ? "checkout_cart" : "idle"); setEquipment(null); return; }
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
      if (!controller.signal.aborted) {
        setState(checkoutCart.length > 0 ? "checkout_cart" : "idle");
        setEquipment(null);
      }
    }
  }, [lastBarcode, checkoutCart.length]);

  const handleSmartCardComplete = useCallback(() => {
    setActionCount((c) => c + 1);
    // After a check-in/found action, go back to cart if it has items
    if (checkoutCart.length > 0) {
      setState("checkout_cart");
      setEquipment(null);
    } else {
      reFetch();
    }
  }, [reFetch, checkoutCart.length]);

  const handleActionComplete = useCallback(() => {
    toast.success("Action completed");
    setActiveAction(null);
    setActionCount((c) => c + 1);
    if (checkoutCart.length > 0) {
      setState("checkout_cart");
      setEquipment(null);
    } else {
      reFetch();
    }
  }, [toast, reFetch, checkoutCart.length]);

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
    setCheckoutCart([]);
    setCheckoutPerson(EMPTY_PERSON);
    setCheckoutPlace(null);
    setCheckoutUnit("");
    setCheckoutNotes("");
    setCheckoutPurpose("");
    setCheckoutType("");
    setCheckoutApptDate("");
    setCheckoutDeposit("0");
  }, []);

  // ── Add to cart from AvailableTrapCard ──
  const handleAddToCart = useCallback(() => {
    if (!equipment) return;
    if (checkoutCart.some((c) => c.equipment_id === equipment.equipment_id)) {
      toast.warning("Already in cart");
      return;
    }
    setCheckoutCart((prev) => [...prev, equipment]);
    setState("checkout_cart");
    setEquipment(null);
    setLastBarcode("");
  }, [equipment, checkoutCart, toast]);

  const handleRemoveFromCart = useCallback((equipmentId: string) => {
    setCheckoutCart((prev) => {
      const next = prev.filter((c) => c.equipment_id !== equipmentId);
      if (next.length === 0) {
        setState("idle");
      }
      return next;
    });
  }, []);

  // ── Batch checkout — resolve person once, fire N events ──
  const handleBatchCheckout = useCallback(async () => {
    const name = `${checkoutPerson.first_name} ${checkoutPerson.last_name}`.trim();
    if (!name) {
      toast.error("Enter the borrower's name");
      return;
    }
    if (checkoutCart.length === 0) {
      toast.error("No items in cart");
      return;
    }

    setCheckoutSubmitting(true);
    try {
      // Resolve person once
      const resolution = await resolveCollectedPerson(checkoutPerson);

      const noteParts: string[] = [];
      if (checkoutNotes.trim()) noteParts.push(checkoutNotes.trim());
      if (checkoutPlace) {
        const addr = checkoutPlace.formatted_address || checkoutPlace.display_name;
        noteParts.push(`Address: ${addr}${checkoutUnit.trim() ? `, ${checkoutUnit.trim()}` : ""}`);
      } else if (checkoutUnit.trim()) {
        noteParts.push(`Unit: ${checkoutUnit.trim()}`);
      }
      if (checkoutCart.length > 1) {
        noteParts.push(`Batch: ${checkoutCart.length} items`);
      }
      const finalNotes = noteParts.join(" | ") || undefined;
      const phone = checkoutPerson.phone.replace(/\D/g, "") || undefined;

      // Compute due date from appointment date + purpose offset (min 7 days)
      let computedDueDate: string | undefined;
      if (checkoutApptDate) {
        const purposeOffset = (checkoutPurpose && PURPOSE_DUE_OFFSETS?.[checkoutPurpose]) || 7;
        const offset = Math.max(purposeOffset, 7);
        const apptDate = new Date(checkoutApptDate + "T00:00:00");
        apptDate.setDate(apptDate.getDate() + offset);
        computedDueDate = apptDate.toISOString().split("T")[0];
      }

      // Fire all checkout events
      const depositNum = checkoutDeposit ? Number(checkoutDeposit) : undefined;
      const results = await Promise.allSettled(
        checkoutCart.map((item) =>
          postApi(`/api/equipment/${item.equipment_id}/events`, {
            event_type: "check_out",
            custodian_person_id: resolution.person_id || undefined,
            custodian_name: name,
            custodian_name_raw: name,
            custodian_phone: phone,
            notes: finalNotes,
            checkout_purpose: checkoutPurpose || undefined,
            checkout_type: checkoutType || undefined,
            due_date: computedDueDate,
            deposit_amount: depositNum && !isNaN(depositNum) ? depositNum : undefined,
            ...(checkoutPlace?.place_id ? { place_id: checkoutPlace.place_id } : {}),
          })
        )
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      if (failed === 0) {
        toast.success(`${succeeded} item${succeeded !== 1 ? "s" : ""} checked out to ${name}`);
      } else {
        toast.warning(`${succeeded} succeeded, ${failed} failed`);
      }

      setActionCount((c) => c + succeeded);
      setCheckoutCart([]);
      setEquipment(null);
      setState("idle");
      setLastBarcode("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Batch checkout failed");
    } finally {
      setCheckoutSubmitting(false);
    }
  }, [checkoutCart, checkoutPerson, checkoutPlace, checkoutUnit, checkoutNotes, checkoutPurpose, checkoutType, checkoutApptDate, checkoutDeposit, PURPOSE_DUE_OFFSETS, toast]);

  // ── Display logic ──
  const showSmartCard = state === "found" && equipment && !forceGenericCard;
  const smartCardStatus = equipment?.custody_status;
  const useSmartCard = showSmartCard && (smartCardStatus === "checked_out" || smartCardStatus === "missing" || smartCardStatus === "available");
  const personName = `${checkoutPerson.first_name} ${checkoutPerson.last_name}`.trim();
  const inCartMode = state === "checkout_cart" || checkoutCart.length > 0;

  const footer = actionCount > 0 && !inCartMode ? (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <Icon name="check-circle" size={18} color="var(--success-text)" />
        <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--success-text)" }}>
          {actionCount} action{actionCount !== 1 ? "s" : ""} completed
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={handleReset}>
        Start Over
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
          placeholder={inCartMode ? "Scan another barcode to add to cart..." : "Scan barcode or type 4-digit ID..."}
          autoFocus={isOpen}
        />
      </div>

      {/* Not found */}
      {(state === "idle" || state === "checkout_cart") && errorMessage && (
        <div style={{
          padding: "0.75rem 1rem",
          background: "var(--warning-bg)",
          border: "1px solid var(--warning-border)",
          borderRadius: 10,
          textAlign: "center",
          marginBottom: "1rem",
        }}>
          <p style={{ color: "var(--warning-text)", fontWeight: 600, fontSize: "0.9rem", margin: 0 }}>
            {errorMessage}
          </p>
        </div>
      )}

      {/* ═══ CHECKOUT CART MODE ═══ */}
      {inCartMode && state !== "found" && state !== "action" && state !== "loading" && (
        <div style={{
          borderRadius: 12,
          border: "2px solid var(--warning-border)",
          background: "var(--warning-bg)",
          padding: "1.25rem",
        }}>
          {/* Cart header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Icon name="package-plus" size={20} color="var(--warning-text)" />
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
                Check Out {checkoutCart.length} Item{checkoutCart.length !== 1 ? "s" : ""}
              </h3>
            </div>
            <Button variant="ghost" size="sm" onClick={handleReset} style={{ fontSize: "0.75rem" }}>
              Clear
            </Button>
          </div>

          {/* Cart items */}
          <div style={{
            display: "flex", flexDirection: "column", gap: "0.375rem",
            marginBottom: "1rem",
            padding: "0.5rem",
            background: "var(--card-bg, #fff)",
            borderRadius: 8,
            border: "1px solid var(--card-border)",
          }}>
            {checkoutCart.map((item) => (
              <div
                key={item.equipment_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.375rem 0.5rem",
                  borderRadius: 6,
                  background: "var(--section-bg, #f9fafb)",
                }}
              >
                {item.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.photo_url}
                    alt={item.display_name}
                    style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
                  />
                ) : (
                  <div style={{
                    width: 32, height: 32, borderRadius: 6,
                    background: "var(--bg-secondary, #f3f4f6)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <Icon name={item.type_category === "cage" ? "grid-3x3" : "box"} size={16} color="var(--muted)" />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                    #{item.barcode}
                  </span>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600, marginLeft: "0.375rem" }}>
                    {item.display_name}
                  </span>
                </div>
                <button
                  onClick={() => handleRemoveFromCart(item.equipment_id)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: "0.25rem", color: "var(--muted)", flexShrink: 0,
                  }}
                  title="Remove"
                >
                  <Icon name="x" size={14} color="var(--muted)" />
                </button>
              </div>
            ))}
            <div style={{
              padding: "0.375rem 0.5rem",
              fontSize: "0.75rem",
              color: "var(--muted)",
              textAlign: "center",
              borderTop: "1px dashed var(--card-border)",
              marginTop: "0.125rem",
            }}>
              Scan another barcode above to add more items
            </div>
          </div>

          {/* Form fields — white card so text has proper contrast */}
          <div style={{
            background: "var(--card-bg, #fff)",
            borderRadius: 10,
            border: "1px solid var(--card-border)",
            padding: "1rem",
            display: "flex", flexDirection: "column", gap: "0.75rem",
          }}>
            {/* ── Borrower ── */}
            <KioskPersonCollector
              value={checkoutPerson}
              onChange={setCheckoutPerson}
            />

            {/* ── Address ── */}
            <div>
              <label style={labelStyle}>
                Address <span style={labelHintStyle}>(where equipment will be used)</span>
              </label>
              {linkedAddress && !checkoutPlace && (
                <button
                  type="button"
                  onClick={() => setCheckoutPlace({
                    place_id: linkedAddress.place_id,
                    display_name: linkedAddress.formatted_address,
                    formatted_address: linkedAddress.formatted_address,
                    locality: null,
                  })}
                  style={{
                    display: "flex", alignItems: "center", gap: "0.5rem",
                    width: "100%", padding: "0.5rem 0.75rem", marginBottom: "0.5rem",
                    borderRadius: 8,
                    border: "1px solid var(--info-border, #93c5fd)",
                    background: "var(--info-bg, #eff6ff)",
                    cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                    fontSize: "0.8rem", color: "var(--text-primary)",
                  }}
                >
                  <Icon name="map-pin" size={14} color="var(--info-text)" />
                  <span style={{ flex: 1 }}>
                    Use <strong>{checkoutPerson.display_name || checkoutPerson.first_name}</strong>&apos;s address:{" "}
                    <span style={{ color: "var(--text-secondary)" }}>{linkedAddress.formatted_address}</span>
                  </span>
                </button>
              )}
              <PlaceResolver
                value={checkoutPlace}
                onChange={setCheckoutPlace}
                placeholder="Search for an address..."
              />
            </div>

            <div>
              <label style={labelStyle}>
                Apt / Unit <span style={labelHintStyle}>(if applicable)</span>
              </label>
              <input
                type="text"
                value={checkoutUnit}
                onChange={(e) => setCheckoutUnit(e.target.value)}
                placeholder="e.g. Apt 5, Unit B, Space 12"
                style={inputStyle}
              />
            </div>

            {/* ── Checkout Details ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={labelStyle}>Purpose</label>
                <select
                  value={checkoutPurpose}
                  onChange={(e) => setCheckoutPurpose(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select...</option>
                  {EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Checkout Type</label>
                <select
                  value={checkoutType}
                  onChange={(e) => setCheckoutType(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select...</option>
                  {EQUIPMENT_CHECKOUT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={labelStyle}>Appointment Date</label>
                <input
                  type="date"
                  value={checkoutApptDate}
                  onChange={(e) => setCheckoutApptDate(e.target.value)}
                  style={inputStyle}
                />
                {checkoutApptDate && (() => {
                  const purposeOffset = (checkoutPurpose && PURPOSE_DUE_OFFSETS?.[checkoutPurpose]) || 7;
                  const offset = Math.max(purposeOffset, 7);
                  const d = new Date(checkoutApptDate + "T00:00:00");
                  d.setDate(d.getDate() + offset);
                  return (
                    <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 4 }}>
                      Due back {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (+{offset}d)
                    </div>
                  );
                })()}
              </div>
              <div>
                <label style={labelStyle}>
                  Deposit <span style={labelHintStyle}>($)</span>
                </label>
                <input
                  type="number"
                  value={checkoutDeposit}
                  onChange={(e) => setCheckoutDeposit(e.target.value)}
                  placeholder="0"
                  min="0"
                  step="5"
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>
                Notes <span style={labelHintStyle}>(optional)</span>
              </label>
              <input
                type="text"
                value={checkoutNotes}
                onChange={(e) => setCheckoutNotes(e.target.value)}
                placeholder="e.g. Paper form filled, appointment 5/15..."
                style={inputStyle}
              />
            </div>
          </div>

          {/* Actions — outside white card */}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <Button variant="ghost" size="lg" onClick={handleReset} style={{ flex: 1, borderRadius: 10 }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="lg"
              icon="log-out"
              loading={checkoutSubmitting}
              disabled={!personName || checkoutCart.length === 0}
              onClick={handleBatchCheckout}
              style={{ flex: 2, borderRadius: 10 }}
            >
              Check Out{checkoutCart.length > 1 ? ` All (${checkoutCart.length})` : ""}
            </Button>
          </div>
        </div>
      )}

      {/* ═══ SMART CARDS — non-checkout scan results ═══ */}
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
          onCheckOut={handleAddToCart}
        />
      )}

      {/* Generic card fallback + non-checkout action forms */}
      {(state === "found" || state === "action") && equipment && (forceGenericCard || !useSmartCard) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* For available items in generic view, show "Add to Cart" instead of per-item checkout */}
          {state === "found" && equipment.custody_status === "available" && (
            <div style={{
              padding: "1rem",
              borderRadius: 10,
              border: "1px solid var(--card-border)",
              background: "var(--card-bg, #fff)",
              display: "flex", alignItems: "center", gap: "0.75rem",
            }}>
              {equipment.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={equipment.photo_url} alt={equipment.display_name}
                  style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 48, height: 48, borderRadius: 8, background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name={equipment.type_category === "cage" ? "grid-3x3" : "box"} size={22} color="var(--muted)" />
                </div>
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "var(--text-secondary)" }}>#{equipment.barcode}</span>{" "}
                  {equipment.display_name}
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--success-text)" }}>Available</div>
              </div>
              <Button variant="primary" size="sm" icon="plus" onClick={handleAddToCart} style={{ borderRadius: 8 }}>
                Add to Cart
              </Button>
            </div>
          )}

          {/* Non-available items get the standard cards */}
          {state === "found" && equipment.custody_status !== "available" && (
            <KioskEquipmentCard equipment={equipment} onAction={handleAction} />
          )}

          {/* Non-checkout action forms */}
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

          {/* For action=check_out on generic card, show add-to-cart prompt */}
          {state === "action" && activeAction === "check_out" && equipment.custody_status === "available" && (
            <div style={{ textAlign: "center", padding: "1rem" }}>
              <Button variant="primary" size="lg" icon="plus" onClick={handleAddToCart} style={{ borderRadius: 10 }}>
                Add {equipment.display_name} to Cart
              </Button>
              <Button variant="ghost" size="sm" onClick={handleActionCancel} style={{ marginTop: "0.5rem" }}>
                Cancel
              </Button>
            </div>
          )}

          {state === "found" && !inCartMode && (
            <Button variant="ghost" size="lg" icon="scan-barcode" fullWidth onClick={handleReset} style={{ marginTop: "0.25rem" }}>
              Scan Another
            </Button>
          )}

          {state === "found" && inCartMode && (
            <Button variant="ghost" size="sm" onClick={() => { setState("checkout_cart"); setEquipment(null); }} style={{ marginTop: "0.25rem" }}>
              Back to Cart ({checkoutCart.length} item{checkoutCart.length !== 1 ? "s" : ""})
            </Button>
          )}
        </div>
      )}

      {/* Idle hint */}
      {state === "idle" && !errorMessage && !inCartMode && (
        <EmptyState
          title="Scan or type a barcode"
          description="Type the 4-digit barcode ID or scan with a USB scanner. The right action will appear based on the item's status."
          size="lg"
        />
      )}
    </ActionDrawer>
  );
}
