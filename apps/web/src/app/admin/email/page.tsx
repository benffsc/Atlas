"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SendEmailModal } from "@/components/modals";
import { fetchApi } from "@/lib/api-client";
import { SkeletonStats } from "@/components/feedback/Skeleton";

interface EmailHubMetrics {
  connected_accounts: number;
  active_templates: number;
  pending_jobs: number;
  pending_batches: number;
  pending_suggestions: number;
  emails_sent_30d: number;
  emails_failed_30d: number;
  success_rate_30d: number;
}

interface RecentEmail {
  email_id: string;
  template_name: string | null;
  recipient_email: string;
  recipient_name: string | null;
  subject: string | null;
  status: string;
  sent_at: string | null;
  created_at: string;
  sent_by_name: string | null;
}

export default function EmailHubPage() {
  const [metrics, setMetrics] = useState<EmailHubMetrics | null>(null);
  const [recentEmails, setRecentEmails] = useState<RecentEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposeModal, setShowComposeModal] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchApi<{ metrics: EmailHubMetrics }>("/api/admin/email-hub/metrics"),
      fetchApi<{ emails: RecentEmail[] }>("/api/admin/email-audit?limit=10"),
    ])
      .then(([metricsData, auditData]) => {
        setMetrics(metricsData.metrics);
        setRecentEmails(auditData.emails || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Email Hub</h1>
          <p className="text-muted">Send emails, manage templates, and view history</p>
        </div>
        <button
          onClick={() => setShowComposeModal(true)}
          className="btn btn-primary"
          style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          <span>✉️</span>
          Compose Email
        </button>
      </div>

      {loading ? (
        <div style={{ padding: "1rem 0" }}><SkeletonStats count={4} /></div>
      ) : (
        <>
          {/* Metrics Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
            <MetricCard
              value={metrics?.connected_accounts || 0}
              label="Connected Accounts"
              icon="📧"
              href="/admin/email-settings"
            />
            <MetricCard
              value={metrics?.active_templates || 0}
              label="Active Templates"
              icon="📄"
              href="/admin/email-templates"
            />
            <MetricCard
              value={metrics?.pending_jobs || 0}
              label="Pending Jobs"
              icon="📤"
              href="/admin/email-jobs"
              warning={(metrics?.pending_jobs ?? 0) > 0}
            />
            <MetricCard
              value={metrics?.pending_batches || 0}
              label="Draft Batches"
              icon="📨"
              href="/admin/email-batches"
            />
            <MetricCard
              value={metrics?.emails_sent_30d || 0}
              label="Sent (30 days)"
              icon="✅"
            />
            <MetricCard
              value={`${metrics?.success_rate_30d || 100}%`}
              label="Success Rate"
              icon="📊"
              good={(metrics?.success_rate_30d || 100) >= 95}
            />
          </div>

          {/* Pending Suggestions Alert */}
          {metrics?.pending_suggestions && metrics.pending_suggestions > 0 && (
            <Link
              href="/admin/email-templates/suggestions"
              className="card"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "1rem",
                marginBottom: "1.5rem",
                background: "#fef3c7",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ fontSize: "1.25rem" }}>💡</span>
              <div>
                <strong>{metrics.pending_suggestions} template suggestion{metrics.pending_suggestions > 1 ? "s" : ""} awaiting review</strong>
                <p className="text-muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem" }}>
                  Click to review and approve or reject staff suggestions
                </p>
              </div>
            </Link>
          )}

          {/* Quick Links */}
          <div style={{ marginBottom: "2rem" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-muted)" }}>Quick Links</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
              <QuickLinkCard
                href="/admin/email-settings"
                title="Email Settings"
                description="Connect Outlook accounts"
                icon="⚙️"
              />
              <QuickLinkCard
                href="/admin/email-templates"
                title="Templates"
                description="Create and edit templates"
                icon="📝"
              />
              <QuickLinkCard
                href="/admin/email-jobs"
                title="Job Queue"
                description="Appointment confirmations"
                icon="📋"
              />
              <QuickLinkCard
                href="/admin/email-batches"
                title="Batches"
                description="Trapper assignment emails"
                icon="📧"
              />
              <QuickLinkCard
                href="/admin/email/audit"
                title="Audit Log"
                description="Search all sent emails"
                icon="🔍"
              />
            </div>
          </div>

          {/* Recent Emails */}
          <div className="card" style={{ padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Recent Emails</h2>
              <Link href="/admin/email/audit" className="text-link" style={{ fontSize: "0.875rem" }}>
                View All →
              </Link>
            </div>

            {recentEmails.length === 0 ? (
              <p className="text-muted">No emails sent yet</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {recentEmails.map((email) => (
                  <div
                    key={email.email_id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto",
                      gap: "1rem",
                      padding: "0.75rem",
                      background: "var(--card-border)",
                      borderRadius: "6px",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {email.recipient_name || email.recipient_email}
                      </div>
                      <div className="text-muted" style={{ fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {email.subject || "(No subject)"}
                      </div>
                    </div>
                    <StatusBadge status={email.status} />
                    <div className="text-muted" style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {formatDate(email.sent_at || email.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Compose Modal */}
      <SendEmailModal
        isOpen={showComposeModal}
        onClose={() => setShowComposeModal(false)}
        onSuccess={() => {
          setShowComposeModal(false);
          // Refresh metrics
          fetchApi<{ metrics: EmailHubMetrics }>("/api/admin/email-hub/metrics")
            .then(data => setMetrics(data.metrics));
          fetchApi<{ emails: RecentEmail[] }>("/api/admin/email-audit?limit=10")
            .then(data => setRecentEmails(data.emails || []));
        }}
      />
    </div>
  );
}

function MetricCard({
  value,
  label,
  icon,
  href,
  warning,
  good,
}: {
  value: number | string;
  label: string;
  icon: string;
  href?: string;
  warning?: boolean;
  good?: boolean;
}) {
  const content = (
    <div
      className="card"
      style={{
        padding: "1rem",
        textAlign: "center",
        background: warning ? "#fef3c7" : good ? "#ecfdf5" : undefined,
        cursor: href ? "pointer" : undefined,
      }}
    >
      <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>{icon}</div>
      <div style={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
      <div className="text-muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>{label}</div>
    </div>
  );

  if (href) {
    return <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>{content}</Link>;
  }
  return content;
}

function QuickLinkCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="card"
      style={{
        padding: "1rem",
        display: "flex",
        gap: "0.75rem",
        alignItems: "center",
        textDecoration: "none",
        color: "inherit",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <span style={{ fontSize: "1.25rem" }}>{icon}</span>
      <div>
        <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>{title}</h3>
        <p className="text-muted" style={{ margin: 0, fontSize: "0.8rem" }}>{description}</p>
      </div>
    </Link>
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
