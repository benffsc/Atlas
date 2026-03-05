"use client";

import { useState, useEffect, useCallback } from "react";
import type { IntakeSubmission, CommunicationLog, StaffMember } from "@/lib/intake-types";
import { CONTACT_METHODS, CONTACT_RESULTS } from "@/lib/intake-types";
import { normalizeName } from "@/components/intake/IntakeBadges";
import { formatPhone } from "@/lib/formatters";
import { fetchApi, postApi } from "@/lib/api-client";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS, Z_INDEX } from "@/lib/design-tokens";

interface ContactLogModalProps {
  submission: IntakeSubmission;
  isOpen: boolean;
  onClose: () => void;
  onLogSaved: () => void;
  staffList: StaffMember[];
  currentUser: { staff_id: string; display_name: string } | null;
}

export function ContactLogModal({
  submission,
  isOpen,
  onClose,
  onLogSaved,
  staffList,
  currentUser,
}: ContactLogModalProps) {
  const [saving, setSaving] = useState(false);
  const [communicationLogs, setCommunicationLogs] = useState<CommunicationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [contactForm, setContactForm] = useState({
    contact_method: "phone",
    contact_result: "answered",
    notes: "",
    contacted_by: currentUser?.display_name || "",
    is_journal_only: false,
  });

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const data = await fetchApi<{ logs: CommunicationLog[] }>(
        `/api/intake/${submission.submission_id}/communications`
      );
      setCommunicationLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch communication logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  }, [submission.submission_id]);

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
      setContactForm({
        contact_method: "phone",
        contact_result: "answered",
        notes: "",
        contacted_by: currentUser?.display_name || "",
        is_journal_only: false,
      });
    }
  }, [isOpen, fetchLogs, currentUser?.display_name]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await postApi(`/api/intake/${submission.submission_id}/communications`, contactForm);
      fetchLogs();
      onLogSaved();
      setContactForm({
        ...contactForm,
        notes: "",
        is_journal_only: false,
      });
    } catch (err) {
      console.error("Failed to submit contact log:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: Z_INDEX.modal,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--background)",
          borderRadius: BORDERS.radius.xl,
          padding: SPACING.xl,
          maxWidth: "600px",
          width: "90%",
          maxHeight: "85vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>Log Contact / Journal</h2>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0", fontSize: "0.9rem" }}>
            {normalizeName(submission.submitter_name)} - {submission.email}
            {submission.phone && ` | ${formatPhone(submission.phone)}`}
          </p>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.8rem" }}>
            {submission.geo_formatted_address || submission.cats_address}
          </p>
        </div>

        {/* Contact Form */}
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
            {contactForm.is_journal_only ? "New Journal Entry" : "New Contact Log"}
          </h3>

          {/* Journal Only Toggle */}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={contactForm.is_journal_only}
                onChange={(e) => setContactForm({ ...contactForm, is_journal_only: e.target.checked })}
                style={{ width: "1rem", height: "1rem" }}
              />
              <span style={{ fontSize: "0.9rem" }}>Just log a journal entry (internal note only)</span>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            {!contactForm.is_journal_only && (
              <>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Contact Method
                  </label>
                  <select
                    value={contactForm.contact_method}
                    onChange={(e) => setContactForm({ ...contactForm, contact_method: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem" }}
                  >
                    {CONTACT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Result
                  </label>
                  <select
                    value={contactForm.contact_result}
                    onChange={(e) => setContactForm({ ...contactForm, contact_result: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem" }}
                  >
                    {CONTACT_RESULTS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div style={{ gridColumn: contactForm.is_journal_only ? "1 / -1" : undefined }}>
              <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                {contactForm.is_journal_only ? "Staff" : "Who Contacted"}
              </label>
              <select
                value={contactForm.contacted_by}
                onChange={(e) => setContactForm({ ...contactForm, contacted_by: e.target.value })}
                style={{ width: "100%", padding: "0.5rem" }}
              >
                <option value="">Select staff...</option>
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
              <label style={{ display: "block", fontSize: "0.8rem", marginBottom: "0.25rem", fontWeight: 500 }}>
                {contactForm.is_journal_only ? "Journal Entry" : "Notes"}
              </label>
              <textarea
                value={contactForm.notes}
                onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })}
                rows={3}
                placeholder={contactForm.is_journal_only ? "Internal notes..." : "Brief notes about the conversation or attempt..."}
                style={{ width: "100%", padding: "0.5rem", resize: "vertical" }}
              />
            </div>
          </div>

          <div style={{ marginTop: "0.75rem" }}>
            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{
                padding: "0.5rem 1rem",
                background: contactForm.is_journal_only ? "#0d6efd" : "#6f42c1",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              {saving ? "Saving..." : contactForm.is_journal_only ? "Save Journal Entry" : "Save Contact Log"}
            </button>
          </div>
        </div>

        {/* Communication History */}
        <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem" }}>
          <h3 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
            Contact History
            {submission.contact_attempt_count ? ` (${submission.contact_attempt_count} attempts)` : ""}
          </h3>

          {loadingLogs ? (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Loading...</p>
          ) : communicationLogs.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0 }}>
              No journal entries logged yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {communicationLogs.map((log) => {
                const isNote = log.entry_kind === "note" || !log.contact_method;
                const displayName = log.created_by_staff_name || log.contacted_by;

                return (
                  <div
                    key={log.log_id}
                    style={{
                      padding: "0.5rem 0.75rem",
                      background: "var(--background)",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      borderLeft: `3px solid ${isNote ? "#0d6efd" : "#6f42c1"}`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{
                          padding: "0.125rem 0.4rem",
                          borderRadius: "3px",
                          fontSize: "0.7rem",
                          fontWeight: 500,
                          background: isNote ? "#0d6efd" : "#6f42c1",
                          color: "#fff",
                        }}>
                          {isNote ? "Note" : "Contact"}
                        </span>

                        {!isNote && (
                          <>
                            <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>
                              {CONTACT_METHODS.find(m => m.value === log.contact_method)?.label || log.contact_method}
                            </span>
                            <span style={{ color: "var(--muted)" }}>&rarr;</span>
                            <span style={{
                              padding: "0.125rem 0.5rem",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              background: log.contact_result === "answered" || log.contact_result === "scheduled"
                                ? "rgba(25, 135, 84, 0.15)"
                                : log.contact_result === "no_answer"
                                ? "rgba(108, 117, 125, 0.15)"
                                : "rgba(13, 110, 253, 0.15)",
                              color: log.contact_result === "answered" || log.contact_result === "scheduled"
                                ? "#198754"
                                : log.contact_result === "no_answer"
                                ? "#6c757d"
                                : "#0d6efd",
                            }}>
                              {CONTACT_RESULTS.find(r => r.value === log.contact_result)?.label || log.contact_result}
                            </span>
                          </>
                        )}

                        {displayName && (
                          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                            by {displayName}{log.created_by_staff_role ? ` (${log.created_by_staff_role})` : ""}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                        {new Date(log.contacted_at).toLocaleString()}
                      </span>
                    </div>
                    {log.notes && (
                      <div style={{ fontSize: "0.85rem", marginTop: "0.35rem", whiteSpace: "pre-wrap" }}>
                        {log.notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Close button */}
        <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
