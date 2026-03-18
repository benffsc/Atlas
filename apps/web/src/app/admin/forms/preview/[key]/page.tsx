"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { PRINT_BASE_CSS, PRINT_EDITABLE_CSS } from "@/lib/print-styles";
import { useOrgConfig } from "@/hooks/useOrgConfig";
import {
  TemplateRenderer,
  PrintHeader,
  PrintFooter,
  PrintControlsPanel,
} from "@/components/print";
import { useFormTemplate } from "@/lib/use-form-template";
import { requestToFormData } from "@/lib/request-to-form-data";
import { fetchApi } from "@/lib/api-client";
import type { TemplateKey, FormData } from "@/lib/form-field-types";

const VALID_KEYS = ["help_request", "tnr_call_sheet", "trapper_sheet"];

export default function FormPreviewPage() {
  const params = useParams();
  const key = params.key as string;

  if (!VALID_KEYS.includes(key)) {
    return (
      <div style={{ padding: "2rem", color: "#e74c3c" }}>
        Invalid template key: {key}
      </div>
    );
  }

  return <FormPreview templateKey={key as TemplateKey} />;
}

function FormPreview({ templateKey }: { templateKey: TemplateKey }) {
  const searchParams = useSearchParams();
  const { nameFull } = useOrgConfig();
  const { template, loading, error } = useFormTemplate(templateKey);
  const [formData, setFormData] = useState<FormData>({});
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestIdInput, setRequestIdInput] = useState(
    searchParams.get("request_id") || ""
  );

  const loadRequest = useCallback(async (requestId: string) => {
    if (!requestId) {
      setFormData({});
      setRequestError(null);
      return;
    }
    setRequestLoading(true);
    setRequestError(null);
    try {
      const req = await fetchApi<Record<string, unknown>>(
        `/api/requests/${requestId}`
      );
      setFormData(requestToFormData(req));
    } catch (e) {
      setRequestError(
        e instanceof Error ? e.message : "Failed to load request"
      );
      setFormData({});
    } finally {
      setRequestLoading(false);
    }
  }, []);

  // Load from URL param on mount
  useEffect(() => {
    const rid = searchParams.get("request_id");
    if (rid) {
      loadRequest(rid);
    }
  }, [searchParams, loadRequest]);

  if (loading) {
    return <div style={{ padding: "2rem" }}>Loading template...</div>;
  }
  if (error) {
    return (
      <div style={{ padding: "2rem", color: "#e74c3c" }}>Error: {error}</div>
    );
  }
  if (!template) {
    return <div style={{ padding: "2rem" }}>Template not found</div>;
  }

  const fieldCount = template.sections.reduce(
    (s, sec) => s + sec.fields.length,
    0
  );
  const hasData = Object.keys(formData).length > 0;

  return (
    <div className="print-wrapper">
      <style jsx global>{`
        ${PRINT_BASE_CSS}
        ${PRINT_EDITABLE_CSS}
      `}</style>

      <PrintControlsPanel
        title={`Preview: ${template.name}`}
        description={`${template.sections.length} sections, ${fieldCount} fields — Schema v${template.schema_version}${hasData ? " — Pre-filled from request" : ""}`}
        backHref="/admin/forms"
        backLabel="Back to Forms"
      >
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            marginTop: "0.5rem",
          }}
        >
          <input
            type="text"
            placeholder="Request UUID"
            value={requestIdInput}
            onChange={(e) => setRequestIdInput(e.target.value)}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid var(--border-light)",
              borderRadius: "4px",
              fontSize: "0.85rem",
              width: "280px",
              fontFamily: "monospace",
            }}
          />
          <button
            onClick={() => loadRequest(requestIdInput)}
            disabled={requestLoading}
            style={{
              padding: "0.25rem 0.75rem",
              fontSize: "0.85rem",
              cursor: requestLoading ? "wait" : "pointer",
            }}
          >
            {requestLoading ? "Loading..." : "Load from request"}
          </button>
          {hasData && (
            <button
              onClick={() => {
                setFormData({});
                setRequestIdInput("");
                setRequestError(null);
              }}
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>
        {requestError && (
          <div style={{ color: "#e74c3c", fontSize: "0.85rem", marginTop: "0.25rem" }}>
            {requestError}
          </div>
        )}
      </PrintControlsPanel>

      <div className="print-page">
        <PrintHeader
          title={template.name}
          subtitle={nameFull}
        />

        <TemplateRenderer template={template} data={formData} />

        <PrintFooter
          left={nameFull}
          right="Template Preview"
        />
      </div>
    </div>
  );
}
