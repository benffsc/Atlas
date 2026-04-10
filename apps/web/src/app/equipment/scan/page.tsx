"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { EmptyState } from "@/components/feedback/EmptyState";
import { BarcodeInput } from "@/components/equipment/BarcodeInput";
import { ScanOnboarding } from "@/components/equipment/ScanOnboarding";
import { QuickActionCard } from "@/components/equipment/QuickActionCard";
import { HeroCheckinCard } from "@/components/equipment/HeroCheckinCard";
import { FoundTrapFlow } from "@/components/equipment/FoundTrapFlow";
import { AvailableTrapCard } from "@/components/equipment/AvailableTrapCard";
import { BatchScanBanner } from "@/components/equipment/BatchScanBanner";
import { ScanSessionHistory, type ScanHistoryEntry } from "@/components/equipment/ScanSessionHistory";
import { PersonReferencePicker, type PersonReference } from "@/components/ui/PersonReferencePicker";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useScanFeedback } from "@/hooks/useScanFeedback";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";
import { EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";

type ScannedItem = VEquipmentInventoryRow & { available_actions: string[]; primary_action?: string | null };

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

export default function EquipmentScanPage() {
  const { success, error: showError } = useToast();
  const { playSuccess, playError, vibrate } = useScanFeedback();
  const [loading, setLoading] = useState(false);
  const [equipment, setEquipment] = useState<ScannedItem | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastBarcode, setLastBarcode] = useState("");

  // Smart card bypass — show full action list when user clicks "Other actions"
  const [forceGenericCard, setForceGenericCard] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Action form state
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [person, setPerson] = useState<PersonReference>({ person_id: null, display_name: "", is_resolved: false });
  const [conditionAfter, setConditionAfter] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState(todayISO());

  // Batch mode + session history
  const [batchMode, setBatchMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("equipment_batch_mode") === "true";
    }
    return false;
  });
  const [sessionHistory, setSessionHistory] = useState<ScanHistoryEntry[]>([]);
  const barcodeInputRef = useRef<HTMLDivElement>(null);

  // AbortController ref
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const toggleBatchMode = useCallback((on: boolean) => {
    setBatchMode(on);
    if (typeof window !== "undefined") {
      localStorage.setItem("equipment_batch_mode", String(on));
    }
  }, []);

  const resetForNextScan = useCallback(() => {
    setEquipment(null);
    setScanError(null);
    setActiveAction(null);
    setForceGenericCard(false);
    // Re-focus barcode input
    setTimeout(() => {
      const input = barcodeInputRef.current?.querySelector("input");
      input?.focus();
    }, 100);
  }, []);

  const addHistoryEntry = useCallback((entry: Omit<ScanHistoryEntry, "timestamp">) => {
    setSessionHistory((prev) => [
      { ...entry, timestamp: new Date() },
      ...prev.slice(0, 9), // keep last 10
    ]);
  }, []);

  const handleScan = useCallback(async (barcode: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setScanError(null);
    setEquipment(null);
    setActiveAction(null);
    setForceGenericCard(false);
    setLastBarcode(barcode);

    try {
      const data = await fetchApi<ScannedItem>(
        `/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`,
        { signal: controller.signal }
      );
      if (!controller.signal.aborted) {
        setEquipment(data);
        playSuccess();
        vibrate();
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      playError();
      setScanError(err instanceof Error ? err.message : "Equipment not found");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  // Called when a smart card completes its action
  const handleSmartCardComplete = useCallback(async () => {
    playSuccess();
    vibrate();
    const barcode = equipment?.barcode || equipment?.equipment_id || lastBarcode;
    const name = equipment?.display_name || lastBarcode;

    addHistoryEntry({
      barcode: lastBarcode,
      name,
      action: equipment?.primary_action || "action",
      success: true,
    });

    if (batchMode) {
      // Auto-reset after 1.5s in batch mode
      setTimeout(resetForNextScan, 1500);
    } else {
      // Re-fetch updated state
      try {
        const updated = await fetchApi<ScannedItem>(
          `/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`
        );
        setEquipment(updated);
        setActiveAction(null);
        setForceGenericCard(false);
      } catch {
        resetForNextScan();
      }
    }
  }, [equipment, lastBarcode, batchMode, resetForNextScan, addHistoryEntry]);

  const handleAction = useCallback((action: string) => {
    if (action === "check_in") {
      setActiveAction("check_in");
      setConditionAfter("");
      setNotes("");
    } else if (action === "check_out") {
      setActiveAction("check_out");
      setPerson({ person_id: null, display_name: "", is_resolved: false });
      setDueDate(todayISO());
      setNotes("");
    } else {
      setActiveAction(action);
      setNotes("");
      setConditionAfter("");
    }
  }, []);

  const submitAction = useCallback(async () => {
    if (!equipment || !activeAction) return;
    setActionLoading(true);

    try {
      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: activeAction,
        custodian_person_id: person.person_id || undefined,
        condition_after: conditionAfter || undefined,
        due_date: activeAction === "check_out" && dueDate ? dueDate : undefined,
        notes: notes || undefined,
      });

      success(`${activeAction.replace(/_/g, " ")} recorded`);

      addHistoryEntry({
        barcode: lastBarcode,
        name: equipment.display_name,
        action: activeAction,
        success: true,
      });

      if (batchMode) {
        setTimeout(resetForNextScan, 1500);
      } else {
        const updated = await fetchApi<ScannedItem>(
          `/api/equipment/scan?barcode=${encodeURIComponent(equipment.barcode || equipment.equipment_id)}`
        );
        setEquipment(updated);
        setActiveAction(null);
        setPerson({ person_id: null, display_name: "", is_resolved: false });
        setNotes("");
        setConditionAfter("");
        setDueDate(todayISO());
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Action failed");
      addHistoryEntry({
        barcode: lastBarcode,
        name: equipment.display_name,
        action: activeAction,
        success: false,
      });
    } finally {
      setActionLoading(false);
    }
  }, [equipment, activeAction, person, conditionAfter, dueDate, notes, lastBarcode, batchMode, success, showError, resetForNextScan, addHistoryEntry]);

  const quickReCheckout = useCallback(async () => {
    if (!equipment) return;
    setActionLoading(true);

    try {
      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: "check_in",
        condition_after: conditionAfter || undefined,
        notes: "Quick re-checkout return",
      });
      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: "check_out",
        custodian_person_id: person.person_id,
        notes: notes || undefined,
      });

      success("Quick re-checkout complete");

      addHistoryEntry({
        barcode: lastBarcode,
        name: equipment.display_name,
        action: "re_checkout",
        success: true,
      });

      if (batchMode) {
        setTimeout(resetForNextScan, 1500);
      } else {
        const updated = await fetchApi<ScannedItem>(
          `/api/equipment/scan?barcode=${encodeURIComponent(equipment.barcode || equipment.equipment_id)}`
        );
        setEquipment(updated);
        setActiveAction(null);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Re-checkout failed");
    } finally {
      setActionLoading(false);
    }
  }, [equipment, person, conditionAfter, notes, lastBarcode, batchMode, success, showError, resetForNextScan, addHistoryEntry]);

  // Determine which smart card to show
  const showSmartCard = equipment && !forceGenericCard && !activeAction;
  const smartCardStatus = equipment?.custody_status;

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ textAlign: "center", marginBottom: "2rem", position: "relative" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Equipment Scanner</h1>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
          Scan barcode or type equipment ID
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowHelp(true)}
          style={{ position: "absolute", top: 0, right: 0, minWidth: 32, padding: "0.25rem" }}
        >
          <Icon name="help-circle" size={18} />
        </Button>
      </div>

      <ScanOnboarding forceShow={showHelp} onDismiss={() => setShowHelp(false)} />

      <BatchScanBanner
        active={batchMode}
        onToggle={toggleBatchMode}
        scanCount={sessionHistory.filter((e) => e.success).length}
        onClear={() => setSessionHistory([])}
      />

      <div ref={barcodeInputRef}>
        <BarcodeInput onScan={handleScan} loading={loading} />
      </div>

      <ScanSessionHistory
        entries={sessionHistory}
        onRescan={handleScan}
      />

      {/* Not Found — amber info card instead of red error */}
      {scanError && (
        <div style={{
          marginTop: "1rem",
          padding: "1rem",
          background: "var(--warning-bg, #fffbeb)",
          border: "1px solid var(--warning-border, #fde68a)",
          borderRadius: "12px",
          textAlign: "center",
        }}>
          <Icon name="help-circle" size={28} color="var(--warning-text)" />
          <p style={{
            color: "var(--warning-text)",
            fontWeight: 600,
            fontSize: "1rem",
            margin: "0.5rem 0 0.25rem",
          }}>
            Not Recognized
          </p>
          <p style={{
            color: "var(--text-secondary)",
            fontSize: "0.85rem",
            margin: "0 0 0.75rem",
          }}>
            No equipment matches &quot;{lastBarcode}&quot;
          </p>
          <Button
            variant="outline"
            size="md"
            icon="plus"
            onClick={() => {
              window.location.href = `/equipment/add?barcode=${encodeURIComponent(lastBarcode)}`;
            }}
          >
            Register New Equipment
          </Button>
        </div>
      )}

      {/* Smart Status Cards */}
      {showSmartCard && smartCardStatus === "checked_out" && (
        <div style={{ marginTop: "1.5rem" }}>
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
        </div>
      )}

      {showSmartCard && smartCardStatus === "missing" && (
        <div style={{ marginTop: "1.5rem" }}>
          <FoundTrapFlow
            equipmentId={equipment.equipment_id}
            equipmentName={equipment.display_name}
            onComplete={handleSmartCardComplete}
          />
        </div>
      )}

      {showSmartCard && smartCardStatus === "available" && (
        <div style={{ marginTop: "1.5rem" }}>
          <AvailableTrapCard
            equipmentId={equipment.equipment_id}
            equipmentName={equipment.display_name}
            onComplete={handleSmartCardComplete}
            onCheckOut={() => {
              setForceGenericCard(true);
              handleAction("check_out");
            }}
          />
        </div>
      )}

      {/* Fallback: Generic card for maintenance, retired, or when "Other actions" clicked */}
      {equipment && (forceGenericCard || (!["checked_out", "missing", "available"].includes(equipment.custody_status) && !activeAction)) && (
        <div style={{ marginTop: "1.5rem" }}>
          <QuickActionCard
            equipment={equipment}
            onAction={handleAction}
            actionLoading={actionLoading}
          />
        </div>
      )}

      {/* Action Form (inline) */}
      {equipment && activeAction && (
        <div style={{
          marginTop: "1rem",
          padding: "1rem",
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--border, #d1d5db)",
          borderRadius: "12px",
        }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 600 }}>
            {activeAction === "check_out" ? "Check Out To" :
             activeAction === "check_in" ? "Check In" :
             activeAction.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
          </h3>

          {activeAction === "check_out" && (
            <>
              <div style={{ marginBottom: "0.75rem" }}>
                <PersonReferencePicker
                  value={person}
                  onChange={setPerson}
                  placeholder="Search for trapper or staff..."
                  label="Person"
                />
              </div>
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Due Back
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    fontSize: "0.9rem",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </>
          )}

          {(activeAction === "check_in" || activeAction === "condition_change") && (
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
                Condition
              </label>
              <select
                value={conditionAfter}
                onChange={(e) => setConditionAfter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  fontSize: "0.9rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                }}
              >
                <option value="">No change</option>
                {EQUIPMENT_CONDITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              style={{
                width: "100%",
                padding: "0.5rem",
                fontSize: "0.9rem",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button
              variant="primary"
              size="md"
              loading={actionLoading}
              disabled={activeAction === "check_out" && !person.person_id}
              onClick={submitAction}
            >
              Confirm
            </Button>

            {activeAction === "check_in" && (
              <Button
                variant="outline"
                size="md"
                onClick={() => {
                  setActiveAction("re_checkout");
                  setPerson({ person_id: null, display_name: "", is_resolved: false });
                }}
                style={{ color: "var(--warning-text)" }}
              >
                Quick Re-checkout
              </Button>
            )}

            {activeAction === "re_checkout" && (
              <>
                <div style={{ width: "100%", marginBottom: "0.5rem" }}>
                  <PersonReferencePicker
                    value={person}
                    onChange={setPerson}
                    placeholder="New person..."
                  />
                </div>
                <Button
                  variant="primary"
                  size="md"
                  disabled={!person.person_id || actionLoading}
                  onClick={quickReCheckout}
                  style={{
                    background: person.person_id ? "var(--warning-text)" : "var(--border)",
                    color: "#fff",
                    border: "1px solid transparent",
                  }}
                >
                  Re-checkout
                </Button>
              </>
            )}

            <Button
              variant="ghost"
              size="md"
              onClick={() => setActiveAction(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Helper text */}
      {!equipment && !scanError && !loading && (
        <EmptyState
          title="Scan Equipment"
          description="Point USB scanner at barcode and scan, or type a barcode / trap number and press Enter"
          style={{ marginTop: "2rem" }}
        />
      )}
    </div>
  );
}
