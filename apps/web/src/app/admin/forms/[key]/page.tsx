"use client";

import { useParams } from "next/navigation";
import { useFormTemplate } from "@/lib/use-form-template";
import Link from "next/link";
import type { TemplateKey, ResolvedTemplateField } from "@/lib/form-field-types";

const VALID_KEYS = ["help_request", "tnr_call_sheet", "trapper_sheet"];

const FIELD_TYPE_COLORS: Record<string, string> = {
  text: "#3b82f6",
  number: "#8b5cf6",
  boolean: "#f59e0b",
  select: "#10b981",
  multi_select: "#06b6d4",
  date: "#ec4899",
  textarea: "#6366f1",
  phone: "#14b8a6",
  email: "#f97316",
};

export default function FormTemplatePage() {
  const params = useParams();
  const key = params.key as string;

  if (!VALID_KEYS.includes(key)) {
    return (
      <div style={{ padding: "2rem", color: "#e74c3c" }}>
        Invalid template key: {key}
      </div>
    );
  }

  return <TemplateDetail templateKey={key as TemplateKey} />;
}

function TemplateDetail({ templateKey }: { templateKey: TemplateKey }) {
  const { template, loading, error } = useFormTemplate(templateKey);

  if (loading) return <div style={{ padding: "2rem" }}>Loading...</div>;
  if (error)
    return (
      <div style={{ padding: "2rem", color: "#e74c3c" }}>Error: {error}</div>
    );
  if (!template) return <div style={{ padding: "2rem" }}>Not found</div>;

  const totalFields = template.sections.reduce(
    (s, sec) => s + sec.fields.length,
    0
  );

  // Count by category
  const categoryCounts: Record<string, number> = {};
  for (const section of template.sections) {
    for (const field of section.fields) {
      categoryCounts[field.category] =
        (categoryCounts[field.category] || 0) + 1;
    }
  }

  return (
    <div style={{ padding: "2rem", maxWidth: "1000px" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Link
          href="/admin/forms"
          style={{
            fontSize: "0.8rem",
            color: "#666",
            textDecoration: "none",
          }}
        >
          Forms
        </Link>
        <span style={{ margin: "0 6px", color: "#ccc" }}>/</span>
        <span style={{ fontSize: "0.8rem", color: "#333" }}>
          {template.name}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
            {template.name}
          </h1>
          {template.description && (
            <p
              style={{
                fontSize: "0.875rem",
                color: "#666",
                margin: "4px 0 0",
              }}
            >
              {template.description}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <Link
            href={`/admin/forms/preview/${templateKey}`}
            style={{
              background: "#27ae60",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: "6px",
              fontSize: "0.85rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Preview
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        <StatChip label="Fields" value={totalFields} />
        <StatChip label="Sections" value={template.sections.length} />
        <StatChip label="Schema" value={`v${template.schema_version}`} />
        <StatChip label="Entity" value={template.entity_type} />
        {Object.entries(categoryCounts).map(([cat, count]) => (
          <StatChip key={cat} label={cat} value={count} muted />
        ))}
      </div>

      {/* Sections */}
      {template.sections.map((section) => (
        <div
          key={section.name}
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            marginBottom: "12px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "#f9fafb",
              padding: "10px 16px",
              fontWeight: 600,
              fontSize: "0.9rem",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>{section.name}</span>
            <span
              style={{
                fontSize: "0.75rem",
                color: "#888",
                fontWeight: 400,
              }}
            >
              {section.fields.length} fields
            </span>
          </div>
          <div>
            {section.fields.map((field) => (
              <FieldRow key={field.field_key} field={field} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldRow({ field }: { field: ResolvedTemplateField }) {
  const typeColor = FIELD_TYPE_COLORS[field.field_type] || "#888";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 16px",
        borderBottom: "1px solid #f3f4f6",
        fontSize: "0.85rem",
        gap: "12px",
      }}
    >
      <code
        style={{
          flex: "0 0 180px",
          fontSize: "0.75rem",
          color: "#666",
          fontFamily: "monospace",
        }}
      >
        {field.field_key}
      </code>
      <span style={{ flex: 1, fontWeight: 500 }}>{field.label}</span>
      <span
        style={{
          flex: "0 0 90px",
          background: `${typeColor}15`,
          color: typeColor,
          padding: "2px 8px",
          borderRadius: "4px",
          fontSize: "0.7rem",
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        {field.field_type}
      </span>
      <span
        style={{
          flex: "0 0 40px",
          fontSize: "0.7rem",
          color: "#888",
          textAlign: "center",
        }}
      >
        {field.field_width}
      </span>
      {field.is_required && (
        <span
          style={{
            fontSize: "0.7rem",
            color: "#e74c3c",
            fontWeight: 600,
          }}
        >
          req
        </span>
      )}
      {field.options && field.options.length > 0 && (
        <span
          style={{
            fontSize: "0.65rem",
            color: "#888",
            maxWidth: "200px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={field.options.join(", ")}
        >
          [{field.options.length} opts]
        </span>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  muted,
}: {
  label: string;
  value: string | number;
  muted?: boolean;
}) {
  return (
    <div
      style={{
        background: muted ? "#f9fafb" : "#f0fdf4",
        border: `1px solid ${muted ? "#e5e7eb" : "#bbf7d0"}`,
        borderRadius: "6px",
        padding: "4px 10px",
        fontSize: "0.75rem",
      }}
    >
      <span style={{ color: "#888", marginRight: "4px" }}>{label}:</span>
      <span style={{ fontWeight: 600, color: muted ? "#666" : "#166534" }}>
        {value}
      </span>
    </div>
  );
}
