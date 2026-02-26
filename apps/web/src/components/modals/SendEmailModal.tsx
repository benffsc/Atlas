"use client";

import { useState, useEffect } from "react";

interface OutlookAccount {
  account_id: string;
  email: string;
  display_name: string | null;
}

interface EmailTemplate {
  template_id: string;
  template_key: string;
  name: string;
  subject: string;
}

interface SendEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  // Pre-fill recipient info
  defaultTo?: string;
  defaultToName?: string;
  // Context for logging
  submissionId?: string;
  personId?: string;
  requestId?: string;
  // Pre-select template
  defaultTemplate?: string;
  // Custom placeholders
  placeholders?: Record<string, string>;
}

export function SendEmailModal({
  isOpen,
  onClose,
  onSuccess,
  defaultTo = "",
  defaultToName = "",
  submissionId,
  personId,
  requestId,
  defaultTemplate = "",
  placeholders: defaultPlaceholders = {},
}: SendEmailModalProps) {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Options from API
  const [outlookAccounts, setOutlookAccounts] = useState<OutlookAccount[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [hasOutlook, setHasOutlook] = useState(false);
  const [hasResend, setHasResend] = useState(false);

  // Form state
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(defaultTemplate);
  const [to, setTo] = useState(defaultTo);
  const [toName, setToName] = useState(defaultToName);
  const [customSubject, setCustomSubject] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  // Fetch options when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchOptions();
    }
  }, [isOpen]);

  // Update defaults when they change
  useEffect(() => {
    setTo(defaultTo);
    setToName(defaultToName);
    setSelectedTemplate(defaultTemplate);
  }, [defaultTo, defaultToName, defaultTemplate]);

  const fetchOptions = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/send-email");
      const data = await response.json();

      setOutlookAccounts(data.outlookAccounts || []);
      setTemplates(data.templates || []);
      setHasOutlook(data.hasOutlook);
      setHasResend(data.hasResend);

      // Auto-select first Outlook account if available
      if (data.outlookAccounts?.length > 0 && !selectedAccount) {
        setSelectedAccount(data.outlookAccounts[0].account_id);
      }
    } catch (err) {
      console.error("Failed to fetch email options:", err);
      setMessage({ type: "error", text: "Failed to load email options" });
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    setMessage(null);

    // Validate
    if (!to || !to.includes("@")) {
      setMessage({ type: "error", text: "Valid email address is required" });
      return;
    }

    if (!useCustom && !selectedTemplate) {
      setMessage({ type: "error", text: "Please select a template" });
      return;
    }

    if (useCustom && (!customSubject || !customBody)) {
      setMessage({ type: "error", text: "Subject and body are required for custom emails" });
      return;
    }

    setSending(true);

    try {
      const response = await fetch("/api/admin/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlookAccountId: selectedAccount || undefined,
          templateKey: useCustom ? undefined : selectedTemplate,
          to,
          toName: toName || undefined,
          customSubject: useCustom ? customSubject : undefined,
          customBody: useCustom ? customBody : undefined,
          placeholders: defaultPlaceholders,
          submissionId,
          personId,
          requestId,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: "success", text: "Email sent successfully!" });
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1500);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to send email" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to send email" });
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: "600px",
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1rem 1.5rem",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Send Email</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "var(--text-muted)",
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "1.5rem" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
              Loading...
            </div>
          ) : (
            <>
              {/* Message */}
              {message && (
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    borderRadius: "6px",
                    marginBottom: "1rem",
                    background: message.type === "success" ? "#dcfce7" : "#fef2f2",
                    border: `1px solid ${message.type === "success" ? "#86efac" : "#fecaca"}`,
                    color: message.type === "success" ? "#166534" : "#dc2626",
                    fontSize: "0.875rem",
                  }}
                >
                  {message.text}
                </div>
              )}

              {/* No email service warning */}
              {!hasOutlook && !hasResend && (
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    borderRadius: "6px",
                    marginBottom: "1rem",
                    background: "#fffbeb",
                    border: "1px solid #fcd34d",
                    color: "#92400e",
                    fontSize: "0.875rem",
                  }}
                >
                  No email service configured. Connect an Outlook account in{" "}
                  <a href="/admin/email-settings" style={{ color: "#0d6efd" }}>
                    Email Settings
                  </a>
                  .
                </div>
              )}

              {/* From Account */}
              {hasOutlook && outlookAccounts.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "0.5rem",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                    }}
                  >
                    Send From
                  </label>
                  <select
                    value={selectedAccount}
                    onChange={(e) => setSelectedAccount(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.75rem",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                      background: "var(--background)",
                    }}
                  >
                    {outlookAccounts.map((account) => (
                      <option key={account.account_id} value={account.account_id}>
                        {account.email}
                        {account.display_name && ` (${account.display_name})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* To */}
              <div style={{ marginBottom: "1rem" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                  }}
                >
                  To
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="email"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="email@example.com"
                    style={{
                      flex: 1,
                      padding: "0.5rem 0.75rem",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  />
                  <input
                    type="text"
                    value={toName}
                    onChange={(e) => setToName(e.target.value)}
                    placeholder="Name (optional)"
                    style={{
                      width: "150px",
                      padding: "0.5rem 0.75rem",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  />
                </div>
              </div>

              {/* Template vs Custom toggle */}
              <div style={{ marginBottom: "1rem" }}>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      checked={!useCustom}
                      onChange={() => setUseCustom(false)}
                    />
                    <span style={{ fontSize: "0.875rem" }}>Use Template</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      checked={useCustom}
                      onChange={() => setUseCustom(true)}
                      disabled={!hasOutlook}
                    />
                    <span style={{ fontSize: "0.875rem", opacity: hasOutlook ? 1 : 0.5 }}>
                      Custom Email
                      {!hasOutlook && " (requires Outlook)"}
                    </span>
                  </label>
                </div>
              </div>

              {useCustom ? (
                <>
                  {/* Custom Subject */}
                  <div style={{ marginBottom: "1rem" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "0.5rem",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                      }}
                    >
                      Subject
                    </label>
                    <input
                      type="text"
                      value={customSubject}
                      onChange={(e) => setCustomSubject(e.target.value)}
                      placeholder="Email subject"
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        fontSize: "0.875rem",
                      }}
                    />
                  </div>

                  {/* Custom Body */}
                  <div style={{ marginBottom: "1rem" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "0.5rem",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                      }}
                    >
                      Message (HTML supported)
                    </label>
                    <textarea
                      value={customBody}
                      onChange={(e) => setCustomBody(e.target.value)}
                      placeholder="Enter your message..."
                      rows={8}
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        fontSize: "0.875rem",
                        fontFamily: "inherit",
                        resize: "vertical",
                      }}
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* Template Select */}
                  <div style={{ marginBottom: "1rem" }}>
                    <label
                      style={{
                        display: "block",
                        marginBottom: "0.5rem",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                      }}
                    >
                      Template
                    </label>
                    <select
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        fontSize: "0.875rem",
                        background: "var(--background)",
                      }}
                    >
                      <option value="">Select a template...</option>
                      {templates.map((template) => (
                        <option key={template.template_id} value={template.template_key}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Show template subject preview */}
                  {selectedTemplate && (
                    <div
                      style={{
                        padding: "0.75rem",
                        background: "var(--background-secondary)",
                        borderRadius: "6px",
                        marginBottom: "1rem",
                        fontSize: "0.875rem",
                      }}
                    >
                      <strong>Subject:</strong>{" "}
                      {templates.find((t) => t.template_key === selectedTemplate)?.subject}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "1rem 1.5rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.75rem",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--background-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || loading || (!hasOutlook && !hasResend)}
            style={{
              padding: "0.5rem 1rem",
              background: "#0d6efd",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: sending || loading ? "not-allowed" : "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
              opacity: sending || loading ? 0.7 : 1,
            }}
          >
            {sending ? "Sending..." : "Send Email"}
          </button>
        </div>
      </div>
    </div>
  );
}
