"use client";

export const FINANCIAL_COMMITMENTS = {
  full: {
    label: "Full",
    description: "Will cover all costs",
    color: "#10b981",
    bgColor: "#ecfdf5",
    icon: "💰",
  },
  limited: {
    label: "Limited",
    description: "Can contribute partially",
    color: "#f59e0b",
    bgColor: "#fffbeb",
    icon: "💵",
  },
  emergency_only: {
    label: "Emergency Only",
    description: "Only for emergencies",
    color: "#ef4444",
    bgColor: "#fef2f2",
    icon: "🚨",
  },
  none: {
    label: "None",
    description: "Cannot contribute financially",
    color: "#6b7280",
    bgColor: "#f3f4f6",
    icon: "—",
  },
} as const;

export type FinancialCommitment = keyof typeof FINANCIAL_COMMITMENTS;

interface FinancialCommitmentBadgeProps {
  commitment: string | null | undefined;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  showDescription?: boolean;
}

export default function FinancialCommitmentBadge({
  commitment,
  size = "md",
  showIcon = true,
  showDescription = false,
}: FinancialCommitmentBadgeProps) {
  if (!commitment) return null;

  const info = FINANCIAL_COMMITMENTS[commitment as FinancialCommitment];
  if (!info) return null;

  const sizeStyles = {
    sm: { padding: "0.125rem 0.375rem", fontSize: "0.7rem" },
    md: { padding: "0.25rem 0.5rem", fontSize: "0.8rem" },
    lg: { padding: "0.375rem 0.75rem", fontSize: "0.9rem" },
  };

  return (
    <span
      style={{
        ...sizeStyles[size],
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        background: info.bgColor,
        color: info.color,
        borderRadius: "4px",
        fontWeight: 500,
      }}
      title={info.description}
    >
      {showIcon && <span>{info.icon}</span>}
      <span>{info.label}</span>
      {showDescription && (
        <span style={{ fontSize: "0.75em", opacity: 0.8 }}>
          ({info.description})
        </span>
      )}
    </span>
  );
}
