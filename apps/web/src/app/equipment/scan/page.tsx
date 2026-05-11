"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { BarcodeInput } from "@/components/equipment/BarcodeInput";
import { HeroCheckinCard } from "@/components/equipment/HeroCheckinCard";
import { AvailableTrapCard } from "@/components/equipment/AvailableTrapCard";
import { FoundTrapFlow } from "@/components/equipment/FoundTrapFlow";
import { KioskEquipmentCard } from "@/components/kiosk/KioskEquipmentCard";
import { KioskPersonCollector, resolveCollectedPerson, type CollectedPerson } from "@/components/kiosk/KioskPersonCollector";
import PlaceResolver from "@/components/forms/PlaceResolver";
import type { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { SimpleActionConfirm } from "@/components/kiosk/SimpleActionConfirm";
import { ScanSessionHistory, type ScanHistoryEntry } from "@/components/equipment/ScanSessionHistory";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useScanFeedback } from "@/hooks/useScanFeedback";
import { getLabel, EQUIPMENT_EVENT_TYPE_OPTIONS, EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS, EQUIPMENT_CHECKOUT_TYPE_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

const CameraScanner = dynamic(
  () => import("@/components/kiosk/CameraScanner").then((mod) => mod.CameraScanner),
  { ssr: false },
);

interface ScanResult extends VEquipmentInventoryRow {
  available_actions: string[];
  primary_action?: string | null;
}

type PageState = "idle" | "loading" | "found" | "action" | "checkout";

const EMPTY_PERSON: CollectedPerson = {
  person_id: null, display_name: "", first_name: "", last_name: "",
  phone: "", email: "", is_resolved: false, resolution_type: "unresolved",
};

const DEPARTMENTS = [
  { value: "relo", label: "Relo", purpose: "transport", dueOffset: 2 },
  { value: "clinic", label: "Clinic", purpose: "ffr", dueOffset: 1 },
  { value: "foster_room", label: "Foster Room", purpose: "rescue_recovery", dueOffset: 14 },
  { value: "cat_room", label: "Cat Room", purpose: "rescue_recovery", dueOffset: 7 },
  { value: "barn_cat", label: "Barn Cat Program", purpose: "transport", dueOffset: 14 },
] as const;

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.8rem", fontWeight: 600,
  color: "var(--text-secondary)", textTransform: "uppercase",
  letterSpacing: "0.04em", marginBottom: "0.375rem",
};
const labelHintStyle: React.CSSProperties = { fontWeight: 400, textTransform: "none" as const, fontSize: "0.75rem" };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8,
  border: "1px solid var(--card-border)", background: "var(--background, #fff)",
  fontSize: "0.85rem", fontFamily: "inherit", color: "var(--text-primary)", boxSizing: "border-box",
};

/**
 * Staff Equipment Scan — mobile-optimized, full-featured.
 * No kiosk ceremony — your login IS your identity.
 * Route: /equipment/scan
 */
