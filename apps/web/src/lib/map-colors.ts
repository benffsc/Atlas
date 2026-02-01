/**
 * Centralized Map Color Configuration
 * All map-related colors in one place for consistency
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
    places: '#3b82f6',           // Blue
    google_pins: '#f59e0b',      // Amber
    tnr_priority: '#dc2626',     // Red
    zones: '#10b981',            // Emerald
    volunteers: '#9333ea',       // Purple
    clinic_clients: '#8b5cf6',   // Violet
    historical_sources: '#6b7280', // Gray
    data_coverage: '#059669',    // Green
  },

  // AI Classification colors (for Google Map entries)
  classification: {
    disease_risk: '#dc2626',     // Red - FeLV, FIV, panleuk
    watch_list: '#f59e0b',       // Amber - safety, aggressive
    volunteer: '#9333ea',        // Purple
    active_colony: '#16a34a',    // Green
    historical_colony: '#6b7280', // Gray
    relocation_client: '#8b5cf6', // Violet
    contact_info: '#3b82f6',     // Blue
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
    critical: '#dc2626',         // Red
    high: '#ea580c',             // Orange
    medium: '#ca8a04',           // Yellow
    refresh: '#3b82f6',          // Blue
    current: '#16a34a',          // Green
    unknown: '#6b7280',          // Gray
  },

  // Data coverage levels
  coverage: {
    rich: '#16a34a',             // Green
    moderate: '#3b82f6',         // Blue
    sparse: '#f59e0b',           // Amber
    gap: '#dc2626',              // Red
  },

  // Disease type colors (defaults, actual colors come from disease_types table)
  disease: {
    felv: '#dc2626',             // Red - Feline Leukemia
    fiv: '#ea580c',              // Orange - Feline Immunodeficiency
    ringworm: '#ca8a04',         // Yellow - Ringworm
    heartworm: '#7c3aed',        // Purple - Heartworm
    panleukopenia: '#be185d',    // Pink - Panleukopenia
    fallback: '#6b7280',         // Gray - unknown/new types
  },
} as const;

/**
 * Get priority color based on value
 */
export function getPriorityColor(priority: string): string {
  return MAP_COLORS.priority[priority as keyof typeof MAP_COLORS.priority]
    || MAP_COLORS.priority.unknown;
}

/**
 * Get layer color
 */
export function getLayerColor(layerId: string): string {
  return MAP_COLORS.layers[layerId as keyof typeof MAP_COLORS.layers]
    || MAP_COLORS.layers.places;
}

/**
 * Get classification color
 */
export function getClassificationColor(classification: string): string {
  return MAP_COLORS.classification[classification as keyof typeof MAP_COLORS.classification]
    || MAP_COLORS.classification.contact_info;
}

/**
 * Get volunteer role color
 */
export function getVolunteerRoleColor(role: string): string {
  return MAP_COLORS.volunteerRoles[role as keyof typeof MAP_COLORS.volunteerRoles]
    || MAP_COLORS.volunteerRoles.community_trapper;
}

/**
 * Get disease color by key (falls back to table-provided color or default gray)
 */
export function getDiseaseColor(diseaseKey: string, tableColor?: string): string {
  return MAP_COLORS.disease[diseaseKey as keyof typeof MAP_COLORS.disease]
    || tableColor
    || MAP_COLORS.disease.fallback;
}

/**
 * Lighten a hex color by a percentage
 */
export function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, (num >> 16) + amt);
  const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
  const B = Math.min(255, (num & 0x0000FF) + amt);
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}

/**
 * Darken a hex color by a percentage
 */
export function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, (num >> 16) - amt);
  const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
  const B = Math.max(0, (num & 0x0000FF) - amt);
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}

/**
 * Get RGBA from hex with alpha
 */
export function hexToRgba(hex: string, alpha: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const R = (num >> 16) & 0xFF;
  const G = (num >> 8) & 0xFF;
  const B = num & 0xFF;
  return `rgba(${R}, ${G}, ${B}, ${alpha})`;
}
