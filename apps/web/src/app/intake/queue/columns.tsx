"use client";

/**
 * Column definitions for the Intake Queue DataTable.
 *
 * Replaces the custom table rendering in IntakeQueueRow with
 * DataTable-compatible column definitions.
 *
 * @see FFS-674
 */

import { useState } from "react";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import type { IntakeSubmission } from "@/lib/intake-types";
import {
  SubmissionStatusBadge,
  KittenPriorityBadge,
  formatDate,
  normalizeName,
} from "@/components/intake/IntakeBadges";
import { formatPhone, isValidPhone, extractPhone } from "@/lib/formatters";
import { formatEnum, TRIAGE_LABELS } from "@/lib/display-labels";
import { COLORS, TYPOGRAPHY } from "@/lib/design-tokens";

const col = createColumnHelper<IntakeSubmission>();

export interface IntakeColumnCallbacks {
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (subs: IntakeSubmission[]) => void;
  onOpenDetail: (sub: IntakeSubmission) => void;
  onOpenContactModal: (sub: IntakeSubmission) => void;
  onQuickStatus: (id: string, field: string, value: string) => void;
  onSchedule: (sub: IntakeSubmission) => void;
  onChangeAppointment: (sub: IntakeSubmission) => void;
  saving: boolean;
  allSubmissions: IntakeSubmission[];
}

export function getIntakeColumns(cb: IntakeColumnCallbacks): ColumnDef<IntakeSubmission, unknown>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ([
    // Checkbox
    col.display({
      id: "select",
      header: () => (
        <input
          type="checkbox"
          checked={cb.selectedIds.size === cb.allSubmissions.length && cb.allSubmissions.length > 0}
          onChange={() => cb.onToggleSelectAll(cb.allSubmissions)}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={cb.selectedIds.has(row.original.submission_id)}
          onChange={(e) => {
            e.stopPropagation();
            cb.onToggleSelect(row.original.submission_id);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      meta: { align: "center" as const, minWidth: "40px" },
    }),

    // Submitter
    col.accessor("submitter_name", {
      header: "Submitter",
      cell: ({ row }) => {
        const sub = row.original;
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{normalizeName(sub.submitter_name)}</div>
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
          </div>
        );
      },
      meta: { minWidth: "180px" },
    }),

    // Location
    col.accessor("geo_formatted_address", {
      header: "Location",
      cell: ({ row }) => {
        const sub = row.original;
        return (
          <div>
            <div>{sub.geo_formatted_address || sub.cats_address}</div>
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
          </div>
        );
      },
      meta: { minWidth: "200px" },
    }),

    // Cat count
    col.accessor("cat_count_estimate", {
      header: "Cats",
      cell: ({ row }) => {
        const sub = row.original;
        return (
          <div>
            <div>{sub.cat_count_estimate ?? "?"}</div>
            <KittenPriorityBadge score={sub.kitten_priority_score} hasKittens={sub.has_kittens} />
          </div>
        );
      },
      meta: { minWidth: "80px" },
    }),

    // Status
    col.accessor("submission_status", {
      header: "Status",
      cell: ({ row }) => {
        const sub = row.original;
        const isSelfService = sub.intake_followup_needed === "self_service_appointment";
        const needsTrapper = sub.trapping_assistance_requested === "true";
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
              <SubmissionStatusBadge status={sub.submission_status} />
              {sub.overdue && (
                <span
                  style={{ fontSize: "0.6rem", background: COLORS.warning, color: COLORS.black, padding: "1px 4px", borderRadius: "3px" }}
                  title="No activity for 48+ hours"
                >
                  STALE
                </span>
              )}
              {isSelfService && (
                <span
                  style={{
                    fontSize: "0.6rem",
                    background: COLORS.info,
                    color: COLORS.white,
                    padding: "1px 6px",
                    borderRadius: "3px",
                    fontWeight: 600,
                    cursor: "help",
                  }}
                  title="Self-service appointment — caller will trap on their own. Call back to schedule."
                >
                  SELF-SERVICE
                </span>
              )}
              {needsTrapper && (
                <span
                  style={{
                    fontSize: "0.6rem",
                    background: COLORS.warning,
                    color: COLORS.black,
                    padding: "1px 6px",
                    borderRadius: "3px",
                    fontWeight: 600,
                    cursor: "help",
                  }}
                  title="Explicitly requested trapping assistance"
                >
                  NEEDS TRAPPER
                </span>
              )}
            </div>
            {sub.triage_category && (
              <span
                style={{ fontSize: "0.65rem", color: "var(--muted)", cursor: "help" }}
                title={`Triage: ${formatEnum(sub.triage_category, TRIAGE_LABELS)}${sub.triage_score ? ` (${sub.triage_score})` : ""}`}
              >
                {formatEnum(sub.triage_category, TRIAGE_LABELS)}
              </span>
            )}
            {sub.submission_status === "scheduled" && sub.appointment_date && (
              <span style={{ fontSize: TYPOGRAPHY.size["2xs"], color: COLORS.success }}>
                {formatDate(sub.appointment_date)}
              </span>
            )}
            {sub.is_emergency && (
              <span style={{ color: COLORS.error, fontSize: TYPOGRAPHY.size["2xs"], fontWeight: TYPOGRAPHY.weight.bold }}>URGENT</span>
            )}
          </div>
        );
      },
      meta: { minWidth: "120px" },
    }),

    // Submitted date
    col.accessor("submitted_at", {
      header: "Submitted",
      cell: ({ getValue }) => (
        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
          {formatDate(getValue())}
        </span>
      ),
      meta: { minWidth: "80px", hideOnMobile: true },
    }),

    // Actions
    col.display({
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const sub = row.original;

        const primaryAction = (() => {
          if (sub.submission_status === "new" || sub.submission_status === "in_progress") {
            return { label: "Schedule", bg: COLORS.success, color: COLORS.white, onClick: () => cb.onSchedule(sub) };
          }
          if (sub.submission_status === "scheduled") {
            return {
              label: "Complete",
              bg: COLORS.successLight,
              color: COLORS.black,
              onClick: () => cb.onQuickStatus(sub.submission_id, "submission_status", "complete"),
            };
          }
          return null;
        })();

        return (
          <div
            style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => cb.onOpenContactModal(sub)}
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

            {primaryAction && (
              <button
                onClick={primaryAction.onClick}
                disabled={cb.saving}
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

            <IntakeOverflowMenu
              sub={sub}
              onQuickStatus={cb.onQuickStatus}
              onOpenDetail={() => cb.onOpenDetail(sub)}
              onChangeAppointment={() => cb.onChangeAppointment(sub)}
            />
          </div>
        );
      },
      meta: { minWidth: "200px" },
    }),
  ] as ColumnDef<IntakeSubmission, unknown>[]);
}

