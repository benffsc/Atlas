"use client";

import Link from "next/link";
import { formatPhone } from "@/lib/formatters";

interface PersonInfo {
  personId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isSiteContact?: boolean | null;
}

interface ContactCardProps {
  /** Requester information */
  requester?: PersonInfo | null;
  /** Site contact information (if different from requester) */
  siteContact?: PersonInfo | null;
  /** Callback when email button is clicked */
  onEmailClick?: () => void;
  /** Callback when call link is clicked (optional, defaults to tel: link) */
  onCallClick?: () => void;
  /** Optional title for the card */
  title?: string;
  /** Optional additional class names */
  className?: string;
}

/**
 * ContactCard - Prominent contact information display
 *
 * Inspired by Airtable's contact-first design, this component displays
 * requester and site contact information prominently with quick action buttons.
 *
 * Features:
 * - Two-column layout for requester + site contact
 * - Role badges
 * - Quick action buttons (Email, Call)
 * - Responsive: stacks on mobile
 */
export default function ContactCard({
  requester,
  siteContact,
  onEmailClick,
  onCallClick,
  title = "Contact Information",
  className = "",
}: ContactCardProps) {
  // Check if site contact is actually different from requester
  const hasDifferentSiteContact =
    siteContact &&
    siteContact.personId &&
    siteContact.personId !== requester?.personId;

  // Get the primary phone for call action
  const primaryPhone = requester?.phone || siteContact?.phone;
  const primaryEmail = requester?.email || siteContact?.email;

  return (
    <div
      className={`contact-card ${className}`}
      style={{
        background: "var(--card-bg, #fff)",
        border: "1px solid var(--border, #e5e7eb)",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0.75rem 1rem",
          background: "linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)",
          color: "#fff",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "0.9rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontSize: "1rem" }}>👤</span>
          {title}
        </h3>
      </div>

      {/* Content */}
      <div style={{ padding: "1rem" }}>
        {/* Contacts Grid */}
        <div
          className="contacts-grid"
          style={{
            display: "grid",
            gridTemplateColumns: hasDifferentSiteContact ? "1fr 1fr" : "1fr",
            gap: "1rem",
          }}
        >
          {/* Requester */}
          {requester && (requester.name || requester.email || requester.phone) && (
            <PersonCard
              label="Requester"
              person={requester}
              showSiteContactBadge={requester.isSiteContact === true}
            />
          )}

          {/* Site Contact (if different) */}
          {hasDifferentSiteContact && (
            <PersonCard label="Site Contact" person={siteContact!} />
          )}

          {/* Empty state */}
          {!requester?.name && !requester?.email && !requester?.phone && !hasDifferentSiteContact && (
            <div
              style={{
                color: "var(--muted)",
                fontStyle: "italic",
                textAlign: "center",
                padding: "1rem",
              }}
            >
              No contact information available
            </div>
          )}
        </div>

        {/* Action Buttons */}
        {(primaryEmail || primaryPhone) && (
          <div
            className="contact-actions"
            style={{
              display: "flex",
              gap: "0.5rem",
              marginTop: "1rem",
              paddingTop: "1rem",
              borderTop: "1px solid var(--border, #e5e7eb)",
            }}
          >
            {primaryEmail && (
              <button
                onClick={onEmailClick}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  padding: "0.625rem 1rem",
                  background: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: 500,
                  fontSize: "0.875rem",
                  minHeight: "44px", // Touch-friendly
                }}
              >
                <span>✉️</span> Email
              </button>
            )}

            {primaryPhone && (
              <a
                href={`tel:${primaryPhone.replace(/\D/g, "")}`}
                onClick={onCallClick}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  padding: "0.625rem 1rem",
                  background: "#10b981",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: 500,
                  fontSize: "0.875rem",
                  textDecoration: "none",
                  minHeight: "44px", // Touch-friendly
                }}
              >
                <span>📞</span> Call
              </a>
            )}
          </div>
        )}
      </div>

      {/* Responsive styles */}
      <style jsx>{`
        @media (max-width: 640px) {
          .contacts-grid {
            grid-template-columns: 1fr !important;
          }
          .contact-actions {
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Individual person card within the ContactCard
 */
function PersonCard({
  label,
  person,
  showSiteContactBadge = false,
}: {
  label: string;
  person: PersonInfo;
  showSiteContactBadge?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--card-bg-secondary, #f9fafb)",
        borderRadius: "8px",
        padding: "0.875rem",
      }}
    >
      {/* Label */}
      <div
        style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "0.5rem",
        }}
      >
        {label}
      </div>

      {/* Name */}
      <div style={{ marginBottom: "0.5rem" }}>
        {person.personId ? (
          <Link
            href={`/people/${person.personId}`}
            style={{
              fontWeight: 600,
              fontSize: "1rem",
              color: "#3b82f6",
              textDecoration: "none",
            }}
          >
            {person.name || "Unknown"}
          </Link>
        ) : (
          <span style={{ fontWeight: 600, fontSize: "1rem" }}>
            {person.name || "Unknown"}
          </span>
        )}
      </div>

      {/* Role Badge */}
      {(person.role || showSiteContactBadge) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginBottom: "0.5rem" }}>
          {person.role && (
            <span
              style={{
                display: "inline-block",
                padding: "0.125rem 0.5rem",
                background: getRoleBadgeColor(person.role),
                color: "#fff",
                borderRadius: "9999px",
                fontSize: "0.7rem",
                fontWeight: 500,
                textTransform: "capitalize",
              }}
            >
              {formatRole(person.role)}
            </span>
          )}
          {showSiteContactBadge && (
            <span
              style={{
                display: "inline-block",
                padding: "0.125rem 0.5rem",
                background: "#10b981",
                color: "#fff",
                borderRadius: "9999px",
                fontSize: "0.7rem",
                fontWeight: 500,
              }}
            >
              Also Site Contact
            </span>
          )}
        </div>
      )}

      {/* Contact Details */}
      <div style={{ fontSize: "0.875rem" }}>
        {person.phone && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              marginBottom: "0.25rem",
            }}
          >
            <span style={{ opacity: 0.6 }}>📞</span>
            <a
              href={`tel:${person.phone.replace(/\D/g, "")}`}
              style={{ color: "inherit", textDecoration: "none" }}
            >
              {formatPhone(person.phone)}
            </a>
          </div>
        )}
        {person.email && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
            }}
          >
            <span style={{ opacity: 0.6 }}>✉️</span>
            <a
              href={`mailto:${person.email}`}
              style={{
                color: "inherit",
                textDecoration: "none",
                wordBreak: "break-all",
              }}
            >
              {person.email}
            </a>
          </div>
        )}
        {!person.phone && !person.email && (
          <div style={{ color: "var(--muted)", fontStyle: "italic", fontSize: "0.8rem" }}>
            No contact details
          </div>
        )}
      </div>
    </div>
  );
}

// Helper to get role badge color
function getRoleBadgeColor(role: string): string {
  const colors: Record<string, string> = {
    owner: "#3b82f6",
    resident: "#8b5cf6",
    property_manager: "#f59e0b",
    neighbor: "#6b7280",
    caretaker: "#10b981",
    trapper: "#ec4899",
    staff: "#ef4444",
    feeder: "#06b6d4",
  };
  return colors[role.toLowerCase()] || "#6b7280";
}

// Helper to format role for display
function formatRole(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
