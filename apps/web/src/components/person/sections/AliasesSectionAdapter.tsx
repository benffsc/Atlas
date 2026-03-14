"use client";

import { useState } from "react";
import { postApi } from "@/lib/api-client";
import { formatDateLocal } from "@/lib/formatters";
import type { SectionProps } from "@/lib/person-roles/types";

export function AliasesSectionAdapter({ personId, data, onDataChange }: SectionProps) {
  const person = data.person;
  const [addingAlias, setAddingAlias] = useState(false);
  const [newAliasName, setNewAliasName] = useState("");
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [savingAlias, setSavingAlias] = useState(false);

  const handleAddAlias = async () => {
    const name = newAliasName.trim();
    if (!name) return;
    setSavingAlias(true);
    setAliasError(null);
    try {
      await postApi(`/api/people/${personId}/aliases`, { name });
      setNewAliasName("");
      setAddingAlias(false);
      onDataChange?.("person");
    } catch (err) {
      setAliasError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSavingAlias(false);
    }
  };

  const handleDeleteAlias = async (aliasId: string) => {
    try {
      await postApi(`/api/people/${personId}/aliases`, { alias_id: aliasId }, { method: "DELETE" });
      onDataChange?.("person");
    } catch {
      /* optional: alias delete failed */
    }
  };

  return (
    <>
      {person?.aliases && person.aliases.length > 0 ? (
        <table style={{ width: "100%", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "0.5rem 0" }}>Name</th>
              <th style={{ padding: "0.5rem 0" }}>Source</th>
              <th style={{ padding: "0.5rem 0" }}>Date</th>
              <th style={{ padding: "0.5rem 0", width: "60px" }}></th>
            </tr>
          </thead>
          <tbody>
            {person.aliases.map((alias) => {
              const sourceLabel = alias.source_table === "name_change" ? "Name Change" :
                alias.source_table === "manual_alias" ? "Manual" :
                alias.source_system || "System";
              return (
                <tr key={alias.alias_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.5rem 0" }}>{alias.name_raw}</td>
                  <td style={{ padding: "0.5rem 0" }}>
                    <span className="badge" style={{ background: "#6c757d", color: "#fff", fontSize: "0.7rem" }}>{sourceLabel}</span>
                  </td>
                  <td style={{ padding: "0.5rem 0" }} className="text-muted">{formatDateLocal(alias.created_at)}</td>
                  <td style={{ padding: "0.5rem 0" }}>
                    <button onClick={() => handleDeleteAlias(alias.alias_id)} style={{
                      padding: "0.125rem 0.375rem", fontSize: "0.7rem", background: "transparent",
                      border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", color: "#dc3545",
                    }}>Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-muted text-sm">No previous names recorded.</p>
      )}
      <div style={{ marginTop: "0.75rem" }}>
        {addingAlias ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input type="text" value={newAliasName} onChange={(e) => setNewAliasName(e.target.value)} placeholder="Enter previous name"
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.875rem", width: "200px" }} autoFocus onKeyDown={(e) => e.key === "Enter" && handleAddAlias()} />
            <button onClick={handleAddAlias} disabled={savingAlias || !newAliasName.trim()} style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}>
              {savingAlias ? "Saving..." : "Add"}
            </button>
            <button onClick={() => { setAddingAlias(false); setAliasError(null); setNewAliasName(""); }}
              style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem", background: "transparent", border: "1px solid var(--border)" }}>Cancel</button>
            {aliasError && <span style={{ color: "#dc3545", fontSize: "0.8rem" }}>{aliasError}</span>}
          </div>
        ) : (
          <button onClick={() => setAddingAlias(true)} style={{
            padding: "0.25rem 0.75rem", fontSize: "0.8rem", background: "transparent",
            border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer",
          }}>+ Add Previous Name</button>
        )}
      </div>
    </>
  );
}
