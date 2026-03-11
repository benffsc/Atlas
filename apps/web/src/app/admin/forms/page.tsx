"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";
import Link from "next/link";

interface TemplateListItem {
  template_key: string;
  name: string;
  description: string | null;
  entity_type: string;
  schema_version: number;
  is_active: boolean;
  field_count: number;
}

export default function AdminFormsPage() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchApi<TemplateListItem[]>("/api/forms/templates");
        setTemplates(data);
      } catch {
        // Fallback: load each template individually
        const keys = ["help_request", "tnr_call_sheet", "trapper_sheet"];
        const results: TemplateListItem[] = [];
        for (const key of keys) {
          try {
            const t = await fetchApi<{
              template_key: string;
              name: string;
              description: string | null;
              entity_type: string;
              schema_version: number;
              sections: { fields: unknown[] }[];
            }>(`/api/forms/templates/${key}`);
            results.push({
              template_key: t.template_key,
              name: t.name,
              description: t.description,
              entity_type: t.entity_type,
              schema_version: t.schema_version,
              is_active: true,
              field_count: t.sections.reduce(
                (sum, s) => sum + s.fields.length,
                0
              ),
            });
          } catch {
            /* skip */
          }
        }
        setTemplates(results);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1
          style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}
        >
          Form Templates
        </h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: "900px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
          Form Templates
        </h1>
        <span style={{ fontSize: "0.875rem", color: "#666" }}>
          {templates.length} templates
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {templates.map((t) => (
          <div
            key={t.template_key}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "16px 20px",
              background: "#fff",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "8px",
              }}
            >
              <div>
                <h2
                  style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}
                >
                  {t.name}
                </h2>
                {t.description && (
                  <p
                    style={{
                      fontSize: "0.875rem",
                      color: "#666",
                      margin: "4px 0 0",
                    }}
                  >
                    {t.description}
                  </p>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    background: "#f0fdf4",
                    color: "#166534",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                  }}
                >
                  {t.entity_type}
                </span>
                <span
                  style={{
                    background: "#f3f4f6",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                  }}
                >
                  v{t.schema_version}
                </span>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: "0.875rem", color: "#888" }}>
                {t.field_count} fields
              </span>
              <div style={{ display: "flex", gap: "12px" }}>
                <Link
                  href={`/admin/forms/${t.template_key}`}
                  style={{
                    fontSize: "0.875rem",
                    color: "#333",
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  Fields
                </Link>
                <Link
                  href={`/admin/forms/preview/${t.template_key}`}
                  style={{
                    fontSize: "0.875rem",
                    color: "#27ae60",
                    textDecoration: "none",
                  }}
                >
                  Preview
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: "2rem",
          padding: "16px",
          background: "#f9fafb",
          borderRadius: "8px",
          fontSize: "0.875rem",
          color: "#666",
        }}
      >
        <strong>Field Registry:</strong>{" "}
        <Link
          href="/api/forms/fields"
          target="_blank"
          style={{ color: "#27ae60" }}
        >
          View all field definitions
        </Link>
      </div>
    </div>
  );
}
