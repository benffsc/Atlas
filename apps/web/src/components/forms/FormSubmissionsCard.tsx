"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import type { FormSubmission, TemplateKey } from "@/lib/form-field-types";

interface FormSubmissionsCardProps {
  entityType: "request" | "cat" | "place";
  entityId: string;
}

const TEMPLATE_OPTIONS: { key: TemplateKey; label: string }[] = [
  { key: "help_request", label: "Help Request Form" },
  { key: "tnr_call_sheet", label: "TNR Call Sheet" },
  { key: "trapper_sheet", label: "Trapper Assignment Sheet" },
];

/**
 * Card showing form submissions linked to an entity.
 * Supports uploading paper scan references.
 */
export function FormSubmissionsCard({
  entityType,
  entityId,
}: FormSubmissionsCardProps) {
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    template_key: "tnr_call_sheet" as TemplateKey,
    notes: "",
  });
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const fetchSubmissions = useCallback(async () => {
    try {
      const data = await fetchApi<FormSubmission[]>(
        `/api/forms/submissions?entity_type=${entityType}&entity_id=${entityId}`
      );
      setSubmissions(data);
    } catch {
      // Silently fail — table may not exist yet
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  /** Upload a file to media storage and return the public URL. */
  async function uploadScanFile(file: File): Promise<string | null> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("entity_type", entityType);
    formData.append("entity_id", entityId);
    formData.append("media_type", "document");
    formData.append("caption", "Paper form scan");

    const res = await fetch("/api/media/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json.data || json;
    return result.storage_path || null;
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Upload scan file first if provided
      let paperScanUrl: string | null = null;
      if (scanFile) {
        paperScanUrl = await uploadScanFile(scanFile);
      }

      await postApi("/api/forms/submissions", {
        template_key: uploadForm.template_key,
        entity_type: entityType,
        entity_id: entityId,
        data: {},
        source: "paper_entry",
        notes: uploadForm.notes || null,
        paper_scan_url: paperScanUrl,
      });
      setShowUpload(false);
      setUploadForm({ template_key: "tnr_call_sheet", notes: "" });
      setScanFile(null);
      fetchSubmissions();
    } catch (err) {
      console.error("Failed to save submission:", err);
    } finally {
      setSaving(false);
    }
  }

  /** Attach a scan to an existing submission. */
  async function handleAttachScan(submissionId: string, file: File) {
    setUploadingFor(submissionId);
    try {
      const url = await uploadScanFile(file);
      if (!url) return;

      const res = await fetch("/api/forms/submissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: submissionId, paper_scan_url: url }),
      });
      if (res.ok) {
        fetchSubmissions();
      }
    } catch (err) {
      console.error("Failed to attach scan:", err);
    } finally {
      setUploadingFor(null);
    }
  }

  if (loading) return null;

  return (
    <div
      className="card"
      style={{ padding: "1rem", marginBottom: "1rem" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: submissions.length > 0 ? "0.75rem" : 0,
        }}
      >
        <h4
          style={{
            margin: 0,
            fontSize: "0.9rem",
            fontWeight: 700,
          }}
        >
          Paper Forms ({submissions.length})
        </h4>
        <button
          onClick={() => setShowUpload(!showUpload)}
          style={{
            background: "none",
            border: "none",
            color: "#27ae60",
            cursor: "pointer",
            fontSize: "0.8rem",
            fontWeight: 600,
          }}
        >
          {showUpload ? "Cancel" : "+ Log Entry"}
        </button>
      </div>

      {showUpload && (
        <div
          style={{
            background: "#f9fafb",
            borderRadius: "6px",
            padding: "12px",
            marginBottom: "12px",
          }}
        >
          <div style={{ marginBottom: "8px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.75rem",
                color: "#666",
                marginBottom: "4px",
              }}
            >
              Form Type
            </label>
            <select
              value={uploadForm.template_key}
              onChange={(e) =>
                setUploadForm({
                  ...uploadForm,
                  template_key: e.target.value as TemplateKey,
                })
              }
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "0.85rem",
              }}
            >
              {TEMPLATE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: "8px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.75rem",
                color: "#666",
                marginBottom: "4px",
              }}
            >
              Scan (optional)
            </label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setScanFile(e.target.files?.[0] || null)}
              style={{
                width: "100%",
                fontSize: "0.8rem",
              }}
            />
          </div>
          <div style={{ marginBottom: "8px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.75rem",
                color: "#666",
                marginBottom: "4px",
              }}
            >
              Notes
            </label>
            <textarea
              value={uploadForm.notes}
              onChange={(e) =>
                setUploadForm({ ...uploadForm, notes: e.target.value })
              }
              placeholder="e.g. Scanned call sheet from Crystal, 3/10..."
              style={{
                width: "100%",
                padding: "6px 8px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "0.85rem",
                minHeight: "50px",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: "#27ae60",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              padding: "6px 14px",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : "Log Paper Form"}
          </button>
        </div>
      )}

      {submissions.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {submissions.map((sub) => (
            <div
              key={sub.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 8px",
                background: "#f9fafb",
                borderRadius: "4px",
                fontSize: "0.8rem",
              }}
            >
              <div>
                <span style={{ fontWeight: 600 }}>
                  {TEMPLATE_OPTIONS.find(
                    (t) => t.key === sub.template_key
                  )?.label || sub.template_key}
                </span>
                <span
                  style={{
                    marginLeft: "8px",
                    color: "#888",
                    fontSize: "0.75rem",
                  }}
                >
                  {sub.source === "paper_entry" ? "Paper" : sub.source}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  color: "#888",
                  fontSize: "0.75rem",
                }}
              >
                {sub.paper_scan_url ? (
                  <a
                    href={sub.paper_scan_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#27ae60", fontWeight: 600 }}
                  >
                    View Scan
                  </a>
                ) : sub.source === "paper_entry" ? (
                  <label
                    style={{
                      background: "none",
                      border: "1px dashed #ccc",
                      borderRadius: "3px",
                      padding: "1px 6px",
                      color: "#888",
                      cursor:
                        uploadingFor === sub.id ? "wait" : "pointer",
                      fontSize: "0.7rem",
                    }}
                  >
                    {uploadingFor === sub.id
                      ? "Uploading..."
                      : "+ Scan"}
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      style={{ display: "none" }}
                      disabled={uploadingFor === sub.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleAttachScan(sub.id, file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                ) : null}
                {new Date(sub.submitted_at).toLocaleDateString()}
                {sub.notes && (
                  <span
                    title={sub.notes}
                    style={{ cursor: "help" }}
                  >
                    [note]
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
