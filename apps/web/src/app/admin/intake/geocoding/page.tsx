"use client";

/**
 * /admin/intake/geocoding — DLQ review UI
 *
 * Part of FFS-1181 Follow-Up Phase 4. Lists intake submissions stuck in
 * the geocoding queue (failed, zero_results, unreachable) and lets staff:
 *
 *   - Edit the address and requeue
 *   - Manually override lat/lng
 *   - Skip (mark intentionally ungeocodable)
 *   - Retry (reset to pending)
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";

interface DlqRow {
  submission_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  cats_address: string | null;
  cats_city: string | null;
  cats_zip: string | null;
  geocode_status: string;
  geocode_attempts: number;
  geocode_last_attempted_at: string | null;
  geocode_last_error: string | null;
  geocode_next_attempt_at: string | null;
  created_at: string;
}

interface Health {
  pending: number;
  ok: number;
  failed: number;
  zero_results: number;
  unreachable: number;
  manual_override: number;
  skipped: number;
  oldest_pending_age_minutes: number | null;
}

type Action = "retry" | "skip" | "manual_override" | "edit_address" | null;

export default function GeocodingDlqPage() {
  const [rows, setRows] = useState<DlqRow[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    row: DlqRow;
    action: Action;
  } | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const qs = filter ? `?status=${filter}` : "";
      const data = await fetchApi<{ rows: DlqRow[]; health: Health }>(
        `/api/admin/intake/geocoding${qs}`
      );
      setRows(data.rows || []);
      setHealth(data.health || null);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to load queue",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const doRetry = async (id: string) => {
    setBusy(id);
    try {
      await postApi(`/api/admin/intake/${id}/geocode-retry`, {});
      setMessage({ type: "success", text: "Requeued" });
      reload();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Retry failed",
      });
    } finally {
      setBusy(null);
    }
  };

  const doAction = async (
    id: string,
    body: Record<string, unknown>
  ) => {
    setBusy(id);
    try {
      await postApi(`/api/admin/intake/${id}/geocode`, body, {
        method: "PATCH",
      });
      setMessage({ type: "success", text: "Updated" });
      setEditing(null);
      reload();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Action failed",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <Link
          href="/admin"
          style={{
            color: "var(--text-muted)",
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          &larr; Admin
        </Link>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginTop: "0.5rem" }}>
          Intake Geocoding Queue
        </h1>
        <p style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>
          Submissions stuck in the geocoding queue. Retry after fixing the
          address, manually enter lat/lng, or skip if intentionally
          ungeocodable.
        </p>
      </div>

      {message && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: 6,
            marginBottom: "1rem",
            background: message.type === "success" ? "#dcfce7" : "#fef2f2",
            border: `1px solid ${
              message.type === "success" ? "#86efac" : "#fecaca"
            }`,
            color: message.type === "success" ? "#166534" : "#dc2626",
          }}
        >
          {message.text}
          <button
            onClick={() => setMessage(null)}
            style={{
              float: "right",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Health summary */}
      {health && (
        <div
          className="card"
          style={{
            padding: "1rem 1.25rem",
            marginBottom: "1rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "1rem",
          }}
        >
          {[
            ["Pending", health.pending, "#6c757d"],
            ["OK", health.ok, "#198754"],
            ["Failed", health.failed, "#dc3545"],
            ["Zero Results", health.zero_results, "#856404"],
            ["Unreachable", health.unreachable, "#fd7e14"],
            ["Manual Override", health.manual_override, "#0d6efd"],
            ["Skipped", health.skipped, "#6c757d"],
          ].map(([label, value, color]) => (
            <div key={label as string}>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {label}
              </div>
              <div
                style={{
                  fontSize: "1.25rem",
                  fontWeight: 600,
                  color: color as string,
                }}
              >
                {value as number}
              </div>
            </div>
          ))}
          {health.oldest_pending_age_minutes !== null && (
            <div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Oldest pending
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 600 }}>
                {Math.round(health.oldest_pending_age_minutes)}m
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter chips */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {[
          ["", "All Issues"],
          ["failed", "Failed"],
          ["zero_results", "Zero Results"],
          ["unreachable", "Unreachable"],
          ["pending", "Pending"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            style={{
              padding: "0.4rem 0.85rem",
              background: filter === value ? "#0d6efd" : "transparent",
              color: filter === value ? "#fff" : "inherit",
              border: "1px solid var(--border)",
              borderRadius: 999,
              cursor: "pointer",
              fontSize: "0.8rem",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div
            style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}
          >
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div
            style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}
          >
            No submissions in the selected state.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--background-secondary)" }}>
                <th
                  style={{
                    padding: "0.5rem 0.75rem",
                    textAlign: "left",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                  }}
                >
                  Submitter
                </th>
                <th
                  style={{
                    padding: "0.5rem 0.75rem",
                    textAlign: "left",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                  }}
                >
                  Address
                </th>
                <th
                  style={{
                    padding: "0.5rem 0.75rem",
                    textAlign: "left",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    padding: "0.5rem 0.75rem",
                    textAlign: "left",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                  }}
                >
                  Attempts
                </th>
                <th
                  style={{
                    padding: "0.5rem 0.75rem",
                    textAlign: "left",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                  }}
                >
                  Last Error
                </th>
                <th
                  style={{
                    padding: "0.5rem 0.75rem",
                    textAlign: "right",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.submission_id}
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "0.6rem 0.75rem", fontSize: "0.85rem" }}>
                    <div>
                      {r.first_name} {r.last_name}
                    </div>
                    {r.email && (
                      <div
                        style={{
                          fontSize: "0.7rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {r.email}
                      </div>
                    )}
                  </td>
                  <td
                    style={{
                      padding: "0.6rem 0.75rem",
                      fontSize: "0.8rem",
                      maxWidth: 260,
                    }}
                  >
                    {r.cats_address}
                    {r.cats_city && `, ${r.cats_city}`}
                    {r.cats_zip && ` ${r.cats_zip}`}
                  </td>
                  <td
                    style={{
                      padding: "0.6rem 0.75rem",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    <code>{r.geocode_status}</code>
                  </td>
                  <td
                    style={{
                      padding: "0.6rem 0.75rem",
                      fontSize: "0.8rem",
                    }}
                  >
                    {r.geocode_attempts}
                  </td>
                  <td
                    style={{
                      padding: "0.6rem 0.75rem",
                      fontSize: "0.7rem",
                      color: "var(--text-muted)",
                      maxWidth: 220,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={r.geocode_last_error || ""}
                  >
                    {r.geocode_last_error}
                  </td>
                  <td style={{ padding: "0.6rem 0.75rem", textAlign: "right" }}>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.35rem",
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        type="button"
                        disabled={busy === r.submission_id}
                        onClick={() => doRetry(r.submission_id)}
                        style={actionBtnStyle("#0d6efd")}
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.submission_id}
                        onClick={() =>
                          setEditing({ row: r, action: "edit_address" })
                        }
                        style={actionBtnStyle("transparent", "var(--border)")}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.submission_id}
                        onClick={() =>
                          setEditing({ row: r, action: "manual_override" })
                        }
                        style={actionBtnStyle("transparent", "var(--border)")}
                      >
                        Override
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.submission_id}
                        onClick={() =>
                          doAction(r.submission_id, { action: "skip" })
                        }
                        style={actionBtnStyle("transparent", "#dc3545")}
                      >
                        Skip
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit/override modal */}
      {editing && (
        <EditModal
          row={editing.row}
          action={editing.action}
          busy={busy === editing.row.submission_id}
          onCancel={() => setEditing(null)}
          onSubmit={(body) => doAction(editing.row.submission_id, body)}
        />
      )}
    </div>
  );
}

function actionBtnStyle(bg: string, border?: string): React.CSSProperties {
  return {
    padding: "0.25rem 0.55rem",
    background: bg,
    color: bg === "transparent" ? "inherit" : "#fff",
    border: `1px solid ${border || bg}`,
    borderRadius: 4,
    cursor: "pointer",
    fontSize: "0.7rem",
    fontWeight: 500,
  };
}

function EditModal({
  row,
  action,
  busy,
  onCancel,
  onSubmit,
}: {
  row: DlqRow;
  action: Action;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [catsAddress, setCatsAddress] = useState(row.cats_address || "");
  const [catsCity, setCatsCity] = useState(row.cats_city || "");
  const [catsZip, setCatsZip] = useState(row.cats_zip || "");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{
          padding: "1.5rem",
          minWidth: 420,
          maxWidth: 560,
          background: "var(--background)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 1rem" }}>
          {action === "edit_address"
            ? "Edit Address & Requeue"
            : "Manual Lat/Lng Override"}
        </h2>

        {action === "edit_address" ? (
          <>
            <Field label="Address">
              <input
                type="text"
                value={catsAddress}
                onChange={(e) => setCatsAddress(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="City">
              <input
                type="text"
                value={catsCity}
                onChange={(e) => setCatsCity(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="ZIP">
              <input
                type="text"
                value={catsZip}
                onChange={(e) => setCatsZip(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Latitude">
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Longitude">
              <input
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </>
        )}

        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            justifyContent: "flex-end",
            marginTop: "1rem",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "0.45rem 0.85rem",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (action === "edit_address") {
                onSubmit({
                  action: "edit_address",
                  cats_address: catsAddress,
                  cats_city: catsCity,
                  cats_zip: catsZip,
                });
              } else {
                onSubmit({
                  action: "manual_override",
                  lat: parseFloat(lat),
                  lng: parseFloat(lng),
                });
              }
            }}
            style={{
              padding: "0.45rem 0.85rem",
              background: "#0d6efd",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <label
        style={{
          display: "block",
          fontSize: "0.75rem",
          fontWeight: 500,
          marginBottom: "0.25rem",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.4rem 0.6rem",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: "0.85rem",
};
