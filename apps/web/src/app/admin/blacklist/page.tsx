"use client";

import { useState, useEffect } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";

interface BlacklistEntry {
  id: string;
  identifier_type: string;
  identifier_norm: string;
  reason: string;
  auto_detected: boolean;
  created_at: string;
  created_by: string | null;
}

export default function BlacklistPage() {
  return <BlacklistContent />;
}

function BlacklistContent() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newEntry, setNewEntry] = useState({ identifier_type: "email", identifier_norm: "", reason: "" });
  const [saving, setSaving] = useState(false);
  const { success: showSuccess, error: showError } = useToast();
  const [pendingDelete, setPendingDelete] = useState<BlacklistEntry | null>(null);

  async function loadEntries() {
    try {
      const params = new URLSearchParams();
      if (filterType) params.set("type", filterType);
      if (search) params.set("q", search);
      const data = await fetchApi<{ entries: BlacklistEntry[] }>(`/api/admin/blacklist?${params}`);
      setEntries(data.entries);
    } catch {
      showError("Failed to load blacklist");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    loadEntries();
  }, [filterType]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSearch() {
    setLoading(true);
    await loadEntries();
  }

  async function addEntry() {
    if (!newEntry.identifier_norm || !newEntry.reason) return;
    setSaving(true);
    try {
      await postApi("/api/admin/blacklist", newEntry);
      setNewEntry({ identifier_type: "email", identifier_norm: "", reason: "" });
      setShowAdd(false);
      await loadEntries();
      showSuccess("Entry added");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  function deleteEntry(entry: BlacklistEntry) {
    setPendingDelete(entry);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const entry = pendingDelete;
    setPendingDelete(null);
    try {
      await postApi(`/api/admin/blacklist?id=${entry.id}`, {}, { method: "DELETE" });
      await loadEntries();
      showSuccess(`Removed ${entry.identifier_norm}`);
    } catch {
      showError("Failed to remove");
    }
  }

  const emailCount = entries.filter((e) => e.identifier_type === "email").length;
  const phoneCount = entries.filter((e) => e.identifier_type === "phone").length;

  return (
    <div style={{ maxWidth: "900px" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>Soft Blacklist</h1>
        <p style={{ margin: "0.25rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Org emails and shared phones that should not create person records. {emailCount} emails, {phoneCount} phones.
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ padding: "0.375rem 0.75rem", border: "1px solid var(--card-border)", borderRadius: "6px", fontSize: "0.875rem" }}
        >
          <option value="">All types</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
        </select>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{ padding: "0.375rem 0.75rem", border: "1px solid var(--card-border)", borderRadius: "6px", fontSize: "0.875rem", flex: 1, minWidth: "150px" }}
        />
        <button onClick={handleSearch} style={{ padding: "0.375rem 0.75rem", background: "var(--primary)", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.875rem" }}>
          Search
        </button>
        <button onClick={() => setShowAdd(!showAdd)} style={{ padding: "0.375rem 0.75rem", background: showAdd ? "var(--card-bg)" : "var(--primary)", color: showAdd ? "var(--text-primary)" : "#fff", border: "1px solid var(--card-border)", borderRadius: "6px", cursor: "pointer", fontSize: "0.875rem" }}>
          {showAdd ? "Cancel" : "+ Add"}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ marginBottom: "1rem", padding: "1rem", border: "1px solid var(--card-border)", borderRadius: "8px", background: "var(--card-bg, #f9fafb)" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-muted)" }}>Type</label>
              <select value={newEntry.identifier_type} onChange={(e) => setNewEntry({ ...newEntry, identifier_type: e.target.value })} style={{ padding: "0.375rem 0.5rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.875rem" }}>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-muted)" }}>
                {newEntry.identifier_type === "email" ? "Email address" : "Phone (10 digits)"}
              </label>
              <input value={newEntry.identifier_norm} onChange={(e) => setNewEntry({ ...newEntry, identifier_norm: e.target.value })} placeholder={newEntry.identifier_type === "email" ? "org@example.com" : "7075551234"} style={{ width: "100%", padding: "0.375rem 0.5rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.875rem" }} />
            </div>
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-muted)" }}>Reason</label>
              <input value={newEntry.reason} onChange={(e) => setNewEntry({ ...newEntry, reason: e.target.value })} placeholder="Why is this blacklisted?" style={{ width: "100%", padding: "0.375rem 0.5rem", border: "1px solid var(--card-border)", borderRadius: "4px", fontSize: "0.875rem" }} />
            </div>
            <button onClick={addEntry} disabled={saving || !newEntry.identifier_norm || !newEntry.reason} style={{ padding: "0.375rem 0.75rem", background: "var(--primary)", color: "#fff", border: "none", borderRadius: "6px", cursor: saving ? "wait" : "pointer", fontSize: "0.875rem", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Adding..." : "Add"}
            </button>
          </div>
        </div>
      )}

      {/* Entries table */}
      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
      ) : (
        <div style={{ border: "1px solid var(--card-border)", borderRadius: "8px", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 60px", padding: "0.5rem 1rem", background: "var(--card-bg, #f9fafb)", borderBottom: "1px solid var(--card-border)", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)" }}>
            <div>Type</div>
            <div>Identifier</div>
            <div>Reason</div>
            <div></div>
          </div>
          {entries.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>No entries found</div>
          ) : (
            entries.map((entry, idx) => (
              <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 60px", padding: "0.5rem 1rem", borderBottom: idx < entries.length - 1 ? "1px solid var(--card-border)" : "none", alignItems: "center", fontSize: "0.875rem" }}>
                <div>
                  <span style={{ padding: "0.125rem 0.375rem", borderRadius: "4px", fontSize: "0.7rem", fontWeight: 500, background: entry.identifier_type === "email" ? "var(--info-bg, #dbeafe)" : "var(--warning-bg, #fef3c7)", color: entry.identifier_type === "email" ? "var(--info-text, #1e40af)" : "var(--warning-text, #92400e)" }}>
                    {entry.identifier_type}
                  </span>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{entry.identifier_norm}</div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{entry.reason}</div>
                <div style={{ textAlign: "right" }}>
                  <button onClick={() => deleteEntry(entry)} style={{ padding: "0.125rem 0.375rem", background: "transparent", border: "1px solid var(--card-border)", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem", color: "var(--danger, #dc2626)" }} title="Remove">
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove from blacklist"
        message={`Remove "${pendingDelete?.identifier_norm}" from blacklist?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
