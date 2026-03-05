/**
 * Shared style constants for Request pages.
 *
 * These replace the ~200+ repeated inline style objects across
 * requests/[id]/page.tsx, requests/page.tsx, and requests/new/page.tsx.
 *
 * All values are sourced from @/lib/design-tokens.
 */
import { COLORS, SPACING, TYPOGRAPHY, BORDERS, SHADOWS, TRANSITIONS } from '@/lib/design-tokens';

// ─── Layout ──────────────────────────────────────────────────────────────────

export const PAGE_CONTAINER: React.CSSProperties = {
  maxWidth: '900px',
  margin: '0 auto',
  padding: SPACING.lg,
};

export const CARD: React.CSSProperties = {
  padding: SPACING.xl,
  marginBottom: SPACING.lg,
};

export const GRID_2COL: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: SPACING.lg,
};

export const GRID_3COL: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: SPACING.lg,
};

export const GRID_AUTO: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: SPACING.lg,
};

// ─── Typography ──────────────────────────────────────────────────────────────

export const SECTION_HEADER: React.CSSProperties = {
  margin: 0,
  fontSize: TYPOGRAPHY.size.base,
  fontWeight: TYPOGRAPHY.weight.bold,
};

export const PAGE_TITLE: React.CSSProperties = {
  margin: 0,
  fontSize: TYPOGRAPHY.size['2xl'],
};

export const SUBTITLE: React.CSSProperties = {
  margin: 0,
  fontSize: TYPOGRAPHY.size.xl,
  marginBottom: SPACING.lg,
};

// ─── Fields & Labels ─────────────────────────────────────────────────────────

export const FIELD_LABEL: React.CSSProperties = {
  fontSize: TYPOGRAPHY.size.xs,
  fontWeight: TYPOGRAPHY.weight.semibold,
  color: COLORS.gray500,
  textTransform: 'uppercase',
  letterSpacing: '0.025em',
};

export const FIELD_HINT: React.CSSProperties = {
  fontSize: '0.65rem',
  color: COLORS.textMuted,
};

export const FIELD_VALUE: React.CSSProperties = {
  fontWeight: TYPOGRAPHY.weight.medium,
  color: COLORS.textPrimary,
};

export const FIELD_VALUE_EMPTY: React.CSSProperties = {
  fontWeight: TYPOGRAPHY.weight.medium,
  color: COLORS.textMuted,
  fontStyle: 'italic',
};

// ─── Form Controls ───────────────────────────────────────────────────────────

export const INPUT: React.CSSProperties = {
  width: '100%',
  padding: SPACING.sm,
};

export const SELECT: React.CSSProperties = {
  width: '100%',
  padding: SPACING.sm,
};

// ─── Flex Patterns ───────────────────────────────────────────────────────────

export const FLEX_CENTER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACING.sm,
};

export const FLEX_CENTER_SM: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACING.xs,
};

export const FLEX_BETWEEN: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

export const FLEX_WRAP: React.CSSProperties = {
  display: 'flex',
  gap: SPACING.lg,
  flexWrap: 'wrap',
};

export const FLEX_WRAP_SM: React.CSSProperties = {
  display: 'flex',
  gap: SPACING.sm,
  flexWrap: 'wrap',
};

// ─── Actions Row ─────────────────────────────────────────────────────────────

export const ACTIONS_ROW: React.CSSProperties = {
  display: 'flex',
  gap: SPACING.sm,
  flexWrap: 'wrap',
  alignItems: 'center',
};

// ─── Banners ─────────────────────────────────────────────────────────────────

export const WARNING_BANNER: React.CSSProperties = {
  marginTop: SPACING.lg,
  padding: `${SPACING.sm} ${SPACING.md}`,
  background: 'rgba(255, 193, 7, 0.15)',
  border: `1px solid ${COLORS.warning}`,
  borderRadius: BORDERS.radius.md,
  fontSize: TYPOGRAPHY.size.sm,
};

export const ERROR_BANNER: React.CSSProperties = {
  marginTop: SPACING.lg,
  padding: SPACING.md,
  background: COLORS.errorLight,
  border: `1px solid #fecaca`,
  borderRadius: BORDERS.radius.lg,
};

// ─── Spacing ─────────────────────────────────────────────────────────────────

export const MB_SM: React.CSSProperties = { marginBottom: SPACING.sm };
export const MB_MD: React.CSSProperties = { marginBottom: SPACING.md };
export const MB_LG: React.CSSProperties = { marginBottom: SPACING.lg };
export const MB_XL: React.CSSProperties = { marginBottom: SPACING.xl };
export const MT_LG: React.CSSProperties = { marginTop: SPACING.lg };

// ─── Section Divider ─────────────────────────────────────────────────────────

export const SECTION_DIVIDER: React.CSSProperties = {
  borderTop: `1px solid var(--border, ${COLORS.border})`,
  paddingTop: SPACING.lg,
  marginTop: SPACING.lg,
};

// ─── Quick Status Button ─────────────────────────────────────────────────────

export function quickStatusButton(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: `0.35rem ${SPACING.md}`,
    fontSize: TYPOGRAPHY.size.sm,
    background: color,
    color: COLORS.white,
    border: 'none',
    borderRadius: BORDERS.radius.md,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

// ─── Skeleton Loading ────────────────────────────────────────────────────────

export const SKELETON_LINE: React.CSSProperties = {
  height: '1rem',
  background: COLORS.gray200,
  borderRadius: BORDERS.radius.md,
  animation: 'pulse 1.5s ease-in-out infinite',
};

export const SKELETON_BLOCK: React.CSSProperties = {
  height: '6rem',
  background: COLORS.gray200,
  borderRadius: BORDERS.radius.lg,
  animation: 'pulse 1.5s ease-in-out infinite',
};
