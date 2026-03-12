import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A disease risk flag for a place (from ops.place_disease_status). */
export interface DiseaseFlag {
  /** Disease key, e.g. 'felv', 'fiv' */
  disease_key: string;
  /** Short code for badge label, e.g. 'FeLV', 'FIV' */
  short_code: string;
  /** Status: confirmed_active, suspected, historical, perpetual, cleared */
  status: string;
  /** Badge color from disease_types table */
  color?: string | null;
  /** Number of positive cats at this place */
  positive_cat_count?: number;
}

export interface PlaceRiskBadgesProps {
  /** Disease risk flags from the API */
  diseaseFlags?: DiseaseFlag[] | null;
  /** Whether place is on the watch list */
  watchList?: boolean;
  /** Number of active requests at this place */
  activeRequestCount?: number;
  /** Badge size */
  size?: "sm" | "md";
}

// ---------------------------------------------------------------------------
// Status → color mapping
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { dot: string; bg: string; color: string }> = {
  confirmed_active: { dot: COLORS.errorDark, bg: COLORS.errorLight, color: COLORS.errorDark },
  perpetual: { dot: "#991b1b", bg: "#fecaca", color: "#991b1b" },
  suspected: { dot: COLORS.warning, bg: COLORS.warningLight, color: COLORS.warningDark },
  historical: { dot: COLORS.gray400, bg: COLORS.gray100, color: COLORS.gray600 },
  cleared: { dot: COLORS.success, bg: COLORS.successLight, color: COLORS.successDark },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlaceRiskBadges({
  diseaseFlags,
  watchList,
  activeRequestCount,
  size = "sm",
}: PlaceRiskBadgesProps) {
  const hasDisease = diseaseFlags && diseaseFlags.length > 0;
  const hasWatch = watchList;
  const hasRequests = activeRequestCount != null && activeRequestCount > 0;

  if (!hasDisease && !hasWatch && !hasRequests) return null;

  const fontSize = size === "sm" ? TYPOGRAPHY.size["2xs"] : TYPOGRAPHY.size.xs;
  const padding =
    size === "sm" ? `1px ${SPACING.xs}` : `${SPACING.xs} ${SPACING.sm}`;

  return (
    <span
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        gap: SPACING["2xs"],
        alignItems: "center",
      }}
    >
      {/* Disease flags — only show active/suspected/perpetual inline */}
      {diseaseFlags
        ?.filter((d) => d.status !== "cleared")
        .map((d) => {
          const style = STATUS_COLORS[d.status] || STATUS_COLORS.historical;
          return (
            <span
              key={d.disease_key}
              title={`${d.short_code}: ${d.status.replace(/_/g, " ")}${d.positive_cat_count ? ` (${d.positive_cat_count} cats)` : ""}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                borderRadius: BORDERS.radius.md,
                fontWeight: TYPOGRAPHY.weight.medium,
                lineHeight: 1.4,
                whiteSpace: "nowrap",
                background: style.bg,
                color: style.color,
                fontSize,
                padding,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: BORDERS.radius.full,
                  background: d.color || style.dot,
                  flexShrink: 0,
                }}
              />
              {d.short_code}
            </span>
          );
        })}

      {/* Watch list badge */}
      {hasWatch && (
        <span
          style={{
            display: "inline-block",
            borderRadius: BORDERS.radius.md,
            fontWeight: TYPOGRAPHY.weight.medium,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
            background: COLORS.warningLight,
            color: COLORS.warningDark,
            fontSize,
            padding,
          }}
        >
          Watch
        </span>
      )}

      {/* Active requests badge */}
      {hasRequests && (
        <span
          style={{
            display: "inline-block",
            borderRadius: BORDERS.radius.md,
            fontWeight: TYPOGRAPHY.weight.medium,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
            background: COLORS.primaryLight,
            color: COLORS.primaryDark,
            fontSize,
            padding,
          }}
        >
          {activeRequestCount} req
        </span>
      )}
    </span>
  );
}
