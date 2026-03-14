"use client";

import { useState } from "react";
import { formatPhone } from "@/lib/formatters";

interface ContactInfoCardProps {
  email: string | null | undefined;
  phone: string | null | undefined;
  address?: string | null;
  addressPlaceId?: string | null;
  /** Show copy buttons (used in detail headers) */
  showCopy?: boolean;
  /** Compact mode for roster/table display */
  compact?: boolean;
}

/**
 * Displays contact info (email, phone, address) with optional copy buttons.
 * Used in both person detail header and trapper detail header.
 */
export function ContactInfoCard({
  email,
  phone,
  address,
  addressPlaceId,
  showCopy = false,
  compact = false,
}: ContactInfoCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (!phone && !email && !address) {
    return <span style={{ color: "#999", fontSize: compact ? "0.8rem" : "0.875rem" }}>No contact info</span>;
  }

  if (compact) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
        {phone && (
          <a
            href={`tel:${phone}`}
            style={{ fontSize: "0.8rem", color: "#0d6efd", textDecoration: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            {formatPhone(phone)}
          </a>
        )}
        {email && (
          <a
            href={`mailto:${email}`}
            style={{ fontSize: "0.75rem", color: "#6c757d", textDecoration: "none" }}
            title={email}
            onClick={(e) => e.stopPropagation()}
          >
            {email.length > 24 ? email.slice(0, 22) + "..." : email}
          </a>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
      {email && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <a href={`mailto:${email}`} style={{ fontSize: "0.875rem" }}>{email}</a>
          {showCopy && (
            <button
              onClick={() => copyToClipboard(email, "email")}
              title="Copy email"
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: "0.75rem", color: copiedField === "email" ? "#16a34a" : "#9ca3af",
                padding: "0.125rem 0.25rem",
              }}
            >
              {copiedField === "email" ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      )}
      {phone && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <a href={`tel:${phone.replace(/\D/g, "")}`} style={{ fontSize: "0.875rem" }}>
            {formatPhone(phone)}
          </a>
          {showCopy && (
            <button
              onClick={() => copyToClipboard(phone, "phone")}
              title="Copy phone"
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: "0.75rem", color: copiedField === "phone" ? "#16a34a" : "#9ca3af",
                padding: "0.125rem 0.25rem",
              }}
            >
              {copiedField === "phone" ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      )}
      {!email && !phone && (
        <span className="text-muted" style={{ fontSize: "0.875rem" }}>No contact info on file</span>
      )}
      {address && (
        <div style={{ fontSize: "0.875rem" }}>
          {addressPlaceId ? (
            <a href={`/places/${addressPlaceId}`} style={{ color: "var(--primary)", textDecoration: "none" }}>
              {address}
            </a>
          ) : (
            <span>{address}</span>
          )}
        </div>
      )}
    </div>
  );
}
