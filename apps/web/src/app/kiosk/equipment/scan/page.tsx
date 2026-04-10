"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { EmptyState } from "@/components/feedback/EmptyState";
import { BarcodeInput } from "@/components/equipment/BarcodeInput";
import { ScanOnboarding } from "@/components/equipment/ScanOnboarding";
import { KioskEquipmentCard } from "@/components/kiosk/KioskEquipmentCard";
import { HeroCheckinCard } from "@/components/equipment/HeroCheckinCard";
import { FoundTrapFlow } from "@/components/equipment/FoundTrapFlow";
import { AvailableTrapCard } from "@/components/equipment/AvailableTrapCard";
import { BatchScanBanner } from "@/components/equipment/BatchScanBanner";
import { ScanSessionHistory, type ScanHistoryEntry } from "@/components/equipment/ScanSessionHistory";
import { CheckoutForm } from "@/components/kiosk/CheckoutForm";
import { CheckinForm } from "@/components/kiosk/CheckinForm";
import { SimpleActionConfirm } from "@/components/kiosk/SimpleActionConfirm";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { useScanFeedback } from "@/hooks/useScanFeedback";
import { getLabel, EQUIPMENT_EVENT_TYPE_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

const CameraScanner = dynamic(
  () =>
    import("@/components/kiosk/CameraScanner").then(
      (mod) => mod.CameraScanner
    ),
  { ssr: false }
);

type ScanState = "idle" | "loading" | "found" | "not_found" | "action";

interface ScanResult extends VEquipmentInventoryRow {
  available_actions: string[];
  primary_action?: string | null;
}

export default function KioskScanPage() {
  const toast = useToast();
  const { playSuccess, playError, vibrate } = useScanFeedback();
  const [state, setState] = useState<ScanState>("idle");
  const [equipment, setEquipment] = useState<ScanResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastBarcode, setLastBarcode] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  // Smart card bypass
  const [forceGenericCard, setForceGenericCard] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Batch mode + session history
  const [batchMode, setBatchMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("equipment_batch_mode") === "true";
    }
    return false;
  });
  const [sessionHistory, setSessionHistory] = useState<ScanHistoryEntry[]>([]);
  const barcodeInputRef = useRef<HTMLDivElement>(null);

  const abortRef = useRef<AbortController>();
  const scanIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const toggleBatchMode = useCallback((on: boolean) => {
    setBatchMode(on);
    if (typeof window !== "undefined") {
      localStorage.setItem("equipment_batch_mode", String(on));
    }
  }, []);

  const addHistoryEntry = useCallback((entry: Omit<ScanHistoryEntry, "timestamp">) => {
    setSessionHistory((prev) => [
      { ...entry, timestamp: new Date() },
      ...prev.slice(0, 9),
    ]);
  }, []);

  const resetForNextScan = useCallback(() => {
    setState("idle");
    setEquipment(null);
    setActiveAction(null);
    setForceGenericCard(false);
    setErrorMessage("");
    setTimeout(() => {
      const input = barcodeInputRef.current?.querySelector("input");
      input?.focus();
    }, 100);
  }, []);

  const handleScan = useCallback(
    async (barcode: string) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const currentScanId = ++scanIdRef.current;

      setLastBarcode(barcode);
      setActiveAction(null);
      setForceGenericCard(false);
      setState("loading");
      setErrorMessage("");
      setShowCamera(false);

      try {
        const result = await fetchApi<ScanResult>(
          `/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`,
          { signal: controller.signal }
        );

        if (scanIdRef.current !== currentScanId) return;

        setEquipment(result);
        setState("found");
        playSuccess();
        vibrate();
      } catch (err) {
        if (controller.signal.aborted) return;
        if (scanIdRef.current !== currentScanId) return;

        playError();
        const message =
          err instanceof Error ? err.message : "Failed to look up equipment";
        setErrorMessage(message);
        setEquipment(null);
        setState("not_found");
      }
    },
    []
  );

  const handleAction = useCallback((action: string) => {
    setActiveAction(action);
    setState("action");
  }, []);

  const handleActionComplete = useCallback(async () => {
    toast.success("Action completed successfully");
    setActiveAction(null);

    addHistoryEntry({
      barcode: lastBarcode,
      name: equipment?.display_name || lastBarcode,
      action: activeAction || "action",
      success: true,
    });

    if (batchMode) {
      setTimeout(resetForNextScan, 1500);
      return;
    }

    if (lastBarcode) {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState("loading");
      try {
        const result = await fetchApi<ScanResult>(
          `/api/equipment/scan?barcode=${encodeURIComponent(lastBarcode)}`,
          { signal: controller.signal }
        );
        if (!controller.signal.aborted) {
          setEquipment(result);
          setForceGenericCard(false);
          setState("found");
        }
      } catch {
        if (!controller.signal.aborted) {
          setState("idle");
          setEquipment(null);
        }
      }
    } else {
      setState("idle");
      setEquipment(null);
    }
  }, [lastBarcode, equipment, activeAction, batchMode, toast, resetForNextScan, addHistoryEntry]);

  const handleSmartCardComplete = useCallback(async () => {
    playSuccess();
    vibrate();
    addHistoryEntry({
      barcode: lastBarcode,
      name: equipment?.display_name || lastBarcode,
      action: equipment?.primary_action || "action",
      success: true,
    });

    if (batchMode) {
      setTimeout(resetForNextScan, 1500);
      return;
    }

    // Re-fetch
    const barcode = equipment?.barcode || equipment?.equipment_id || lastBarcode;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState("loading");
    try {
      const result = await fetchApi<ScanResult>(
        `/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`,
        { signal: controller.signal }
      );
      if (!controller.signal.aborted) {
        setEquipment(result);
        setForceGenericCard(false);
        setState("found");
      }
    } catch {
      if (!controller.signal.aborted) {
        resetForNextScan();
      }
    }
  }, [lastBarcode, equipment, batchMode, resetForNextScan, addHistoryEntry]);

  const handleActionCancel = useCallback(() => {
    setActiveAction(null);
    setState("found");
  }, []);

  const handleReset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    resetForNextScan();
    setLastBarcode("");
  }, [resetForNextScan]);

  // Smart card display logic
  const showSmartCard = state === "found" && equipment && !forceGenericCard;
  const smartCardStatus = equipment?.custody_status;
  const useSmartCard = showSmartCard && (smartCardStatus === "checked_out" || smartCardStatus === "missing" || smartCardStatus === "available");

  return (
    <div
      style={{
        padding: "1.25rem",
        maxWidth: "600px",
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1.25rem",
        }}
      >
        <Icon name="scan-barcode" size={28} color="var(--primary)" />
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: 0,
            flex: 1,
          }}
        >
          Scan Equipment
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowHelp(true)}
          style={{ minWidth: 32, padding: "0.25rem", flexShrink: 0 }}
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

      {/* Barcode Input */}
      <div style={{ marginBottom: "1rem" }} ref={barcodeInputRef}>
        <BarcodeInput
          onScan={handleScan}
          loading={state === "loading"}
          placeholder="Type 4-digit barcode..."
          autoFocus
        />
      </div>

      {/* Quick links — staff tools accessible from the scan page */}
      {state === "idle" && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginBottom: "1rem",
            flexWrap: "wrap",
          }}
        >
          <Button
            variant="outline"
            size="sm"
            icon="plus"
            onClick={() => { window.location.href = "/kiosk/equipment/add"; }}
            style={{ borderRadius: 8, fontSize: "0.8rem" }}
          >
            Add Equipment
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon="list"
            onClick={() => { window.location.href = "/kiosk/equipment/inventory"; }}
            style={{ borderRadius: 8, fontSize: "0.8rem" }}
          >
            Inventory
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon="printer"
            onClick={() => { window.location.href = "/equipment/print/slips"; }}
            style={{ borderRadius: 8, fontSize: "0.8rem" }}
          >
            Print Slips
          </Button>
        </div>
      )}

      <ScanSessionHistory
        entries={sessionHistory}
        onRescan={handleScan}
      />

      {/* Camera scan option */}
      {(state === "idle" || state === "not_found") && (
        <div style={{ marginBottom: "1.5rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              margin: "0.5rem 0 1rem",
            }}
          >
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
            <span style={{ color: "var(--muted)", fontSize: "0.8rem", fontWeight: 500, whiteSpace: "nowrap" }}>
              or
            </span>
            <div style={{ flex: 1, height: "1px", background: "var(--border)" }} />
          </div>

          <Button
            variant="outline"
            size="lg"
            icon="camera"
            fullWidth
            onClick={() => setShowCamera(true)}
            style={{ minHeight: "48px" }}
          >
            Scan with Camera
          </Button>
        </div>
      )}

      {/* Camera scanner overlay */}
      {showCamera && (
        <CameraScanner
          onScan={handleScan}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Not Found State — amber instead of red */}
      {state === "not_found" && (
        <div
          style={{
            padding: "1.5rem",
            background: "var(--warning-bg, #fffbeb)",
            border: "1px solid var(--warning-border, #fde68a)",
            borderRadius: "12px",
            textAlign: "center",
          }}
        >
          <Icon name="help-circle" size={40} color="var(--warning-text)" />
          <p
            style={{
              color: "var(--warning-text)",
              fontWeight: 600,
              fontSize: "1.1rem",
              margin: "0.75rem 0 0.5rem",
            }}
          >
            Not Recognized
          </p>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.9rem",
              margin: "0 0 1rem",
            }}
          >
            {errorMessage || `No equipment matches barcode "${lastBarcode}".`}
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <Button
              variant="outline"
              size="lg"
              icon="arrow-left"
              onClick={handleReset}
              style={{ minHeight: "48px" }}
            >
              Try Again
            </Button>
            <Button
              variant="primary"
              size="lg"
              icon="plus"
              onClick={() => {
                window.location.href = `/kiosk/equipment/add?barcode=${encodeURIComponent(lastBarcode)}`;
              }}
              style={{ minHeight: "48px" }}
            >
              Add New Equipment
            </Button>
          </div>
        </div>
      )}

      {/* Smart Status Cards */}
      {useSmartCard && smartCardStatus === "checked_out" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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

      {useSmartCard && smartCardStatus === "missing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <FoundTrapFlow
            equipmentId={equipment.equipment_id}
            equipmentName={equipment.display_name}
            onComplete={handleSmartCardComplete}
          />
        </div>
      )}

      {useSmartCard && smartCardStatus === "available" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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

      {/* Fallback: KioskEquipmentCard for non-smart-card statuses or "Other actions" */}
      {(state === "found" || state === "action") && equipment && (forceGenericCard || !useSmartCard) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <KioskEquipmentCard
            equipment={equipment}
            onAction={handleAction}
          />

          {state === "action" && activeAction === "check_out" && (
            <CheckoutForm
              equipmentId={equipment.equipment_id}
              equipmentName={equipment.display_name}
              onComplete={handleActionComplete}
              onCancel={handleActionCancel}
            />
          )}

          {state === "action" && activeAction === "check_in" && (
            <CheckinForm
              equipmentId={equipment.equipment_id}
              equipmentName={equipment.display_name}
              currentCondition={equipment.condition_status}
              hasDeposit={
                equipment.checkout_type === "public" ||
                equipment.checkout_type === "client" ||
                equipment.checkout_type === "foster"
              }
              previousCustodianId={equipment.current_custodian_id || null}
              onComplete={handleActionComplete}
              onCancel={handleActionCancel}
            />
          )}

          {state === "action" &&
            activeAction !== "check_out" &&
            activeAction !== "check_in" &&
            activeAction && (
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
              style={{ minHeight: "48px", marginTop: "0.5rem" }}
            >
              Scan Another
            </Button>
          )}
        </div>
      )}

      {/* Idle hint */}
      {state === "idle" && (
        <EmptyState
          title="Scan Equipment"
          description="Scan a barcode or type the 4-digit ID to look up equipment."
          size="lg"
        />
      )}
    </div>
  );
}
