"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import type { SectionProps } from "@/lib/person-roles/types";

/**
 * Manual catches section for trapper detail.
 * Lists manually-logged catches with add form.
 */
export function ManualCatchesSection({ personId, data, onDataChange }: SectionProps) {
  const { manualCatches } = data;

  const [showAddCatch, setShowAddCatch] = useState(false);
  const [newMicrochip, setNewMicrochip] = useState("");
  const [newCatchDate, setNewCatchDate] = useState(new Date().toISOString().split("T")[0]);
  const [newNotes, setNewNotes] = useState("");
  const [addingCatch, setAddingCatch] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const handleAddCatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMicrochip.trim()) {
      setAddError("Microchip is required");
      return;
    }
    setAddingCatch(true);
    setAddError(null);
    try {
      await postApi(`/api/people/${personId}/trapper-cats`, {
        microchip: newMicrochip.trim(),
        catch_date: newCatchDate,
        notes: newNotes.trim() || null,
      });
      setNewMicrochip("");
      setNewNotes("");
      setShowAddCatch(false);
      onDataChange?.("trapper");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Network error");
    } finally {
      setAddingCatch(false);
    }
  };

  return (
    <>
      <p className="text-muted text-sm" style={{ marginBottom: "1rem" }}>
        Track cats caught outside of formal FFR requests by entering their microchip numbers.
      </p>

      {!showAddCatch ? (
        <button onClick={() => setShowAddCatch(true)} style={{ marginBottom: "1rem" }}>+ Add Manual Catch</button>
      ) : (
        <form onSubmit={handleAddCatch} style={{ padding: "1rem", background: "var(--section-bg)", borderRadius: "8px", marginBottom: "1rem" }}>
          {addError && (
            <div style={{ color: "#dc3545", marginBottom: "0.75rem", padding: "0.5rem", background: "#f8d7da", borderRadius: "4px", fontSize: "0.875rem" }}>{addError}</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Microchip *</label>
              <input type="text" value={newMicrochip} onChange={(e) => setNewMicrochip(e.target.value)} placeholder="900000001234567" style={{ width: "100%" }} required />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Catch Date</label>
              <input type="date" value={newCatchDate} onChange={(e) => setNewCatchDate(e.target.value)} style={{ width: "100%" }} />
            </div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.875rem" }}>Notes (optional)</label>
            <input type="text" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Where caught, circumstances, etc." style={{ width: "100%" }} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" disabled={addingCatch}>{addingCatch ? "Adding..." : "Add Catch"}</button>
            <button type="button" onClick={() => { setShowAddCatch(false); setAddError(null); }} disabled={addingCatch} style={{ background: "transparent", border: "1px solid var(--border)" }}>Cancel</button>
          </div>
        </form>
      )}

      {manualCatches.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Cat</th>
              <th>Microchip</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {manualCatches.map((c) => (
              <tr key={c.catch_id}>
                <td>{new Date(c.catch_date).toLocaleDateString()}</td>
                <td>{c.cat_id ? <a href={`/cats/${c.cat_id}`}>{c.cat_name || "Unknown"}</a> : <span className="text-muted">Not linked</span>}</td>
                <td><code style={{ fontSize: "0.8rem" }}>{c.microchip}</code></td>
                <td className="text-muted">{c.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted">No manual catches recorded.</p>
      )}
    </>
  );
}
