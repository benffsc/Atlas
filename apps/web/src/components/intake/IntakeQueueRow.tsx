"use client";

import { useState, useRef } from "react";
import type { IntakeSubmission } from "@/lib/intake-types";
import { SubmissionStatusBadge, formatAge, formatDate, normalizeName } from "@/components/intake/IntakeBadges";
import { formatPhone, isValidPhone, extractPhone } from "@/lib/formatters";
import { COLORS, TYPOGRAPHY } from "@/lib/design-tokens";
import { formatEnum, TRIAGE_LABELS } from "@/lib/display-labels";

interface IntakeQueueRowProps {
  submission: IntakeSubmission;
  isSelected: boolean;
  onSelect: () => void;
  onOpenDetail: () => void;
  onOpenContactModal: () => void;
  onQuickStatus: (submissionId: string, field: string, value: string) => void;
  onSchedule: () => void;
  onChangeAppointment: () => void;
  saving: boolean;
}

export function IntakeQueueRow({
  submission: sub,
  isSelected,
  onSelect,
  onOpenDetail,
  onOpenContactModal,
  onQuickStatus,
  onSchedule,
  onChangeAppointment,
  saving,
}: IntakeQueueRowProps) {
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Priority left-border color
  const borderColor = sub.is_emergency
    ? COLORS.error
    : sub.overdue
    ? COLORS.warning
    : "transparent";

  // Primary action by status
  const primaryAction = (() => {
    if (sub.submission_status === "new" || sub.submission_status === "in_progress") {
      return { label: "Schedule", bg: COLORS.success, color: COLORS.white, onClick: onSchedule };
    }
    if (sub.submission_status === "scheduled") {
      return {
        label: "Complete",
        bg: COLORS.successLight,
        color: COLORS.black,
        onClick: () => onQuickStatus(sub.submission_id, "submission_status", "complete"),
      };
    }
    return null;
  })();

  return (
    <tr
      style={{
        background: isSelected ? COLORS.primaryLight : undefined,
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      {/* Checkbox */}
      <td style={{ textAlign: "center" }}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onSelect}
        />
      </td>

      {/* Name / Contact */}
      <td>
        <div
          style={{ fontWeight: 500, cursor: "pointer" }}
          onClick={onOpenDetail}
        >
          {normalizeName(sub.submitter_name)}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub.email}</div>
        {sub.phone && (
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", display: "flex", alignItems: "center", gap: "4px" }}>
            {formatPhone(sub.phone)}
            {!isValidPhone(sub.phone) && (
              <span
                style={{ fontSize: "0.6rem", background: COLORS.warning, color: COLORS.black, padding: "1px 4px", borderRadius: "3px", cursor: "help" }}
                title={extractPhone(sub.phone) ? `Likely: ${formatPhone(extractPhone(sub.phone))}` : "Invalid phone format"}
              >
                !
              </span>
            )}
          </div>
        )}
        {sub.is_third_party_report && (
          <span style={{ fontSize: "0.65rem", background: COLORS.warning, color: COLORS.black, padding: "1px 4px", borderRadius: "3px" }}>
            3RD PARTY
          </span>
        )}
      </td>

      {/* Address */}
      <td>
        <div style={{ cursor: "pointer" }} onClick={onOpenDetail}>
          {sub.geo_formatted_address || sub.cats_address}
        </div>
        {sub.geo_formatted_address && sub.geo_formatted_address !== sub.cats_address && (
          <div style={{ fontSize: "0.65rem", color: "var(--muted)", fontStyle: "italic" }}>
            (original: {sub.cats_address})
          </div>
        )}
        {!sub.geo_formatted_address && sub.cats_city && (
          <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub.cats_city}</div>
        )}
        {!sub.geo_formatted_address && sub.geo_confidence === null && (
          <span style={{ fontSize: "0.6rem", background: COLORS.warning, color: COLORS.black, padding: "1px 4px", borderRadius: "2px" }}>
            needs geocoding
          </span>
        )}
      </td>

      {/* Cat count */}
      <td>
        <div>{sub.cat_count_estimate ?? "?"}</div>
        {sub.has_kittens && <span style={{ fontSize: TYPOGRAPHY.size['2xs'], color: COLORS.warning }}>+kittens</span>}
      </td>

      {/* Status — simplified per FFS-108 */}
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <SubmissionStatusBadge status={sub.submission_status} />
            {sub.overdue && (
              <span
                style={{ fontSize: "0.6rem", background: COLORS.warning, color: COLORS.black, padding: "1px 4px", borderRadius: "3px" }}
                title="No activity for 48+ hours"
              >
                STALE
              </span>
            )}
          </div>
          {/* Triage category as tooltip, not inline badge (FFS-108) */}
          {sub.triage_category && (
            <span
              style={{ fontSize: "0.65rem", color: "var(--muted)", cursor: "help" }}
              title={`Triage: ${formatEnum(sub.triage_category, TRIAGE_LABELS)}${sub.triage_score ? ` (${sub.triage_score})` : ""}`}
            >
              {formatEnum(sub.triage_category, TRIAGE_LABELS)}
            </span>
          )}
          {/* Appointment date only when scheduled (FFS-108) */}
          {sub.submission_status === "scheduled" && sub.appointment_date && (
            <span style={{ fontSize: TYPOGRAPHY.size['2xs'], color: COLORS.success }}>
              {formatDate(sub.appointment_date)}
            </span>
          )}
          {sub.is_emergency && (
            <span style={{ color: COLORS.error, fontSize: TYPOGRAPHY.size['2xs'], fontWeight: TYPOGRAPHY.weight.bold }}>URGENT</span>
          )}
        </div>
      </td>

      {/* Submitted date */}
      <td style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
        {formatDate(sub.submitted_at)}
      </td>

      {/* Actions — consolidated per FFS-109 */}
      <td>
        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
          {/* Log button - always visible */}
          <button
            onClick={onOpenContactModal}
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.7rem",
              background: "#6f42c1",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
            title={sub.contact_attempt_count ? `${sub.contact_attempt_count} contact attempts` : "Log a contact attempt"}
          >
            Log {sub.contact_attempt_count ? `(${sub.contact_attempt_count})` : ""}
          </button>

          {/* Primary action button */}
          {primaryAction && (
            <button
              onClick={primaryAction.onClick}
              disabled={saving}
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.7rem",
                background: primaryAction.bg,
                color: primaryAction.color,
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {primaryAction.label}
            </button>
          )}

          {/* Overflow menu (FFS-109) */}
          <div style={{ position: "relative" }} ref={overflowRef}>
            <button
              onClick={() => setShowOverflow(!showOverflow)}
              style={{
                padding: "0.25rem 0.4rem",
                fontSize: "0.8rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
                lineHeight: 1,
              }}
              title="More actions"
            >
              ...
            </button>
            {showOverflow && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  background: "var(--background, #fff)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  zIndex: 100,
                  minWidth: "140px",
                  overflow: "hidden",
                }}
                onMouseLeave={() => setShowOverflow(false)}
              >
                {sub.submission_status === "new" && (
                  <button
                    onClick={() => { onQuickStatus(sub.submission_id, "submission_status", "in_progress"); setShowOverflow(false); }}
                    style={{ display: "block", width: "100%", padding: "0.5rem 0.75rem", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontSize: "0.8rem" }}
                  >
                    Mark Working
                  </button>
                )}
                {sub.submission_status === "scheduled" && (
                  <button
                    onClick={() => { onChangeAppointment(); setShowOverflow(false); }}
                    style={{ display: "block", width: "100%", padding: "0.5rem 0.75rem", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontSize: "0.8rem" }}
                  >
                    Edit Date
                  </button>
                )}
                <button
                  onClick={() => { onOpenDetail(); setShowOverflow(false); }}
                  style={{ display: "block", width: "100%", padding: "0.5rem 0.75rem", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontSize: "0.8rem" }}
                >
                  Details
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
