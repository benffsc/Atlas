"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface EmailJob {
  job_id: string;
  category_key: string | null;
  template_key: string | null;
  recipient_email: string;
  recipient_name: string | null;
  status: string;
  created_at: string;
  sent_at: string | null;
  template_name: string | null;
  template_subject: string | null;
  category_name: string | null;
  from_email: string | null;
  created_by_name: string | null;
  error_message: string | null;
}

interface EmailTemplate {
  template_id: string;
  template_key: string;
  name: string;
  subject: string;
  category_key: string | null;
}

interface OutlookAccount {
  account_id: string;
  email: string;
  display_name: string | null;
}

interface EmailCategory {
  category_key: string;
  display_name: string;
  default_outlook_account_id: string | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const statusColors: Record<string, { bg: string; text: string }> = {
  draft: { bg: "#f3f4f6", text: "#374151" },
  queued: { bg: "#fef3c7", text: "#92400e" },
  sending: { bg: "#dbeafe", text: "#1e40af" },
  sent: { bg: "#dcfce7", text: "#166534" },
  failed: { bg: "#fef2f2", text: "#dc2626" },
  cancelled: { bg: "#f3f4f6", text: "#6b7280" },
};

export default function EmailJobsPage() {
  const [jobs, setJobs] = useState<EmailJob[]>([]);
  const [counts, setCounts] = useState({ draft: 0, queued: 0, sent: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("draft");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Create modal state
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [accounts, setAccounts] = useState<OutlookAccount[]>([]);
  const [categories, setCategories] = useState<EmailCategory[]>([]);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    category_key: "",
    template_key: "",
    recipient_email: "",
    recipient_name: "",
    outlook_account_id: "",
    placeholders: {} as Record<string, string>,
  });

  const fetchJobs = async () => {
    try {
      const response = await fetch(`/api/admin/email-jobs?status=${filter}`);
      const result = await response.json();
      const data = result.data || result;
      setJobs(data.jobs || []);
      setCounts(data.counts || { draft: 0, queued: 0, sent: 0, failed: 0 });
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchFormData = async () => {
    try {
      const [templatesRes, accountsRes] = await Promise.all([
        fetch("/api/admin/email-templates"),
        fetch("/api/admin/email-settings/accounts"),
      ]);
      const templatesResult = await templatesRes.json();
      const accountsResult = await accountsRes.json();
      const templatesData = templatesResult.data || templatesResult;
      const accountsData = accountsResult.data || accountsResult;

      setTemplates(templatesData.templates || []);
      setAccounts(accountsData.accounts || []);

      // Extract unique categories from templates
      const cats = new Map<string, EmailCategory>();
      (templatesData.templates || []).forEach((t: EmailTemplate) => {
        if (t.category_key && !cats.has(t.category_key)) {
          cats.set(t.category_key, {
            category_key: t.category_key,
            display_name: t.category_key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
            default_outlook_account_id: null,
          });
        }
      });
      setCategories(Array.from(cats.values()));
    } catch (err) {
      console.error("Failed to fetch form data:", err);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [filter]);

  useEffect(() => {
    if (showCreateModal) {
      fetchFormData();
    }
  }, [showCreateModal]);

  const handleCreateJob = async () => {
    if (!form.recipient_email || !form.template_key) {
      setMessage({ type: "error", text: "Recipient email and template are required" });
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/admin/email-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          outlook_account_id: form.outlook_account_id || undefined,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ type: "success", text: "Email job created" });
        setShowCreateModal(false);
        setForm({
          category_key: "",
          template_key: "",
          recipient_email: "",
          recipient_name: "",
          outlook_account_id: "",
          placeholders: {},
        });
        fetchJobs();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to create job" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to create job" });
    } finally {
      setCreating(false);
    }
  };

  const handleSendJob = async (jobId: string) => {
    setSending(jobId);
    try {
      const response = await fetch(`/api/admin/email-jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ type: "success", text: "Email sent!" });
        fetchJobs();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to send" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to send email" });
    } finally {
      setSending(null);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      const response = await fetch(`/api/admin/email-jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });

      if (response.ok) {
        setMessage({ type: "success", text: "Job cancelled" });
        fetchJobs();
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to cancel job" });
    }
  };

