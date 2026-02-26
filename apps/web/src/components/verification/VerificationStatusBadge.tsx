"use client";

interface VerificationStatusBadgeProps {
  isVerified: boolean;
  verifiedAt?: string | null;
  verificationMethod?: string | null;
  size?: "sm" | "md" | "lg";
  showMethod?: boolean;
}

const METHOD_LABELS: Record<string, string> = {
  phone_call: "Phone",
  site_visit: "Site Visit",
  ui_button: "Manual",
  import_confirmed: "Import",
  intake_form: "Intake",
  adopter_record: "Adoption",
};

export default function VerificationStatusBadge({
  isVerified,
  verifiedAt,
  verificationMethod,
  size = "md",
  showMethod = false,
}: VerificationStatusBadgeProps) {
  const sizeStyles = {
    sm: { padding: "0.125rem 0.375rem", fontSize: "0.7rem" },
    md: { padding: "0.25rem 0.5rem", fontSize: "0.8rem" },
    lg: { padding: "0.375rem 0.75rem", fontSize: "0.9rem" },
  };

  if (isVerified) {
    const methodLabel = verificationMethod ? METHOD_LABELS[verificationMethod] || verificationMethod : null;
    const dateStr = verifiedAt ? new Date(verifiedAt).toLocaleDateString() : null;

    return (
      <span
        style={{
          ...sizeStyles[size],
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          background: "#ecfdf5",
          color: "#10b981",
          borderRadius: "4px",
          fontWeight: 500,
        }}
        title={dateStr ? `Verified on ${dateStr}${methodLabel ? ` via ${methodLabel}` : ""}` : "Verified"}
      >
        <span>✓</span>
        <span>Verified</span>
        {showMethod && methodLabel && (
          <span style={{ opacity: 0.7, fontSize: "0.85em" }}>({methodLabel})</span>
        )}
      </span>
    );
  }

  return (
    <span
      style={{
        ...sizeStyles[size],
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        background: "#fef3c7",
        color: "#d97706",
        borderRadius: "4px",
        fontWeight: 500,
      }}
      title="Not verified by staff - automated inference"
    >
      <span>⚠</span>
      <span>Unverified</span>
    </span>
  );
}
