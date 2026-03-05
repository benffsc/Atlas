import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";

interface BadgeProps {
  variant?: "default" | "success" | "warning" | "error" | "info" | "purple" | "gray";
  size?: "sm" | "md";
  children: React.ReactNode;
}

const VARIANT_STYLES: Record<string, { bg: string; color: string }> = {
  default: { bg: COLORS.gray100, color: COLORS.gray700 },
  success: { bg: COLORS.successLight, color: COLORS.successDark },
  warning: { bg: COLORS.warningLight, color: COLORS.warningDark },
  error: { bg: COLORS.errorLight, color: COLORS.errorDark },
  info: { bg: COLORS.infoLight, color: COLORS.infoDark },
  purple: { bg: "#f3e8ff", color: "#7c3aed" },
  gray: { bg: COLORS.gray100, color: COLORS.gray600 },
};

const SIZE_STYLES: Record<string, React.CSSProperties> = {
  sm: {
    fontSize: TYPOGRAPHY.size["2xs"],
    padding: `1px ${SPACING.xs}`,
  },
  md: {
    fontSize: TYPOGRAPHY.size.xs,
    padding: `${SPACING.xs} ${SPACING.sm}`,
  },
};

export function Badge({ variant = "default", size = "sm", children }: BadgeProps) {
  const colors = VARIANT_STYLES[variant] || VARIANT_STYLES.default;
  const sizing = SIZE_STYLES[size] || SIZE_STYLES.sm;

  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: BORDERS.radius.md,
        fontWeight: TYPOGRAPHY.weight.medium,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        background: colors.bg,
        color: colors.color,
        ...sizing,
      }}
    >
      {children}
    </span>
  );
}
