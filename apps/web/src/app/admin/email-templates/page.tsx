"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import DOMPurify from "dompurify";
import { fetchApi, postApi } from "@/lib/api-client";
import { usePermission } from "@/hooks/usePermission";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Button } from "@/components/ui/Button";

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

/** Extended placeholder list for the rich-text editor insert dropdown */
const EDITOR_PLACEHOLDERS = [
  { key: "first_name", description: "Recipient's first name" },
  { key: "detected_county", description: "Detected county" },
  { key: "service_area_name", description: "Service area name" },
  { key: "brand_name", description: "Brand name (short)" },
  { key: "brand_full_name", description: "Brand full name" },
  { key: "org_phone", description: "Org phone number" },
  { key: "org_email", description: "Org email address" },
  { key: "org_address", description: "Org mailing address" },
  { key: "org_website", description: "Org website URL" },
  { key: "org_logo_url", description: "Org logo URL" },
  { key: "nearest_county_resources_html", description: "Nearest county resources (HTML block)" },
  { key: "statewide_resources_html", description: "Statewide resources (HTML block)" },
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

// ---------------------------------------------------------------------------
// RichTextEditor — contentEditable visual editor with formatting toolbar
// ---------------------------------------------------------------------------

const TOOLBAR_BTN: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  background: "var(--bg-secondary, #f5f5f5)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "0.8rem",
  lineHeight: 1,
  fontFamily: "inherit",
  minWidth: "1.75rem",
  textAlign: "center",
};

const TOOLBAR_BTN_ACTIVE: React.CSSProperties = {
  ...TOOLBAR_BTN,
  background: "var(--primary, #0d6efd)",
  color: "#fff",
  borderColor: "var(--primary, #0d6efd)",
};

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  onPreview: () => void;
  label?: string;
  required?: boolean;
}

