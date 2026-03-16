import type { FormOption } from "@/lib/form-options";
import type { RequestStatus } from "@/lib/request-status";

/**
 * Configuration for a single editable field in a request section.
 */
export interface RequestFieldConfig {
  /** DB column name on ops.requests */
  key: string;
  /** Human-readable label */
  label: string;
  /** Field input type */
  type: "text" | "number" | "select" | "boolean" | "textarea" | "checkbox-group";
  /** Options for select / checkbox-group fields (from form-options.ts) */
  options?: readonly FormOption[];
  /** Help text shown below the field label in edit mode */
  helpText?: string;
  /** Only show this field when another field has a specific value */
  conditional?: { field: string; value: unknown };
  /** Full width in the grid (spans all columns) */
  fullWidth?: boolean;
}

/**
 * Configuration for a collapsible section of request fields.
 */
export interface RequestSectionConfig {
  /** Unique section identifier */
  id: string;
  /** Section title displayed in the accordion header */
  title: string;
  /** Emoji icon for the section header */
  icon: string;
  /** Header accent color */
  color: string;
  /** Fields in this section */
  fields: RequestFieldConfig[];
  /** Only show this section when the request status is in this list */
  statusVisibility?: RequestStatus[];
  /** Guidance callout shown at the top of the section in edit mode */
  guidanceText?: string;
}

/**
 * Completion count for a section.
 */
export interface SectionCompletion {
  filled: number;
  total: number;
}
