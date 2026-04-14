"use client";

import { useState, useEffect } from "react";
import { PlaceResolver } from "@/components/forms";
import { ResolvedPlace } from "@/hooks/usePlaceResolver";
import { formatPhone, isValidPhone, extractPhone, extractPhones } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";
import type { IntakeSubmission, CommunicationLog, StaffMember } from "@/lib/intake-types";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { useToast } from "@/components/feedback/Toast";
import {
  CONTACT_METHODS,
  CONTACT_RESULTS,
  UNIFIED_STATUSES,
  PRIORITY_OPTIONS,
  URGENT_DOWNGRADE_REASONS,
} from "@/lib/intake-types";
import {
  SubmissionStatusBadge,
  KittenPriorityBadge,
  formatDate,
  normalizeName,
} from "@/components/intake/IntakeBadges";
import { KITTEN_ASSESSMENT_OUTCOME_OPTIONS } from "@/lib/form-options";
import { getKittenPriorityTier, KITTEN_PRIORITY_LABELS } from "@/lib/display-labels";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS } from "@/lib/design-tokens";
import { OutOfServiceAreaBanner } from "@/components/intake/OutOfServiceAreaBanner";
import { SendOutOfServiceConfirmModal } from "@/components/intake/SendOutOfServiceConfirmModal";
import { EmailSuggestionBanner } from "@/components/intake/EmailSuggestionBanner";
import { useEmailSuggestions, type EmailSuggestion } from "@/hooks/useEmailSuggestions";
import { ActionDrawer } from "@/components/shared/ActionDrawer";

export interface IntakeDetailPanelProps {
  submission: IntakeSubmission;
  currentUser: { staff_id: string; display_name: string } | null;
  staffList: StaffMember[];
  saving: boolean;
  setSaving: (v: boolean) => void;
  onClose: () => void;
  onRefresh: () => void;
  onSubmissionUpdate: (updated: IntakeSubmission) => void;
  onOpenContactModal: (sub: IntakeSubmission) => void;
  onOpenBookingModal: (sub: IntakeSubmission) => void;
  onOpenDeclineModal: (sub: IntakeSubmission) => void;
  onChangeAppointment: (sub: IntakeSubmission) => void;
  onQuickStatus: (submissionId: string, field: string, value: string) => Promise<void>;
  onArchive: (submissionId: string) => Promise<void>;
  isMobile?: boolean;
}

