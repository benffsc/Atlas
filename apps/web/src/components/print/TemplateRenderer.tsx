"use client";

import React from "react";
import {
  Bubble,
  Check,
  EditableField,
  EditableTextArea,
  PrintSection,
  FieldRow,
  OptionsRow,
} from "./PrintPrimitives";
import type {
  ResolvedTemplate,
  ResolvedTemplateField,
  FieldKey,
  FormData,
} from "@/lib/form-field-types";

interface TemplateRendererProps {
  /** Resolved template from API */
  template: ResolvedTemplate;
  /** Entity data keyed by field_key */
  data?: FormData;
  /** Sections to exclude from rendering */
  hideSections?: string[];
  /** Fields to exclude from rendering */
  hideFields?: FieldKey[];
  /** Custom rendering for specific fields (overrides default) */
  renderField?: (
    field: ResolvedTemplateField,
    value: unknown
  ) => React.ReactNode | undefined;
}

/**
 * Renders a form template dynamically from the field registry.
 *
 * Maps field_type to the appropriate PrintPrimitive:
 * - text, phone, email, number, date → EditableField
 * - textarea → EditableTextArea
 * - boolean → Check (single checkbox)
 * - select → OptionsRow with Bubbles
 * - multi_select → OptionsRow with Checks
 */
export function TemplateRenderer({
  template,
  data = {},
  hideSections = [],
  hideFields = [],
  renderField,
}: TemplateRendererProps) {
  const hideSectionsSet = new Set(hideSections);
  const hideFieldsSet = new Set(hideFields);

  return (
    <>
      {template.sections
        .filter((section) => !hideSectionsSet.has(section.name))
        .map((section) => {
          const visibleFields = section.fields.filter(
            (f) => !hideFieldsSet.has(f.field_key)
          );
          if (visibleFields.length === 0) return null;

          return (
            <PrintSection key={section.name} title={section.name}>
              <TemplateSectionFields
                fields={visibleFields}
                data={data}
                renderField={renderField}
              />
            </PrintSection>
          );
        })}
    </>
  );
}

/** Renders a flat list of sections without PrintSection wrappers. */
export function TemplateSectionFields({
  fields,
  data = {},
  renderField,
}: {
  fields: ResolvedTemplateField[];
  data?: FormData;
  renderField?: TemplateRendererProps["renderField"];
}) {
  // Group adjacent fields into rows based on field_width
  const rows = groupFieldsIntoRows(fields);

  return (
    <>
      {rows.map((row, i) => {
        if (row.length === 1) {
          const field = row[0];
          return (
            <React.Fragment key={field.field_key}>
              {renderSingleField(field, data[field.field_key], renderField)}
            </React.Fragment>
          );
        }

        return (
          <FieldRow key={`row-${i}`}>
            {row.map((field) => (
              <React.Fragment key={field.field_key}>
                {renderSingleField(field, data[field.field_key], renderField)}
              </React.Fragment>
            ))}
          </FieldRow>
        );
      })}
    </>
  );
}

function renderSingleField(
  field: ResolvedTemplateField,
  value: unknown,
  renderFieldOverride?: TemplateRendererProps["renderField"]
): React.ReactNode {
  // Allow custom rendering override
  if (renderFieldOverride) {
    const custom = renderFieldOverride(field, value);
    if (custom !== undefined) return custom;
  }

  const label = field.label;
  const strValue = value != null ? String(value) : null;

  switch (field.field_type) {
    case "text":
    case "phone":
    case "email":
    case "number":
    case "date":
      return (
        <EditableField
          label={label}
          value={strValue}
          size={field.field_width}
        />
      );

    case "textarea":
      return (
        <EditableTextArea
          label={label}
          value={strValue}
          size={field.field_width}
        />
      );

    case "boolean":
      return (
        <OptionsRow label={label}>
          <Check checked={toBool(value)} label="Yes" />
          <Check checked={value != null && !toBool(value)} label="No" />
        </OptionsRow>
      );

    case "select":
      if (!field.options?.length) {
        return (
          <EditableField
            label={label}
            value={strValue}
            size={field.field_width}
          />
        );
      }
      return (
        <OptionsRow label={label}>
          {field.options.map((opt) => (
            <Bubble key={opt} filled={strValue === opt} label={opt} />
          ))}
        </OptionsRow>
      );

    case "multi_select":
      if (!field.options?.length) {
        return (
          <EditableField
            label={label}
            value={strValue}
            size={field.field_width}
          />
        );
      }
      return (
        <OptionsRow label={label}>
          {field.options.map((opt) => (
            <Check
              key={opt}
              checked={isMultiSelected(value, opt)}
              label={opt}
            />
          ))}
        </OptionsRow>
      );

    default:
      return (
        <EditableField
          label={label}
          value={strValue}
          size={field.field_width}
        />
      );
  }
}

/**
 * Group fields into rows for the print layout.
 * - lg/xl fields get their own row
 * - sm/md fields are grouped into rows of 2-3
 */
function groupFieldsIntoRows(
  fields: ResolvedTemplateField[]
): ResolvedTemplateField[][] {
  const rows: ResolvedTemplateField[][] = [];
  let currentRow: ResolvedTemplateField[] = [];
  let currentRowWidth = 0;

  const widthValues: Record<string, number> = {
    sm: 1,
    md: 2,
    lg: 3,
    xl: 4,
  };

  for (const field of fields) {
    const w = widthValues[field.field_width] || 1;

    // Full-width fields or select/multi_select/boolean always get their own row
    if (
      w >= 3 ||
      field.field_type === "select" ||
      field.field_type === "multi_select" ||
      field.field_type === "boolean"
    ) {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
        currentRowWidth = 0;
      }
      rows.push([field]);
      continue;
    }

    // Would this field exceed a row of 4 units?
    if (currentRowWidth + w > 4) {
      rows.push(currentRow);
      currentRow = [];
      currentRowWidth = 0;
    }

    currentRow.push(field);
    currentRowWidth += w;
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "yes", "1", "checked"].includes(value.toLowerCase());
  }
  return !!value;
}

function isMultiSelected(value: unknown, option: string): boolean {
  if (Array.isArray(value)) return value.includes(option);
  if (typeof value === "string") {
    // Handle comma-separated strings
    return value.split(",").some((v) => v.trim() === option);
  }
  return false;
}
