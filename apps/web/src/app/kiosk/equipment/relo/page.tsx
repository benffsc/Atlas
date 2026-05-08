"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { BarcodeInput } from "@/components/equipment/BarcodeInput";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";

interface ScanResult extends VEquipmentInventoryRow {
  available_actions: string[];
  primary_action?: string | null;
}

interface SessionEntry {
  barcode: string | null;
  name: string;
  action: "check_out" | "check_in";
  timestamp: Date;
}

/**
 * Relo Quick Equipment — zero-friction scan page for the trap bay.
 *
 * Designed for a wall-mounted tablet in the storage room where relo
 * grabs traps on the way out the door. No person picker, no address,
 * no deposit. Just scan → one tap → done.
 *
 * - Available item → "Check Out for Relo" (one tap, +2 day due date)
 * - Checked-out item → "Check In" (one tap)
 * - Auto-resets after 3 seconds for next scan
 *
 * Route: /kiosk/equipment/relo
 */
export default function ReloQuickPage() {
  const toast = useToast();
  const [equipment, setEquipment] = useState<ScanResult | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "found" | "done">("idle");
  const [lastAction, setLastAction] = useState<"check_out" | "check_in" | null>(null);
  const [processing, setProcessing] = useState(false);
  const [session, setSession] = useState<SessionEntry[]>([]);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  // Auto-reset to idle after action completes
  const scheduleReset = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      setState("idle");
      setEquipment(null);
      setLastAction(null);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => { if (resetTimer.current) clearTimeout(resetTimer.current); };
  }, []);

  const handleScan = useCallback(async (barcode: string) => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setState("loading");
    setEquipment(null);
    setLastAction(null);

    try {
      const result = await fetchApi<ScanResult>(
        `/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`
      );
      setEquipment(result);
      setState("found");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Not found");
      setState("idle");
    }
  }, [toast]);

  const handleCheckOut = useCallback(async () => {
    if (!equipment) return;
    setProcessing(true);
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 2);

      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: "check_out",
        custodian_name: "Relo",
        custodian_name_raw: "Relo",
        checkout_type: "relo",
        checkout_purpose: "transport",
        due_date: dueDate.toISOString().split("T")[0],
        notes: "Relo quick checkout — trap bay kiosk",
      });

      setLastAction("check_out");
      setState("done");
      setSession((prev) => [{ barcode: equipment.barcode, name: equipment.display_name, action: "check_out", timestamp: new Date() }, ...prev.slice(0, 19)]);
      toast.success(`${equipment.display_name} → Relo`);
      scheduleReset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setProcessing(false);
    }
  }, [equipment, toast, scheduleReset]);

  const handleCheckIn = useCallback(async () => {
    if (!equipment) return;
    setProcessing(true);
    try {
      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: "check_in",
        notes: "Relo return — trap bay kiosk",
      });

      setLastAction("check_in");
      setState("done");
      setSession((prev) => [{ barcode: equipment.barcode, name: equipment.display_name, action: "check_in", timestamp: new Date() }, ...prev.slice(0, 19)]);
      toast.success(`${equipment.display_name} returned`);
      scheduleReset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setProcessing(false);
    }
  }, [equipment, toast, scheduleReset]);

  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--background, #fff)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "2rem 1.5rem",
      fontFamily: "inherit",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "0.5rem",
          padding: "0.375rem 1rem", borderRadius: 20,
          background: "var(--info-bg)", border: "1px solid var(--info-border)",
          fontSize: "0.8rem", fontWeight: 600, color: "var(--info-text)",
          marginBottom: "0.75rem",
        }}>
          <Icon name="truck" size={16} color="var(--info-text)" />
          Relo Equipment
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0.5rem 0 0.25rem" }}>
          Scan Trap
        </h1>
        <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: 0 }}>
          Scan barcode to check out or return
        </p>
      </div>

      {/* Barcode input */}
      <div style={{ width: "100%", maxWidth: 480, marginBottom: "1.5rem" }}>
        <BarcodeInput
          onScan={handleScan}
          loading={state === "loading"}
          placeholder="Scan barcode..."
          autoFocus
        />
      </div>

      {/* ═══ FOUND: show action based on status ═══ */}
      {state === "found" && equipment && (
        <div style={{ width: "100%", maxWidth: 480 }}>
          {equipment.custody_status === "available" ? (
            <button
              onClick={handleCheckOut}
              disabled={processing}
              style={{
                width: "100%",
                padding: "1.5rem",
                borderRadius: 16,
                border: "3px solid var(--warning-border)",
                background: "var(--warning-bg)",
                cursor: processing ? "wait" : "pointer",
                fontFamily: "inherit",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--warning-text)", marginBottom: "0.25rem" }}>
                {equipment.display_name}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                #{equipment.barcode}
              </div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.75rem 2rem", borderRadius: 12,
                background: "var(--warning-text, #d97706)", color: "#fff",
                fontSize: "1.1rem", fontWeight: 700,
              }}>
                <Icon name="log-out" size={22} color="#fff" />
                {processing ? "Checking out..." : "Check Out for Relo"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                Due back in 2 days
              </div>
            </button>
          ) : equipment.custody_status === "checked_out" || equipment.custody_status === "assigned" ? (
            <button
              onClick={handleCheckIn}
              disabled={processing}
              style={{
                width: "100%",
                padding: "1.5rem",
                borderRadius: 16,
                border: "3px solid var(--success-border)",
                background: "var(--success-bg)",
                cursor: processing ? "wait" : "pointer",
                fontFamily: "inherit",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--success-text)", marginBottom: "0.25rem" }}>
                {equipment.display_name}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                #{equipment.barcode}
              </div>
              {equipment.custodian_name && (
                <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
                  Currently with: {equipment.custodian_name}
                </div>
              )}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.75rem 2rem", borderRadius: 12,
                background: "var(--success-text, #16a34a)", color: "#fff",
                fontSize: "1.1rem", fontWeight: 700,
              }}>
                <Icon name="log-in" size={22} color="#fff" />
                {processing ? "Checking in..." : "Return"}
              </div>
            </button>
          ) : (
            <div style={{
              padding: "1.5rem", borderRadius: 16,
              border: "2px solid var(--card-border)", textAlign: "center",
            }}>
              <div style={{ fontWeight: 600 }}>{equipment.display_name}</div>
              <div style={{ color: "var(--muted)", marginTop: "0.25rem" }}>
                Status: {equipment.custody_status}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ DONE: success feedback ═══ */}
      {state === "done" && equipment && (
        <div style={{
          width: "100%", maxWidth: 480, textAlign: "center",
          padding: "2rem", borderRadius: 16,
          border: `3px solid ${lastAction === "check_in" ? "var(--success-border)" : "var(--warning-border)"}`,
          background: lastAction === "check_in" ? "var(--success-bg)" : "var(--warning-bg)",
        }}>
          <Icon
            name={lastAction === "check_in" ? "check-circle" : "log-out"}
            size={48}
            color={lastAction === "check_in" ? "var(--success-text)" : "var(--warning-text)"}
          />
          <div style={{
            fontSize: "1.25rem", fontWeight: 700, marginTop: "0.75rem",
            color: lastAction === "check_in" ? "var(--success-text)" : "var(--warning-text)",
          }}>
            {lastAction === "check_in" ? "Returned" : "Checked Out"}
          </div>
          <div style={{ fontSize: "1rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
            {equipment.display_name}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "1rem" }}>
            Scan next barcode or wait...
          </div>
        </div>
      )}

      {/* ═══ IDLE: hint ═══ */}
      {state === "idle" && (
        <div style={{ textAlign: "center", color: "var(--muted)", marginTop: "2rem" }}>
          <Icon name="scan-barcode" size={48} color="var(--muted)" />
          <div style={{ fontSize: "1rem", marginTop: "0.75rem" }}>
            Scan a trap barcode to check out or return
          </div>
        </div>
      )}

      {/* ═══ Session history ═══ */}
      {session.length > 0 && (
        <div style={{
          width: "100%", maxWidth: 480, marginTop: "2rem",
          borderTop: "1px solid var(--card-border)", paddingTop: "1rem",
        }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>
            This Session
          </div>
          {session.map((entry, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: "0.5rem",
              padding: "0.375rem 0", fontSize: "0.85rem",
              borderBottom: "1px solid var(--card-border)",
            }}>
              <Icon
                name={entry.action === "check_out" ? "log-out" : "log-in"}
                size={14}
                color={entry.action === "check_out" ? "var(--warning-text)" : "var(--success-text)"}
              />
              <span style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>#{entry.barcode}</span>
              <span style={{ flex: 1 }}>{entry.name}</span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                {entry.timestamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
