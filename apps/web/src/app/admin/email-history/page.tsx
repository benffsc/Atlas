"use client";

import { useState, useEffect, useCallback } from "react";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { ActionDrawer } from "@/components/shared/ActionDrawer";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SkeletonTable } from "@/components/feedback/Skeleton";
import { fetchApiWithMeta, ApiError } from "@/lib/api-client";
import { COLORS, SPACING, TYPOGRAPHY, BORDERS } from "@/lib/design-tokens";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SentEmail {
  email_id: string;
  template_key: string;
  recipient_email: string;
  recipient_name: string | null;
  subject_rendered: string;
  body_html_rendered: string | null;
  body_text_rendered: string | null;
  status: string;
  error_message: string | null;
  external_id: string | null;
  sent_at: string | null;
  created_at: string;
  created_by: string | null;
}

interface StatusCounts {
  total: number;
  sent: number;
  dry_run: number;
  failed: number;
  pending: number;
}

interface EmailHistoryResponse {
  emails: SentEmail[];
  stats: StatusCounts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  sent: { label: "SENT", bg: COLORS.successLight, text: COLORS.successDark },
  delivered: { label: "DELIVERED", bg: COLORS.successLight, text: COLORS.successDark },
  dry_run: { label: "DRY RUN", bg: COLORS.warningLight, text: COLORS.warningDark },
  failed: { label: "FAILED", bg: COLORS.errorLight, text: COLORS.errorDark },
  pending: { label: "PENDING", bg: COLORS.gray100, text: COLORS.gray700 },
  bounced: { label: "BOUNCED", bg: COLORS.errorLight, text: COLORS.errorDark },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.125rem 0.5rem",
        borderRadius: BORDERS.radius.full,
        fontSize: TYPOGRAPHY.size.xs,
        fontWeight: TYPOGRAPHY.weight.semibold,
        letterSpacing: "0.025em",
        backgroundColor: config.bg,
        color: config.text,
        whiteSpace: "nowrap",
      }}
    >
      {config.label}
    </span>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "--";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "sent", label: "Sent" },
  { value: "dry_run", label: "Dry Run" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
  { value: "delivered", label: "Delivered" },
  { value: "bounced", label: "Bounced" },
];

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EmailHistoryPage() {
  // Data
  const [emails, setEmails] = useState<SentEmail[]>([]);
  const [stats, setStats] = useState<StatusCounts>({
    total: 0,
    sent: 0,
    dry_run: 0,
    failed: 0,
    pending: 0,
  });
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [daysFilter, setDaysFilter] = useState("30");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<SentEmail | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [statusFilter, daysFilter]);

  // Fetch data
  const fetchEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (daysFilter !== "all") params.set("days", daysFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));

      const result = await fetchApiWithMeta<EmailHistoryResponse>(
        `/api/admin/email-history?${params.toString()}`
      );

      setEmails(result.data.emails);
      setStats(result.data.stats);
      setTotalCount(result.meta?.total ?? result.data.emails.length);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load email history"
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter, daysFilter, debouncedSearch, page]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: SPACING.xl }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: SPACING.xl,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: TYPOGRAPHY.size["2xl"],
              fontWeight: TYPOGRAPHY.weight.bold,
              color: COLORS.textPrimary,
            }}
          >
            Email History
          </h1>
          <p
            style={{
              margin: 0,
              marginTop: SPACING.xs,
              fontSize: TYPOGRAPHY.size.sm,
              color: COLORS.textSecondary,
            }}
          >
            View all emails sent from the system
          </p>
        </div>
        <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Email History" }]} />
      </div>

      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: SPACING.md,
          marginBottom: SPACING.xl,
        }}
      >
        <StatCard label="Total" value={stats.total} color={COLORS.primary} />
        <StatCard label="Sent" value={stats.sent} color={COLORS.success} />
        <StatCard
          label="Dry Run"
          value={stats.dry_run}
          color={COLORS.warning}
        />
        <StatCard label="Failed" value={stats.failed} color={COLORS.error} />
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: SPACING.md,
          marginBottom: SPACING.lg,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={selectStyle}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={daysFilter}
          onChange={(e) => setDaysFilter(e.target.value)}
          style={selectStyle}
        >
          {DAY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search by recipient email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            ...selectStyle,
            flex: "1 1 200px",
            minWidth: 200,
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            marginBottom: SPACING.lg,
            padding: SPACING.md,
            backgroundColor: COLORS.errorLight,
            border: `1px solid ${COLORS.error}`,
            borderRadius: BORDERS.radius.lg,
            color: COLORS.errorDark,
            fontSize: TYPOGRAPHY.size.sm,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: COLORS.errorDark,
              cursor: "pointer",
              textDecoration: "underline",
              fontSize: TYPOGRAPHY.size.sm,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ padding: SPACING.xl }}>
          <SkeletonTable rows={8} columns={6} />
        </div>
      ) : emails.length === 0 ? (
        <EmptyState
          variant={debouncedSearch ? "search" : "default"}
          title={debouncedSearch ? "No results found" : "No emails yet"}
          description={
            debouncedSearch
              ? `No emails match "${debouncedSearch}"`
              : "No emails have been sent with the current filters"
          }
          action={
            debouncedSearch
              ? {
                  label: "Clear search",
                  onClick: () => setSearchQuery(""),
                }
              : undefined
          }
        />
      ) : (
        <>
          <div
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: BORDERS.radius.lg,
              overflow: "hidden",
              backgroundColor: COLORS.bgPrimary,
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: COLORS.bgSecondary,
                    borderBottom: `1px solid ${COLORS.border}`,
                  }}
                >
                  {["Status", "Recipient", "Subject", "Template", "Sent At", "Sent By"].map(
                    (header) => (
                      <th
                        key={header}
                        style={{
                          padding: `${SPACING.md} ${SPACING.lg}`,
                          textAlign: "left",
                          fontSize: TYPOGRAPHY.size.xs,
                          fontWeight: TYPOGRAPHY.weight.medium,
                          color: COLORS.textSecondary,
                          textTransform: "uppercase" as const,
                          letterSpacing: "0.05em",
                        }}
                      >
                        {header}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {emails.map((email) => (
                  <tr
                    key={email.email_id}
                    onClick={() => setSelectedEmail(email)}
                    style={{
                      borderBottom: `1px solid ${COLORS.border}`,
                      cursor: "pointer",
                      transition: "background-color 150ms ease",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = COLORS.bgSecondary)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                  >
                    <td style={cellStyle}>
                      <StatusBadge status={email.status} />
                      {email.error_message && (
                        <div
                          style={{
                            marginTop: SPACING.xs,
                            fontSize: TYPOGRAPHY.size.xs,
                            color: COLORS.errorDark,
                            maxWidth: 160,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={email.error_message}
                        >
                          {email.error_message}
                        </div>
                      )}
                    </td>
                    <td style={cellStyle}>
                      <div
                        style={{
                          fontSize: TYPOGRAPHY.size.sm,
                          fontWeight: TYPOGRAPHY.weight.medium,
                          color: COLORS.textPrimary,
                        }}
                      >
                        {email.recipient_name || email.recipient_email}
                      </div>
                      {email.recipient_name && (
                        <div
                          style={{
                            fontSize: TYPOGRAPHY.size.xs,
                            color: COLORS.textSecondary,
                          }}
                        >
                          {email.recipient_email}
                        </div>
                      )}
                    </td>
                    <td style={cellStyle}>
                      <div
                        style={{
                          fontSize: TYPOGRAPHY.size.sm,
                          color: COLORS.textPrimary,
                          maxWidth: 280,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={email.subject_rendered}
                      >
                        {email.subject_rendered}
                      </div>
                    </td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          fontSize: TYPOGRAPHY.size.xs,
                          color: COLORS.textSecondary,
                          fontFamily: TYPOGRAPHY.family.mono,
                        }}
                      >
                        {email.template_key}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          fontSize: TYPOGRAPHY.size.sm,
                          color: COLORS.textSecondary,
                        }}
                      >
                        {formatDate(email.sent_at || email.created_at)}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          fontSize: TYPOGRAPHY.size.sm,
                          color: COLORS.textSecondary,
                        }}
                      >
                        {email.created_by || "--"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: SPACING.lg,
              paddingTop: SPACING.md,
            }}
          >
            <span
              style={{
                fontSize: TYPOGRAPHY.size.sm,
                color: COLORS.textSecondary,
              }}
            >
              Showing {page * PAGE_SIZE + 1}--
              {Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
            </span>
            <div style={{ display: "flex", gap: SPACING.sm }}>
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Detail Drawer */}
      <ActionDrawer
        isOpen={!!selectedEmail}
        onClose={() => setSelectedEmail(null)}
        title="Email Detail"
        width="lg"
        footer={
          <Button variant="secondary" onClick={() => setSelectedEmail(null)}>
            Close
          </Button>
        }
      >
        {selectedEmail && <EmailDetail email={selectedEmail} />}
      </ActionDrawer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      style={{
        padding: SPACING.lg,
        borderRadius: BORDERS.radius.lg,
        border: `1px solid ${COLORS.border}`,
        backgroundColor: COLORS.bgPrimary,
      }}
    >
      <div
        style={{
          fontSize: TYPOGRAPHY.size.xs,
          fontWeight: TYPOGRAPHY.weight.medium,
          color: COLORS.textSecondary,
          textTransform: "uppercase" as const,
          letterSpacing: "0.05em",
          marginBottom: SPACING.xs,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: TYPOGRAPHY.size["2xl"],
          fontWeight: TYPOGRAPHY.weight.bold,
          color,
        }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function EmailDetail({ email }: { email: SentEmail }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SPACING.lg }}>
      {/* Meta fields */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          gap: `${SPACING.sm} ${SPACING.md}`,
          fontSize: TYPOGRAPHY.size.sm,
        }}
      >
        <MetaLabel>Status</MetaLabel>
        <div>
          <StatusBadge status={email.status} />
        </div>

        <MetaLabel>Recipient</MetaLabel>
        <div style={{ color: COLORS.textPrimary }}>
          {email.recipient_name && (
            <span style={{ fontWeight: TYPOGRAPHY.weight.medium }}>
              {email.recipient_name}{" "}
            </span>
          )}
          <span style={{ color: COLORS.textSecondary }}>
            &lt;{email.recipient_email}&gt;
          </span>
        </div>

        <MetaLabel>Subject</MetaLabel>
        <div
          style={{
            color: COLORS.textPrimary,
            fontWeight: TYPOGRAPHY.weight.medium,
          }}
        >
          {email.subject_rendered}
        </div>

        <MetaLabel>Template</MetaLabel>
        <div
          style={{
            fontFamily: TYPOGRAPHY.family.mono,
            fontSize: TYPOGRAPHY.size.xs,
            color: COLORS.textSecondary,
          }}
        >
          {email.template_key}
        </div>

        <MetaLabel>Sent At</MetaLabel>
        <div style={{ color: COLORS.textSecondary }}>
          {formatDate(email.sent_at || email.created_at)}
        </div>

        <MetaLabel>Created By</MetaLabel>
        <div style={{ color: COLORS.textSecondary }}>
          {email.created_by || "--"}
        </div>

        {email.external_id && (
          <>
            <MetaLabel>External ID</MetaLabel>
            <div
              style={{
                fontFamily: TYPOGRAPHY.family.mono,
                fontSize: TYPOGRAPHY.size.xs,
                color: COLORS.textSecondary,
                wordBreak: "break-all",
              }}
            >
              {email.external_id}
            </div>
          </>
        )}

        {email.error_message && (
          <>
            <MetaLabel>Error</MetaLabel>
            <div
              style={{
                color: COLORS.errorDark,
                fontSize: TYPOGRAPHY.size.sm,
              }}
            >
              {email.error_message}
            </div>
          </>
        )}
      </div>

      {/* Rendered email body */}
      {email.body_html_rendered && (
        <div>
          <div
            style={{
              fontSize: TYPOGRAPHY.size.xs,
              fontWeight: TYPOGRAPHY.weight.semibold,
              color: COLORS.textSecondary,
              textTransform: "uppercase" as const,
              letterSpacing: "0.05em",
              marginBottom: SPACING.sm,
            }}
          >
            Rendered Email
          </div>
          <iframe
            srcDoc={email.body_html_rendered}
            sandbox=""
            title="Rendered email preview"
            style={{
              width: "100%",
              minHeight: 400,
              border: `1px solid ${COLORS.border}`,
              borderRadius: BORDERS.radius.lg,
              backgroundColor: "#fff",
            }}
          />
        </div>
      )}

      {/* Text fallback if no HTML */}
      {!email.body_html_rendered && email.body_text_rendered && (
        <div>
          <div
            style={{
              fontSize: TYPOGRAPHY.size.xs,
              fontWeight: TYPOGRAPHY.weight.semibold,
              color: COLORS.textSecondary,
              textTransform: "uppercase" as const,
              letterSpacing: "0.05em",
              marginBottom: SPACING.sm,
            }}
          >
            Email Body (Plain Text)
          </div>
          <pre
            style={{
              padding: SPACING.lg,
              backgroundColor: COLORS.bgSecondary,
              border: `1px solid ${COLORS.border}`,
              borderRadius: BORDERS.radius.lg,
              fontSize: TYPOGRAPHY.size.sm,
              fontFamily: TYPOGRAPHY.family.mono,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: COLORS.textPrimary,
              margin: 0,
            }}
          >
            {email.body_text_rendered}
          </pre>
        </div>
      )}
    </div>
  );
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: TYPOGRAPHY.size.xs,
        fontWeight: TYPOGRAPHY.weight.medium,
        color: COLORS.textSecondary,
        paddingTop: "0.1rem",
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const cellStyle: React.CSSProperties = {
  padding: `${SPACING.md} ${SPACING.lg}`,
  verticalAlign: "top",
};

const selectStyle: React.CSSProperties = {
  padding: `${SPACING.sm} ${SPACING.md}`,
  fontSize: TYPOGRAPHY.size.sm,
  border: `1px solid ${COLORS.border}`,
  borderRadius: BORDERS.radius.lg,
  backgroundColor: COLORS.bgPrimary,
  color: COLORS.textPrimary,
  outline: "none",
  minWidth: 140,
};