  const selectedTemplate = templates.find(t => t.template_key === form.template_key);

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Link
          href="/admin"
          style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: "0.875rem" }}
        >
          &larr; Admin
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
          <div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Email Jobs</h1>
            <p style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Create, review, and send emails
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: "0.5rem 1rem",
              background: "#0d6efd",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            + New Email Job
          </button>
        </div>
      </div>

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
          }}
        >
          {message.text}
          <button
            onClick={() => setMessage(null)}
            style={{ float: "right", background: "none", border: "none", cursor: "pointer", opacity: 0.7 }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Status Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {[
          { key: "draft", label: "Draft", count: counts.draft },
          { key: "queued", label: "Queued", count: counts.queued },
          { key: "sent", label: "Sent", count: counts.sent },
          { key: "failed", label: "Failed", count: counts.failed },
          { key: "all", label: "All", count: null },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              padding: "0.5rem 1rem",
              background: filter === tab.key ? "#0d6efd" : "var(--background-secondary)",
              color: filter === tab.key ? "white" : "inherit",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            {tab.label} {tab.count !== null && `(${tab.count})`}
          </button>
        ))}
      </div>

      {/* Jobs Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
        ) : jobs.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
            No email jobs found
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--background-secondary)" }}>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>Recipient</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>Template</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>From</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>Status</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: 500, fontSize: "0.875rem" }}>Created</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 500, fontSize: "0.875rem" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr key={job.job_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <div style={{ fontWeight: 500 }}>{job.recipient_name || job.recipient_email}</div>
                    {job.recipient_name && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{job.recipient_email}</div>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <div>{job.template_name || "(Custom)"}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {job.category_name || job.category_key}
                    </div>
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    {job.from_email || "Resend"}
                  </td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                        background: statusColors[job.status]?.bg || "#f3f4f6",
                        color: statusColors[job.status]?.text || "#374151",
                      }}
                      title={job.error_message || undefined}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    {formatDate(job.created_at)}
                    {job.sent_at && (
                      <div style={{ fontSize: "0.7rem" }}>Sent: {formatDate(job.sent_at)}</div>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                    {job.status === "draft" && (
                      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => handleSendJob(job.job_id)}
                          disabled={sending === job.job_id}
                          style={{
                            padding: "0.375rem 0.75rem",
                            background: "#10b981",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            opacity: sending === job.job_id ? 0.5 : 1,
                          }}
                        >
                          {sending === job.job_id ? "..." : "Send"}
                        </button>
                        <button
                          onClick={() => handleCancelJob(job.job_id)}
                          style={{
                            padding: "0.375rem 0.75rem",
                            background: "transparent",
                            color: "#6b7280",
                            border: "1px solid var(--border)",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {job.status === "failed" && (
                      <button
                        onClick={() => handleSendJob(job.job_id)}
                        disabled={sending === job.job_id}
                        style={{
                          padding: "0.375rem 0.75rem",
                          background: "#f59e0b",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "0.75rem",
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1rem",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false);
          }}
        >
          <div className="card" style={{ width: "100%", maxWidth: "500px", maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>New Email Job</h2>
            </div>

            <div style={{ padding: "1.5rem" }}>
              {/* Category */}
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>
                  Category
                </label>
                <select
                  value={form.category_key}
                  onChange={(e) => setForm({ ...form, category_key: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                  }}
                >
                  <option value="">Select category...</option>
                  {categories.map(c => (
                    <option key={c.category_key} value={c.category_key}>{c.display_name}</option>
                  ))}
                </select>
              </div>

              {/* Template */}
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>
                  Template *
                </label>
                <select
                  value={form.template_key}
                  onChange={(e) => setForm({ ...form, template_key: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                  }}
                >
                  <option value="">Select template...</option>
                  {templates
                    .filter(t => !form.category_key || t.category_key === form.category_key)
                    .map(t => (
                      <option key={t.template_key} value={t.template_key}>{t.name}</option>
                    ))}
                </select>
                {selectedTemplate && (
                  <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "var(--background-secondary)", borderRadius: "4px", fontSize: "0.75rem" }}>
                    <strong>Subject:</strong> {selectedTemplate.subject}
                  </div>
                )}
              </div>

              {/* Recipient */}
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>
                  Recipient Email *
                </label>
                <input
                  type="email"
                  value={form.recipient_email}
                  onChange={(e) => setForm({ ...form, recipient_email: e.target.value })}
                  placeholder="email@example.com"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                  }}
                />
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>
                  Recipient Name
                </label>
                <input
                  type="text"
                  value={form.recipient_name}
                  onChange={(e) => setForm({ ...form, recipient_name: e.target.value })}
                  placeholder="John Doe"
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    fontSize: "0.875rem",
                  }}
                />
              </div>

              {/* From Account */}
              {accounts.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>
                    Send From
                  </label>
                  <select
                    value={form.outlook_account_id}
                    onChange={(e) => setForm({ ...form, outlook_account_id: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  >
                    <option value="">Default (Resend)</option>
                    {accounts.map(a => (
                      <option key={a.account_id} value={a.account_id}>{a.email}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Common Placeholders */}
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 500 }}>
                  Placeholders
                </label>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={form.placeholders.first_name || ""}
                    onChange={(e) => setForm({ ...form, placeholders: { ...form.placeholders, first_name: e.target.value } })}
                    placeholder="first_name"
                    style={{
                      padding: "0.5rem",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  />
                  <input
                    type="text"
                    value={form.placeholders.appt_date || ""}
                    onChange={(e) => setForm({ ...form, placeholders: { ...form.placeholders, appt_date: e.target.value } })}
                    placeholder="appt_date (e.g., January 15, 2026)"
                    style={{
                      padding: "0.5rem",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  />
                  <input
                    type="text"
                    value={form.placeholders.cat_count || ""}
                    onChange={(e) => setForm({ ...form, placeholders: { ...form.placeholders, cat_count: e.target.value } })}
                    placeholder="cat_count (e.g., 2)"
                    style={{
                      padding: "0.5rem",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  />
                </div>
              </div>
            </div>

            <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--background-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateJob}
                disabled={creating}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#0d6efd",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  opacity: creating ? 0.7 : 1,
                }}
              >
                {creating ? "Creating..." : "Create Job"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
