"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { PersonReferencePicker, type PersonReference } from "@/components/ui/PersonReferencePicker";

interface EquipmentItem {
  equipment_id: string;
  equipment_type: string;
  equipment_name: string | null;
  serial_number: string | null;
  condition: string | null;
  notes: string | null;
  is_available: boolean;
  source_system: string;
  created_at: string;
  active_checkout_person: string | null;
  active_checkout_date: string | null;
  total_checkouts: number;
}

interface CheckoutRecord {
  checkout_id: string;
  person_name: string | null;
  person_id: string | null;
  checked_out_at: string | null;
  returned_at: string | null;
  notes: string | null;
  source_system: string;
}

interface EquipmentStats {
  total: number;
  available: number;
  checked_out: number;
  by_type: Array<{ equipment_type: string; count: number }>;
}

const CONDITION_COLORS: Record<string, string> = {
  good: "#166534",
  fair: "#b45309",
  poor: "#dc3545",
  new: "#0d6efd",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function EquipmentAdminPage() {
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [stats, setStats] = useState<EquipmentStats | null>(null);
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [availableFilter, setAvailableFilter] = useState<string>("");

  // Detail panel
  const [selectedItem, setSelectedItem] = useState<EquipmentItem | null>(null);
  const [checkouts, setCheckouts] = useState<CheckoutRecord[]>([]);
  const [loadingCheckouts, setLoadingCheckouts] = useState(false);

  // Checkout/return state
  const [showCheckoutForm, setShowCheckoutForm] = useState(false);
  const [checkoutPerson, setCheckoutPerson] = useState<PersonReference>({ person_id: null, display_name: "", is_resolved: false });
  const [checkoutNotes, setCheckoutNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchEquipment = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (availableFilter) params.set("available", availableFilter);

      const data = await fetchApi<{
        equipment: EquipmentItem[];
        stats: EquipmentStats;
        equipment_types: string[];
      }>(`/api/admin/equipment?${params}`);

      setEquipment(data.equipment || []);
      setStats(data.stats);
      setEquipmentTypes(data.equipment_types || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load equipment");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, availableFilter]);

  useEffect(() => {
    fetchEquipment();
  }, [fetchEquipment]);

  const openDetail = async (item: EquipmentItem) => {
    setSelectedItem(item);
    setLoadingCheckouts(true);
    try {
      const data = await fetchApi<{ checkouts: CheckoutRecord[] }>(
        `/api/admin/equipment/${item.equipment_id}/checkouts`
      );
      setCheckouts(data.checkouts || []);
    } catch {
      setCheckouts([]);
    } finally {
      setLoadingCheckouts(false);
    }
  };

  const handleCheckout = async () => {
    if (!selectedItem || !checkoutPerson.person_id) return;
    setActionLoading(true);
    try {
      await postApi("/api/admin/equipment", {
        action: "checkout",
        equipment_id: selectedItem.equipment_id,
        person_id: checkoutPerson.person_id,
        notes: checkoutNotes || undefined,
      });
      setShowCheckoutForm(false);
      setCheckoutPerson({ person_id: null, display_name: "", is_resolved: false });
      setCheckoutNotes("");
      await fetchEquipment();
      // Refresh detail panel
      const updated = equipment.find(e => e.equipment_id === selectedItem.equipment_id);
      if (updated) openDetail({ ...updated, is_available: false, active_checkout_person: checkoutPerson.display_name, active_checkout_date: new Date().toISOString() });
      else setSelectedItem(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReturn = async () => {
    if (!selectedItem) return;
    setActionLoading(true);
    try {
      await postApi("/api/admin/equipment", {
        action: "return",
        equipment_id: selectedItem.equipment_id,
      });
      await fetchEquipment();
      openDetail({ ...selectedItem, is_available: true, active_checkout_person: null, active_checkout_date: null });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Return failed");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Equipment Inventory</h1>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Equipment Inventory</h1>
        <p style={{ color: "#dc3545" }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>Equipment Inventory</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.5rem", fontSize: "0.85rem" }}>
        Manage trap equipment and checkout history. Imported from Airtable.
      </p>

      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <div className="card" style={{ padding: "0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{stats.total}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>Total Items</div>
          </div>
          <div className="card" style={{ padding: "0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#166534" }}>{stats.available}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>Available</div>
          </div>
          <div className="card" style={{ padding: "0.75rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#b45309" }}>{stats.checked_out}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>Checked Out</div>
          </div>
          {stats.by_type?.map((t) => (
            <div key={t.equipment_type} className="card" style={{ padding: "0.75rem", textAlign: "center" }}>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--text)" }}>{t.count}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase" }}>{t.equipment_type}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)" }}
        >
          <option value="">All Types</option>
          {equipmentTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={availableFilter}
          onChange={(e) => setAvailableFilter(e.target.value)}
          style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem", borderRadius: "6px", border: "1px solid var(--border)" }}
        >
          <option value="">All Status</option>
          <option value="true">Available</option>
          <option value="false">Checked Out</option>
        </select>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
              <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Type</th>
              <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Name / Serial</th>
              <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Condition</th>
              <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Status</th>
              <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Checkouts</th>
            </tr>
          </thead>
          <tbody>
            {equipment.map((item) => (
              <tr
                key={item.equipment_id}
                onClick={() => openDetail(item)}
                style={{
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  background: selectedItem?.equipment_id === item.equipment_id ? "var(--muted-bg)" : undefined,
                }}
                onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--muted-bg)"; }}
                onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = selectedItem?.equipment_id === item.equipment_id ? "var(--muted-bg)" : ""; }}
              >
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <span style={{ fontWeight: 500 }}>{item.equipment_type}</span>
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <div>{item.equipment_name || "—"}</div>
                  {item.serial_number && (
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>SN: {item.serial_number}</div>
                  )}
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  {item.condition ? (
                    <span style={{
                      fontSize: "0.75rem",
                      padding: "0.125rem 0.5rem",
                      borderRadius: "4px",
                      background: (CONDITION_COLORS[item.condition.toLowerCase()] || "#6c757d") + "18",
                      color: CONDITION_COLORS[item.condition.toLowerCase()] || "#6c757d",
                      fontWeight: 500,
                    }}>
                      {item.condition}
                    </span>
                  ) : "—"}
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  {item.is_available ? (
                    <span style={{ color: "#166534", fontWeight: 500, fontSize: "0.8rem" }}>Available</span>
                  ) : (
                    <div>
                      <span style={{ color: "#b45309", fontWeight: 500, fontSize: "0.8rem" }}>Checked out</span>
                      {item.active_checkout_person && (
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                          to {item.active_checkout_person}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td style={{ padding: "0.5rem 0.75rem", textAlign: "center" }}>
                  {item.total_checkouts}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {equipment.length === 0 && (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            No equipment found matching filters.
          </div>
        )}
      </div>

      {/* Detail Panel (modal) */}
      {selectedItem && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "480px",
            maxWidth: "100vw",
            background: "var(--card-bg, #fff)",
            borderLeft: "1px solid var(--border)",
            boxShadow: "-4px 0 12px rgba(0,0,0,0.1)",
            zIndex: 100,
            overflow: "auto",
            padding: "1.5rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
                {selectedItem.equipment_name || selectedItem.equipment_type}
              </h2>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                {selectedItem.equipment_type}
                {selectedItem.serial_number && ` — SN: ${selectedItem.serial_number}`}
              </div>
            </div>
            <button
              onClick={() => setSelectedItem(null)}
              style={{
                background: "none",
                border: "none",
                fontSize: "1.25rem",
                cursor: "pointer",
                padding: "0.25rem",
                color: "var(--muted)",
              }}
            >
              x
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1.25rem" }}>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.125rem" }}>Condition</div>
              <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{selectedItem.condition || "Unknown"}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.125rem" }}>Status</div>
              <div style={{ fontSize: "0.875rem", fontWeight: 500, color: selectedItem.is_available ? "#166534" : "#b45309" }}>
                {selectedItem.is_available ? "Available" : "Checked Out"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.125rem" }}>Source</div>
              <div style={{ fontSize: "0.875rem" }}>{selectedItem.source_system}</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.125rem" }}>Total Checkouts</div>
              <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{selectedItem.total_checkouts}</div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ marginBottom: "1.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {selectedItem.is_available ? (
              <button
                onClick={() => setShowCheckoutForm(!showCheckoutForm)}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.8rem",
                  background: "#b45309",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Check Out
              </button>
            ) : (
              <button
                onClick={handleReturn}
                disabled={actionLoading}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.8rem",
                  background: "#166534",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: actionLoading ? "wait" : "pointer",
                  fontWeight: 500,
                  opacity: actionLoading ? 0.7 : 1,
                }}
              >
                {actionLoading ? "Returning..." : "Return Equipment"}
              </button>
            )}
          </div>

          {/* Checkout form */}
          {showCheckoutForm && (
            <div style={{
              marginBottom: "1.25rem",
              padding: "0.75rem",
              background: "var(--muted-bg)",
              borderRadius: "6px",
              border: "1px solid var(--border)",
            }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Check Out To</div>
              <PersonReferencePicker
                value={checkoutPerson}
                onChange={setCheckoutPerson}
                placeholder="Search for person..."
                inputStyle={{ fontSize: "0.85rem" }}
              />
              <div style={{ marginTop: "0.5rem" }}>
                <input
                  type="text"
                  value={checkoutNotes}
                  onChange={(e) => setCheckoutNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  style={{
                    width: "100%",
                    padding: "0.375rem 0.5rem",
                    fontSize: "0.8rem",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  onClick={handleCheckout}
                  disabled={!checkoutPerson.person_id || actionLoading}
                  style={{
                    padding: "0.3rem 0.6rem",
                    fontSize: "0.8rem",
                    background: checkoutPerson.person_id ? "#b45309" : "#ccc",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: checkoutPerson.person_id && !actionLoading ? "pointer" : "not-allowed",
                    fontWeight: 500,
                  }}
                >
                  {actionLoading ? "..." : "Confirm Checkout"}
                </button>
                <button
                  onClick={() => { setShowCheckoutForm(false); setCheckoutPerson({ person_id: null, display_name: "", is_resolved: false }); setCheckoutNotes(""); }}
                  style={{
                    padding: "0.3rem 0.6rem",
                    fontSize: "0.8rem",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {selectedItem.notes && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.25rem" }}>Notes</div>
              <div style={{ fontSize: "0.85rem", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px" }}>
                {selectedItem.notes}
              </div>
            </div>
          )}

          {/* Checkout History */}
          <div>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.75rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
              Checkout History
            </h3>
            {loadingCheckouts ? (
              <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Loading...</p>
            ) : checkouts.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No checkout records.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {checkouts.map((co) => (
                  <div
                    key={co.checkout_id}
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: "6px",
                      background: co.returned_at ? "var(--muted-bg)" : "#fff7ed",
                      border: `1px solid ${co.returned_at ? "var(--border)" : "#fed7aa"}`,
                      fontSize: "0.8rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 500 }}>{co.person_name || "Unknown"}</span>
                      <span style={{
                        fontSize: "0.7rem",
                        fontWeight: 500,
                        color: co.returned_at ? "#166534" : "#b45309",
                      }}>
                        {co.returned_at ? "Returned" : "Active"}
                      </span>
                    </div>
                    <div style={{ color: "var(--muted)", marginTop: "0.125rem" }}>
                      Out: {formatDate(co.checked_out_at)}
                      {co.returned_at && ` — In: ${formatDate(co.returned_at)}`}
                    </div>
                    {co.notes && (
                      <div style={{ marginTop: "0.25rem", color: "var(--muted)" }}>{co.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backdrop for detail panel */}
      {selectedItem && (
        <div
          onClick={() => setSelectedItem(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.15)",
            zIndex: 99,
          }}
        />
      )}
    </div>
  );
}
