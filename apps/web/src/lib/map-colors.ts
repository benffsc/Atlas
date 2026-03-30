/**
 * Centralized Map Color Configuration
 * All map-related colors in one place for consistency.
 *
 * Rules:
 * - React component inline styles: use `var(--xxx)` CSS variables where a
 *   design token exists, or import from MAP_COLORS / the named exports here.
 * - Google Maps InfoWindow content: use raw hex (innerHTML context).
 * - Canvas drawing ops (ctx.fillStyle etc.): must be raw hex.
 * - Use `var(--primary)` etc. for generic UI chrome that has a design token.
 */

export const MAP_COLORS = {
  // Priority levels (TNR urgency)
  priority: {
    critical: '#dc2626', // Red
    high: '#ea580c',     // Orange
    medium: '#ca8a04',   // Yellow
    low: '#3b82f6',      // Blue
    managed: '#16a34a',  // Green
    unknown: '#6b7280',  // Gray
  },

  // Layer-specific colors
  layers: {
    places: '#3b82f6',             // Blue
    google_pins: '#f59e0b',        // Amber
    tnr_priority: '#dc2626',       // Red
    zones: '#10b981',              // Emerald
    volunteers: '#9333ea',         // Purple
    volunteer_marker: '#FFD700',   // Gold — volunteer map dot
    clinic_clients: '#8b5cf6',     // Violet
    historical_sources: '#6b7280', // Gray
    data_coverage: '#059669',      // Green
    trapper_coverage: '#0ea5e9',   // Sky blue — trapper territory layer
    heatmap_density: '#f03b20',    // Orange-red — density heatmap
    heatmap_disease: '#e31a1c',    // Red — disease heatmap
  },

  // AI Classification colors (for Google Map entries)
  classification: {
    disease_risk: '#dc2626',      // Red - FeLV, FIV, panleuk
    watch_list: '#f59e0b',        // Amber - safety, aggressive
    volunteer: '#9333ea',         // Purple
    active_colony: '#16a34a',     // Green
    historical_colony: '#6b7280', // Gray
    relocation_client: '#8b5cf6', // Violet
    contact_info: '#3b82f6',      // Blue
  },

  // Signal colors (pregnancy, mortality, etc.)
  signals: {
    pregnant_nursing: '#ec4899', // Pink
    mortality: '#1f2937',        // Dark gray
    relocated: '#8b5cf6',        // Violet
    adopted: '#10b981',          // Emerald
    temperament: '#f59e0b',      // Amber
    general: '#6366f1',          // Indigo
  },

  // Volunteer role colors
  volunteerRoles: {
    coordinator: '#7c3aed',      // Violet
    head_trapper: '#2563eb',     // Blue
    ffsc_trapper: '#16a34a',     // Green
    community_trapper: '#f59e0b', // Amber
  },

  // Zone observation status
  zoneStatus: {
    critical: '#dc2626', // Red
    high: '#ea580c',     // Orange
    medium: '#ca8a04',   // Yellow
    refresh: '#3b82f6',  // Blue
    current: '#16a34a',  // Green
    unknown: '#6b7280',  // Gray
  },

  // Data coverage levels
  coverage: {
    rich: '#16a34a',     // Green
    moderate: '#3b82f6', // Blue
    sparse: '#f59e0b',   // Amber
    gap: '#dc2626',      // Red
  },

  // Disease type colors (defaults; actual colors may come from disease_types table)
  disease: {
    felv: '#dc2626',        // Red - Feline Leukemia
    fiv: '#ea580c',         // Orange - Feline Immunodeficiency
    ringworm: '#ca8a04',    // Yellow - Ringworm
    heartworm: '#7c3aed',   // Purple - Heartworm
    panleukopenia: '#be185d', // Pink - Panleukopenia
    fallback: '#6b7280',    // Gray - unknown/new types
  },

  // Atlas pin style colors (teardrop marker fill)
  pinStyle: {
    disease: '#ea580c',        // Orange-red
    watch_list: '#8b5cf6',     // Violet
    active: '#22c55e',         // Green
    active_requests: '#14b8a6', // Teal
    has_history: '#6366f1',    // Indigo
    minimal: '#94a3b8',        // Slate
    default: '#3b82f6',        // Blue
  },

  // Trapper territory type colors
  trapperType: {
    ffsc_volunteer: '#3b82f6',   // Blue
    ffsc_staff: '#3b82f6',       // Blue
    ffsc_trapper: '#3b82f6',     // Blue
    coordinator: '#3b82f6',      // Blue
    head_trapper: '#3b82f6',     // Blue
    community_trapper: '#d97706', // Amber
    rescue_operator: '#8b5cf6',  // Violet
    colony_caretaker: '#059669', // Green
    unknown: '#6b7280',          // Gray
  },

  // Annotation type colors
  annotationType: {
    colony_sighting: '#22c55e', // Green
    trap_location: '#3b82f6',   // Blue
    hazard: '#ef4444',          // Red
    feeding_site: '#f59e0b',    // Amber
    general: '#6b7280',         // Gray
    other: '#8b5cf6',           // Violet
  },

  // Person role badge colors (React component, not popup HTML)
  personRole: {
    staff:     { bg: 'rgba(59, 130, 246, 0.15)',  text: '#2563eb' },
    trapper:   { bg: 'rgba(22, 163, 74, 0.15)',   text: '#16a34a' },
    volunteer: { bg: 'rgba(139, 92, 246, 0.15)',  text: '#7c3aed' },
    foster:    { bg: 'rgba(234, 88, 12, 0.15)',   text: '#ea580c' },
    caretaker: { bg: 'rgba(234, 88, 12, 0.10)',   text: '#c2410c' },
    unknown:   { bg: 'rgba(107, 114, 128, 0.15)', text: '#6b7280' },
  },

  // Popup HTML palette — InfoWindow/popup content renders raw HTML so CSS vars don't work.
  // Reference these constants instead of raw hex inside template strings.
  popup: {
    textPrimary: '#374151',   // Gray-700
    textSecondary: '#6b7280', // Gray-500
    textTertiary: '#9ca3af',  // Gray-400
    bgMuted: '#f3f4f6',      // Gray-100
    bgSubtle: '#f9fafb',     // Gray-50
    border: '#e5e7eb',       // Gray-200
    link: '#0d6efd',         // Primary link blue
    danger: '#dc2626',       // Red-600
    dangerDark: '#7f1d1d',   // Red-900
    dangerBg: '#fef2f2',     // Red-50
    dangerBorder: '#fecaca', // Red-200
    success: '#059669',      // Emerald-600
    successBg: '#ecfdf5',    // Emerald-50
    successText: '#065f46',  // Emerald-800
    warningBg: '#fef3c7',    // Amber-100
    warningText: '#92400e',  // Amber-800
    watchBg: '#f5f3ff',      // Violet-50
    watchBorder: '#c4b5fd',  // Violet-300
    watchText: '#7c3aed',    // Violet-600
    staffBadgeBg: '#eef2ff', // Indigo-50
    staffBadgeText: '#4338ca', // Indigo-700
    fosterBadgeBg: '#fdf2f8', // Pink-50
    fosterBadgeText: '#9d174d', // Pink-800
    caretakerBadgeBg: '#ecfeff', // Cyan-50
    caretakerBadgeText: '#0e7490', // Cyan-700
    volunteerBadgeBg: '#f5f3ff', // Violet-50
    volunteerBadgeText: '#6d28d9', // Violet-700
    warningBannerBg: '#fff7ed', // Orange-50
    warningBannerBorder: '#fed7aa', // Orange-200
    warningBannerText: '#c2410c', // Orange-700
  },

  // Misc
  googleBrandBlue: '#4285f4', // Google Maps brand color (don't change)
};

