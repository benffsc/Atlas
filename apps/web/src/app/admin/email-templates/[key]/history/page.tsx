"use client";

/**
 * /admin/email-templates/[key]/history
 *
 * Part of FFS-1181 Follow-Up Phase 6. Version history + rollback UI
 * for a single email template. Kept as a separate route instead of
 * modifying the existing /admin/email-templates page to avoid
 * colliding with in-flight rebrand edits.
 */

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { fetchApi, postApi } from "@/lib/api-client";

interface TemplateVersion {
  version_id: string;
  template_key: string;
  version_number: number;
  subject: string;
  body_html_length: number;
  change_summary: string | null;
  created_at: string;
  created_by: string | null;
  is_active: boolean;
}

interface PreviewResult {
  template_key: string;
  version_number: number | null;
  subject: string;
  body_html: string;
  body_text: string | null;
  missing_placeholders: string[];
}

export default function TemplateHistoryPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = use(params);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [sampleJson, setSampleJson] = useState(
    '{\n  "first_name": "Jamie",\n  "detected_county": "Marin"\n}'
  );

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{ rows: TemplateVersion[] }>(
        `/api/admin/email-templates/${key}/versions`
      );
      setVersions(data.rows || []);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to load history",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const doRollback = async (versionNumber: number) => {
    if (
      !confirm(
        `Roll back ${key} to version ${versionNumber}? The current version will be saved in history.`
      )
    )
      return;
    setBusy(true);
    try {
      await postApi(`/api/admin/email-templates/${key}/versions`, {
        action: "rollback",
        version_number: versionNumber,
      });
      setMessage({
        type: "success",
        text: `Rolled back to version ${versionNumber}`,
      });
      reload();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Rollback failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async (versionNumber?: number) => {
    setBusy(true);
    try {
      let samplePayload: Record<string, string> = {};
      try {
        samplePayload = JSON.parse(sampleJson || "{}");
      } catch {
        throw new Error("Sample payload is not valid JSON");
      }

      const result = await postApi<PreviewResult>(
        `/api/admin/email-templates/${key}/preview`,
        {
          sample_payload: samplePayload,
          ...(versionNumber && { version_number: versionNumber }),
        }
      );
      setPreview(result);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Preview failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1100px", margin: "0 auto" }}>
      <Link
        href="/admin/email-templates"
        style={{
          color: "var(--text-muted)",
          textDecoration: "none",
          fontSize: "0.875rem",
        }}
      >
        &larr; Email Templates
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginTop: "0.5rem" }}>
        History: <code>{key}</code>
      </h1>
      <p style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>
        Immutable version history. Every edit to subject/body auto-creates
        a version row; rollback writes the historical content back into
        the live template (and snapshots the outgoing content as a new
        version).
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

      {/* Sample payload editor */}
      <div className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
          Sample payload (JSON)
        </h2>
        <p
          style={{
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            margin: "0 0 0.5rem",
          }}
        >
          Org placeholders are merged automatically. Only provide
          template-specific values here.
        </p>
        <textarea
          value={sampleJson}
          onChange={(e) => setSampleJson(e.target.value)}
          rows={5}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            padding: "0.5rem",
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => doPreview()}
          style={{
            marginTop: "0.5rem",
            padding: "0.45rem 0.85rem",
            background: "#0d6efd",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Preview current active version
        </button>
      </div>

      {/* Preview result */}
      {preview && (
        <div className="card" style={{ padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            Preview {preview.version_number ? `(v${preview.version_number})` : "(current)"}
          </h2>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>Subject:</strong> {preview.subject}
          </div>
          {preview.missing_placeholders.length > 0 && (
            <div
              style={{
                padding: "0.5rem",
                background: "#fffbeb",
                border: "1px solid #fcd34d",
                borderRadius: 4,
                fontSize: "0.75rem",
                color: "#92400e",
                marginBottom: "0.5rem",
              }}
            >
              ⚠ Unsubstituted placeholders:{" "}
              {preview.missing_placeholders.join(", ")}
            </div>
          )}
          <iframe
            srcDoc={preview.body_html}
            title="Email preview"
            style={{
              width: "100%",
              minHeight: 400,
              border: "1px solid var(--border)",
              borderRadius: 4,
            }}
            sandbox=""
          />
        </div>
      )}

      {/* Version list */}
      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center" }}>Loading…</div>
        ) : versions.length === 0 ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              color: "var(--text-muted)",
            }}
          >
            No versions yet. Editing the template will create the first
            historical row.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--background-secondary)" }}>
                <th style={thStyle}>Version</th>
                <th style={thStyle}>Subject</th>
                <th style={thStyle}>Body size</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Change Summary</th>
                <th style={{ ...thStyle, textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr
                  key={v.version_id}
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <td style={tdStyle}>
                    <strong>v{v.version_number}</strong>
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      maxWidth: 340,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={v.subject}
                  >
                    {v.subject}
                  </td>
                  <td style={tdStyle}>
                    {Math.round(v.body_html_length / 1024)} KB
                  </td>
                  <td style={{ ...tdStyle, fontSize: "0.7rem" }}>
                    {new Date(v.created_at).toLocaleString()}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      fontSize: "0.7rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    {v.change_summary}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.35rem",
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => doPreview(v.version_number)}
                        style={{
                          padding: "0.25rem 0.55rem",
                          background: "transparent",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: "0.7rem",
                        }}
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => doRollback(v.version_number)}
                        style={{
                          padding: "0.25rem 0.55rem",
                          background: "#198754",
                          color: "#fff",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: "0.7rem",
                          fontWeight: 500,
                        }}
                      >
                        Roll back
                      </button>
                    </div>
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
