"use client";

import { useState, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { BarcodeInput } from "@/components/equipment/BarcodeInput";
import { QuickActionCard } from "@/components/equipment/QuickActionCard";
import { PersonReferencePicker, type PersonReference } from "@/components/ui/PersonReferencePicker";
import type { VEquipmentInventoryRow } from "@/lib/types/view-contracts";
import { EQUIPMENT_CONDITION_OPTIONS } from "@/lib/form-options";

type ScannedItem = VEquipmentInventoryRow & { available_actions: string[] };

export default function EquipmentScanPage() {
  const { success, error: showError } = useToast();
  const [loading, setLoading] = useState(false);
  const [equipment, setEquipment] = useState<ScannedItem | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Action form state
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [person, setPerson] = useState<PersonReference>({ person_id: null, display_name: "", is_resolved: false });
  const [conditionAfter, setConditionAfter] = useState("");
  const [notes, setNotes] = useState("");

  const handleScan = useCallback(async (barcode: string) => {
    setLoading(true);
    setScanError(null);
    setEquipment(null);
    setActiveAction(null);

    try {
      const data = await fetchApi<ScannedItem>(`/api/equipment/scan?barcode=${encodeURIComponent(barcode)}`);
      setEquipment(data);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Equipment not found");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAction = useCallback((action: string) => {
    if (action === "check_in") {
      // Quick check-in: no form needed, just condition
      setActiveAction("check_in");
      setConditionAfter("");
      setNotes("");
    } else if (action === "check_out") {
      setActiveAction("check_out");
      setPerson({ person_id: null, display_name: "", is_resolved: false });
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
        notes: notes || undefined,
      });

      success(`${activeAction.replace(/_/g, " ")} recorded`);

      // Re-fetch to get updated state
      const updated = await fetchApi<ScannedItem>(
        `/api/equipment/scan?barcode=${encodeURIComponent(equipment.barcode || equipment.equipment_id)}`
      );
      setEquipment(updated);
      setActiveAction(null);
      setPerson({ person_id: null, display_name: "", is_resolved: false });
      setNotes("");
      setConditionAfter("");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  }, [equipment, activeAction, person, conditionAfter, notes, success, showError]);

  const quickReCheckout = useCallback(async () => {
    if (!equipment) return;
    setActionLoading(true);

    try {
      // Check in first
      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: "check_in",
        condition_after: conditionAfter || undefined,
        notes: "Quick re-checkout return",
      });
      // Then check out to new person
      await postApi(`/api/equipment/${equipment.equipment_id}/events`, {
        event_type: "check_out",
        custodian_person_id: person.person_id,
        notes: notes || undefined,
      });

      success("Quick re-checkout complete");

      const updated = await fetchApi<ScannedItem>(
        `/api/equipment/scan?barcode=${encodeURIComponent(equipment.barcode || equipment.equipment_id)}`
      );
      setEquipment(updated);
      setActiveAction(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Re-checkout failed");
    } finally {
      setActionLoading(false);
    }
  }, [equipment, person, conditionAfter, notes, success, showError]);

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Equipment Scanner</h1>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
          Scan barcode or type equipment ID
        </p>
      </div>

      <BarcodeInput onScan={handleScan} loading={loading} />

      {scanError && (
        <div style={{
          marginTop: "1rem",
          padding: "0.75rem 1rem",
          background: "var(--danger-bg)",
          border: "1px solid var(--danger-border)",
          borderRadius: "8px",
          color: "var(--danger-text)",
          fontSize: "0.9rem",
        }}>
          {scanError}
        </div>
      )}

      {equipment && (
        <div style={{ marginTop: "1.5rem" }}>
          <QuickActionCard
            equipment={equipment}
            onAction={handleAction}
            actionLoading={actionLoading}
          />

          {/* Action Form */}
          {activeAction && (
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
                <div style={{ marginBottom: "0.75rem" }}>
                  <PersonReferencePicker
                    value={person}
                    onChange={setPerson}
                    placeholder="Search for trapper or staff..."
                    label="Person"
                  />
                </div>
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
                <button
                  onClick={submitAction}
                  disabled={actionLoading || (activeAction === "check_out" && !person.person_id)}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    background: "var(--primary, #3b82f6)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    cursor: actionLoading ? "wait" : "pointer",
                    opacity: actionLoading || (activeAction === "check_out" && !person.person_id) ? 0.5 : 1,
                  }}
                >
                  {actionLoading ? "..." : "Confirm"}
                </button>

                {/* Quick re-checkout: visible when checking in an item */}
                {activeAction === "check_in" && (
                  <button
                    onClick={() => {
                      setActiveAction("re_checkout");
                      setPerson({ person_id: null, display_name: "", is_resolved: false });
                    }}
                    style={{
                      padding: "0.5rem 1rem",
                      fontSize: "0.9rem",
                      fontWeight: 500,
                      background: "var(--warning-text)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                  >
                    Quick Re-checkout
                  </button>
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
                    <button
                      onClick={quickReCheckout}
                      disabled={!person.person_id || actionLoading}
                      style={{
                        padding: "0.5rem 1rem",
                        fontSize: "0.9rem",
                        fontWeight: 600,
                        background: person.person_id ? "var(--warning-text)" : "var(--border)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "8px",
                        cursor: person.person_id ? "pointer" : "not-allowed",
                      }}
                    >
                      Re-checkout
                    </button>
                  </>
                )}

                <button
                  onClick={() => setActiveAction(null)}
                  style={{
                    padding: "0.5rem 1rem",
                    fontSize: "0.9rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Helper text */}
      {!equipment && !scanError && !loading && (
        <div style={{
          marginTop: "3rem",
          textAlign: "center",
          color: "var(--muted)",
          fontSize: "0.85rem",
        }}>
          <p style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
            {/* barcode icon emoji-free */}
            |||||||
          </p>
          <p>Point USB scanner at barcode and scan</p>
          <p style={{ marginTop: "0.25rem" }}>or type a barcode / trap number and press Enter</p>
        </div>
      )}
    </div>
  );
}
