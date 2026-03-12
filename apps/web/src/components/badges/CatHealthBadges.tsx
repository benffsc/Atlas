import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single health flag from the API (stored as JSONB array element). */
export interface HealthFlag {
  /** Category: 'disease', 'reproductive', 'condition', 'age', 'weight' */
  category: string;
  /** Machine key, e.g. 'felv', 'fiv', 'pregnant', 'uri', 'kitten' */
  key: string;
  /** Human-readable short label for the badge, e.g. 'FeLV+', 'Pregnant' */
  label: string;
  /** Optional hex color from the disease_types table */
  color?: string | null;
}

export interface CatHealthBadgesProps {
  /** Aggregated health flags from the API */
  healthFlags?: HealthFlag[] | null;
  /** Whether the cat is deceased — always shown, doesn't count toward limit */
  isDeceased?: boolean;
  /** Max badges to show inline before +N overflow (default 3) */
  maxInline?: number;
  /** Badge size */
  size?: "sm" | "md";
}

// ---------------------------------------------------------------------------
// Badge color mapping
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, { bg: string; color: string }> = {
  disease: { bg: COLORS.errorLight, color: COLORS.errorDark },
  reproductive: { bg: "#f3e8ff", color: "#7c3aed" }, // purple
  condition: { bg: COLORS.warningLight, color: COLORS.warningDark },
  age: { bg: COLORS.gray100, color: COLORS.gray600 },
  weight: { bg: COLORS.gray100, color: COLORS.gray600 },
};

const DECEASED_STYLE = { bg: COLORS.gray200, color: COLORS.gray700 };

// Priority order for sorting badges (lower = more important = shown first)
const CATEGORY_PRIORITY: Record<string, number> = {
  disease: 0,
  reproductive: 1,
  condition: 2,
  age: 3,
  weight: 4,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CatHealthBadges({
  healthFlags,
  isDeceased,
  maxInline = 3,
  size = "sm",
}: CatHealthBadgesProps) {
  if ((!healthFlags || healthFlags.length === 0) && !isDeceased) {
    return null;
  }

  // Sort by category priority
  const sorted = [...(healthFlags || [])].sort(
    (a, b) =>
      (CATEGORY_PRIORITY[a.category] ?? 99) -
      (CATEGORY_PRIORITY[b.category] ?? 99)
  );

  const visible = sorted.slice(0, maxInline);
  const overflowCount = sorted.length - maxInline;

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
      {/* Deceased badge — always shown, doesn't count toward limit */}
      {isDeceased && (
        <HealthBadge
          label="Deceased"
          bg={DECEASED_STYLE.bg}
          color={DECEASED_STYLE.color}
          fontSize={fontSize}
          padding={padding}
        />
      )}

      {visible.map((flag) => {
        const colors = CATEGORY_COLORS[flag.category] || CATEGORY_COLORS.age;
        // Use disease-specific color if provided
        const bg =
          flag.color && flag.category === "disease"
            ? hexToLightBg(flag.color)
            : colors.bg;
        const textColor =
          flag.color && flag.category === "disease" ? flag.color : colors.color;

        return (
          <HealthBadge
            key={`${flag.category}-${flag.key}`}
            label={flag.label}
            bg={bg}
            color={textColor}
            fontSize={fontSize}
            padding={padding}
          />
        );
      })}

      {overflowCount > 0 && (
        <span
          style={{
            display: "inline-block",
            fontSize,
            padding,
            borderRadius: BORDERS.radius.md,
            fontWeight: TYPOGRAPHY.weight.medium,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
            background: COLORS.gray100,
            color: COLORS.gray500,
            cursor: "default",
          }}
          title={sorted
            .slice(maxInline)
            .map((f) => f.label)
            .join(", ")}
        >
          +{overflowCount}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Internal badge
// ---------------------------------------------------------------------------

function HealthBadge({
  label,
  bg,
  color,
  fontSize,
  padding,
}: {
  label: string;
  bg: string;
  color: string;
  fontSize: string;
  padding: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: BORDERS.radius.md,
        fontWeight: TYPOGRAPHY.weight.medium,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        background: bg,
        color,
        fontSize,
        padding,
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a hex color to a light tinted background (10% opacity effect). */
function hexToLightBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return COLORS.errorLight;
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

// ---------------------------------------------------------------------------
// Builder helper — construct HealthFlag[] from raw cat data
// ---------------------------------------------------------------------------

export interface CatHealthData {
  /** Disease test results with positive outcome */
  diseases?: Array<{
    disease_key: string;
    short_code?: string;
    display_name?: string;
    color?: string;
    result: string;
  }>;
  /** Is pregnant, lactating, in heat from vitals */
  isPregnant?: boolean;
  isLactating?: boolean;
  /** Active clinical conditions */
  conditions?: Array<{
    condition_type: string;
    severity?: string | null;
  }>;
  /** Age-derived group */
  ageGroup?: string | null;
  /** Weight in lbs */
  weightLbs?: number | null;
}

const CONDITION_LABELS: Record<string, string> = {
  uri: "URI",
  fleas: "Fleas",
  ear_mites: "Ear Mites",
  ringworm: "Ringworm",
  abscess: "Abscess",
  wound: "Wound",
  conjunctivitis: "Conjunctivitis",
  dental: "Dental",
  skin_condition: "Skin",
  upper_respiratory: "URI",
  dehydration: "Dehydrated",
  emaciated: "Emaciated",
  injured: "Injured",
  pregnant: "Pregnant",
  lactating: "Lactating",
};

/**
 * Build a HealthFlag[] from structured cat health data.
 * Use this on the frontend when you have the raw fields
 * (e.g., from the cat detail API) rather than a pre-computed JSONB array.
 */
export function buildHealthFlags(data: CatHealthData): HealthFlag[] {
  const flags: HealthFlag[] = [];

  // 1. Disease (positive results only)
  if (data.diseases) {
    for (const d of data.diseases) {
      if (
        d.result === "positive" ||
        d.result === "Positive" ||
        d.result === "true" ||
        d.result === "TRUE"
      ) {
        flags.push({
          category: "disease",
          key: d.disease_key,
          label: `${d.short_code || d.disease_key}+`,
          color: d.color || null,
        });
      }
    }
  }

  // 2. Reproductive
  if (data.isPregnant) {
    flags.push({ category: "reproductive", key: "pregnant", label: "Pregnant" });
  }
  if (data.isLactating) {
    flags.push({
      category: "reproductive",
      key: "lactating",
      label: "Lactating",
    });
  }

  // 3. Clinical conditions
  if (data.conditions) {
    for (const c of data.conditions) {
      const label =
        CONDITION_LABELS[c.condition_type] ||
        c.condition_type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
      flags.push({
        category: "condition",
        key: c.condition_type,
        label,
      });
    }
  }

  // 4. Age group (only notable ones)
  if (data.ageGroup === "kitten") {
    flags.push({ category: "age", key: "kitten", label: "Kitten" });
  } else if (data.ageGroup === "senior") {
    flags.push({ category: "age", key: "senior", label: "Senior" });
  }

  // 5. Weight
  if (data.weightLbs != null && data.weightLbs > 0) {
    flags.push({
      category: "weight",
      key: "weight",
      label: `${data.weightLbs.toFixed(1)} lbs`,
    });
  }

  return flags;
}
