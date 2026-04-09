"use client";

/**
 * /admin/email-settings/suppressions
 *
 * FFS-1181 Follow-Up Phase 5. Admin UI for ops.email_suppressions.
 * List, filter, add, and remove suppressions.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";

interface Suppression {
  suppression_id: string;
  email_norm: string;
  scope: "global" | "per_flow" | "per_flow_per_recipient";
  flow_slug: string | null;
  reason: string;
  source: string;
  created_at: string;
  expires_at: string | null;
  notes: string | null;
}

const REASONS = [
  "hard_bounce",
  "soft_bounce_repeated",
  "complaint",
  "unsubscribe",
  "manual",
  "gdpr_erasure",
  "invalid_address",
] as const;

export default function SuppressionsPage() {
  const [rows, setRows] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [form, setForm] = useState({
    email: "",
    scope: "global" as Suppression["scope"],
    flow_slug: "",
    reason: "manual",
    notes: "",
    expires_days: "",
  });

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ rows: Suppression[] }>(
        "/api/admin/email-settings/suppressions"
      );
      setRows(data.rows || []);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to load",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const addSuppression = async () => {
    try {
      await postApi("/api/admin/email-settings/suppressions", {
        ...form,
        expires_days: form.expires_days ? parseInt(form.expires_days, 10) : null,
      });
      setMessage({ type: "success", text: "Suppression added" });
      setForm({
        email: "",
        scope: "global",
        flow_slug: "",
        reason: "manual",
        notes: "",
        expires_days: "",
      });
      reload();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to add",
      });
    }
  };

  const removeRow = async (id: string) => {
    if (!confirm("Remove this suppression?")) return;
    try {
      await postApi(
        `/api/admin/email-settings/suppressions?id=${id}`,
        {},
        { method: "DELETE" }
      );
      setMessage({ type: "success", text: "Removed" });
      reload();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to remove",
      });
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1100px", margin: "0 auto" }}>
      <Link
        href="/admin/email-settings"
        style={{
          color: "var(--text-muted)",
          textDecoration: "none",
          fontSize: "0.875rem",
        }}
      >
        &larr; Email Settings
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginTop: "0.5rem" }}>
        Email Suppressions
      </h1>
      <p style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>
        Addresses that are blocked from receiving email. Auto-populated by
        bounce / unsubscribe webhooks; manually editable.
      </p>

      {message && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: 6,
            margin: "1rem 0",
            background: message.type === "success" ? "#dcfce7" : "#fef2f2",
            border: `1px solid ${
              message.type === "success" ? "#86efac" : "#fecaca"
            }`,
            color: message.type === "success" ? "#166534" : "#dc2626",
          }}
        >
          {message.text}
        </div>
      )}

      {/* Add form */}
      <div
        className="card"
        style={{ padding: "1rem 1.25rem", marginBottom: "1.5rem" }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
          Add Suppression
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr",
            gap: "0.5rem",
          }}
        >
          <input
            type="email"
            placeholder="email@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            style={inputStyle}
          />
          <select
            value={form.scope}
            onChange={(e) =>
              setForm({
                ...form,
                scope: e.target.value as Suppression["scope"],
              })
            }
            style={inputStyle}
          >
            <option value="global">global</option>
            <option value="per_flow">per_flow</option>
          </select>
          <input
            type="text"
            placeholder="flow_slug (if per_flow)"
            value={form.flow_slug}
            onChange={(e) => setForm({ ...form, flow_slug: e.target.value })}
            style={inputStyle}
            disabled={form.scope === "global"}
          />
          <select
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            style={inputStyle}
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr auto",
            gap: "0.5rem",
            marginTop: "0.5rem",
          }}
        >
          <input
            type="text"
            placeholder="notes (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            style={inputStyle}
          />
          <input
            type="number"
            placeholder="TTL days (blank = permanent)"
            value={form.expires_days}
            onChange={(e) => setForm({ ...form, expires_days: e.target.value })}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={addSuppression}
            disabled={!form.email}
            style={{
              padding: "0.5rem 1rem",
              background: "#0d6efd",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: form.email ? "pointer" : "not-allowed",
              opacity: form.email ? 1 : 0.5,
            }}
          >
            Add
          </button>
        </div>
      </div>

      {/* List */}
      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              color: "var(--text-muted)",
            }}
          >
            No suppressions.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--background-secondary)" }}>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Scope</th>
                <th style={thStyle}>Flow</th>
                <th style={thStyle}>Reason</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Expires</th>
                <th style={{ ...thStyle, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.suppression_id}
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <td style={tdStyle}>
                    <code>{s.email_norm}</code>
                  </td>
                  <td style={tdStyle}>{s.scope}</td>
                  <td style={tdStyle}>{s.flow_slug || "—"}</td>
                  <td style={tdStyle}>{s.reason}</td>
                  <td style={tdStyle}>{s.source}</td>
                  <td style={{ ...tdStyle, fontSize: "0.7rem" }}>
                    {new Date(s.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ ...tdStyle, fontSize: "0.7rem" }}>
                    {s.expires_at
                      ? new Date(s.expires_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => removeRow(s.suppression_id)}
                      style={{
                        padding: "0.25rem 0.55rem",
                        background: "transparent",
                        color: "#dc3545",
                        border: "1px solid #dc3545",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: "0.7rem",
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.45rem 0.6rem",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: "0.85rem",
};

const thStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  textAlign: "left",
  fontSize: "0.75rem",
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  fontSize: "0.8rem",
};
