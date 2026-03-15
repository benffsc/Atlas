/**
 * Form Configuration Layer (FFS-496, FFS-497)
 *
 * Declares which sections and fields each form context shows via JSON
 * config objects. A single <RequestForm config={...} /> component
 * renders any config.
 *
 * Configs are stored in ops.app_config (key = 'form_config.<id>') and
 * editable via /admin/forms/configs. The TypeScript constants below serve
 * as fallback defaults when no DB row exists.
 *
 * Usage:
 *   import { FFR_NEW_CONFIG, getFormConfigFromDb } from '@/lib/form-configs';
 *   // Client-side (static): <RequestForm config={FFR_NEW_CONFIG} ... />
 *   // Server-side (DB-backed): const config = await getFormConfigFromDb('ffr_new');
 */

// ── Section component types ─────────────────────────────────────────
// Each key maps to a component in request-sections/

export type SectionComponent =
  | "person"
  | "place"
  | "catDetails"
  | "kittens"
  | "propertyAccess"
  | "urgencyNotes";

// ── Section config ──────────────────────────────────────────────────

export interface PersonSectionConfig {
  component: "person";
  label?: string;
  props?: {
    role?: "requestor" | "property_owner" | "site_contact" | "caretaker";
    allowCreate?: boolean;
    showSameAsRequestor?: boolean;
    required?: boolean;
    compact?: boolean;
  };
}

export interface PlaceSectionConfig {
  component: "place";
  label?: string;
  props?: {
    showPropertyType?: boolean;
    showCounty?: boolean;
    showWhereOnProperty?: boolean;
    showDescribeLocation?: boolean;
    compact?: boolean;
    required?: boolean;
  };
}

export interface CatDetailsSectionConfig {
  component: "catDetails";
  label?: string;
  props?: {
    compact?: boolean;
  };
}

export interface KittenSectionConfig {
  component: "kittens";
  label?: string;
  props?: {
    compact?: boolean;
  };
}

export interface PropertyAccessSectionConfig {
  component: "propertyAccess";
  label?: string;
  props?: {
    compact?: boolean;
  };
}

export interface UrgencyNotesSectionConfig {
  component: "urgencyNotes";
  label?: string;
  props?: {
    showDetails?: boolean;
    compact?: boolean;
  };
}

export type SectionConfig =
  | PersonSectionConfig
  | PlaceSectionConfig
  | CatDetailsSectionConfig
  | KittenSectionConfig
  | PropertyAccessSectionConfig
  | UrgencyNotesSectionConfig;

// ── Form config ─────────────────────────────────────────────────────

export interface FormConfig {
  /** Unique config identifier (e.g. 'ffr_new', 'handoff') */
  id: string;
  /** Human-readable form label */
  label: string;
  /** Ordered list of sections to render */
  sections: SectionConfig[];
}

// ── Config definitions ──────────────────────────────────────────────

/**
 * Full FFR (Forgotten Felines Request) new request form.
 * Used by /requests/new — phone intake, paper entry, and quick complete modes.
 */
export const FFR_NEW_CONFIG: FormConfig = {
  id: "ffr_new",
  label: "New FFR Request",
  sections: [
    {
      component: "place",
      label: "Cat Location",
      props: { showPropertyType: true, showCounty: true, showWhereOnProperty: true },
    },
    {
      component: "person",
      label: "Requester",
      props: { role: "requestor", allowCreate: true, required: true },
    },
    {
      component: "propertyAccess",
    },
    {
      component: "catDetails",
    },
    {
      component: "kittens",
    },
    {
      component: "urgencyNotes",
      props: { showDetails: true },
    },
  ],
};

/**
 * Quick intake — minimal form for fast phone triage.
 * Person + Place + cat count + urgency only.
 */
export const QUICK_INTAKE_CONFIG: FormConfig = {
  id: "quick_intake",
  label: "Quick Intake",
  sections: [
    {
      component: "person",
      label: "Caller",
      props: { role: "requestor", allowCreate: true, compact: true },
    },
    {
      component: "place",
      label: "Cat Location",
      props: { showPropertyType: false, showCounty: true, showWhereOnProperty: false, compact: true },
    },
    {
      component: "catDetails",
      props: { compact: true },
    },
    {
      component: "urgencyNotes",
      label: "Notes",
      props: { showDetails: false, compact: true },
    },
  ],
};

