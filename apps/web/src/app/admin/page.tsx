"use client";

import { useState, useEffect } from "react";
import ClinicHQUploadModal from "@/components/ClinicHQUploadModal";

interface QueueStats {
  total: number;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  by_geo_confidence: Record<string, number>;
}

// Status badge colors for visual clarity
const statusColors: Record<string, string> = {
  new: "#3b82f6",
  in_progress: "#f59e0b",
  scheduled: "#8b5cf6",
  complete: "#10b981",
  archived: "#6b7280",
};

const geoConfidenceColors: Record<string, string> = {
  exact: "#10b981",
  high: "#22c55e",
  medium: "#f59e0b",
  low: "#ef4444",
  "(pending)": "#6b7280",
};

export default function AdminPage() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showClinicHQModal, setShowClinicHQModal] = useState(false);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then(setStats)
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Admin Dashboard</h1>
        <p className="text-muted">Quick access to core admin functions</p>
      </div>

      {/* Two Column Layout - responsive */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(280px, 320px)", gap: "1.5rem", alignItems: "start" }}>

        {/* Main Content - Simplified to 8 Cards in 3 Sections */}
        <div>
          <div style={{ display: "grid", gap: "1.5rem" }}>

            {/* OPERATIONS Section (4 cards) */}
            <section>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-muted)" }}>Operations</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                <AdminCard
                  href="/admin/data"
                  title="Data Hub"
                  description="Review queues, processing, health"
                  icon="📊"
                  badge="New"
                />
                <ActionCard
                  onClick={() => setShowClinicHQModal(true)}
                  title="ClinicHQ Upload"
                  description="Upload 3-file batch from clinic"
                  icon="🏥"
                />
                <AdminCard
                  href="/admin/email"
                  title="Email Hub"
                  description="Send, templates, and history"
                  icon="📧"
                />
                <AdminCard
                  href="/admin/staff"
                  title="Staff & Trappers"
                  description="Manage FFSC personnel"
                  icon="👥"
                />
              </div>
            </section>

            {/* CONFIGURATION Section (4 cards) */}
            <section>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-muted)" }}>Configuration</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                <AdminCard
                  href="/admin/ecology"
                  title="Ecology & Beacon"
                  description="Colony parameters & modeling"
                  icon="🌿"
                />
                <AdminCard
                  href="/admin/intake-fields"
                  title="Intake Fields"
                  description="Custom questions + Airtable"
                  icon="📝"
                />
                <AdminCard
                  href="/admin/organizations"
                  title="Organizations"
                  description="Shelters, rescues, clinics, partners"
                  icon="🏢"
                />
                <AdminCard
                  href="/admin/departments"
                  title="FFSC Departments"
                  description="Internal teams & structure"
                  icon="🐾"
                />
              </div>
            </section>

            {/* DEVELOPER Section (2 cards) */}
            <section>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-muted)" }}>Developer</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                <AdminCard
                  href="/admin/claude-code"
                  title="Claude Code"
                  description="AI development assistant"
                  icon="🤖"
                />
                <AdminCard
                  href="/admin/knowledge-base"
                  title="Knowledge Base"
                  description="Manage Tippy's knowledge"
                  icon="📚"
                />
              </div>
            </section>

            {/* Quick Links Section */}
            <section className="card" style={{ padding: "1.25rem" }}>
              <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>Quick Links</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
                <QuickLink href="/intake/queue" label="Intake Queue" />
                <QuickLink href="/trappers" label="Trapper Assignments" />
                <QuickLink href="/admin/ingest" label="Data Ingest Status" />
                <QuickLink href="/admin/tippy-corrections" label="Tippy Corrections" />
                <QuickLink href="/admin/source-confidence" label="Source Confidence" />
                <QuickLink href="/admin/ai-access" label="AI Access Controls" />
              </div>
            </section>

          </div>
        </div>

        {/* Sidebar - Stats */}
        <aside>
          <div className="card" style={{ padding: "1.25rem", position: "sticky", top: "1rem" }}>
            <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>Intake Stats</h2>

            {loading ? (
              <p className="text-muted">Loading...</p>
            ) : stats ? (
              <div style={{ display: "grid", gap: "1.25rem" }}>
                {/* Total */}
                <div style={{ textAlign: "center", padding: "1rem", background: "var(--card-border)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "2.5rem", fontWeight: 700, lineHeight: 1 }}>{stats.total}</div>
                  <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>Total Submissions</div>
                </div>

                {/* By Status */}
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>By Status</h4>
                  {Object.entries(stats.by_status || {}).map(([status, count]) => (
                    <div key={status} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0" }}>
                      <div style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: statusColors[status] || "#6b7280",
                      }} />
                      <span style={{ flex: 1, fontSize: "0.875rem" }}>{status || "(none)"}</span>
                      <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{count}</span>
                    </div>
                  ))}
                </div>

                {/* By Source */}
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>By Source</h4>
                  {Object.entries(stats.by_source || {}).map(([source, count]) => (
                    <div key={source} style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.875rem" }}>
                      <span>{source || "(none)"}</span>
                      <span style={{ fontWeight: 500 }}>{count}</span>
                    </div>
                  ))}
                </div>

                {/* Geocoding Quality */}
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>Geocoding Quality</h4>
                  {Object.entries(stats.by_geo_confidence || {}).map(([conf, count]) => (
                    <div key={conf} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0" }}>
                      <div style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: geoConfidenceColors[conf] || "#6b7280",
                      }} />
                      <span style={{ flex: 1, fontSize: "0.875rem" }}>{conf || "(pending)"}</span>
                      <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-muted">Could not load stats</p>
            )}
          </div>
        </aside>
      </div>

      {/* ClinicHQ Upload Modal */}
      <ClinicHQUploadModal
        isOpen={showClinicHQModal}
        onClose={() => setShowClinicHQModal(false)}
      />
    </div>
  );
}

