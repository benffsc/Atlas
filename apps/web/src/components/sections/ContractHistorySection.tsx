"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import type { SectionProps } from "@/lib/person-roles/types";

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  ffsc_volunteer: "FFSC Volunteer",
  community_limited: "Community Limited",
  colony_caretaker: "Colony Caretaker",
  rescue_partnership: "Rescue Partnership",
};

const CONTRACT_STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  active: { bg: "#dcfce7", color: "#166534" },
  pending: { bg: "#fef3c7", color: "#92400e" },
  expired: { bg: "#fee2e2", color: "#b91c1c" },
  terminated: { bg: "#f3f4f6", color: "#6b7280" },
};

/**
 * Contract history section for trapper detail.
 * Lists all contracts with status badges, add/terminate actions.
 */
export function ContractHistorySection({ personId, data, onDataChange }: SectionProps) {
  const { contracts } = data;

  const [showAddContract, setShowAddContract] = useState(false);
  const [newContractType, setNewContractType] = useState("community_limited");
  const [newContractSignedDate, setNewContractSignedDate] = useState(new Date().toISOString().split("T")[0]);
  const [newContractExpDate, setNewContractExpDate] = useState("");
  const [newContractAreaDesc, setNewContractAreaDesc] = useState("");
  const [newContractNotes, setNewContractNotes] = useState("");
  const [newContractExpirePrev, setNewContractExpirePrev] = useState(true);
  const [addingContract, setAddingContract] = useState(false);
  const [terminatingContractId, setTerminatingContractId] = useState<string | null>(null);

  const handleAddContract = async () => {
    setAddingContract(true);
    try {
      await postApi(`/api/people/${personId}/contracts`, {
        contract_type: newContractType,
        signed_date: newContractSignedDate || undefined,
        expiration_date: newContractExpDate || undefined,
        service_area_description: newContractAreaDesc || undefined,
        contract_notes: newContractNotes || undefined,
        expire_previous: newContractExpirePrev,
      });
      setShowAddContract(false);
      setNewContractType("community_limited");
      setNewContractSignedDate(new Date().toISOString().split("T")[0]);
      setNewContractExpDate("");
      setNewContractAreaDesc("");
      setNewContractNotes("");
      onDataChange?.("trapper");
    } catch (err) {
      console.error("Failed to create contract:", err);
      alert(err instanceof Error ? err.message : "Failed to create contract");
    } finally {
      setAddingContract(false);
    }
  };

  const handleTerminateContract = async (contractId: string) => {
    const reason = prompt("Reason for termination:");
    if (reason === null) return;
    setTerminatingContractId(contractId);
    try {
      await postApi(`/api/people/${personId}/contracts/${contractId}`, {
        status: "terminated",
        reason: reason || "Manually terminated",
      }, { method: "PATCH" });
      onDataChange?.("trapper");
    } catch (err) {
      console.error("Failed to terminate contract:", err);
      alert(err instanceof Error ? err.message : "Failed to terminate contract");
    } finally {
      setTerminatingContractId(null);
    }
  };

  return (
    <>
      {!showAddContract ? (
        <button onClick={() => setShowAddContract(true)} style={{ marginBottom: "1rem" }}>
          + New Contract
        </button>
      ) : (
        <div style={{ padding: "1rem", background: "#f8f9fa", borderRadius: "8px", marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Contract Type</label>
              <select value={newContractType} onChange={(e) => setNewContractType(e.target.value)} style={{ width: "100%", padding: "0.5rem" }}>
                {Object.entries(CONTRACT_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Signed Date</label>
              <input type="date" value={newContractSignedDate} onChange={(e) => setNewContractSignedDate(e.target.value)} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Expiration Date (optional)</label>
              <input type="date" value={newContractExpDate} onChange={(e) => setNewContractExpDate(e.target.value)} style={{ width: "100%", padding: "0.5rem" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Service Area Description (optional)</label>
              <input type="text" value={newContractAreaDesc} onChange={(e) => setNewContractAreaDesc(e.target.value)} placeholder="e.g. Santa Rosa, West Side" style={{ width: "100%", padding: "0.5rem" }} />
            </div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Notes (optional)</label>
            <input type="text" value={newContractNotes} onChange={(e) => setNewContractNotes(e.target.value)} placeholder="Any additional notes..." style={{ width: "100%", padding: "0.5rem" }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", cursor: "pointer" }}>
            <input type="checkbox" checked={newContractExpirePrev} onChange={(e) => setNewContractExpirePrev(e.target.checked)} />
            <span style={{ fontSize: "0.875rem" }}>Expire previous active contract of same type</span>
          </label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={handleAddContract} disabled={addingContract}>{addingContract ? "Creating..." : "Create Contract"}</button>
            <button onClick={() => setShowAddContract(false)} style={{ background: "transparent", border: "1px solid var(--border)" }}>Cancel</button>
          </div>
        </div>
      )}

      {contracts.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {contracts.map((c) => {
            const statusStyle = CONTRACT_STATUS_STYLES[c.status] || CONTRACT_STATUS_STYLES.active;
            return (
              <div key={c.contract_id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0.75rem 1rem", background: "#f8f9fa", borderRadius: "8px",
                borderLeft: `4px solid ${statusStyle.color}`,
                opacity: c.status === "terminated" || c.status === "expired" ? 0.7 : 1,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.75rem", padding: "0.125rem 0.5rem", borderRadius: "4px", background: statusStyle.bg, color: statusStyle.color, fontWeight: 500 }}>
                      {CONTRACT_TYPE_LABELS[c.contract_type] || c.contract_type}
                    </span>
                    <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "3px", background: statusStyle.bg, color: statusStyle.color }}>
                      {c.status}
                    </span>
                    {c.is_expiring_soon && c.status === "active" && (
                      <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "3px", background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>Expiring Soon</span>
                    )}
                    {c.is_expired && c.status === "active" && (
                      <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "3px", background: "#fee2e2", color: "#b91c1c", fontWeight: 600 }}>Expired</span>
                    )}
                    {c.renewed_from_contract_id && (
                      <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>(renewal)</span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                    {c.signed_date && `Signed: ${new Date(c.signed_date).toLocaleDateString()}`}
                    {c.expiration_date && ` · Expires: ${new Date(c.expiration_date).toLocaleDateString()}`}
                    {c.service_area_description && ` · ${c.service_area_description}`}
                  </div>
                  {c.contract_notes && (
                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.15rem", fontStyle: "italic" }}>{c.contract_notes}</div>
                  )}
                </div>
                {c.status === "active" && (
                  <button
                    onClick={() => handleTerminateContract(c.contract_id)}
                    disabled={terminatingContractId === c.contract_id}
                    title="Terminate contract"
                    style={{
                      background: "transparent", border: "1px solid #fecaca", color: "#b91c1c",
                      cursor: terminatingContractId === c.contract_id ? "not-allowed" : "pointer",
                      fontSize: "0.75rem", padding: "0.25rem 0.5rem", borderRadius: "4px",
                    }}
                  >
                    {terminatingContractId === c.contract_id ? "..." : "Terminate"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-muted">No contracts on file.</p>
      )}
    </>
  );
}