function RichTextEditor({ value, onChange, onPreview, label, required }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showHtml, setShowHtml] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState(value);
  const [showPlaceholderMenu, setShowPlaceholderMenu] = useState(false);
  const placeholderBtnRef = useRef<HTMLButtonElement>(null);
  const placeholderMenuRef = useRef<HTMLDivElement>(null);
  // Track the last saved selection/range so we can restore it after toolbar clicks
  const savedRangeRef = useRef<Range | null>(null);

  // Sync external value into the editor when it changes (e.g. on modal open)
  const lastExternalValue = useRef(value);
  useEffect(() => {
    if (value !== lastExternalValue.current) {
      lastExternalValue.current = value;
      setHtmlDraft(value);
      if (editorRef.current && !showHtml) {
        editorRef.current.innerHTML = value;
      }
    }
  }, [value, showHtml]);

  // Close placeholder dropdown on outside click
  useEffect(() => {
    if (!showPlaceholderMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        placeholderMenuRef.current &&
        !placeholderMenuRef.current.contains(e.target as Node) &&
        placeholderBtnRef.current &&
        !placeholderBtnRef.current.contains(e.target as Node)
      ) {
        setShowPlaceholderMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPlaceholderMenu]);

  /** Read current HTML from the contentEditable div and push it to parent */
  const syncFromEditor = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastExternalValue.current = html;
    setHtmlDraft(html);
    onChange(html);
  }, [onChange]);

  /** Save selection before a toolbar button steals focus */
  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  /** Restore selection into the editor */
  const restoreSelection = useCallback(() => {
    if (!savedRangeRef.current || !editorRef.current) return;
    editorRef.current.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  }, []);

  // --- Formatting commands ---
  const execCommand = useCallback(
    (cmd: string, val?: string) => {
      restoreSelection();
      document.execCommand(cmd, false, val);
      syncFromEditor();
    },
    [restoreSelection, syncFromEditor],
  );

  const handleBold = () => execCommand("bold");
  const handleItalic = () => execCommand("italic");

  const handleLink = () => {
    restoreSelection();
    const url = prompt("Enter URL:");
    if (url) {
      document.execCommand("createLink", false, url);
      syncFromEditor();
    }
  };

  const handleHeading = () => {
    restoreSelection();
    // Wrap selection in an <h3> styled for email
    document.execCommand("formatBlock", false, "h3");
    syncFromEditor();
  };

  const handleHr = () => {
    restoreSelection();
    document.execCommand("insertHTML", false, "<hr>");
    syncFromEditor();
  };

  const insertPlaceholder = (key: string) => {
    restoreSelection();
    document.execCommand("insertText", false, `{{${key}}}`);
    syncFromEditor();
    setShowPlaceholderMenu(false);
  };

  // Toggle between visual and HTML modes
  const toggleHtmlMode = () => {
    if (showHtml) {
      // Switching from HTML -> visual: push htmlDraft into editor + parent
      lastExternalValue.current = htmlDraft;
      onChange(htmlDraft);
      if (editorRef.current) {
        editorRef.current.innerHTML = htmlDraft;
      }
    } else {
      // Switching from visual -> HTML: sync editor into htmlDraft
      if (editorRef.current) {
        setHtmlDraft(editorRef.current.innerHTML);
      }
    }
    setShowHtml(!showHtml);
  };

  return (
    <div>
      {/* Label row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
        <label style={{ fontWeight: 500 }}>
          {label ?? "Email Body"} {required && <span style={{ color: "#dc3545" }}>*</span>}
        </label>
        <Button variant="ghost" size="sm" onClick={onPreview}>
          Preview
        </Button>
      </div>

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.25rem",
          padding: "0.375rem 0.5rem",
          background: "var(--section-bg, #fafafa)",
          border: "1px solid var(--border)",
          borderBottom: "none",
          borderRadius: "4px 4px 0 0",
          alignItems: "center",
        }}
      >
        {/* Formatting buttons */}
        <button
          type="button"
          style={TOOLBAR_BTN}
          title="Bold"
          onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
          onClick={handleBold}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          style={TOOLBAR_BTN}
          title="Italic"
          onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
          onClick={handleItalic}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          style={TOOLBAR_BTN}
          title="Insert Link"
          onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
          onClick={handleLink}
        >
          Link
        </button>
        <button
          type="button"
          style={TOOLBAR_BTN}
          title="Heading (H3)"
          onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
          onClick={handleHeading}
        >
          H3
        </button>
        <button
          type="button"
          style={TOOLBAR_BTN}
          title="Horizontal Rule"
          onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
          onClick={handleHr}
        >
          &mdash;
        </button>

        {/* Separator */}
        <div style={{ width: "1px", height: "1.25rem", background: "var(--border)", margin: "0 0.25rem" }} />

        {/* Insert Placeholder dropdown */}
        <div style={{ position: "relative" }}>
          <button
            ref={placeholderBtnRef}
            type="button"
            style={showPlaceholderMenu ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
            title="Insert Placeholder"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
            onClick={() => setShowPlaceholderMenu((prev) => !prev)}
          >
            {"{{ }}"}
          </button>
          {showPlaceholderMenu && (
            <div
              ref={placeholderMenuRef}
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                background: "var(--background, #fff)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.12))",
                zIndex: 20,
                width: "260px",
                maxHeight: "280px",
                overflowY: "auto",
              }}
            >
              {EDITOR_PLACEHOLDERS.map(({ key, description }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => insertPlaceholder(key)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "0.375rem 0.75rem",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--section-bg, #f5f5f5)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  <code style={{ fontSize: "0.75rem", color: "var(--primary, #0d6efd)" }}>{`{{${key}}}`}</code>
                  <span style={{ display: "block", fontSize: "0.7rem", color: "var(--muted)" }}>{description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* View HTML toggle */}
        <button
          type="button"
          style={showHtml ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="Toggle raw HTML view"
          onClick={toggleHtmlMode}
        >
          {showHtml ? "Visual" : "HTML"}
        </button>
      </div>

      {/* Editor area */}
      {showHtml ? (
        <textarea
          value={htmlDraft}
          onChange={(e) => setHtmlDraft(e.target.value)}
          onBlur={() => {
            lastExternalValue.current = htmlDraft;
            onChange(htmlDraft);
          }}
          rows={12}
          style={{
            width: "100%",
            padding: "0.75rem",
            border: "1px solid var(--border)",
            borderTop: "none",
            borderRadius: "0 0 4px 4px",
            fontFamily: "monospace",
            fontSize: "0.85rem",
            resize: "vertical",
            minHeight: "200px",
          }}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={syncFromEditor}
          onBlur={() => {
            saveSelection();
            syncFromEditor();
          }}
          onMouseUp={saveSelection}
          onKeyUp={saveSelection}
          dangerouslySetInnerHTML={{ __html: value }}
          style={{
            width: "100%",
            minHeight: "200px",
            padding: "0.75rem",
            border: "1px solid var(--border)",
            borderTop: "none",
            borderRadius: "0 0 4px 4px",
            outline: "none",
            fontSize: "0.9rem",
            lineHeight: 1.6,
            overflowY: "auto",
            maxHeight: "400px",
            background: "#fff",
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function EmailTemplatesAdminPage() {
  const isAdmin = usePermission("admin.email");
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
      const data = await fetchApi<{ templates: EmailTemplate[]; userRole: string; pendingSuggestions: number }>("/api/admin/email-templates");
      setTemplates(data.templates || []);
      setUserRole(data.userRole || "staff");
      setPendingSuggestions(data.pendingSuggestions || 0);
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    } finally {
      setLoading(false);
    }
  };

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

      await postApi("/api/admin/email-templates/suggestions", {
        template_id: suggestingTemplate.template_id,
        ...changes,
        suggestion_notes: suggestionNotes,
      });

      setMessage({ type: "success", text: "Suggestion submitted for review!" });
      setTimeout(() => {
        closeSuggestModal();
        setMessage(null);
      }, 1500);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to submit suggestion" });
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

      await postApi("/api/admin/email-templates", body, { method });

      setMessage({ type: "success", text: editingTemplate ? "Template updated!" : "Template created!" });
      fetchTemplates();
      setTimeout(() => {
        closeModal();
        setMessage(null);
      }, 1500);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save template" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (template: EmailTemplate) => {
    try {
      await postApi("/api/admin/email-templates", {
        template_id: template.template_id,
        is_active: !template.is_active,
      }, { method: "PATCH" });
      fetchTemplates();
    } catch (err) {
      console.error("Failed to toggle template:", err);
    }
  };

  const showPreview = () => {
    // Replace placeholders with sample values for preview
    let html = form.body_html;
    // Use both COMMON_PLACEHOLDERS and EDITOR_PLACEHOLDERS for preview highlighting
    const allKeys = new Set([
      ...COMMON_PLACEHOLDERS.map((p) => p.key),
      ...EDITOR_PLACEHOLDERS.map((p) => p.key),
    ]);
    allKeys.forEach((key) => {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), `<span style="background:#fef3c7;padding:0 2px;">[${key}]</span>`);
    });
    // Sanitize HTML to prevent XSS - only allow safe email-compatible tags
    const sanitized = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'span', 'div', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img', 'hr'],
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
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0" }}>
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
        <EmptyState title="No email templates" description="Create your first email template to get started." />
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
                    <p style={{ color: "var(--muted)", margin: "0.25rem 0 0", fontSize: "0.875rem" }}>
                      {template.description}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                    <span>Subject: <strong>{template.subject}</strong></span>
                    <span>Sent: <strong>{template.send_count}</strong></span>
                    <span>Last sent: {formatDate(template.last_sent)}</span>
                  </div>
                  {template.placeholders && template.placeholders.length > 0 && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Placeholders: </span>
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
                        background: "var(--section-bg)",
                        border: "1px solid var(--border)",
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
              background: "var(--background)",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "800px",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--border)" }}>
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
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      fontFamily: "monospace",
                    }}
                  />
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
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
                      border: "1px solid var(--border)",
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
                    border: "1px solid var(--border)",
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
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
                <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  Use {`{{placeholder}}`} syntax for dynamic values
                </div>
              </div>

              {/* Rich-text editor replaces the raw textarea */}
              <RichTextEditor
                value={form.body_html}
                onChange={(html) => setForm((prev) => ({ ...prev, body_html: html }))}
                onPreview={showPreview}
                label="Email Body"
                required
              />

              {previewHtml && (
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Preview
                  </label>
                  <div
                    style={{
                      padding: "1rem",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      background: "#fafafa",
                    }}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              )}
            </div>

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
                onClick={closeModal}
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--section-bg)",
                  border: "1px solid var(--border)",
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
              background: "var(--background)",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "800px",
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <div style={{ padding: "1.5rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ margin: 0 }}>Suggest Edit</h2>
              <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.875rem" }}>
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
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
              </div>

              {/* Rich-text editor replaces the raw textarea in suggest modal */}
              <RichTextEditor
                value={form.body_html}
                onChange={(html) => setForm((prev) => ({ ...prev, body_html: html }))}
                onPreview={showPreview}
                label="Email Body"
              />

              {previewHtml && (
                <div>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 500 }}>
                    Preview
                  </label>
                  <div
                    style={{
                      padding: "1rem",
                      border: "1px solid var(--border)",
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
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                  }}
                />
              </div>
            </div>

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
                onClick={closeSuggestModal}
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--section-bg)",
                  border: "1px solid var(--border)",
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