// Admin card component - uses CSS variables for dark mode support
function AdminCard({
  href,
  title,
  description,
  icon,
  badge,
}: {
  href: string;
  title: string;
  description: string;
  icon: string;
  badge?: string;
}) {
  return (
    <a
      href={href}
      className="card admin-card"
      style={{
        padding: "1rem",
        display: "flex",
        gap: "0.75rem",
        alignItems: "flex-start",
        textDecoration: "none",
        color: "inherit",
        transition: "transform 0.15s, box-shadow 0.15s",
        position: "relative",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {badge && (
        <span style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.5rem",
          padding: "0.15rem 0.4rem",
          fontSize: "0.65rem",
          fontWeight: 600,
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          borderRadius: "4px",
        }}>
          {badge}
        </span>
      )}
      <span style={{ fontSize: "1.5rem" }}>{icon}</span>
      <div>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "var(--foreground)" }}>{title}</h3>
        <p className="text-muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem" }}>{description}</p>
      </div>
    </a>
  );
}

// Quick link component for secondary navigation - uses CSS variables for dark mode
function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="quick-link"
      style={{
        padding: "0.5rem 0.75rem",
        fontSize: "0.875rem",
        color: "var(--foreground)",
        textDecoration: "none",
        borderRadius: "6px",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = "var(--card-border)";
        e.currentTarget.style.borderColor = "var(--border-light)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "var(--bg-secondary)";
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      {label} →
    </a>
  );
}

// Action card component - button-based for modal triggers
function ActionCard({
  onClick,
  title,
  description,
  icon,
  badge,
}: {
  onClick: () => void;
  title: string;
  description: string;
  icon: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="card admin-card"
      style={{
        padding: "1rem",
        display: "flex",
        gap: "0.75rem",
        alignItems: "flex-start",
        textAlign: "left",
        cursor: "pointer",
        border: "1px solid var(--border)",
        background: "var(--card-bg)",
        transition: "transform 0.15s, box-shadow 0.15s",
        position: "relative",
        width: "100%",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {badge && (
        <span style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.5rem",
          padding: "0.15rem 0.4rem",
          fontSize: "0.65rem",
          fontWeight: 600,
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          borderRadius: "4px",
        }}>
          {badge}
        </span>
      )}
      <span style={{ fontSize: "1.5rem" }}>{icon}</span>
      <div>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: "var(--foreground)" }}>{title}</h3>
        <p className="text-muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem" }}>{description}</p>
      </div>
    </button>
  );
}