export function IntakeDetailPanel({
  submission,
  currentUser,
  staffList,
  saving,
  setSaving,
  onClose,
  onRefresh,
  onSubmissionUpdate,
  onOpenContactModal,
  onOpenBookingModal,
  onOpenDeclineModal,
  onChangeAppointment,
  onQuickStatus,
  onArchive,
  isMobile = false,
}: IntakeDetailPanelProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  // Status editing state
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusEdits, setStatusEdits] = useState({
    submission_status: submission.submission_status || "new",
    appointment_date: submission.appointment_date || "",
    priority_override: submission.priority_override || "",
    legacy_status: submission.legacy_status || "",
    legacy_submission_status: submission.legacy_submission_status || "",
    legacy_appointment_date: submission.legacy_appointment_date || "",
    legacy_notes: submission.legacy_notes || "",
  });

  // Address edit state
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressEdits, setAddressEdits] = useState({
    cats_address: "",
    cats_city: "",
    cats_zip: "",
  });
  const [resolvedQueuePlace, setResolvedQueuePlace] = useState<ResolvedPlace | null>(null);

  // Cats editing state
  const [editingCats, setEditingCats] = useState(false);
  const [catsEdits, setCatsEdits] = useState({
    cat_count_estimate: "",
    ownership_status: "",
    fixed_status: "",
    has_kittens: false,
    has_medical_concerns: false,
  });

  // Situation editing state
  const [editingSituation, setEditingSituation] = useState(false);
  const [situationEdit, setSituationEdit] = useState("");

  // Saving section state
  const [savingSection, setSavingSection] = useState(false);

  // Contact info editing state
  const [editingContact, setEditingContact] = useState(false);
  const [contactEdits, setContactEdits] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });

  // Urgent downgrade state
  const [showUrgentDowngrade, setShowUrgentDowngrade] = useState(false);
  const [urgentDowngradeReason, setUrgentDowngradeReason] = useState("");
  const [savingUrgentDowngrade, setSavingUrgentDowngrade] = useState(false);

  // Kitten assessment state (FFS-559)
  const [showKittenAssessment, setShowKittenAssessment] = useState(false);
  const [kittenOutcome, setKittenOutcome] = useState(submission.kitten_assessment_outcome || "");
  const [kittenRedirectDest, setKittenRedirectDest] = useState(submission.kitten_redirect_destination || "");
  const [savingKittenAssessment, setSavingKittenAssessment] = useState(false);

  // FFS-1187 — out-of-service-area UI state
  const [showOoaConfirm, setShowOoaConfirm] = useState(false);
  const [showOoaPreview, setShowOoaPreview] = useState(false);
  const [ooaPreviewHtml, setOoaPreviewHtml] = useState<string | null>(null);
  const [ooaPreviewSubject, setOoaPreviewSubject] = useState<string | null>(null);
  const [ooaPreviewLoading, setOoaPreviewLoading] = useState(false);
  const [ooaSending, setOoaSending] = useState(false);
  const [ooaSuppressed, setOoaSuppressed] = useState(false);

  // Config-driven email suggestions (Phase 2 — MIG_3078)
  const { suggestions: emailSuggestions } = useEmailSuggestions(submission, ooaSuppressed);

  // Inline contact form state
  const [showInlineContactForm, setShowInlineContactForm] = useState<"note" | "call" | null>(null);
  const [contactForm, setContactForm] = useState({
    contact_method: "phone",
    contact_result: "answered",
    notes: "",
    contacted_by: "",
    is_journal_only: false,
  });

  // Communication logs state
  const [communicationLogs, setCommunicationLogs] = useState<CommunicationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Edit history state
  const [editHistory, setEditHistory] = useState<Array<{
    edit_id: string;
    field_name: string;
    old_value: unknown;
    new_value: unknown;
    edited_at: string;
    edited_by: string;
    edit_reason: string | null;
  }>>([]);
  const [showEditHistory, setShowEditHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: "default" | "danger";
    onConfirm: () => void;
  }>({ open: false, title: "", message: "", onConfirm: () => {} });

  // Reset editing states when submission changes
  useEffect(() => {
    setEditingAddress(false);
    setResolvedQueuePlace(null);
    setShowInlineContactForm(null);
    setEditingStatus(false);
    setEditingCats(false);
    setEditingSituation(false);
    setEditingContact(false);
    setShowEditHistory(false);
    setEditHistory([]);
    setShowKittenAssessment(false);
    setKittenOutcome(submission.kitten_assessment_outcome || "");
    setKittenRedirectDest(submission.kitten_redirect_destination || "");
    setStatusEdits({
      submission_status: submission.submission_status || "new",
      appointment_date: submission.appointment_date || "",
      priority_override: submission.priority_override || "",
      legacy_status: submission.legacy_status || "",
      legacy_submission_status: submission.legacy_submission_status || "",
      legacy_appointment_date: submission.legacy_appointment_date || "",
      legacy_notes: submission.legacy_notes || "",
    });
  }, [submission.submission_id]);

  // Fetch communication logs when submission changes
  useEffect(() => {
    if (submission.submission_id) {
      fetchCommunicationLogs(submission.submission_id);
    } else {
      setCommunicationLogs([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission.submission_id]);

  // Fetch communication logs for a submission
  const fetchCommunicationLogs = async (submissionId: string) => {
    setLoadingLogs(true);
    try {
      const data = await fetchApi<{ logs: CommunicationLog[] }>(`/api/intake/${submissionId}/communications`);
      setCommunicationLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch communication logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Submit inline contact/journal entry
  const handleInlineContactSubmit = async () => {
    setSaving(true);
    try {
      await postApi(`/api/intake/${submission.submission_id}/communications`, contactForm);
      // Refresh logs
      fetchCommunicationLogs(submission.submission_id);
      onRefresh();
      // Reset form and close inline form
      setContactForm({
        ...contactForm,
        notes: "",
        is_journal_only: false,
      });
      setShowInlineContactForm(null);
      toastSuccess("Entry added successfully");
    } catch (err) {
      console.error("Failed to submit contact log:", err);
    } finally {
      setSaving(false);
    }
  };

  const fetchEditHistory = async (submissionId: string) => {
    setLoadingHistory(true);
    try {
      const data = await fetchApi<{ history: typeof editHistory }>(`/api/intake/queue/${submissionId}/history`);
      setEditHistory(data.history || []);
    } catch (err) {
      console.error("Failed to fetch edit history:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Handler for removing urgent flag with reason
  const handleUrgentDowngrade = async () => {
    if (!urgentDowngradeReason) return;
    setSavingUrgentDowngrade(true);

    const reasonInfo = URGENT_DOWNGRADE_REASONS.find(r => r.value === urgentDowngradeReason);
    const noteText = `Urgent flag removed: ${reasonInfo?.label} - ${reasonInfo?.description}`;

    try {
      await postApi(`/api/intake/queue/${submission.submission_id}`, {
        is_emergency: false,
        review_notes: submission.review_notes
          ? `${submission.review_notes}\n\n[${new Date().toLocaleDateString()}] ${noteText}`
          : `[${new Date().toLocaleDateString()}] ${noteText}`,
      }, { method: "PATCH" });

      setShowUrgentDowngrade(false);
      setUrgentDowngradeReason("");
      onSubmissionUpdate({
        ...submission,
        is_emergency: false,
      });
      onRefresh();
    } catch (err) {
      console.error("Failed to remove urgent flag:", err);
    } finally {
      setSavingUrgentDowngrade(false);
    }
  };

  // ── FFS-1187 — Out-of-service-area handlers ─────────────────────────────
  const handleOoaPreview = async () => {
    setOoaPreviewLoading(true);
    setShowOoaPreview(true);
    try {
      const data = await fetchApi<{
        subject: string;
        body_html: string;
      }>(`/api/emails/preview-out-of-service-area?submission_id=${submission.submission_id}`);
      setOoaPreviewSubject(data.subject);
      setOoaPreviewHtml(data.body_html);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to load preview");
      setShowOoaPreview(false);
    } finally {
      setOoaPreviewLoading(false);
    }
  };

  const handleOoaApprove = async () => {
    // Open confirm modal — actual send happens in handleOoaSendConfirmed
    setShowOoaConfirm(true);
  };

  const handleOoaSendConfirmed = async () => {
    setOoaSending(true);
    try {
      // The send route handles approval + send + (in dry-run) logging in one
      // atomic flow. The Phase 5 dry-run / test-override layers are honored
      // inside sendTemplateEmail — we just check the response.
      const result = await postApi<{
        success: boolean;
        message: string;
        dry_run: boolean;
      }>("/api/emails/send-out-of-service-area", {
        submission_id: submission.submission_id,
      });

      toastSuccess(
        result.dry_run
          ? "Dry-run complete — email logged but not sent"
          : "Email sent successfully"
      );

      setShowOoaConfirm(false);
      onRefresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setOoaSending(false);
    }
  };

  const handleOoaOverride = async (newStatus: "in" | "out") => {
    try {
      await postApi(
        `/api/intake/${submission.submission_id}/service-area-override`,
        { status: newStatus }
      );
      toastSuccess(
        newStatus === "in"
          ? "Marked as in-service"
          : "Marked as out-of-service"
      );
      onRefresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to override");
    }
  };

  // Config-driven email suggestion handlers (reuse existing OoA handlers for now)
  const handleSuggestionPreview = (suggestion: EmailSuggestion) => {
    // For out_of_service_area flow, reuse the existing preview handler
    if (suggestion.rule.flow_slug === "out_of_service_area") {
      handleOoaPreview();
    }
  };

  const handleSuggestionSend = (suggestion: EmailSuggestion) => {
    // For out_of_service_area flow, reuse the existing approve handler
    if (suggestion.rule.flow_slug === "out_of_service_area") {
      handleOoaApprove();
    }
  };

  const handleSaveAddress = async () => {
    if (!addressEdits.cats_address.trim()) {
      toastError("Street address is required");
      return;
    }
    setSaving(true);
    try {
      const data = await postApi<{ submission?: IntakeSubmission; address_relinked?: boolean }>(`/api/intake/queue/${submission.submission_id}`, {
        cats_address: addressEdits.cats_address.trim(),
        cats_city: addressEdits.cats_city.trim() || null,
        cats_zip: addressEdits.cats_zip.trim() || null,
      }, { method: "PATCH" });

      setEditingAddress(false);
      // Update local state with refreshed submission data
      if (data.submission) {
        onSubmissionUpdate(data.submission);
      }
      // Show success message
      if (data.address_relinked) {
        toastSuccess("Address updated and re-linked to place");
      } else {
        toastSuccess("Address updated");
      }
      onRefresh();
    } catch (err) {
      console.error("Failed to save address:", err);
      toastError("Failed to save address");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        flex: isMobile ? "1" : "0 0 55%",
        borderLeft: isMobile ? "none" : "1px solid var(--border)",
        background: "var(--background)",
        overflow: "auto",
        padding: isMobile ? "1rem 0.75rem" : "1.5rem",
        position: "relative",
      }}
    >
      {/* Back / Close button */}
      <button
        onClick={onClose}
        style={{
          position: isMobile ? "relative" : "absolute",
          top: isMobile ? undefined : "1rem",
          right: isMobile ? undefined : "1rem",
          background: "transparent",
          border: "none",
          fontSize: isMobile ? "0.9rem" : "1.5rem",
          cursor: "pointer",
          color: "var(--muted)",
          padding: isMobile ? "0.5rem 0" : "0.25rem 0.5rem",
          lineHeight: 1,
          marginBottom: isMobile ? "0.5rem" : undefined,
        }}
        title="Close panel (Esc)"
      >
        {isMobile ? "← Back to queue" : "×"}
      </button>
      <div>
        {/* Header with Contact Editing */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
          <div style={{ flex: 1 }}>
            {editingContact ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.125rem" }}>First Name</label>
                    <input
                      type="text"
                      value={contactEdits.first_name}
                      onChange={(e) => setContactEdits({ ...contactEdits, first_name: e.target.value })}
                      style={{ width: "100%", padding: "0.375rem", fontSize: "0.9rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.125rem" }}>Last Name</label>
                    <input
                      type="text"
                      value={contactEdits.last_name}
                      onChange={(e) => setContactEdits({ ...contactEdits, last_name: e.target.value })}
                      style={{ width: "100%", padding: "0.375rem", fontSize: "0.9rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                    />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.125rem" }}>Email</label>
                    <input
                      type="email"
                      value={contactEdits.email}
                      onChange={(e) => setContactEdits({ ...contactEdits, email: e.target.value })}
                      style={{ width: "100%", padding: "0.375rem", fontSize: "0.9rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.7rem", color: "var(--muted)", marginBottom: "0.125rem" }}>
                      Phone
                      {contactEdits.phone && !isValidPhone(contactEdits.phone) && (
                        <span style={{ color: COLORS.error, marginLeft: "4px" }}>⚠ Invalid</span>
                      )}
                    </label>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      <input
                        type="tel"
                        value={contactEdits.phone}
                        onChange={(e) => setContactEdits({ ...contactEdits, phone: e.target.value })}
                        style={{
                          flex: 1,
                          minWidth: "140px",
                          padding: "0.375rem",
                          fontSize: "0.9rem",
                          borderRadius: "4px",
                          border: `1px solid ${contactEdits.phone && !isValidPhone(contactEdits.phone) ? "#dc3545" : "var(--border)"}`,
                        }}
                      />
                      {contactEdits.phone && !isValidPhone(contactEdits.phone) && (() => {
                        const phones = extractPhones(contactEdits.phone);
                        if (phones.length === 0) return null;
                        if (phones.length === 1) {
                          return (
                            <button
                              type="button"
                              onClick={() => setContactEdits({ ...contactEdits, phone: phones[0] })}
                              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: COLORS.success, color: COLORS.white, border: "none", borderRadius: "4px", cursor: "pointer" }}
                              title={`Fix to: ${formatPhone(phones[0])}`}
                            >
                              Fix
                            </button>
                          );
                        }
                        // Multiple phones found - show options
                        return phones.map((p, i) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setContactEdits({ ...contactEdits, phone: p })}
                            style={{ padding: "0.25rem 0.5rem", fontSize: "0.7rem", background: i === 0 ? COLORS.success : COLORS.primary, color: COLORS.white, border: "none", borderRadius: "4px", cursor: "pointer" }}
                            title={`Use: ${formatPhone(p)}`}
                          >
                            {i === 0 ? "Primary" : `Alt ${i}`}: {formatPhone(p)}
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem" }}>
                  <button
                    onClick={async () => {
                      setSavingSection(true);
                      try {
                        const data = await postApi<{ submission: IntakeSubmission }>(`/api/intake/queue/${submission.submission_id}`, {
                          first_name: contactEdits.first_name || null,
                          last_name: contactEdits.last_name || null,
                          email: contactEdits.email || null,
                          phone: contactEdits.phone || null,
                        }, { method: "PATCH" });
                        // Update local state with new name constructed from first/last
                        const newName = `${contactEdits.first_name || ""} ${contactEdits.last_name || ""}`.trim();
                        onSubmissionUpdate({
                          ...submission,
                          ...data.submission,
                          submitter_name: newName || submission.submitter_name,
                          email: contactEdits.email || submission.email,
                          phone: contactEdits.phone || submission.phone,
                        });
                        setEditingContact(false);
                        onRefresh();
                      } catch (err) {
                        console.error("Failed to save contact:", err);
                      } finally {
                        setSavingSection(false);
                      }
                    }}
                    disabled={savingSection}
                    style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: COLORS.success, color: COLORS.white, border: "none", borderRadius: "4px", cursor: "pointer" }}
                  >
                    {savingSection ? "..." : "Save"}
                  </button>
                  <button
                    onClick={() => setEditingContact(false)}
                    style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <h2 style={{ margin: 0 }}>{normalizeName(submission.submitter_name)}</h2>
                  <button
                    onClick={() => {
                      // Parse submitter_name into first/last name
                      const nameParts = (submission.submitter_name || "").trim().split(" ");
                      const firstName = nameParts[0] || "";
                      const lastName = nameParts.slice(1).join(" ") || "";
                      setContactEdits({
                        first_name: submission.first_name || firstName,
                        last_name: submission.last_name || lastName,
                        email: submission.email || "",
                        phone: submission.phone || "",
                      });
                      setEditingContact(true);
                    }}
                    style={{ padding: "0.125rem 0.375rem", fontSize: "0.7rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", color: "var(--muted)" }}
                    title="Edit contact info"
                  >
                    Edit
                  </button>
                </div>
                <p style={{ color: "var(--muted)", margin: "0.25rem 0", fontSize: "0.9rem" }}>
                  {submission.email}
                  {submission.phone && (
                    <>
                      {` | ${formatPhone(submission.phone)}`}
                      {!isValidPhone(submission.phone) && (
                        <span
                          style={{ fontSize: "0.7rem", background: COLORS.warning, color: COLORS.black, padding: "1px 4px", borderRadius: "3px", marginLeft: "4px", cursor: "help" }}
                          title={extractPhone(submission.phone) ? `Click Edit to fix. Likely: ${formatPhone(extractPhone(submission.phone))}` : "Invalid phone - click Edit to correct"}
                        >
                          ⚠ Invalid
                        </span>
                      )}
                    </>
                  )}
                </p>
              </>
            )}
            {submission.matched_person_id && (
              <div style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--muted)" }}>Matched to: </span>
                <a href={`/people/${submission.matched_person_id}`}
                   style={{ color: "var(--primary, #3b82f6)", textDecoration: "none", fontWeight: 500 }}>
                  View Person Profile →
                </a>
              </div>
            )}
            <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.8rem" }}>
              Submitted {formatDate(submission.submitted_at)}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {submission.is_test && (
              <span style={{ background: COLORS.error, color: COLORS.white, padding: "0.25rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: "bold" }}>
                TEST
              </span>
            )}
            {submission.is_legacy && (
              <span style={{ background: COLORS.gray500, color: COLORS.white, padding: "0.25rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem" }}>
                Legacy
              </span>
            )}
            <SubmissionStatusBadge status={submission.submission_status} />
          </div>
        </div>

        {/* FFS-1187 — Out-of-Service-Area banner (hardcoded fallback) */}
        <OutOfServiceAreaBanner
          submission={submission}
          onPreviewEmail={handleOoaPreview}
          onApproveAndSend={handleOoaApprove}
          onOverride={handleOoaOverride}
          isSuppressed={ooaSuppressed}
        />

        {/* Config-driven email suggestions (Phase 2 — MIG_3078) */}
        {emailSuggestions
          .filter((s) => s.rule.flow_slug !== "out_of_service_area") // OoA has its own banner above
          .map((suggestion) => (
            <EmailSuggestionBanner
              key={suggestion.rule.rule_id}
              suggestion={suggestion}
              onPreview={handleSuggestionPreview}
              onSend={handleSuggestionSend}
            />
          ))}

        {submission.is_emergency ? (
          <div style={{ background: "rgba(220, 53, 69, 0.15)", padding: "0.75rem", borderRadius: "8px", marginBottom: "1rem", border: "1px solid rgba(220, 53, 69, 0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ color: COLORS.error, fontWeight: "bold" }}>MARKED AS URGENT</span>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "#856404" }}>
                  True emergencies (injury, illness) should be referred to a pet hospital. We are a spay/neuter clinic, not an emergency vet.
                </p>
              </div>
              <button
                onClick={() => setShowUrgentDowngrade(true)}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.8rem",
                  background: "var(--background)",
                  border: `1px solid ${COLORS.error}`,
                  color: COLORS.error,
                  borderRadius: "4px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Remove Urgent Flag
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={async () => {
              try {
                const data = await postApi<{ submission: IntakeSubmission }>(`/api/intake/queue/${submission.submission_id}`, { is_emergency: true }, { method: "PATCH" });
                onSubmissionUpdate({ ...submission, ...data.submission, is_emergency: true });
                onRefresh();
              } catch (err) {
                console.error("Failed to mark as urgent:", err);
              }
            }}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.8rem",
              background: "transparent",
              border: `1px dashed ${COLORS.error}`,
              color: COLORS.error,
              borderRadius: "4px",
              cursor: "pointer",
              marginBottom: "1rem",
            }}
          >
            + Mark as Urgent
          </button>
        )}

        {/* Urgent downgrade reason picker */}
        {showUrgentDowngrade && (
          <div style={{
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}>
            <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>Why is this not urgent?</h4>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>
              Select a reason to help track common misunderstandings and improve our intake form.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
              {URGENT_DOWNGRADE_REASONS.map((reason) => (
                <label
                  key={reason.value}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.5rem",
                    padding: "0.5rem",
                    background: urgentDowngradeReason === reason.value ? "rgba(25, 135, 84, 0.1)" : "var(--bg-muted, #f8f9fa)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    border: urgentDowngradeReason === reason.value ? "1px solid #198754" : "1px solid transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="urgentReason"
                    value={reason.value}
                    checked={urgentDowngradeReason === reason.value}
                    onChange={(e) => setUrgentDowngradeReason(e.target.value)}
                    style={{ marginTop: "0.2rem" }}
                  />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: "0.85rem" }}>{reason.label}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{reason.description}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowUrgentDowngrade(false);
                  setUrgentDowngradeReason("");
                }}
                style={{ padding: "0.375rem 0.75rem", fontSize: "0.85rem" }}
              >
                Cancel
              </button>
              <button
                onClick={handleUrgentDowngrade}
                disabled={!urgentDowngradeReason || savingUrgentDowngrade}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.85rem",
                  background: urgentDowngradeReason ? COLORS.success : COLORS.gray500,
                  color: COLORS.white,
                  border: "none",
                  borderRadius: "4px",
                  cursor: urgentDowngradeReason ? "pointer" : "not-allowed",
                }}
              >
                {savingUrgentDowngrade ? "Saving..." : "Remove Urgent Flag"}
              </button>
            </div>
          </div>
        )}

        {/* Status Section - Unified workflow */}
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "1rem" }}>Status & Priority</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            {/* Status dropdown - always visible, saves on change */}
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Status</label>
              <select
                value={statusEdits.submission_status || submission.submission_status || "new"}
                onChange={async (e) => {
                  const newStatus = e.target.value;
                  setStatusEdits({ ...statusEdits, submission_status: newStatus });
                  // Auto-save on change
                  try {
                    const data = await postApi<{ submission: IntakeSubmission }>(`/api/intake/queue/${submission.submission_id}`, { submission_status: newStatus }, { method: "PATCH" });
                    onSubmissionUpdate({ ...submission, ...data.submission, submission_status: newStatus });
                    onRefresh();
                  } catch (err) {
                    console.error("Failed to update status:", err);
                  }
                }}
                style={{ width: "100%", padding: "0.5rem", fontWeight: 500 }}
              >
                {UNIFIED_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Priority dropdown */}
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                Priority {submission.triage_score && !statusEdits.priority_override && (
                  <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                    (Score: {submission.triage_score})
                  </span>
                )}
              </label>
              <select
                value={statusEdits.priority_override || submission.priority_override || ""}
                onChange={async (e) => {
                  const newPriority = e.target.value;
                  setStatusEdits({ ...statusEdits, priority_override: newPriority });
                  // Auto-save on change
                  try {
                    const data = await postApi<{ submission: IntakeSubmission }>(`/api/intake/queue/${submission.submission_id}`, { priority_override: newPriority || null }, { method: "PATCH" });
                    onSubmissionUpdate({ ...submission, ...data.submission, priority_override: newPriority || null });
                    onRefresh();
                  } catch (err) {
                    console.error("Failed to update priority:", err);
                  }
                }}
                style={{ width: "100%", padding: "0.5rem" }}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Appointment date - shown when status is scheduled */}
            {(statusEdits.submission_status === "scheduled" || submission.submission_status === "scheduled") && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>Appointment Date</label>
                <input
                  type="date"
                  value={statusEdits.appointment_date || submission.appointment_date || ""}
                  onChange={async (e) => {
                    const newDate = e.target.value;
                    setStatusEdits({ ...statusEdits, appointment_date: newDate });
                    // Auto-save on change
                    try {
                      const data = await postApi<{ submission: IntakeSubmission }>(`/api/intake/queue/${submission.submission_id}`, { appointment_date: newDate || null }, { method: "PATCH" });
                      onSubmissionUpdate({ ...submission, ...data.submission, appointment_date: newDate || null });
                      onRefresh();
                    } catch (err) {
                      console.error("Failed to update appointment:", err);
                    }
                  }}
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>
            )}
          </div>

          {/* Legacy status section - collapsible for backward compatibility */}
          {submission.is_legacy && (
            <details style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
                Legacy Status Fields
              </summary>
              <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "rgba(0,0,0,0.03)", borderRadius: "4px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div><strong>Contact:</strong> {submission.legacy_status || "(none)"}</div>
                  <div><strong>Status:</strong> {submission.legacy_submission_status || "(none)"}</div>
                  {submission.legacy_appointment_date && (
                    <div><strong>Appt:</strong> {formatDate(submission.legacy_appointment_date)}</div>
                  )}
                </div>
              </div>
            </details>
          )}
        </div>

        {/* Location */}
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Location</h3>
            {!editingAddress ? (
              <button
                onClick={() => {
                  setAddressEdits({
                    cats_address: submission.cats_address || "",
                    cats_city: submission.cats_city || "",
                    cats_zip: "",
                  });
                  setEditingAddress(true);
                }}
                style={{
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.75rem",
                  background: "transparent",
                  border: "1px solid var(--muted)",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Edit Address
              </button>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => setEditingAddress(false)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem",
                    background: "transparent",
                    border: "1px solid var(--muted)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAddress}
                  disabled={saving}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem",
                    background: COLORS.success,
                    color: COLORS.white,
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            )}
          </div>

          {!editingAddress ? (
            <>
              {submission.place_id ? (
                <a href={`/places/${submission.place_id}`} style={{ color: "inherit", textDecoration: "none" }}>
                  <p style={{ margin: 0, fontWeight: 500 }}>{submission.cats_address}</p>
                </a>
              ) : (
                <p style={{ margin: 0 }}>{submission.cats_address}</p>
              )}
              {submission.cats_city && <p style={{ margin: 0, color: "var(--muted)" }}>{submission.cats_city}</p>}
              {submission.geo_formatted_address && submission.geo_formatted_address !== submission.cats_address && (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                  Geocoded: {submission.geo_formatted_address}
                </p>
              )}
              {!submission.geo_formatted_address && submission.geo_confidence === null && (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: COLORS.warning }}>
                  ⚠ Address needs geocoding - consider correcting if vague
                </p>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--muted)" }}>
                  Street Address * (start typing for suggestions)
                </label>
                <PlaceResolver
                  value={resolvedQueuePlace}
                  onChange={(place) => {
                    setResolvedQueuePlace(place);
                    if (place) {
                      setAddressEdits({
                        cats_address: place.formatted_address || place.display_name || "",
                        cats_city: place.locality || "",
                        cats_zip: "",
                      });
                    }
                  }}
                  placeholder="Start typing address..."
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--muted)" }}>
                    City
                  </label>
                  <input
                    type="text"
                    value={addressEdits.cats_city}
                    onChange={(e) => setAddressEdits({ ...addressEdits, cats_city: e.target.value })}
                    placeholder="Santa Rosa"
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--muted)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem", color: "var(--muted)" }}>
                    ZIP
                  </label>
                  <input
                    type="text"
                    value={addressEdits.cats_zip}
                    onChange={(e) => setAddressEdits({ ...addressEdits, cats_zip: e.target.value })}
                    placeholder="95401"
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--muted)" }}
                  />
                </div>
              </div>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                Select from suggestions or type manually. Address will be linked to the correct place.
              </p>
            </div>
          )}
        </div>

        {/* Cats */}
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Cats</h3>
            {!editingCats ? (
              <button
                onClick={() => {
                  setCatsEdits({
                    cat_count_estimate: submission.cat_count_estimate?.toString() || "",
                    ownership_status: submission.ownership_status || "",
                    fixed_status: submission.fixed_status || "",
                    has_kittens: submission.has_kittens || false,
                    has_medical_concerns: submission.has_medical_concerns || false,
                  });
                  setEditingCats(true);
                }}
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
              >
                Edit
              </button>
            ) : (
              <div style={{ display: "flex", gap: "0.25rem" }}>
                <button
                  onClick={async () => {
                    setSavingSection(true);
                    try {
                      const data = await postApi<{ submission: IntakeSubmission }>(`/api/intake/queue/${submission.submission_id}`, {
                        cat_count_estimate: catsEdits.cat_count_estimate ? parseInt(catsEdits.cat_count_estimate) : null,
                        ownership_status: catsEdits.ownership_status || null,
                        fixed_status: catsEdits.fixed_status || null,
                        has_kittens: catsEdits.has_kittens,
                        has_medical_concerns: catsEdits.has_medical_concerns,
                      }, { method: "PATCH" });
                      onSubmissionUpdate({ ...submission, ...data.submission });
                      setEditingCats(false);
                      onRefresh();
                    } catch (err) {
                      console.error("Failed to save:", err);
                    } finally {
                      setSavingSection(false);
                    }
                  }}
                  disabled={savingSection}
                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: COLORS.success, color: COLORS.white, border: "none", borderRadius: "4px", cursor: "pointer" }}
                >
                  {savingSection ? "..." : "Save"}
                </button>
                <button
                  onClick={() => setEditingCats(false)}
                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {editingCats ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Count</label>
                <input
                  type="number"
                  value={catsEdits.cat_count_estimate}
                  onChange={(e) => setCatsEdits({ ...catsEdits, cat_count_estimate: e.target.value })}
                  style={{ width: "100%", padding: "0.375rem", fontSize: "0.85rem" }}
                  min="1"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Type</label>
                <select
                  value={catsEdits.ownership_status}
                  onChange={(e) => setCatsEdits({ ...catsEdits, ownership_status: e.target.value })}
                  style={{ width: "100%", padding: "0.375rem", fontSize: "0.85rem" }}
                >
                  <option value="">Select...</option>
                  <option value="unknown_stray">Stray cat</option>
                  <option value="community_colony">Community/Colony</option>
                  <option value="newcomer">Newcomer</option>
                  <option value="neighbors_cat">Neighbor's cat</option>
                  <option value="my_cat">My own pet</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Fixed Status</label>
                <select
                  value={catsEdits.fixed_status}
                  onChange={(e) => setCatsEdits({ ...catsEdits, fixed_status: e.target.value })}
                  style={{ width: "100%", padding: "0.375rem", fontSize: "0.85rem" }}
                >
                  <option value="">Select...</option>
                  <option value="none_fixed">None fixed</option>
                  <option value="some_fixed">Some fixed</option>
                  <option value="all_fixed">All fixed</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                  <input
                    type="checkbox"
                    checked={catsEdits.has_kittens}
                    onChange={(e) => setCatsEdits({ ...catsEdits, has_kittens: e.target.checked })}
                  />
                  Kittens present
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
                  <input
                    type="checkbox"
                    checked={catsEdits.has_medical_concerns}
                    onChange={(e) => setCatsEdits({ ...catsEdits, has_medical_concerns: e.target.checked })}
                  />
                  Medical concerns
                </label>
              </div>
            </div>
          ) : (
            <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div><strong>Count:</strong> {submission.cat_count_estimate ?? "Unknown"}</div>
              {submission.ownership_status && <div><strong>Type:</strong> {submission.ownership_status.replace(/_/g, " ")}</div>}
              {submission.fixed_status && <div><strong>Fixed:</strong> {submission.fixed_status.replace(/_/g, " ")}</div>}
              {submission.has_kittens && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <KittenPriorityBadge score={submission.kitten_priority_score} hasKittens={submission.has_kittens} />
                  {submission.kitten_priority_score != null && (
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginLeft: "0.5rem" }}>
                      {submission.kitten_priority_score}/100
                    </span>
                  )}
                </div>
              )}
              {submission.has_medical_concerns && <div style={{ color: COLORS.error }}><strong>Medical concerns</strong></div>}
            </div>

            {/* Kitten Assessment Outcome (FFS-559) */}
            {submission.has_kittens && submission.kitten_priority_score != null && (
              <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                {submission.kitten_assessment_outcome ? (
                  <div style={{ fontSize: "0.85rem" }}>
                    <strong>Assessment:</strong>{" "}
                    {KITTEN_ASSESSMENT_OUTCOME_OPTIONS.find(o => o.value === submission.kitten_assessment_outcome)?.label || submission.kitten_assessment_outcome}
                    {submission.kitten_assessed_at && (
                      <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>
                        ({formatDate(submission.kitten_assessed_at)})
                      </span>
                    )}
                    {submission.kitten_redirect_destination && (
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                        Redirected to: {submission.kitten_redirect_destination}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    {!showKittenAssessment ? (
                      <button
                        onClick={() => setShowKittenAssessment(true)}
                        style={{
                          padding: "0.375rem 0.75rem",
                          fontSize: "0.8rem",
                          background: COLORS.primary,
                          color: COLORS.white,
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        Record Assessment Outcome
                      </button>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <label style={{ fontSize: "0.8rem", fontWeight: 500 }}>Assessment Outcome</label>
                        <select
                          value={kittenOutcome}
                          onChange={(e) => setKittenOutcome(e.target.value)}
                          style={{ padding: "0.375rem", fontSize: "0.85rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                        >
                          <option value="">Select outcome...</option>
                          {KITTEN_ASSESSMENT_OUTCOME_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {kittenOutcome === "redirected" && (
                          <input
                            type="text"
                            placeholder="Destination shelter/rescue name"
                            value={kittenRedirectDest}
                            onChange={(e) => setKittenRedirectDest(e.target.value)}
                            style={{ padding: "0.375rem", fontSize: "0.85rem", borderRadius: "4px", border: "1px solid var(--border)" }}
                          />
                        )}
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            onClick={async () => {
                              if (!kittenOutcome) return;
                              setSavingKittenAssessment(true);
                              try {
                                const payload: Record<string, unknown> = {
                                  kitten_assessment_outcome: kittenOutcome,
                                };
                                if (kittenOutcome === "redirected" && kittenRedirectDest) {
                                  payload.kitten_redirect_destination = kittenRedirectDest;
                                }
                                const data = await postApi<{ submission: IntakeSubmission }>(
                                  `/api/intake/queue/${submission.submission_id}`,
                                  payload,
                                  { method: "PATCH" }
                                );
                                onSubmissionUpdate({ ...submission, ...data.submission });
                                setShowKittenAssessment(false);
                                toastSuccess("Kitten assessment recorded");
                                onRefresh();
                              } catch (err) {
                                console.error("Failed to save kitten assessment:", err);
                              } finally {
                                setSavingKittenAssessment(false);
                              }
                            }}
                            disabled={!kittenOutcome || savingKittenAssessment}
                            style={{
                              padding: "0.375rem 0.75rem",
                              fontSize: "0.8rem",
                              background: kittenOutcome ? COLORS.success : COLORS.gray500,
                              color: COLORS.white,
                              border: "none",
                              borderRadius: "4px",
                              cursor: kittenOutcome ? "pointer" : "not-allowed",
                            }}
                          >
                            {savingKittenAssessment ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => {
                              setShowKittenAssessment(false);
                              setKittenOutcome("");
                              setKittenRedirectDest("");
                            }}
                            style={{
                              padding: "0.375rem 0.75rem",
                              fontSize: "0.8rem",
                              background: "transparent",
                              border: "1px solid var(--border)",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
          )}
        </div>

        {/* Structured Fields */}
        {(submission.call_type || submission.cat_name || submission.cat_description || submission.feeding_situation) && (
          <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1rem", marginBottom: "0.5rem" }}>Details</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.9rem" }}>
              {submission.call_type && (
                <div>
                  <span style={{ display: "inline-block", padding: "0.15rem 0.5rem", fontSize: "0.75rem", fontWeight: 600, borderRadius: "4px", background: "rgba(59,130,246,0.15)", color: "rgb(59,130,246)" }}>
                    {submission.call_type.replace(/_/g, " ")}
                  </span>
                </div>
              )}
              {submission.cat_name && (
                <div><strong>Cat name:</strong> {submission.cat_name}</div>
              )}
              {submission.cat_description && (
                <div><strong>Description:</strong> {submission.cat_description}</div>
              )}
              {submission.feeding_situation && (
                <div><strong>Feeding:</strong> {submission.feeding_situation}</div>
              )}
            </div>
          </div>
        )}

        {/* Situation */}
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Notes</h3>
            {!editingSituation ? (
              <button
                onClick={() => {
                  setSituationEdit(submission.situation_description || "");
                  setEditingSituation(true);
                }}
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
              >
                Edit
              </button>
            ) : (
              <div style={{ display: "flex", gap: "0.25rem" }}>
                <button
                  onClick={async () => {
                    setSavingSection(true);
                    try {
                      const data = await postApi<{ submission: IntakeSubmission }>(`/api/intake/queue/${submission.submission_id}`, { situation_description: situationEdit }, { method: "PATCH" });
                      onSubmissionUpdate({ ...submission, ...data.submission });
                      setEditingSituation(false);
                      onRefresh();
                    } catch (err) {
                      console.error("Failed to save:", err);
                    } finally {
                      setSavingSection(false);
                    }
                  }}
                  disabled={savingSection}
                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: COLORS.success, color: COLORS.white, border: "none", borderRadius: "4px", cursor: "pointer" }}
                >
                  {savingSection ? "..." : "Save"}
                </button>
                <button
                  onClick={() => setEditingSituation(false)}
                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {editingSituation ? (
            <textarea
              value={situationEdit}
              onChange={(e) => setSituationEdit(e.target.value)}
              rows={8}
              style={{ width: "100%", padding: "0.5rem", resize: "vertical", fontSize: "0.9rem", fontFamily: "inherit" }}
              placeholder="Notes..."
            />
          ) : submission.situation_description ? (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>{submission.situation_description}</p>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)", fontStyle: "italic" }}>No notes provided.</p>
          )}
        </div>

        {/* Third Party */}
        {submission.is_third_party_report && (
          <div style={{ background: "rgba(255, 193, 7, 0.15)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem", border: "1px solid rgba(255, 193, 7, 0.5)" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>Third-Party Report</h3>
            <p style={{ margin: 0 }}>Reported by: {submission.third_party_relationship?.replace(/_/g, " ")}</p>
            {submission.property_owner_name && (
              <p style={{ margin: "0.25rem 0 0" }}>Property owner: {submission.property_owner_name}</p>
            )}
            {submission.property_owner_phone && (
              <p style={{ margin: "0.25rem 0 0" }}>Owner phone: {formatPhone(submission.property_owner_phone)}</p>
            )}
          </div>
        )}

        {/* Triage */}
        {submission.triage_reasons && submission.triage_reasons.length > 0 && (
          <div style={{ background: "rgba(13, 110, 253, 0.1)", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>
              Triage: {submission.triage_category?.replace(/_/g, " ")} (Score: {submission.triage_score})
            </h3>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.9rem" }}>
              {submission.triage_reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Legacy Review Notes - only shown if record has existing notes */}
        {submission.legacy_notes && (
          <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem", color: "var(--muted)" }}>
              Legacy Notes
            </h3>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
              Historical notes from before the Communication Log. New notes should be added using &quot;+ Note&quot; below.
            </p>
            <div style={{
              padding: "0.75rem",
              background: "var(--background)",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              whiteSpace: "pre-wrap",
              fontSize: "0.9rem"
            }}>
              {submission.legacy_notes}
            </div>
          </div>
        )}

        {/* Edit History - collapsible section to see and undo changes */}
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showEditHistory ? "0.75rem" : 0 }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Edit History</h3>
            <button
              onClick={() => {
                if (!showEditHistory) {
                  fetchEditHistory(submission.submission_id);
                }
                setShowEditHistory(!showEditHistory);
              }}
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.8rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              {showEditHistory ? "Hide" : "Show"} History
            </button>
          </div>
          {showEditHistory && (
            <div>
              {loadingHistory ? (
                <div style={{ padding: "0.5rem 0" }}><SkeletonList items={3} /></div>
              ) : editHistory.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", fontStyle: "italic" }}>
                  No edit history recorded yet.
                </p>
              ) : (
                <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                  {editHistory.map((edit) => (
                    <div
                      key={edit.edit_id}
                      style={{
                        padding: "0.5rem",
                        borderBottom: "1px solid var(--border)",
                        fontSize: "0.8rem",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                        <strong style={{ textTransform: "capitalize" }}>
                          {edit.field_name.replace(/_/g, " ")}
                        </strong>
                        <span style={{ color: "var(--muted)" }}>
                          {new Date(edit.edited_at).toLocaleDateString()} {new Date(edit.edited_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", color: "var(--muted)" }}>
                        <span style={{ textDecoration: "line-through", color: COLORS.error }}>
                          {edit.old_value === null ? "(empty)" : String(edit.old_value)}
                        </span>
                        <span>→</span>
                        <span style={{ color: COLORS.success }}>
                          {edit.new_value === null ? "(empty)" : String(edit.new_value)}
                        </span>
                      </div>
                      <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "var(--muted)" }}>
                        by {edit.edited_by}{edit.edit_reason && ` • ${edit.edit_reason}`}
                      </div>
                      {/* Undo button for recent changes */}
                      {new Date(edit.edited_at).getTime() > Date.now() - 24 * 60 * 60 * 1000 && (
                        <button
                          onClick={() => {
                            setConfirmDialog({
                              open: true,
                              title: "Revert Change",
                              message: `Revert ${edit.field_name.replace(/_/g, " ")} back to "${edit.old_value}"?`,
                              confirmLabel: "Revert",
                              variant: "default",
                              onConfirm: async () => {
                                setConfirmDialog(prev => ({ ...prev, open: false }));
                                try {
                                  const data = await postApi<{ submission: IntakeSubmission }>(`/api/intake/queue/${submission.submission_id}`, {
                                    [edit.field_name]: edit.old_value,
                                    edit_reason: "undo_change",
                                  }, { method: "PATCH" });
                                  onSubmissionUpdate({ ...submission, ...data.submission });
                                  fetchEditHistory(submission.submission_id);
                                  onRefresh();
                                } catch (err) {
                                  console.error("Failed to undo:", err);
                                }
                              },
                            });
                          }}
                          style={{
                            marginTop: "0.25rem",
                            padding: "0.15rem 0.4rem",
                            fontSize: "0.7rem",
                            background: "var(--background)",
                            border: "1px solid #fd7e14",
                            color: COLORS.warning,
                            borderRadius: "3px",
                            cursor: "pointer",
                          }}
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick Actions - for tracking outreach */}
        <div style={{
          background: "var(--card-bg, rgba(0,0,0,0.05))",
          borderRadius: "8px",
          padding: "1rem",
          marginBottom: "1rem"
        }}>
          <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>Quick Actions</h3>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {submission.submission_status === "new" && (
              <button
                onClick={() => {
                  onQuickStatus(submission.submission_id, "submission_status", "in_progress");
                  onSubmissionUpdate({ ...submission, submission_status: "in_progress" });
                }}
                style={{ padding: "0.5rem 1rem", background: "#fd7e14", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Mark In Progress
              </button>
            )}

            {submission.submission_status !== "scheduled" && submission.submission_status !== "complete" ? (
              <button
                onClick={() => {
                  onClose();
                  onOpenBookingModal(submission);
                }}
                style={{ padding: "0.5rem 1rem", background: COLORS.success, color: COLORS.white, border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Schedule Appointment
              </button>
            ) : submission.submission_status === "scheduled" ? (
              <button
                onClick={() => {
                  onClose();
                  onChangeAppointment(submission);
                }}
                style={{ padding: "0.5rem 1rem", background: COLORS.primary, color: COLORS.white, border: "none", borderRadius: "6px", cursor: "pointer" }}
              >
                Change Appointment {submission.appointment_date && `(${formatDate(submission.appointment_date)})`}
              </button>
            ) : null}
          </div>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
            These actions update tracking status. Changes save automatically.
          </p>
        </div>

        {/* Inline Communication Log */}
        <div style={{
          background: "var(--card-bg, rgba(0,0,0,0.03))",
          borderRadius: "8px",
          padding: "1rem",
          marginBottom: "1rem"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h3 style={{ margin: 0, fontSize: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              Communication Log
              {communicationLogs.length > 0 && (
                <span style={{
                  background: "var(--muted-bg, #e0e0e0)",
                  padding: "0.125rem 0.4rem",
                  borderRadius: "10px",
                  fontSize: "0.75rem",
                  color: "var(--muted)"
                }}>
                  {communicationLogs.length}
                </span>
              )}
            </h3>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => {
                  setShowInlineContactForm("note");
                  setContactForm({ ...contactForm, is_journal_only: true, notes: "", contacted_by: contactForm.contacted_by || currentUser?.display_name || "" });
                }}
                style={{
                  padding: "0.35rem 0.75rem",
                  background: showInlineContactForm === "note" ? COLORS.primary : "transparent",
                  color: showInlineContactForm === "note" ? "#fff" : COLORS.primary,
                  border: "1px solid #0d6efd",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: 500
                }}
              >
                + Note
              </button>
              <button
                onClick={() => {
                  setShowInlineContactForm("call");
                  setContactForm({ ...contactForm, is_journal_only: false, notes: "", contact_method: "phone", contact_result: "answered", contacted_by: contactForm.contacted_by || currentUser?.display_name || "" });
                }}
                style={{
                  padding: "0.35rem 0.75rem",
                  background: showInlineContactForm === "call" ? "#6f42c1" : "transparent",
                  color: showInlineContactForm === "call" ? "#fff" : "#6f42c1",
                  border: "1px solid #6f42c1",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: 500
                }}
              >
                + Call
              </button>
            </div>
          </div>

          {/* Inline Add Form */}
          {showInlineContactForm && (
            <div style={{
              background: "var(--background)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "0.75rem",
              marginBottom: "0.75rem"
            }}>
              <div style={{ display: "grid", gridTemplateColumns: showInlineContactForm === "call" ? "1fr 1fr" : "1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                {/* Contact method & result - only for calls */}
                {showInlineContactForm === "call" && (
                  <>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.2rem", color: "var(--muted)" }}>Method</label>
                      <select
                        value={contactForm.contact_method}
                        onChange={(e) => setContactForm({ ...contactForm, contact_method: e.target.value })}
                        style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem" }}
                      >
                        {CONTACT_METHODS.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.2rem", color: "var(--muted)" }}>Result</label>
                      <select
                        value={contactForm.contact_result}
                        onChange={(e) => setContactForm({ ...contactForm, contact_result: e.target.value })}
                        style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem" }}
                      >
                        {CONTACT_RESULTS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.2rem", color: "var(--muted)" }}>Staff</label>
                  <select
                    value={contactForm.contacted_by}
                    onChange={(e) => setContactForm({ ...contactForm, contacted_by: e.target.value })}
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem" }}
                  >
                    <option value="">Select staff...</option>
                    {/* Show current user as first option if logged in */}
                    {currentUser && !staffList.some(s => s.staff_id === currentUser.staff_id) && (
                      <option key={currentUser.staff_id} value={currentUser.display_name}>
                        {currentUser.display_name} (You)
                      </option>
                    )}
                    {staffList.map((s) => (
                      <option key={s.staff_id} value={s.display_name}>
                        {s.display_name}{s.staff_id === currentUser?.staff_id ? " (You)" : ""} ({s.role})
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: "0.2rem", color: "var(--muted)" }}>
                    {showInlineContactForm === "note" ? "Note" : "Notes"}
                  </label>
                  <textarea
                    value={contactForm.notes}
                    onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                    rows={2}
                    placeholder={showInlineContactForm === "note" ? "Internal note..." : "Notes about the conversation..."}
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem", resize: "vertical" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={handleInlineContactSubmit}
                  disabled={saving || !contactForm.notes.trim() || !contactForm.contacted_by}
                  style={{
                    padding: "0.4rem 0.75rem",
                    background: showInlineContactForm === "note" ? COLORS.primary : "#6f42c1",
                    color: COLORS.white,
                    border: "none",
                    borderRadius: "4px",
                    cursor: saving || !contactForm.notes.trim() || !contactForm.contacted_by ? "not-allowed" : "pointer",
                    opacity: saving || !contactForm.notes.trim() || !contactForm.contacted_by ? 0.6 : 1,
                    fontSize: "0.85rem",
                    fontWeight: 500
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setShowInlineContactForm(null)}
                  style={{
                    padding: "0.4rem 0.75rem",
                    background: "transparent",
                    color: "var(--muted)",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.85rem"
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Communication Log Entries */}
          {loadingLogs ? (
            <div style={{ padding: "0.5rem 0" }}><SkeletonList items={3} /></div>
          ) : communicationLogs.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0, fontStyle: "italic" }}>
              No communication logged yet. Use the buttons above to add notes or log calls.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "200px", overflowY: "auto" }}>
              {communicationLogs.map((log) => {
                const isNote = log.entry_kind === "note" || !log.contact_method;
                const displayName = log.created_by_staff_name || log.contacted_by;
                const initials = displayName
                  ? displayName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
                  : "??";

                return (
                  <div
                    key={log.log_id}
                    style={{
                      padding: "0.5rem 0.65rem",
                      background: "var(--background)",
                      borderRadius: "4px",
                      borderLeft: `3px solid ${isNote ? COLORS.primary : "#6f42c1"}`,
                      fontSize: "0.85rem"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                      {/* Initials badge */}
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        background: isNote ? COLORS.primary : "#6f42c1",
                        color: COLORS.white,
                        fontSize: "0.6rem",
                        fontWeight: "bold"
                      }}>{initials}</span>

                      {/* Entry type badge */}
                      <span style={{
                        padding: "0.1rem 0.35rem",
                        borderRadius: "3px",
                        fontSize: "0.65rem",
                        fontWeight: 500,
                        background: isNote ? COLORS.primary : "#6f42c1",
                        color: COLORS.white
                      }}>
                        {isNote ? "Note" : "Contact"}
                      </span>

                      {/* Contact details for calls */}
                      {!isNote && log.contact_method && (
                        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                          {CONTACT_METHODS.find(m => m.value === log.contact_method)?.label || log.contact_method}
                          {log.contact_result && (
                            <> → {CONTACT_RESULTS.find(r => r.value === log.contact_result)?.label || log.contact_result}</>
                          )}
                        </span>
                      )}

                      {/* Date */}
                      <span style={{ fontSize: "0.7rem", color: "var(--muted)", marginLeft: "auto" }}>
                        {formatDate(log.contacted_at)}
                      </span>
                    </div>

                    {/* Notes */}
                    {log.notes && (
                      <p style={{ margin: 0, color: "var(--foreground)", lineHeight: 1.4 }}>
                        {log.notes}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Convert to Request - for ALL not-yet-converted submissions */}
        {submission.native_status !== "request_created" && !submission.created_request_id && (
          <div style={{
            background: "rgba(102, 16, 242, 0.1)",
            border: "1px solid rgba(102, 16, 242, 0.3)",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem"
          }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem", color: "#6610f2" }}>
              Create Trapping Request
            </h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", color: "var(--muted)" }}>
              Convert this submission into a formal FFR request. This creates a new request record
              that can be assigned to trappers and tracked through completion.
            </p>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)", fontStyle: "italic" }}>
              Most submissions are handled directly (booked for clinic) without becoming requests.
              Only create a request if this needs trapper coordination.
            </p>
            <a
              href={`/requests/new?intake_id=${submission.submission_id}`}
              style={{
                display: "inline-block",
                padding: "0.5rem 1rem",
                background: "#6610f2",
                color: COLORS.white,
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 500,
                textDecoration: "none"
              }}
            >
              Create Request →
            </a>
          </div>
        )}

        {/* Already converted indicator */}
        {submission.native_status === "request_created" && submission.created_request_id && (
          <div style={{
            background: "rgba(25, 135, 84, 0.1)",
            border: "1px solid rgba(25, 135, 84, 0.3)",
            borderRadius: "8px",
            padding: "1rem",
            marginBottom: "1rem"
          }}>
            <p style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: COLORS.success, fontSize: "1.25rem" }}>✓</span>
              <span>
                Request created.{" "}
                <a
                  href={`/requests/${submission.created_request_id}`}
                  style={{ color: COLORS.success, fontWeight: 500 }}
                >
                  View Request →
                </a>
              </span>
            </p>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
          <button
            onClick={() => {
              setConfirmDialog({
                open: true,
                title: "Archive Submission",
                message: `Archive "${normalizeName(submission.submitter_name)}"? This will remove it from all views.`,
                confirmLabel: "Archive",
                variant: "danger",
                onConfirm: () => {
                  setConfirmDialog(prev => ({ ...prev, open: false }));
                  onArchive(submission.submission_id);
                },
              });
            }}
            style={{ padding: "0.5rem 1rem", background: COLORS.gray500, color: COLORS.white, border: "none", borderRadius: "6px", cursor: "pointer" }}
          >
            Archive
          </button>

          {/* Decline button - for submissions that shouldn't become requests */}
          {submission.submission_status !== "declined" && !submission.created_request_id && (
            <button
              onClick={() => onOpenDeclineModal(submission)}
              style={{ padding: "0.5rem 1rem", background: COLORS.error, color: COLORS.white, border: "none", borderRadius: "6px", cursor: "pointer" }}
            >
              Decline
            </button>
          )}

          <a
            href={`/intake/print/${submission.submission_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ padding: "0.5rem 1rem", background: COLORS.primary, color: COLORS.white, border: "none", borderRadius: "6px", cursor: "pointer", textDecoration: "none", display: "inline-block" }}
          >
            Print / PDF
          </a>

          {/* Mark Complete - requires confirmation */}
          {submission.submission_status !== "complete" && (
            <button
              onClick={() => {
                setConfirmDialog({
                  open: true,
                  title: "Mark as Complete",
                  message: `Mark "${normalizeName(submission.submitter_name)}" as Complete? This will remove it from the active queue.`,
                  confirmLabel: "Mark Complete",
                  variant: "default",
                  onConfirm: async () => {
                    setConfirmDialog(prev => ({ ...prev, open: false }));
                    await onQuickStatus(submission.submission_id, "submission_status", "complete");
                    onSubmissionUpdate({ ...submission, submission_status: "complete" });
                    toastSuccess(`${normalizeName(submission.submitter_name)} marked as Complete`);
                  },
                });
              }}
              style={{ padding: "0.5rem 1rem", background: "#20c997", color: "#000", border: "none", borderRadius: "6px", cursor: "pointer" }}
            >
              Mark Complete
            </button>
          )}

          {/* Reset status - useful for accidentally marked submissions */}
          {(submission.submission_status === "scheduled" || submission.submission_status === "complete") && (
            <button
              onClick={() => {
                setConfirmDialog({
                  open: true,
                  title: "Reset to New",
                  message: "Reset this submission back to New? It will appear in Needs Attention tab again.",
                  confirmLabel: "Reset",
                  variant: "default",
                  onConfirm: async () => {
                    setConfirmDialog(prev => ({ ...prev, open: false }));
                    await onQuickStatus(submission.submission_id, "submission_status", "new");
                    onSubmissionUpdate({ ...submission, submission_status: "new" });
                    toastSuccess(`${normalizeName(submission.submitter_name)} moved back to New`);
                  },
                });
              }}
              style={{ padding: "0.5rem 1rem", background: COLORS.warning, color: COLORS.black, border: "none", borderRadius: "6px", cursor: "pointer" }}
            >
              Reset to New
            </button>
          )}

          <button
            onClick={onClose}
            style={{ padding: "0.5rem 1rem", marginLeft: "auto", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
      />

      {/* FFS-1187 — Out-of-Service-Area send confirm modal */}
      <SendOutOfServiceConfirmModal
        open={showOoaConfirm}
        recipientEmail={submission.email || ""}
        recipientName={submission.first_name || null}
        detectedCounty={submission.county || null}
        loading={ooaSending}
        onConfirm={handleOoaSendConfirmed}
        onCancel={() => setShowOoaConfirm(false)}
      />

      {/* FFS-1187 — Out-of-Service-Area preview drawer */}
      <ActionDrawer
        isOpen={showOoaPreview}
        onClose={() => setShowOoaPreview(false)}
        title={ooaPreviewSubject || "Email Preview"}
        width="lg"
      >
        {ooaPreviewLoading ? (
          <div style={{ padding: "1rem", color: "var(--text-secondary)" }}>
            Rendering preview…
          </div>
        ) : ooaPreviewHtml ? (
          <iframe
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={ooaPreviewHtml.replace('<head>', '<head><base target="_blank">')}
            style={{
              width: "100%",
              height: "calc(100vh - 200px)",
              border: "1px solid var(--card-border)",
              borderRadius: 6,
              background: "#fff",
            }}
            title="Out-of-service-area email preview"
          />
        ) : (
          <div style={{ padding: "1rem", color: "var(--text-secondary)" }}>
            No preview available.
          </div>
        )}
      </ActionDrawer>
    </div>
  );
}