// ---------------------------------------------------------------------------
// Convenience lookup helpers
// ---------------------------------------------------------------------------

/** Get priority color based on value */
export function getPriorityColor(priority: string): string {
  return MAP_COLORS.priority[priority as keyof typeof MAP_COLORS.priority]
    || MAP_COLORS.priority.unknown;
}

/** Get layer color */
export function getLayerColor(layerId: string): string {
  return MAP_COLORS.layers[layerId as keyof typeof MAP_COLORS.layers]
    || MAP_COLORS.layers.places;
}

/** Get AI classification color */
export function getClassificationColor(classification: string): string {
  return MAP_COLORS.classification[classification as keyof typeof MAP_COLORS.classification]
    || MAP_COLORS.classification.contact_info;
}

/** Get volunteer role color */
export function getVolunteerRoleColor(role: string): string {
  return MAP_COLORS.volunteerRoles[role as keyof typeof MAP_COLORS.volunteerRoles]
    || MAP_COLORS.volunteerRoles.community_trapper;
}

/** Get disease color by key (falls back to table-provided color or default gray) */
export function getDiseaseColor(diseaseKey: string, tableColor?: string): string {
  return MAP_COLORS.disease[diseaseKey as keyof typeof MAP_COLORS.disease]
    || tableColor
    || MAP_COLORS.disease.fallback;
}

/** Get pin style color */
export function getPinStyleColor(pinStyle: string): string {
  return MAP_COLORS.pinStyle[pinStyle as keyof typeof MAP_COLORS.pinStyle]
    || MAP_COLORS.pinStyle.default;
}

/** Get trapper territory type color */
export function getTrapperTypeColor(trapperType: string): string {
  return MAP_COLORS.trapperType[trapperType as keyof typeof MAP_COLORS.trapperType]
    || MAP_COLORS.trapperType.unknown;
}

/** Get annotation type color */
export function getAnnotationTypeColor(annotationType: string): string {
  return MAP_COLORS.annotationType[annotationType as keyof typeof MAP_COLORS.annotationType]
    || MAP_COLORS.annotationType.general;
}

/** Get person role badge color pair (bg + text) */
export function getPersonRoleColor(role: string): { bg: string; text: string } {
  return MAP_COLORS.personRole[role as keyof typeof MAP_COLORS.personRole]
    || MAP_COLORS.personRole.unknown;
}

// ---------------------------------------------------------------------------
// Color math utilities
// ---------------------------------------------------------------------------

/** Get RGBA from hex with alpha */
export function hexToRgba(hex: string, alpha: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const R = (num >> 16) & 0xff;
  const G = (num >> 8) & 0xff;
  const B = num & 0xff;
  return `rgba(${R}, ${G}, ${B}, ${alpha})`;
}