/**
 * Dynamic intake — converts an intake submission into a request.
 * Similar to FFR but may have pre-populated data.
 */
export const DYNAMIC_INTAKE_CONFIG: FormConfig = {
  id: "dynamic_intake",
  label: "Convert Intake to Request",
  sections: [
    {
      component: "place",
      label: "Cat Location",
      props: { showPropertyType: true, showCounty: true, showWhereOnProperty: true },
    },
    {
      component: "person",
      label: "Requester",
      props: { role: "requestor", allowCreate: true },
    },
    {
      component: "catDetails",
    },
    {
      component: "kittens",
    },
    {
      component: "urgencyNotes",
      props: { showDetails: true },
    },
  ],
};

/**
 * Handoff — compact form when handing off a request to a new person/place.
 * Place + person + cat count + notes. No property access or kitten assessment.
 */
export const HANDOFF_CONFIG: FormConfig = {
  id: "handoff",
  label: "Handoff Request",
  sections: [
    {
      component: "place",
      label: "New Location",
      props: { showPropertyType: false, showCounty: false, showWhereOnProperty: false, compact: true },
    },
    {
      component: "person",
      label: "New Contact",
      props: { role: "caretaker", allowCreate: true, compact: true },
    },
    {
      component: "catDetails",
      props: { compact: true },
    },
    {
      component: "urgencyNotes",
      label: "Handoff Notes",
      props: { showDetails: false, compact: true },
    },
  ],
};

/**
 * Redirect — compact form when redirecting a request to a different address.
 * Place + person + cat count + notes.
 */
export const REDIRECT_CONFIG: FormConfig = {
  id: "redirect",
  label: "Redirect Request",
  sections: [
    {
      component: "place",
      label: "New Address",
      props: { showPropertyType: false, showCounty: false, showWhereOnProperty: false, compact: true },
    },
    {
      component: "person",
      label: "Contact",
      props: { role: "requestor", allowCreate: true, compact: true },
    },
    {
      component: "catDetails",
      props: { compact: true },
    },
    {
      component: "urgencyNotes",
      label: "Redirect Notes",
      props: { showDetails: false, compact: true },
    },
  ],
};

// ── Config registry ─────────────────────────────────────────────────

export const FORM_CONFIGS: Record<string, FormConfig> = {
  ffr_new: FFR_NEW_CONFIG,
  quick_intake: QUICK_INTAKE_CONFIG,
  dynamic_intake: DYNAMIC_INTAKE_CONFIG,
  handoff: HANDOFF_CONFIG,
  redirect: REDIRECT_CONFIG,
};

/**
 * Get a form config by ID. Returns undefined if not found.
 */
export function getFormConfig(id: string): FormConfig | undefined {
  return FORM_CONFIGS[id];
}

/**
 * List all available form config IDs with their labels.
 */
export function listFormConfigs(): { id: string; label: string }[] {
  return Object.values(FORM_CONFIGS).map((c) => ({ id: c.id, label: c.label }));
}

/**
 * Load a form config from the database (ops.app_config), falling back to
 * the TypeScript constant if no DB row exists. Server-side only.
 *
 * @example
 *   const config = await getFormConfigFromDb('ffr_new');
 */
export async function getFormConfigFromDb(id: string): Promise<FormConfig> {
  const fallback = FORM_CONFIGS[id];
  try {
    // Dynamic import to avoid bundling server-only code in client
    const { getServerConfig } = await import("@/lib/server-config");
    const dbConfig = await getServerConfig<FormConfig | null>(
      `form_config.${id}`,
      null
    );
    if (dbConfig && dbConfig.sections && Array.isArray(dbConfig.sections)) {
      return dbConfig as FormConfig;
    }
  } catch {
    // DB unavailable or server-config not available — use fallback
  }
  return fallback || { id, label: id, sections: [] };
}