export default function StaffScanPage() {
  const toast = useToast();
  const { playSuccess, playError, vibrate } = useScanFeedback();
  const { value: PURPOSE_DUE_OFFSETS } = useAppConfig<Record<string, number>>("kiosk.purpose_due_offsets");

  const [state, setState] = useState<PageState>("idle");
  const [equipment, setEquipment] = useState<ScanResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [forceGenericCard, setForceGenericCard] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<ScanHistoryEntry[]>([]);

  // Cart for multi-item checkout
  const [checkoutCart, setCheckoutCart] = useState<ScanResult[]>([]);

  const [checkoutBorrowerType, setCheckoutBorrowerType] = useState<"person" | "department">("person");
  const [checkoutDept, setCheckoutDept] = useState("");
  const [checkoutPerson, setCheckoutPerson] = useState<CollectedPerson>(EMPTY_PERSON);
  const [checkoutPlace, setCheckoutPlace] = useState<ResolvedPlace | null>(null);
  const [checkoutUnit, setCheckoutUnit] = useState("");
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [checkoutPurpose, setCheckoutPurpose] = useState("");
  const [checkoutType, setCheckoutType] = useState("");
  const [checkoutApptDate, setCheckoutApptDate] = useState("");
  const [checkoutDeposit, setCheckoutDeposit] = useState("0");
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [linkedAddresses, setLinkedAddresses] = useState<Array<{ place_id: string; formatted_address: string }>>([]);

  const abortRef = useRef<AbortController>();
  const scanIdRef = useRef(0);

  // Fetch person's linked addresses (all of them)
  useEffect(() => {
    if (!checkoutPerson.is_resolved || !checkoutPerson.person_id) { setLinkedAddresses([]); return; }
    let cancelled = false;
    fetchApi<{ primary_place_id: string | null; primary_address: string | null; places: Array<{ place_id: string; formatted_address: string | null }> | null }>(
      `/api/people/${checkoutPerson.person_id}`
    ).then((p) => {
      if (cancelled) return;
      const addrs: Array<{ place_id: string; formatted_address: string }> = [];
      // Primary first
      if (p.primary_place_id && p.primary_address) {
        addrs.push({ place_id: p.primary_place_id, formatted_address: p.primary_address });
      }
      // Then all other places (deduped)
      if (p.places) {
        for (const pl of p.places) {
          if (pl.formatted_address && !addrs.some((a) => a.place_id === pl.place_id)) {
            addrs.push({ place_id: pl.place_id, formatted_address: pl.formatted_address });
          }
        }
      }
      setLinkedAddresses(addrs);
    }).catch(() => { if (!cancelled) setLinkedAddresses([]); });
    return () => { cancelled = true; };
  }, [checkoutPerson.is_resolved, checkoutPerson.person_id]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ── Scan — auto-adds to cart when in checkout mode ──
  const handleScan = useCallback(async (barcode: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = ++scanIdRef.current;
    if (state !== "checkout") { setActiveAction(null); setForceGenericCard(false); }
    setState("loading"); setErrorMessage(""); setShowCamera(false);
    try {
      const result = await fetchApi<ScanResult>(`/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`, { signal: controller.signal });
      if (scanIdRef.current !== id) return;

      // If in checkout/cart mode, auto-add available items
      if ((state === "checkout" || checkoutCart.length > 0) && result.custody_status === "available") {
        if (checkoutCart.some((c) => c.equipment_id === result.equipment_id)) {
          toast.warning(`${result.display_name} is already in the cart`);
        } else {
          setCheckoutCart((prev) => [...prev, result]);
          toast.success(`Added ${result.display_name} to cart`);
          playSuccess(); vibrate();
        }
        setState("checkout");
        setEquipment(null);
        return;
      }

      setEquipment(result); setState("found"); playSuccess(); vibrate();
    } catch (err) {
      if (controller.signal.aborted || scanIdRef.current !== id) return;
      playError(); setErrorMessage(err instanceof Error ? err.message : "Not found");
      setEquipment(null); setState(checkoutCart.length > 0 ? "checkout" : "idle");
    }
  }, [state, checkoutCart, playSuccess, playError, vibrate, toast]);

  const handleAction = useCallback((action: string) => { setActiveAction(action); setState("action"); }, []);
  const handleReset = useCallback(() => {
    abortRef.current?.abort(); setState("idle"); setEquipment(null); setActiveAction(null);
    setForceGenericCard(false); setErrorMessage(""); setCheckoutCart([]);
  }, []);
  const handleAddToCart = useCallback(() => {
    if (!equipment) return;
    if (checkoutCart.some((c) => c.equipment_id === equipment.equipment_id)) { toast.warning("Already in cart"); return; }
    setCheckoutCart((prev) => [...prev, equipment]);
    setState("checkout"); setEquipment(null);
  }, [equipment, checkoutCart, toast]);
  const handleRemoveFromCart = useCallback((equipmentId: string) => {
    setCheckoutCart((prev) => { const next = prev.filter((c) => c.equipment_id !== equipmentId); if (next.length === 0) setState("idle"); return next; });
  }, []);

  const reFetch = useCallback(() => { if (equipment?.barcode) handleScan(equipment.barcode); else handleReset(); }, [equipment?.barcode, handleScan, handleReset]);

  const addHistory = useCallback((action: string) => {
    setSessionHistory((prev) => [{ barcode: equipment?.barcode || "", name: equipment?.display_name || "", action, success: true, timestamp: new Date() }, ...prev.slice(0, 19)]);
  }, [equipment]);

  const handleSmartCardComplete = useCallback(() => {
    addHistory(equipment?.custody_status === "checked_out" ? "check_in" : "action");
    if (checkoutCart.length > 0) { setState("checkout"); setEquipment(null); } else reFetch();
  }, [equipment, addHistory, reFetch, checkoutCart.length]);
  const handleActionComplete = useCallback(() => {
    toast.success("Done"); addHistory(activeAction || "action"); setActiveAction(null);
    if (checkoutCart.length > 0) { setState("checkout"); setEquipment(null); } else reFetch();
  }, [toast, activeAction, addHistory, reFetch, checkoutCart.length]);
  const handleActionCancel = useCallback(() => { setActiveAction(null); setState("found"); }, []);

  // ── Batch checkout submit ──
  const handleCheckout = useCallback(async () => {
    const items = checkoutCart.length > 0 ? checkoutCart : (equipment ? [equipment] : []);
    if (items.length === 0) return;

    const isDept = checkoutBorrowerType === "department";
    const dept = isDept ? DEPARTMENTS.find((d) => d.value === checkoutDept) : null;
    const name = isDept ? (dept?.label || checkoutDept) : `${checkoutPerson.first_name} ${checkoutPerson.last_name}`.trim();
    if (!name) { toast.error(isDept ? "Select a department" : "Enter the borrower's name"); return; }
    setCheckoutSubmitting(true);
    try {
      const resolution = isDept ? { person_id: null, resolution_type: "unresolved" as const } : await resolveCollectedPerson(checkoutPerson);
      const effectiveType = isDept ? "internal" : checkoutType;
      const effectivePurpose = isDept ? (dept?.purpose || checkoutPurpose) : checkoutPurpose;
      const isAssign = effectiveType === "trapper" || effectiveType === "internal";
      const noteParts: string[] = [];
      if (checkoutNotes.trim()) noteParts.push(checkoutNotes.trim());
      if (checkoutPlace) {
        const addr = checkoutPlace.formatted_address || checkoutPlace.display_name;
        noteParts.push(`Address: ${addr}${checkoutUnit.trim() ? `, ${checkoutUnit.trim()}` : ""}`);
      } else if (checkoutUnit.trim()) noteParts.push(`Unit: ${checkoutUnit.trim()}`);
      if (items.length > 1) noteParts.push(`Batch: ${items.length} items`);
      const finalNotes = noteParts.join(" | ") || undefined;

      let dueDate: string | undefined;
      if (isDept && dept?.dueOffset) {
        // Department checkout: due date = now + dept offset
        const d = new Date(); d.setDate(d.getDate() + dept.dueOffset);
        dueDate = d.toISOString().split("T")[0];
      } else if (!isAssign && checkoutApptDate) {
        const offset = Math.max((effectivePurpose && PURPOSE_DUE_OFFSETS?.[effectivePurpose]) || 7, 7);
        const d = new Date(checkoutApptDate + "T00:00:00"); d.setDate(d.getDate() + offset);
        dueDate = d.toISOString().split("T")[0];
      }
      const dep = checkoutDeposit ? Number(checkoutDeposit) : undefined;
      const phone = checkoutPerson.phone.replace(/\D/g, "") || undefined;

      const results = await Promise.allSettled(
        items.map((item) =>
          postApi(`/api/equipment/${item.equipment_id}/events`, {
            event_type: (isDept ? "check_out" : (isAssign ? "assign" : "check_out")),
            custodian_person_id: resolution.person_id || undefined,
            custodian_name: name, custodian_name_raw: name,
            custodian_phone: isDept ? undefined : phone,
            notes: finalNotes, checkout_purpose: effectivePurpose || undefined,
            checkout_type: effectiveType || undefined,
            due_date: isAssign ? undefined : dueDate,
            deposit_amount: isAssign ? undefined : (dep && !isNaN(dep) ? dep : undefined),
            ...(checkoutPlace?.place_id ? { place_id: checkoutPlace.place_id } : {}),
          })
        )
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      if (resolution.person_id && checkoutPlace?.place_id)
        postApi(`/api/people/${resolution.person_id}/places`, { place_id: checkoutPlace.place_id, relationship_type: "residence" }).catch(() => {});

      if (failed === 0) toast.success(`${succeeded} item${succeeded !== 1 ? "s" : ""} ${isAssign ? "assigned to" : "checked out to"} ${name}`);
      else toast.warning(`${succeeded} succeeded, ${failed} failed`);
      playSuccess(); vibrate();

      items.forEach((item) => {
        setSessionHistory((prev) => [{ barcode: item.barcode || "", name: item.display_name, action: isAssign ? "assign" : "check_out", success: true, timestamp: new Date() }, ...prev.slice(0, 19)]);
      });

      // Reset form
      setCheckoutBorrowerType("person"); setCheckoutDept("");
      setCheckoutPerson(EMPTY_PERSON); setCheckoutPlace(null); setLinkedAddresses([]);
      setCheckoutUnit(""); setCheckoutNotes(""); setCheckoutPurpose(""); setCheckoutType(""); setCheckoutApptDate(""); setCheckoutDeposit("0");
      handleReset();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setCheckoutSubmitting(false); }
  }, [equipment, checkoutCart, checkoutPerson, checkoutPlace, checkoutUnit, checkoutNotes, checkoutPurpose, checkoutType, checkoutApptDate, checkoutDeposit, PURPOSE_DUE_OFFSETS, toast, playSuccess, vibrate, handleReset]);

  const showSmartCard = state === "found" && equipment && !forceGenericCard;
  const cs = equipment?.custody_status;
  const useSmartCard = showSmartCard && (cs === "checked_out" || cs === "missing" || cs === "available");
  const personName = checkoutBorrowerType === "department"
    ? (DEPARTMENTS.find((d) => d.value === checkoutDept)?.label || checkoutDept)
    : `${checkoutPerson.first_name} ${checkoutPerson.last_name}`.trim();

  return (
    <div style={{ maxWidth: 540, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>Scan Equipment</h1>
        <div style={{ display: "flex", gap: "0.375rem" }}>
          <Button variant="outline" size="sm" icon="plus" onClick={() => window.location.href = "/equipment/add"}>Add</Button>
          <Button variant="outline" size="sm" icon="clipboard-check" onClick={() => window.location.href = "/equipment/restock"}>Restock</Button>
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <BarcodeInput onScan={handleScan} loading={state === "loading"} placeholder={checkoutCart.length > 0 ? "Scan another barcode to add to cart..." : "Scan barcode or type ID..."} autoFocus />
      </div>

      {state === "idle" && <div style={{ marginBottom: "1rem", textAlign: "center" }}><Button variant="ghost" size="sm" icon="camera" onClick={() => setShowCamera(true)}>Use Camera</Button></div>}
      {showCamera && <CameraScanner onScan={handleScan} onClose={() => setShowCamera(false)} />}

      {state === "idle" && errorMessage && (
        <div style={{ padding: "1rem", background: "var(--warning-bg)", border: "1px solid var(--warning-border)", borderRadius: 10, textAlign: "center", marginBottom: "1rem" }}>
          <p style={{ color: "var(--warning-text)", fontWeight: 600, margin: 0 }}>{errorMessage}</p>
        </div>
      )}

      {useSmartCard && cs === "checked_out" && <HeroCheckinCard equipmentId={equipment.equipment_id} equipmentName={equipment.display_name} custodianName={equipment.custodian_name || equipment.current_holder_name || null} custodianId={equipment.current_custodian_id || null} currentCondition={equipment.condition_status} daysOut={equipment.days_checked_out} onComplete={handleSmartCardComplete} onOtherActions={() => setForceGenericCard(true)} />}
      {useSmartCard && cs === "missing" && <FoundTrapFlow equipmentId={equipment.equipment_id} equipmentName={equipment.display_name} onComplete={handleSmartCardComplete} />}
      {useSmartCard && cs === "available" && <AvailableTrapCard equipmentId={equipment.equipment_id} equipmentName={equipment.display_name} onComplete={handleSmartCardComplete} onCheckOut={handleAddToCart} />}

      {(state === "found" || state === "action") && equipment && (forceGenericCard || !useSmartCard) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <KioskEquipmentCard equipment={equipment} onAction={(a) => a === "check_out" ? handleAddToCart() : handleAction(a)} />
          {state === "action" && activeAction && activeAction !== "check_out" && activeAction !== "check_in" && (
            <SimpleActionConfirm equipmentId={equipment.equipment_id} action={activeAction} actionLabel={getLabel(EQUIPMENT_EVENT_TYPE_OPTIONS, activeAction)} currentCondition={equipment.condition_status} onComplete={handleActionComplete} onCancel={handleActionCancel} />
          )}
          {state === "found" && <Button variant="ghost" icon="scan-barcode" fullWidth onClick={handleReset}>Scan Another</Button>}
        </div>
      )}

      {/* ═══ CHECKOUT FORM (cart mode) ═══ */}
      {state === "checkout" && (checkoutCart.length > 0 || equipment) && (
        <div style={{ borderRadius: 12, border: "2px solid var(--warning-border)", background: "var(--warning-bg)", padding: "1rem" }}>
          {/* Cart header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Icon name="package-plus" size={20} color="var(--warning-text)" />
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
                Check Out {checkoutCart.length} Item{checkoutCart.length !== 1 ? "s" : ""}
              </h3>
            </div>
            <Button variant="ghost" size="sm" onClick={handleReset} style={{ fontSize: "0.75rem" }}>Clear</Button>
          </div>

          {/* Cart items */}
          <div style={{ background: "var(--card-bg, #fff)", borderRadius: 8, border: "1px solid var(--card-border)", padding: "0.5rem", marginBottom: "0.75rem" }}>
            {checkoutCart.map((item) => (
              <div key={item.equipment_id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.375rem 0.5rem", borderRadius: 6, background: "var(--section-bg, #f9fafb)", marginBottom: "0.25rem" }}>
                <span style={{ fontFamily: "monospace", fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)" }}>#{item.barcode}</span>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, flex: 1 }}>{item.display_name}</span>
                <button onClick={() => handleRemoveFromCart(item.equipment_id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0.25rem", color: "var(--muted)" }} title="Remove">
                  <Icon name="x" size={14} color="var(--muted)" />
                </button>
              </div>
            ))}
            <div style={{ padding: "0.375rem 0.5rem", fontSize: "0.75rem", color: "var(--muted)", textAlign: "center", borderTop: "1px dashed var(--card-border)", marginTop: "0.125rem" }}>
              Scan another barcode above to add more items
            </div>
          </div>
          <div style={{ background: "var(--card-bg, #fff)", borderRadius: 10, border: "1px solid var(--card-border)", padding: "0.875rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {/* ── Person vs Department toggle ── */}
            <div style={{ display: "flex", gap: "0.25rem", background: "var(--section-bg, #f3f4f6)", borderRadius: 8, padding: "0.25rem" }}>
              {(["person", "department"] as const).map((t) => (
                <button key={t} type="button"
                  onClick={() => { setCheckoutBorrowerType(t); if (t === "department") { setCheckoutPerson(EMPTY_PERSON); setLinkedAddresses([]); } else setCheckoutDept(""); }}
                  style={{
                    flex: 1, padding: "0.5rem", borderRadius: 6, border: "none",
                    background: checkoutBorrowerType === t ? "var(--card-bg, #fff)" : "transparent",
                    boxShadow: checkoutBorrowerType === t ? "var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.06))" : "none",
                    fontWeight: 600, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit",
                    color: checkoutBorrowerType === t ? "var(--text-primary)" : "var(--muted)",
                  }}>
                  {t === "person" ? "Person" : "Department"}
                </button>
              ))}
            </div>

            {/* ── Person fields ── */}
            {checkoutBorrowerType === "person" && (
              <>
                <KioskPersonCollector value={checkoutPerson} onChange={setCheckoutPerson} />
                <div>
                  <label style={labelStyle}>Address <span style={labelHintStyle}>(where equipment will be used)</span></label>
                  {linkedAddresses.length > 0 && !checkoutPlace && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", marginBottom: "0.5rem" }}>
                      {linkedAddresses.map((addr) => (
                        <button key={addr.place_id} type="button"
                          onClick={() => setCheckoutPlace({ place_id: addr.place_id, display_name: addr.formatted_address, formatted_address: addr.formatted_address, locality: null })}
                          style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", padding: "0.5rem 0.75rem", borderRadius: 8, border: "1px solid var(--info-border)", background: "var(--info-bg)", cursor: "pointer", fontFamily: "inherit", textAlign: "left", fontSize: "0.8rem", color: "var(--text-primary)" }}>
                          <Icon name="map-pin" size={14} color="var(--info-text)" />
                          <span style={{ flex: 1 }}>{addr.formatted_address}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <PlaceResolver value={checkoutPlace} onChange={setCheckoutPlace} placeholder="Search for an address..." />
                </div>
                <div><label style={labelStyle}>Apt / Unit <span style={labelHintStyle}>(if applicable)</span></label><input type="text" value={checkoutUnit} onChange={(e) => setCheckoutUnit(e.target.value)} placeholder="e.g. Apt 5" style={inputStyle} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div><label style={labelStyle}>Purpose</label><select value={checkoutPurpose} onChange={(e) => setCheckoutPurpose(e.target.value)} style={inputStyle}><option value="">Select...</option>{EQUIPMENT_CHECKOUT_PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                  <div><label style={labelStyle}>Type</label><select value={checkoutType} onChange={(e) => setCheckoutType(e.target.value)} style={inputStyle}><option value="">Select...</option>{EQUIPMENT_CHECKOUT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
                </div>
                {checkoutType !== "trapper" && checkoutType !== "internal" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <label style={labelStyle}>Appt Date</label>
                      <input type="date" value={checkoutApptDate} onChange={(e) => setCheckoutApptDate(e.target.value)} style={inputStyle} />
                      {checkoutApptDate && (() => { const offset = Math.max((checkoutPurpose && PURPOSE_DUE_OFFSETS?.[checkoutPurpose]) || 7, 7); const d = new Date(checkoutApptDate + "T00:00:00"); d.setDate(d.getDate() + offset); return <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 4 }}>Due {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} (+{offset}d)</div>; })()}
                    </div>
                    <div><label style={labelStyle}>Deposit ($)</label><input type="number" value={checkoutDeposit} onChange={(e) => setCheckoutDeposit(e.target.value)} placeholder="0" min="0" step="5" style={inputStyle} /></div>
                  </div>
                ) : (
                  <div style={{ fontSize: "0.8rem", color: "var(--info-text)", padding: "0.5rem 0.75rem", background: "var(--info-bg)", borderRadius: 8, border: "1px solid var(--info-border)" }}>Indefinite assignment — no due date.</div>
                )}
              </>
            )}

            {/* ── Department fields ── */}
            {checkoutBorrowerType === "department" && (
              <>
                <div>
                  <label style={labelStyle}>Department</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                    {DEPARTMENTS.map((d) => (
                      <button key={d.value} type="button"
                        onClick={() => setCheckoutDept(d.value)}
                        style={{
                          padding: "0.5rem 1rem", borderRadius: 8, fontFamily: "inherit",
                          fontSize: "0.9rem", fontWeight: 600, cursor: "pointer",
                          border: checkoutDept === d.value ? "2px solid var(--primary)" : "1px solid var(--card-border)",
                          background: checkoutDept === d.value ? "var(--info-bg)" : "var(--card-bg, #fff)",
                          color: checkoutDept === d.value ? "var(--primary)" : "var(--text-primary)",
                        }}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                {checkoutDept && (
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", padding: "0.375rem 0" }}>
                    Due back in {DEPARTMENTS.find((d) => d.value === checkoutDept)?.dueOffset} days
                  </div>
                )}
              </>
            )}

            <div><label style={labelStyle}>Notes <span style={labelHintStyle}>(optional)</span></label><input type="text" value={checkoutNotes} onChange={(e) => setCheckoutNotes(e.target.value)} placeholder="e.g. SCAS pickup, cat transport..." style={inputStyle} /></div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <Button variant="ghost" size="lg" onClick={handleReset} style={{ flex: 1, borderRadius: 10 }}>Cancel</Button>
            <Button variant="primary" size="lg" icon={checkoutType === "trapper" || checkoutType === "internal" ? "user-check" : "log-out"} loading={checkoutSubmitting} disabled={!personName || (checkoutBorrowerType === "department" && !checkoutDept)} onClick={handleCheckout} style={{ flex: 2, borderRadius: 10 }}>
              {checkoutBorrowerType === "department" ? "Check Out" : (checkoutType === "trapper" || checkoutType === "internal" ? "Assign" : "Check Out")}{checkoutCart.length > 1 ? ` All (${checkoutCart.length})` : ""}
            </Button>
          </div>
        </div>
      )}

      {state === "idle" && !errorMessage && <EmptyState title="Scan or type a barcode" description="Scan equipment to check in, check out, or view status." size="lg" />}
      <div style={{ marginTop: "1.5rem" }}><ScanSessionHistory entries={sessionHistory} onRescan={handleScan} /></div>
    </div>
  );
}
