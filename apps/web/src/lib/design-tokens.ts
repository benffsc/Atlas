/**
 * Atlas Design System Tokens
 *
 * Centralized design tokens for consistent styling across the application.
 * Import and use these instead of hardcoding hex colors, spacing, etc.
 *
 * For map-specific colors, see: @/lib/map-colors.ts
 *
 * @example
 * import { COLORS, SPACING } from '@/lib/design-tokens';
 *
 * // In styles
 * style={{ color: COLORS.primary, padding: SPACING.md }}
 *
 * // Status-based colors
 * style={{ backgroundColor: getStatusColor('success').bg }}
 */

// ============================================================================
// COLORS
// ============================================================================

export const COLORS = {
  // Primary brand colors (blue)
  primary: '#3b82f6',
  primaryDark: '#1d4ed8',
  primaryLight: '#dbeafe',
  primaryHover: '#2563eb',

  // Status colors
  success: '#10b981',
  successDark: '#059669',
  successLight: '#d1fae5',

  warning: '#f59e0b',
  warningDark: '#d97706',
  warningLight: '#fef3c7',

  error: '#ef4444',
  errorDark: '#dc2626',
  errorLight: '#fee2e2',

  info: '#3b82f6',
  infoDark: '#2563eb',
  infoLight: '#dbeafe',

  // Neutral grays
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray600: '#4b5563',
  gray700: '#374151',
  gray800: '#1f2937',
  gray900: '#111827',

  // Text colors
  textPrimary: '#111827',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  textInverse: '#ffffff',

  // Background colors
  bgPrimary: '#ffffff',
  bgSecondary: '#f9fafb',
  bgTertiary: '#f3f4f6',
  bgDark: '#111827',

  // Border colors
  border: '#e5e7eb',
  borderFocus: '#3b82f6',
  borderError: '#ef4444',

  // Special colors
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
} as const;

// ============================================================================
// STATUS HELPERS
// ============================================================================

export interface StatusColorSet {
  bg: string;
  text: string;
  border: string;
  icon: string;
}

/**
 * Get consistent color set for a status type.
 */
export function getStatusColor(status: 'success' | 'warning' | 'error' | 'info' | 'neutral'): StatusColorSet {
  switch (status) {
    case 'success':
      return {
        bg: COLORS.successLight,
        text: COLORS.successDark,
        border: COLORS.success,
        icon: COLORS.success,
      };
    case 'warning':
      return {
        bg: COLORS.warningLight,
        text: COLORS.warningDark,
        border: COLORS.warning,
        icon: COLORS.warning,
      };
    case 'error':
      return {
        bg: COLORS.errorLight,
        text: COLORS.errorDark,
        border: COLORS.error,
        icon: COLORS.error,
      };
    case 'info':
      return {
        bg: COLORS.infoLight,
        text: COLORS.infoDark,
        border: COLORS.info,
        icon: COLORS.info,
      };
    case 'neutral':
    default:
      return {
        bg: COLORS.gray100,
        text: COLORS.gray700,
        border: COLORS.gray300,
        icon: COLORS.gray500,
      };
  }
}

// ============================================================================
// SPACING
// ============================================================================

export const SPACING = {
  /** 2px */
  '2xs': '0.125rem',
  /** 4px */
  xs: '0.25rem',
  /** 8px */
  sm: '0.5rem',
  /** 12px */
  md: '0.75rem',
  /** 16px */
  lg: '1rem',
  /** 24px */
  xl: '1.5rem',
  /** 32px */
  '2xl': '2rem',
  /** 48px */
  '3xl': '3rem',
  /** 64px */
  '4xl': '4rem',
} as const;

// ============================================================================
// TYPOGRAPHY
// ============================================================================

export const TYPOGRAPHY = {
  // Font sizes
  size: {
    /** 10px */
    '2xs': '0.625rem',
    /** 12px */
    xs: '0.75rem',
    /** 14px */
    sm: '0.875rem',
    /** 16px */
    base: '1rem',
    /** 18px */
    lg: '1.125rem',
    /** 20px */
    xl: '1.25rem',
    /** 24px */
    '2xl': '1.5rem',
    /** 30px */
    '3xl': '1.875rem',
    /** 36px */
    '4xl': '2.25rem',
  },

  // Font weights
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  // Line heights
  lineHeight: {
    none: 1,
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },

  // Font families
  family: {
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
  },
} as const;

// ============================================================================
// BORDERS
// ============================================================================

export const BORDERS = {
  // Border radius
  radius: {
    none: '0',
    sm: '0.125rem',
    md: '0.25rem',
    lg: '0.5rem',
    xl: '0.75rem',
    '2xl': '1rem',
    full: '9999px',
  },

  // Border widths
  width: {
    none: '0',
    default: '1px',
    '2': '2px',
    '4': '4px',
  },
} as const;

// ============================================================================
// SHADOWS
// ============================================================================

export const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  default: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
} as const;

// ============================================================================
// Z-INDEX
// ============================================================================

export const Z_INDEX = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
  toast: 80,
} as const;

// ============================================================================
// TRANSITIONS
// ============================================================================

export const TRANSITIONS = {
  fast: '150ms ease-in-out',
  default: '200ms ease-in-out',
  slow: '300ms ease-in-out',
} as const;

// ============================================================================
// REQUEST STATUS COLORS
// (specific to Atlas request workflow)
// ============================================================================

export const REQUEST_STATUS_COLORS = {
  new: {
    bg: COLORS.primaryLight,
    text: COLORS.primaryDark,
    border: COLORS.primary,
  },
  working: {
    bg: COLORS.warningLight,
    text: COLORS.warningDark,
    border: COLORS.warning,
  },
  paused: {
    bg: '#fce7f3', // pink-100
    text: '#9d174d', // pink-800
    border: '#ec4899', // pink-500
  },
  completed: {
    bg: COLORS.successLight,
    text: COLORS.successDark,
    border: COLORS.success,
  },
} as const;

/**
 * Get colors for a request status.
 */
export function getRequestStatusColor(status: keyof typeof REQUEST_STATUS_COLORS) {
  return REQUEST_STATUS_COLORS[status] || REQUEST_STATUS_COLORS.new;
}

// ============================================================================
// ENTITY TYPE COLORS
// ============================================================================

export const ENTITY_COLORS = {
  cat: COLORS.primary,
  person: '#9333ea', // purple
  place: COLORS.success,
  request: COLORS.warning,
} as const;

/**
 * Get color for an entity type.
 */
export function getEntityColor(entityType: keyof typeof ENTITY_COLORS): string {
  return ENTITY_COLORS[entityType] || COLORS.gray500;
}
