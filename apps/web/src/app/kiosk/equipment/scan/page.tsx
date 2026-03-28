"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { EmptyState } from "@/components/feedback/EmptyState";
import { BarcodeInput } from "@/components/equipment/BarcodeInput";
import { KioskEquipmentCard } from "@/components/kiosk/KioskEquipmentCard";
import { CheckoutForm } from "@/components/kiosk/CheckoutForm";
import { CheckinForm } from "@/components/kiosk/CheckinForm";
import { SimpleActionConfirm } from "@/components/kiosk/SimpleActionConfirm";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { getLabel, EQUIPMENT_EVENT_TYPE_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

// Dynamic import — html5-qrcode uses browser APIs (window, navigator)
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
}

/**
 * Kiosk scan page — barcode entry, equipment lookup, and inline action forms.
 * State machine: idle -> loading -> found/not_found -> action (checkout/checkin/etc.)
 */
export default function KioskScanPage() {
  const toast = useToast();
  const [state, setState] = useState<ScanState>("idle");
  const [equipment, setEquipment] = useState<ScanResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [lastBarcode, setLastBarcode] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  // Detect touch devices (phones, tablets)
  useEffect(() => {
    setIsTouchDevice(
      "ontouchstart" in window || navigator.maxTouchPoints > 0
    );
  }, []);

  const handleScan = useCallback(
    async (barcode: string) => {
      setLastBarcode(barcode);
      setActiveAction(null);
      setState("loading");
      setErrorMessage("");
      setShowCamera(false);

      try {
        const result = await fetchApi<ScanResult>(
          `/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`
        );
        setEquipment(result);
        setState("found");
      } catch (err) {
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
    // Re-fetch equipment to show updated status
    if (lastBarcode) {
      setState("loading");
      try {
        const result = await fetchApi<ScanResult>(
          `/api/equipment/scan?barcode=${encodeURIComponent(lastBarcode)}`
        );
        setEquipment(result);
        setState("found");
      } catch {
        setState("idle");
        setEquipment(null);
      }
    } else {
      setState("idle");
      setEquipment(null);
    }
  }, [lastBarcode, toast]);

  const handleActionCancel = useCallback(() => {
    setActiveAction(null);
    setState("found");
  }, []);

  const handleReset = useCallback(() => {
    setState("idle");
    setEquipment(null);
    setActiveAction(null);
    setErrorMessage("");
    setLastBarcode("");
  }, []);

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
          }}
        >
          Scan Equipment
        </h1>
      </div>

      {/* Barcode Input — always visible */}
      <div style={{ marginBottom: "1rem" }}>
        <BarcodeInput
          onScan={handleScan}
          loading={state === "loading"}
          placeholder="Type 4-digit barcode..."
          autoFocus
        />
      </div>

      {/* Camera scan option */}
      {(state === "idle" || state === "not_found") && (
        <div style={{ marginBottom: "1.5rem" }}>
          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              margin: "0.5rem 0 1rem",
            }}
          >
            <div
              style={{
                flex: 1,
                height: "1px",
                background: "var(--border)",
              }}
            />
            <span
              style={{
                color: "var(--muted)",
                fontSize: "0.8rem",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              or
            </span>
            <div
              style={{
                flex: 1,
                height: "1px",
                background: "var(--border)",
              }}
            />
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

      {/* Not Found State */}
      {state === "not_found" && (
        <div
          style={{
            padding: "1.5rem",
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            borderRadius: "12px",
            textAlign: "center",
          }}
        >
          <Icon name="alert-circle" size={40} color="var(--danger-text)" />
          <p
            style={{
              color: "var(--danger-text)",
              fontWeight: 600,
              fontSize: "1.1rem",
              margin: "0.75rem 0 0.5rem",
            }}
          >
            Equipment Not Found
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
                window.location.href = "/kiosk/equipment/add";
              }}
              style={{ minHeight: "48px" }}
            >
              Add New Equipment
            </Button>
          </div>
        </div>
      )}

      {/* Found State — show equipment card */}
      {(state === "found" || state === "action") && equipment && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <KioskEquipmentCard
            equipment={equipment}
            onAction={handleAction}
          />

          {/* Action forms rendered inline below the card */}
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
                equipment.checkout_type === "client" ||
                equipment.checkout_type === "foster"
              }
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

          {/* Scan Another button when in found state (not in action) */}
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
