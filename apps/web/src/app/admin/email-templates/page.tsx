"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import DOMPurify from "dompurify";

interface EmailTemplate {
  template_id: string;
  template_key: string;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  body_text: string | null;
  placeholders: string[] | null;
  is_active: boolean;
  edit_restricted: boolean;
  last_edited_by: string | null;
  last_edited_at: string | null;
  last_edited_by_name: string | null;
  send_count: number;
  last_sent: string | null;
  created_at: string;
  updated_at: string;
}

const COMMON_PLACEHOLDERS = [
  { key: "first_name", description: "Recipient's first name" },
  { key: "last_name", description: "Recipient's last name" },
  { key: "email", description: "Recipient's email" },
  { key: "county", description: "Detected county name" },
  { key: "submission_date", description: "Form submission date" },
  { key: "request_id", description: "Request ID" },
  { key: "address", description: "Service address" },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function EmailTemplatesAdminPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("staff");
  const [pendingSuggestions, setPendingSuggestions] = useState(0);

  // Suggest modal state
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [suggestingTemplate, setSuggestingTemplate] = useState<EmailTemplate | null>(null);
  const [suggestionNotes, setSuggestionNotes] = useState("");

  // Form state
  const [form, setForm] = useState({
    template_key: "",
    name: "",
    description: "",
    subject: "",
    body_html: "",
    body_text: "",
    placeholders: [] as string[],
  });

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/email-templates");
      const result = await response.json();
      const data = result.data || result;
      setTemplates(data.templates || []);
      setUserRole(data.userRole || "staff");
      setPendingSuggestions(data.pendingSuggestions || 0);
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = userRole === "admin";

  const openSuggestModal = (template: EmailTemplate) => {
    setSuggestingTemplate(template);
    setForm({
      template_key: template.template_key,
      name: template.name,
      description: template.description || "",
      subject: template.subject,
      body_html: template.body_html,
      body_text: template.body_text || "",
      placeholders: template.placeholders || [],
    });
    setSuggestionNotes("");
    setShowSuggestModal(true);
  };

  const closeSuggestModal = () => {
    setShowSuggestModal(false);
    setSuggestingTemplate(null);
    setSuggestionNotes("");
    resetForm();
  };

  const submitSuggestion = async () => {
    if (!suggestingTemplate) return;
    setSaving(true);
    setMessage(null);

    try {
      // Determine what changed
      const changes: Record<string, string> = {};
      if (form.name !== suggestingTemplate.name) changes.suggested_name = form.name;
      if (form.subject !== suggestingTemplate.subject) changes.suggested_subject = form.subject;
      if (form.body_html !== suggestingTemplate.body_html) changes.suggested_body_html = form.body_html;
      if (form.body_text !== suggestingTemplate.body_text) changes.suggested_body_text = form.body_text;

      if (Object.keys(changes).length === 0) {
        setMessage({ type: "error", text: "No changes made" });
        setSaving(false);
        return;
      }

      const response = await fetch("/api/admin/email-templates/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: suggestingTemplate.template_id,
          ...changes,
          suggestion_notes: suggestionNotes,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: "success", text: "Suggestion submitted for review!" });
        setTimeout(() => {
          closeSuggestModal();
          setMessage(null);
        }, 1500);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to submit suggestion" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to submit suggestion" });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const resetForm = () => {
    setForm({
      template_key: "",
      name: "",
      description: "",
      subject: "",
      body_html: "",
      body_text: "",
      placeholders: [],
    });
  };

  const openEditModal = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setForm({
      template_key: template.template_key,
      name: template.name,
      description: template.description || "",
      subject: template.subject,
      body_html: template.body_html,
      body_text: template.body_text || "",
      placeholders: template.placeholders || [],
    });
    setShowAddModal(true);
  };

  const openAddModal = () => {
    setEditingTemplate(null);
    resetForm();
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingTemplate(null);
    setPreviewHtml(null);
    resetForm();
  };

  const saveTemplate = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const method = editingTemplate ? "PATCH" : "POST";
      const body = editingTemplate
        ? { template_id: editingTemplate.template_id, ...form }
        : form;

      const response = await fetch("/api/admin/email-templates", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: "success", text: editingTemplate ? "Template updated!" : "Template created!" });
        fetchTemplates();
        setTimeout(() => {
          closeModal();
          setMessage(null);
        }, 1500);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to save template" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (template: EmailTemplate) => {
    try {
      await fetch("/api/admin/email-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: template.template_id,
          is_active: !template.is_active,
        }),
      });
      fetchTemplates();
    } catch (err) {
      console.error("Failed to toggle template:", err);
    }
  };

  const showPreview = () => {
    // Replace placeholders with sample values for preview
    let html = form.body_html;
    COMMON_PLACEHOLDERS.forEach(({ key }) => {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), `<span style="background:#fef3c7;padding:0 2px;">[${key}]</span>`);
    });
    // Sanitize HTML to prevent XSS - only allow safe email-compatible tags
    const sanitized = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'span', 'div', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class', 'target', 'width', 'height'],
      ALLOW_DATA_ATTR: false,
    });
    setPreviewHtml(sanitized);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Email Templates</h1>
          <p style={{ color: "#666", margin: "0.25rem 0 0" }}>
            {isAdmin ? "Create and manage email templates" : "View templates and suggest edits"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          {isAdmin && pendingSuggestions > 0 && (
            <Link
              href="/admin/email-templates/suggestions"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 1rem",
                background: "#fef3c7",
                borderRadius: "6px",
                textDecoration: "none",
                color: "#92400e",
                fontWeight: 500,
                fontSize: "0.875rem",
              }}
            >
              <span>💡</span>
              {pendingSuggestions} Suggestion{pendingSuggestions > 1 ? "s" : ""}
            </Link>
          )}
          {isAdmin && (
            <button
              onClick={openAddModal}
              style={{
                padding: "0.5rem 1rem",
                background: "#0d6efd",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              + New Template
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="empty">No email templates configured.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {templates.map((template) => (
            <div
              key={template.template_id}
              className="card"
              style={{
                padding: "1rem",
                opacity: template.is_active ? 1 : 0.6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <h3 style={{ margin: 0, fontSize: "1rem" }}>{template.name}</h3>
                    <code
                      style={{
                        background: "#f0f0f0",
                        padding: "0.125rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                      }}
                    >
                      {template.template_key}
                    </code>
                    {template.edit_restricted && (
                      <span
                        style={{
                          background: "#dbeafe",
                          color: "#1e40af",
                          padding: "0.125rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                        }}
                        title="Only admins can edit this template directly"
                      >
                        🔒 RESTRICTED
                      </span>
                    )}
                    {!template.is_active && (
                      <span
                        style={{
                          background: "#fee2e2",
                          color: "#dc2626",
                          padding: "0.125rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                        }}
                      >
                        INACTIVE
                      </span>
                    )}
                  </div>
                  {template.description && (
                    <p style={{ color: "#666", margin: "0.25rem 0 0", fontSize: "0.875rem" }}>
                      {template.description}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.8rem", color: "#666" }}>
                    <span>Subject: <strong>{template.subject}</strong></span>
                    <span>Sent: <strong>{template.send_count}</strong></span>
                    <span>Last sent: {formatDate(template.last_sent)}</span>
                  </div>
                  {template.placeholders && template.placeholders.length > 0 && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <span style={{ fontSize: "0.75rem", color: "#666" }}>Placeholders: </span>
                      {template.placeholders.map((p) => (
                        <code
                          key={p}
                          style={{
                            background: "#e0f2fe",
                            padding: "0.1rem 0.3rem",
                            borderRadius: "3px",
                            fontSize: "0.7rem",
                            marginRight: "0.25rem",
                          }}
                        >
                          {`{{${p}}}`}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {isAdmin || !template.edit_restricted ? (
                    <button
                      onClick={() => openEditModal(template)}
                      style={{
                        padding: "0.375rem 0.75rem",
                        background: "#f8f9fa",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                      }}
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      onClick={() => openSuggestModal(template)}
                      style={{
                        padding: "0.375rem 0.75rem",
                        background: "#fef3c7",
                        border: "1px solid #fcd34d",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                        color: "#92400e",
                      }}
                    >
                      💡 Suggest Edit
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => toggleActive(template)}
                      style={{
                        padding: "0.375rem 0.75rem",
                        background: template.is_active ? "#fff3cd" : "#d1fae5",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.875rem",
                      }}
                    >
                      {template.is_active ? "Disable" : "Enable"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "800px",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <div style={{ padding: "1.5rem", borderBottom: "1px solid #ddd" }}>
              <h2 style={{ margin: 0 }}>
                {editingTemplate ? "Edit Template" : "New Email Template"}
              </h2>
            </div>

            <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
              {message && (
                <div
                  style={{
                    padding: "0.75rem",
                    borderRadius: "6px",
                    background: message.type === "success" ? "#d1fae5" : "#fee2e2",
                    color: message.type === "success" ? "#065f46" : "#dc2626",
                  }}
                >
                  {message.text}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Template Key <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={form.template_key}
                    onChange={(e) => setForm({ ...form, template_key: e.target.value })}
                    disabled={!!editingTemplate}
                    placeholder="out_of_county"
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      fontFamily: "monospace",
                    }}
                  />
                  <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
                    Unique identifier (snake_case)
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Display Name <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Out of County Notification"
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Sent when a submission is outside Sonoma County"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Subject Line <span style={{ color: "#dc3545" }}>*</span>
                </label>
                <input
                  type="text"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Your request is outside our service area"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                  }}
                />
                <div style={{ fontSize: "0.75rem", color: "#666", marginTop: "0.25rem" }}>
                  Use {`{{placeholder}}`} syntax for dynamic values
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                  <label style={{ fontWeight: 500 }}>
                    Email Body (HTML) <span style={{ color: "#dc3545" }}>*</span>
                  </label>
                  <button
                    type="button"
                    onClick={showPreview}
                    style={{
                      padding: "0.25rem 0.5rem",
                      background: "#e0f2fe",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                    }}
                  >
                    Preview
                  </button>
                </div>
                <textarea
                  value={form.body_html}
                  onChange={(e) => setForm({ ...form, body_html: e.target.value })}
                  rows={10}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    fontSize: "0.875rem",
                  }}
                  placeholder={`<p>Hi {{first_name}},</p>
<p>Thank you for reaching out...</p>
<p>Best regards,<br>Forgotten Felines Team</p>`}
                />
              </div>

              {previewHtml && (
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Preview
                  </label>
                  <div
                    style={{
                      padding: "1rem",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      background: "#fafafa",
                    }}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Available Placeholders
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {COMMON_PLACEHOLDERS.map(({ key, description }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        const placeholder = `{{${key}}}`;
                        setForm({ ...form, body_html: form.body_html + placeholder });
                      }}
                      style={{
                        padding: "0.25rem 0.5rem",
                        background: "#f0f0f0",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                      }}
                      title={description}
                    >
                      {`{{${key}}}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                padding: "1rem 1.5rem",
                borderTop: "1px solid #ddd",
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.75rem",
              }}
            >
              <button
                onClick={closeModal}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#f8f9fa",
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveTemplate}
                disabled={saving || !form.template_key || !form.name || !form.subject || !form.body_html}
                style={{
                  padding: "0.5rem 1rem",
                  background: saving ? "#6c757d" : "#0d6efd",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Saving..." : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suggest Edit Modal */}
      {showSuggestModal && suggestingTemplate && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSuggestModal();
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "800px",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <div style={{ padding: "1.5rem", borderBottom: "1px solid #ddd" }}>
              <h2 style={{ margin: 0 }}>Suggest Edit</h2>
              <p style={{ margin: "0.25rem 0 0", color: "#666", fontSize: "0.875rem" }}>
                Template: <strong>{suggestingTemplate.name}</strong>
              </p>
            </div>

            <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
              {message && (
                <div
                  style={{
                    padding: "0.75rem",
                    borderRadius: "6px",
                    background: message.type === "success" ? "#d1fae5" : "#fee2e2",
                    color: message.type === "success" ? "#065f46" : "#dc2626",
                  }}
                >
                  {message.text}
                </div>
              )}

              <div style={{ background: "#eff6ff", padding: "0.75rem", borderRadius: "6px", fontSize: "0.875rem" }}>
                💡 Make your changes below. An admin will review and approve your suggestion.
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Subject Line
                </label>
                <input
                  type="text"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                  }}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                  <label style={{ fontWeight: 500 }}>
                    Email Body (HTML)
                  </label>
                  <button
                    type="button"
                    onClick={showPreview}
                    style={{
                      padding: "0.25rem 0.5rem",
                      background: "#e0f2fe",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                    }}
                  >
                    Preview
                  </button>
                </div>
                <textarea
                  value={form.body_html}
                  onChange={(e) => setForm({ ...form, body_html: e.target.value })}
                  rows={10}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    fontSize: "0.875rem",
                  }}
                />
              </div>

              {previewHtml && (
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Preview
                  </label>
                  <div
                    style={{
                      padding: "1rem",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      background: "#fafafa",
                    }}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                  Reason for Changes
                </label>
                <textarea
                  value={suggestionNotes}
                  onChange={(e) => setSuggestionNotes(e.target.value)}
                  rows={3}
                  placeholder="Explain why you're suggesting these changes..."
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                  }}
                />
              </div>
            </div>

            <div
              style={{
                padding: "1rem 1.5rem",
                borderTop: "1px solid #ddd",
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.75rem",
              }}
            >
              <button
                onClick={closeSuggestModal}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#f8f9fa",
                  border: "1px solid #ddd",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitSuggestion}
                disabled={saving}
                style={{
                  padding: "0.5rem 1rem",
                  background: saving ? "#6c757d" : "#f59e0b",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Submitting..." : "Submit Suggestion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
