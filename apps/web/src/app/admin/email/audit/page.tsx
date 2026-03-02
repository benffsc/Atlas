"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface EmailAuditEntry {
  email_id: string;
  template_key: string | null;
  template_name: string | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string | null;
  body_html_rendered: string | null;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  sent_by: string | null;
  sent_by_name: string | null;
  from_email: string | null;
  person_id: string | null;
  request_id: string | null;
}

interface FilterOption {
  template_key?: string;
  name?: string;
  staff_id?: string;
  display_name?: string;
}

export default function EmailAuditPage() {
  const [emails, setEmails] = useState<EmailAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    templates: [] as FilterOption[],
    senders: [] as FilterOption[],
  });

  // Search/filter state
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [sentBy, setSentBy] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // Selected email for detail view
  const [selectedEmail, setSelectedEmail] = useState<EmailAuditEntry | null>(null);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (templateKey) params.set("template_key", templateKey);
      if (sentBy) params.set("sent_by", sentBy);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      params.set("limit", String(limit));
      params.set("offset", String(offset));

      const response = await fetch(`/api/admin/email-audit?${params}`);
      const result = await response.json();
      const data = result.data || result;

      setEmails(data.emails || []);
      setTotal(data.total || 0);
      if (data.filters) {
        setFilters(data.filters);
      }
    } catch (err) {
      console.error("Failed to fetch audit log:", err);
    } finally {
      setLoading(false);
    }
  }, [search, status, templateKey, sentBy, dateFrom, dateTo, offset]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    fetchEmails();
  };

  const handleExport = async () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    window.location.href = `/api/admin/email-audit/export?${params}`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <Link href="/admin/email" className="text-muted" style={{ textDecoration: "none" }}>
              Email Hub
            </Link>
            <span className="text-muted">/</span>
            <h1 style={{ margin: 0 }}>Audit Log</h1>
          </div>
          <p className="text-muted">Search and review all sent emails</p>
        </div>
        <button onClick={handleExport} className="btn btn-secondary">
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <input
            type="text"
            placeholder="Search recipient, subject..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
          />
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
            className="input"
          >
            <option value="">All Statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
          <select
            value={templateKey}
            onChange={(e) => { setTemplateKey(e.target.value); setOffset(0); }}
            className="input"
          >
            <option value="">All Templates</option>
            {filters.templates.map((t) => (
              <option key={t.template_key} value={t.template_key}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={sentBy}
            onChange={(e) => { setSentBy(e.target.value); setOffset(0); }}
            className="input"
          >
            <option value="">All Senders</option>
            {filters.senders.map((s) => (
              <option key={s.staff_id} value={s.staff_id}>
                {s.display_name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <label className="text-muted" style={{ fontSize: "0.875rem" }}>Date Range:</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }}
            className="input"
            style={{ width: "auto" }}
          />
          <span className="text-muted">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setOffset(0); }}
            className="input"
            style={{ width: "auto" }}
          />
          <div style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary">
            Search
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSearch("");
              setStatus("");
              setTemplateKey("");
              setSentBy("");
              setDateFrom("");
              setDateTo("");
              setOffset(0);
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {/* Results */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center" }} className="text-muted">
            Loading...
          </div>
        ) : emails.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center" }} className="text-muted">
            No emails found
          </div>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--card-border)" }}>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Recipient</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Subject</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Template</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Sent By</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "0.75rem 1rem", textAlign: "left", fontSize: "0.8rem", fontWeight: 600 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((email) => (
                  <tr
                    key={email.email_id}
                    onClick={() => setSelectedEmail(email)}
                    style={{ borderTop: "1px solid var(--card-border)", cursor: "pointer" }}
                    onMouseOver={(e) => e.currentTarget.style.background = "var(--card-border)"}
                    onMouseOut={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>
                        {email.recipient_name || email.recipient_email}
                      </div>
                      {email.recipient_name && (
                        <div className="text-muted" style={{ fontSize: "0.8rem" }}>
                          {email.recipient_email}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.9rem", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {email.subject || "(No subject)"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }} className="text-muted">
                      {email.template_name || "(Custom)"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }} className="text-muted">
                      {email.sent_by_name || "—"}
                    </td>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <StatusBadge status={email.status} />
                    </td>
                    <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem" }} className="text-muted">
                      {formatDate(email.sent_at || email.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem", borderTop: "1px solid var(--card-border)" }}>
              <div className="text-muted" style={{ fontSize: "0.875rem" }}>
                Showing {offset + 1}–{Math.min(offset + limit, total)} of {total} emails
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  className="btn btn-secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  Previous
                </button>
                <span className="text-muted" style={{ padding: "0.5rem", fontSize: "0.875rem" }}>
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="btn btn-secondary"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset(offset + limit)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Email Detail Modal */}
      {selectedEmail && (
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
          onClick={() => setSelectedEmail(null)}
        >
          <div
            className="card"
            style={{
              width: "90%",
              maxWidth: "700px",
              maxHeight: "80vh",
              overflow: "auto",
              padding: "1.5rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0 }}>Email Details</h2>
              <button
                onClick={() => setSelectedEmail(null)}
                className="btn btn-secondary"
                style={{ padding: "0.25rem 0.5rem" }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <DetailRow label="To" value={`${selectedEmail.recipient_name || ""} <${selectedEmail.recipient_email}>`} />
              <DetailRow label="From" value={selectedEmail.from_email || "—"} />
              <DetailRow label="Subject" value={selectedEmail.subject || "(No subject)"} />
              <DetailRow label="Template" value={selectedEmail.template_name || "(Custom)"} />
              <DetailRow label="Sent By" value={selectedEmail.sent_by_name || "—"} />
              <DetailRow label="Status" value={<StatusBadge status={selectedEmail.status} />} />
              <DetailRow label="Date" value={formatDate(selectedEmail.sent_at || selectedEmail.created_at)} />
              {selectedEmail.error_message && (
                <DetailRow
                  label="Error"
                  value={
                    <span style={{ color: "#991b1b" }}>{selectedEmail.error_message}</span>
                  }
                />
              )}
              {selectedEmail.person_id && (
                <DetailRow
                  label="Person"
                  value={
                    <Link href={`/people/${selectedEmail.person_id}`} className="text-link">
                      View Person
                    </Link>
                  }
                />
              )}
              {selectedEmail.request_id && (
                <DetailRow
                  label="Request"
                  value={
                    <Link href={`/requests/${selectedEmail.request_id}`} className="text-link">
                      View Request
                    </Link>
                  }
                />
              )}
            </div>

            {selectedEmail.body_html_rendered && (
              <div style={{ marginTop: "1.5rem" }}>
                <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Email Content</h3>
                <div
                  style={{
                    border: "1px solid var(--card-border)",
                    borderRadius: "6px",
                    padding: "1rem",
                    background: "white",
                    maxHeight: "300px",
                    overflow: "auto",
                  }}
                  dangerouslySetInnerHTML={{ __html: selectedEmail.body_html_rendered }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    sent: { bg: "#dcfce7", text: "#166534" },
    failed: { bg: "#fee2e2", text: "#991b1b" },
    pending: { bg: "#fef3c7", text: "#92400e" },
    draft: { bg: "#f3f4f6", text: "#374151" },
  };
  const style = colors[status] || colors.draft;

  return (
    <span
      style={{
        padding: "0.25rem 0.5rem",
        borderRadius: "4px",
        fontSize: "0.75rem",
        fontWeight: 500,
        background: style.bg,
        color: style.text,
      }}
    >
      {status}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0.5rem", fontSize: "0.9rem" }}>
      <span className="text-muted" style={{ fontWeight: 500 }}>{label}:</span>
      <span>{value}</span>
    </div>
  );
}