// Inline overflow menu (extracted from IntakeQueueRow for column use)
function IntakeOverflowMenu({
  sub,
  onQuickStatus,
  onOpenDetail,
  onChangeAppointment,
}: {
  sub: IntakeSubmission;
  onQuickStatus: (id: string, field: string, value: string) => void;
  onOpenDetail: () => void;
  onChangeAppointment: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
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
      {open && (
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
          onMouseLeave={() => setOpen(false)}
        >
          {sub.submission_status === "new" && (
            <button
              onClick={() => { onQuickStatus(sub.submission_id, "submission_status", "in_progress"); setOpen(false); }}
              style={{ display: "block", width: "100%", padding: "0.5rem 0.75rem", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontSize: "0.8rem" }}
            >
              Mark Working
            </button>
          )}
          {sub.submission_status === "scheduled" && (
            <button
              onClick={() => { onChangeAppointment(); setOpen(false); }}
              style={{ display: "block", width: "100%", padding: "0.5rem 0.75rem", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontSize: "0.8rem" }}
            >
              Edit Date
            </button>
          )}
          <button
            onClick={() => { onOpenDetail(); setOpen(false); }}
            style={{ display: "block", width: "100%", padding: "0.5rem 0.75rem", border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontSize: "0.8rem" }}
          >
            Details
          </button>
        </div>
      )}
    </div>
  );
}
