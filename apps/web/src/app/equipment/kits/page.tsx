"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { PersonReferencePicker, type PersonReference } from "@/components/ui/PersonReferencePicker";
import type { EquipmentKitRow, VEquipmentInventoryRow } from "@/lib/types/view-contracts";

export default function EquipmentKitsPage() {
  const { success, error: showError } = useToast();
  const [kits, setKits] = useState<EquipmentKitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // Create kit drawer
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [person, setPerson] = useState<PersonReference>({ person_id: null, display_name: "", is_resolved: false });
  const [notes, setNotes] = useState("");
  const [availableEquipment, setAvailableEquipment] = useState<VEquipmentInventoryRow[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [createLoading, setCreateLoading] = useState(false);

  const fetchKits = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ kits: EquipmentKitRow[] }>(
        `/api/equipment/kits?${showAll ? "all=true&" : ""}limit=50`
      );
      setKits(data.kits || []);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to load kits");
    } finally {
      setLoading(false);
    }
  }, [showAll, showError]);

  useEffect(() => {
    fetchKits();
  }, [fetchKits]);

  const openCreateDrawer = useCallback(async () => {
    setIsCreateOpen(true);
    try {
      const data = await fetchApi<{ equipment: VEquipmentInventoryRow[] }>(
        "/api/equipment?custody_status=available&limit=200"
      );
      setAvailableEquipment(data.equipment || []);
    } catch {
      setAvailableEquipment([]);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!person.person_id || selectedItems.size === 0) return;
    setCreateLoading(true);
    try {
      await postApi("/api/equipment/kits", {
        person_id: person.person_id,
        equipment_ids: Array.from(selectedItems),
        notes: notes || undefined,
      });
      success(`Kit created with ${selectedItems.size} items`);
      setIsCreateOpen(false);
      setPerson({ person_id: null, display_name: "", is_resolved: false });
      setSelectedItems(new Set());
      setNotes("");
      fetchKits();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to create kit");
    } finally {
      setCreateLoading(false);
    }
  }, [person, selectedItems, notes, success, showError, fetchKits]);

  const handleReturn = useCallback(async (kitId: string) => {
    try {
      await postApi(`/api/equipment/kits/${kitId}`, { action: "return" });
      success("Kit returned");
      fetchKits();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Return failed");
    }
  }, [success, showError, fetchKits]);

  const toggleItem = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ maxWidth: "900px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Equipment Kits</h1>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>
            Bundle equipment for trapper checkout
          </p>
        </div>
        <button
          onClick={openCreateDrawer}
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.85rem",
            fontWeight: 600,
            background: "var(--primary, #3b82f6)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          Create Kit
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          onClick={() => setShowAll(false)}
          style={{
            padding: "0.375rem 0.75rem",
            fontSize: "0.85rem",
            background: !showAll ? "var(--primary, #3b82f6)" : "transparent",
            color: !showAll ? "#fff" : undefined,
            border: showAll ? "1px solid var(--border)" : "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          Active
        </button>
        <button
          onClick={() => setShowAll(true)}
          style={{
            padding: "0.375rem 0.75rem",
            fontSize: "0.85rem",
            background: showAll ? "var(--primary, #3b82f6)" : "transparent",
            color: showAll ? "#fff" : undefined,
            border: !showAll ? "1px solid var(--border)" : "none",
            borderRadius: "6px",
            cursor: "pointer",
          }}
        >
          All
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--muted)" }}>Loading kits...</p>
      ) : kits.length === 0 ? (
        <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          {showAll ? "No kits have been created yet." : "No active kits."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {kits.map((kit) => (
            <div
              key={kit.kit_id}
              className="card"
              style={{
                padding: "1rem",
                borderLeft: `3px solid ${kit.returned_at ? "#d1d5db" : "#3b82f6"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                    {kit.person_name || "Unknown"}
                    <span style={{
                      marginLeft: "0.5rem",
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      color: kit.returned_at ? "#6b7280" : "#166534",
                    }}>
                      {kit.returned_at ? "Returned" : "Active"}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.125rem" }}>
                    {kit.item_count} item{kit.item_count !== 1 ? "s" : ""}
                    {" — "}
                    Out: {new Date(kit.checked_out_at).toLocaleDateString()}
                    {kit.returned_at && ` — In: ${new Date(kit.returned_at).toLocaleDateString()}`}
                  </div>
                  {kit.place_address && (
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{kit.place_address}</div>
                  )}
                </div>
                {!kit.returned_at && (
                  <button
                    onClick={() => handleReturn(kit.kit_id)}
                    style={{
                      padding: "0.3rem 0.75rem",
                      fontSize: "0.8rem",
                      fontWeight: 500,
                      background: "#166534",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    Return Kit
                  </button>
                )}
              </div>

              {kit.items && kit.items.length > 0 && (
                <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                  {kit.items.map((item) => (
                    <span
                      key={item.equipment_id}
                      style={{
                        padding: "0.125rem 0.5rem",
                        fontSize: "0.7rem",
                        background: "var(--muted-bg)",
                        borderRadius: "4px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {item.display_name}
                    </span>
                  ))}
                </div>
              )}

              {kit.notes && (
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.375rem" }}>{kit.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Kit Drawer */}
      <ActionDrawer
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create Equipment Kit"
        width="lg"
        footer={
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button
              onClick={() => setIsCreateOpen(false)}
              style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!person.person_id || selectedItems.size === 0 || createLoading}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.85rem",
                fontWeight: 600,
                background: person.person_id && selectedItems.size > 0 ? "var(--primary, #3b82f6)" : "#ccc",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: person.person_id && selectedItems.size > 0 ? "pointer" : "not-allowed",
              }}
            >
              {createLoading ? "Creating..." : `Create Kit (${selectedItems.size} items)`}
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Check Out To</label>
            <PersonReferencePicker
              value={person}
              onChange={setPerson}
              placeholder="Search for trapper..."
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              style={{ width: "100%", padding: "0.5rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)", boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Select Equipment ({selectedItems.size} selected)
            </label>
            {availableEquipment.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No available equipment found.</p>
            ) : (
              <div style={{ maxHeight: "400px", overflow: "auto", border: "1px solid var(--border)", borderRadius: "6px" }}>
                {availableEquipment.map((eq) => (
                  <label
                    key={eq.equipment_id}
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "center",
                      padding: "0.5rem 0.75rem",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      background: selectedItems.has(eq.equipment_id) ? "var(--info-bg, #eff6ff)" : undefined,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedItems.has(eq.equipment_id)}
                      onChange={() => toggleItem(eq.equipment_id)}
                    />
                    <div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>{eq.display_name}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        {eq.type_display_name || eq.legacy_type}
                        {eq.barcode && <span style={{ marginLeft: "0.5rem", fontFamily: "monospace" }}>#{eq.barcode}</span>}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </ActionDrawer>
    </div>
  );
}
