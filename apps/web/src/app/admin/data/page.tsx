"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SkeletonStats } from "@/components/feedback/Skeleton";
import { fetchApi } from "@/lib/api-client";
import ClinicHQUploadModal from "@/components/modals/ClinicHQUploadModal";

// ============================================================================
// Types
// ============================================================================

interface HealthData {
  status: string;
  summary: {
    decisions_24h: number;
    pending_reviews: number;
    avg_processing_ms: number;
  };
  households: {
    total: number;
  };
}

interface QueueSummary {
  identity: {
    total: number;
    tier1_email: number;
    tier2_phone_name: number;
    tier3_phone_only: number;
    tier4_name_address: number;
    tier5_name_only: number;
    data_engine_pending: number;
  };
  places: {
    total: number;
    close_similar: number;
    close_different: number;
  };
  quality: {
    total: number;
  };
  ai_parsed: {
    total: number;
    colony_estimates: number;
    reproduction: number;
    mortality: number;
  };
  owner_changes: {
    total: number;
    transfers: number;
    household: number;
  };
}

interface SourceStatus {
  last_sync: string | null;
  records_24h: number;
  total_records: number;
  status: "active" | "ok" | "warning" | "stale" | "never";
  sync_type: "file_upload" | "api_cron" | "api_manual";
  description: string;
}

interface StalenessAlert {
  source: string;
  level: "warning" | "critical";
  message: string;
  hours_stale: number;
}

interface ProcessingStats {
  sources: Record<string, SourceStatus>;
  entity_linking: {
    appointments_linked: number;
    cats_linked: number;
    places_inferred: number;
    last_run: string | null;
  };
  jobs: {
    pending: number;
    running: number;
    completed_24h: number;
    failed_24h: number;
  };
  staleness_alerts?: StalenessAlert[];
  staged_backlog?: Array<{ source_system: string; source_table: string; pending: number }>;
}

// ============================================================================
// Helpers
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string }> = {
    healthy: { bg: "#dcfce7", color: "#166534" },
    active: { bg: "#dcfce7", color: "#166534" },
    ok: { bg: "#dcfce7", color: "#166534" },
    warning: { bg: "#fef3c7", color: "#92400e" },
    stale: { bg: "#fef3c7", color: "#92400e" },
    inactive: { bg: "#f3f4f6", color: "#6b7280" },
    never: { bg: "#f3f4f6", color: "#6b7280" },
    error: { bg: "#fee2e2", color: "#dc2626" },
  };
  const { bg, color } = config[status.toLowerCase()] || config.inactive;

  return (
    <span
      style={{
        padding: "0.15rem 0.5rem",
        borderRadius: "9999px",
        fontSize: "0.7rem",
        fontWeight: 600,
        background: bg,
        color: color,
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const sourceConfig: Record<string, { color: string; label: string; syncLabel: string }> = {
  clinichq: { color: "#2563eb", label: "ClinicHQ", syncLabel: "File Upload" },
  shelterluv: { color: "#10b981", label: "ShelterLuv", syncLabel: "API Cron" },
  airtable: { color: "#f59e0b", label: "Airtable", syncLabel: "Legacy" },
  volunteerhub: { color: "#8b5cf6", label: "VolunteerHub", syncLabel: "Manual + Cron" },
  petlink: { color: "#ec4899", label: "PetLink", syncLabel: "File Upload" },
};

// ============================================================================
// Section: Health Banner
// ============================================================================

function HealthBanner() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchApi<HealthData>("/api/health/data-engine")
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div style={{
        padding: "0.75rem 1rem",
        background: "#fee2e2",
        borderRadius: "8px",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        fontSize: "0.875rem",
        color: "#dc2626",
      }}>
        <Icon name="alert-triangle" size={16} />
        Pipeline health check failed
      </div>
    );
  }

  if (!health) return null;

  const isHealthy = health.status === "healthy";
  const s = health.summary;

  return (
    <div style={{
      padding: "0.75rem 1rem",
      background: isHealthy ? "#dcfce7" : "#fef3c7",
      borderRadius: "8px",
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      fontSize: "0.875rem",
      color: isHealthy ? "#166534" : "#92400e",
    }}>
      <Icon name={isHealthy ? "check-circle" : "alert-triangle"} size={16} />
      <span style={{ fontWeight: 600 }}>
        Data Engine {health.status}
      </span>
      <span style={{ opacity: 0.8 }}>
        — {s.decisions_24h} decisions in 24h, {s.pending_reviews} pending reviews, {health.households.total} households
      </span>
    </div>
  );
}

// ============================================================================
// Section 1: Needs Attention
// ============================================================================

function NeedsAttentionSection() {
  const [data, setData] = useState<QueueSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi<QueueSummary>("/api/admin/reviews/summary")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonStats count={6} />;
  if (!data) return null;

  const totalAttention =
    data.identity.total +
    data.places.total +
    data.quality.total +
    data.ai_parsed.total +
    (data.owner_changes?.total || 0) +
    (data.identity.data_engine_pending || 0);

  const cards = [
    { label: "Person Dedup", value: data.identity.total, href: "/admin/person-dedup", color: "var(--primary, #3b82f6)" },
    { label: "Data Engine Review", value: data.identity.data_engine_pending, href: "/admin/data-engine/review", color: "#10b981" },
    { label: "Place Dedup", value: data.places.total, href: "/admin/place-dedup", color: "#8b5cf6" },
    { label: "Quality Issues", value: data.quality.total, href: "/admin/data-quality", color: "#ef4444" },
    { label: "AI-Parsed", value: data.ai_parsed.total, href: "/admin/tippy-corrections", color: "#f59e0b" },
    { label: "Owner Changes", value: data.owner_changes?.total || 0, href: "/admin/owner-changes", color: "#dc2626" },
  ];

  return (
    <section>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--text-secondary)" }}>
        NEEDS ATTENTION {totalAttention > 0 && <span style={{
          fontSize: "0.8rem",
          padding: "0.15rem 0.5rem",
          borderRadius: "9999px",
          background: "#fef3c7",
          color: "#92400e",
          fontWeight: 600,
          marginLeft: "0.5rem",
        }}>{totalAttention}</span>}
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            href={card.href}
            accentColor={card.value > 0 ? card.color : undefined}
          />
        ))}
      </div>
    </section>
  );
}

// ============================================================================
// Section 2: Data Sources
// ============================================================================

function DataSourcesSection() {
  const [data, setData] = useState<ProcessingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi<ProcessingStats>("/api/admin/data/processing")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonStats count={5} />;
  if (!data) return null;

  const alerts = data.staleness_alerts || [];
  const totalStaged = (data.staged_backlog || []).reduce((sum, r) => sum + r.pending, 0);

  return (
    <section>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--text-secondary)" }}>
        DATA SOURCES
      </h2>

      {/* Staleness banners */}
      {alerts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
          {alerts.map((alert) => (
            <div
              key={alert.source}
              style={{
                padding: "0.6rem 1rem",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                fontSize: "0.85rem",
                fontWeight: 500,
                background: alert.level === "critical" ? "#fee2e2" : "#fef3c7",
                color: alert.level === "critical" ? "#991b1b" : "#92400e",
                border: `1px solid ${alert.level === "critical" ? "#fca5a5" : "#fcd34d"}`,
              }}
            >
              <Icon name={alert.level === "critical" ? "alert-triangle" : "clock"} size={16} />
              {alert.message}
            </div>
          ))}
        </div>
      )}

      {/* Staged backlog summary */}
      {totalStaged > 0 && (
        <div style={{
          padding: "0.6rem 1rem",
          borderRadius: "6px",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.85rem",
          fontWeight: 500,
          background: totalStaged > 1000 ? "#fee2e2" : "#fef3c7",
          color: totalStaged > 1000 ? "#991b1b" : "#92400e",
          border: `1px solid ${totalStaged > 1000 ? "#fca5a5" : "#fcd34d"}`,
          marginBottom: "1rem",
        }}>
          <Icon name="database" size={16} />
          {totalStaged.toLocaleString()} unprocessed staged records
          <span style={{ opacity: 0.7, fontSize: "0.75rem" }}>
            ({(data.staged_backlog || []).map(b => `${b.source_system}/${b.source_table}: ${b.pending}`).join(", ")})
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
        {Object.entries(data.sources || {}).map(([key, source]) => {
          const config = sourceConfig[key] || { color: "#6b7280", label: key, syncLabel: "Unknown" };
          return (
            <div
              key={key}
              style={{
                padding: "1rem",
                background: "var(--surface-raised, var(--card-bg))",
                borderRadius: "8px",
                border: "1px solid var(--card-border)",
                borderLeft: `4px solid ${config.color}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <div>
                  <strong style={{ fontSize: "0.95rem" }}>{config.label}</strong>
                  <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "1px" }}>
                    {config.syncLabel}
                  </div>
                </div>
                <StatusBadge status={source.status} />
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                <div>Last sync: {source.last_sync ? timeAgo(source.last_sync) : "Never"}</div>
                {source.total_records > 0 && (
                  <div>{source.total_records.toLocaleString()} records</div>
                )}
              </div>

              {key === "petlink" && (
                <div style={{
                  fontSize: "0.7rem",
                  padding: "0.3rem 0.5rem",
                  background: "#fef3c7",
                  borderRadius: "4px",
                  marginTop: "0.5rem",
                  color: "#92400e",
                }}>
                  Contains fabricated emails - filtered in matching
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================================
// Section 3: Pipeline Health
// ============================================================================

function PipelineHealthSection() {
  const [data, setData] = useState<ProcessingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningJobs, setRunningJobs] = useState(false);
  const [jobMessage, setJobMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchProcessing = () => {
    fetchApi<ProcessingStats>("/api/admin/data/processing")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProcessing();
  }, []);

  const handleRunJobs = async () => {
    setRunningJobs(true);
    setJobMessage(null);
    try {
      const res = await fetch("/api/admin/data/processing", { method: "POST" });
      const result = await res.json();
      if (result.success) {
        setJobMessage({ type: "success", text: result.message || "Jobs started" });
        fetchProcessing();
      } else {
        setJobMessage({ type: "error", text: result.error || "Failed to start jobs" });
      }
    } catch {
      setJobMessage({ type: "error", text: "Failed to start jobs" });
    } finally {
      setRunningJobs(false);
    }
  };

  if (loading) return <SkeletonStats count={6} />;
  if (!data) return null;

  return (
    <section>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--text-secondary)" }}>
        PIPELINE HEALTH
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Entity linking */}
        <div>
          <h3 style={{ fontSize: "0.85rem", fontWeight: 600, margin: "0 0 0.5rem", color: "var(--muted)" }}>
            Entity Linking
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
            <StatCard label="Appts Linked" value={data.entity_linking.appointments_linked} accentColor="var(--primary, #3b82f6)" />
            <StatCard label="Cats Linked" value={data.entity_linking.cats_linked} accentColor="#10b981" />
            <StatCard label="Places Inferred" value={data.entity_linking.places_inferred} accentColor="#8b5cf6" />
          </div>
          {data.entity_linking.last_run && (
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "0.35rem" }}>
              Last run: {timeAgo(data.entity_linking.last_run)}
            </div>
          )}
        </div>

        {/* Jobs */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h3 style={{ fontSize: "0.85rem", fontWeight: 600, margin: 0, color: "var(--muted)" }}>
              Background Jobs
            </h3>
            {data.jobs.pending > 0 && (
              <Button
                variant="outline"
                size="sm"
                icon="play"
                loading={runningJobs}
                onClick={handleRunJobs}
              >
                Run {data.jobs.pending} Pending
              </Button>
            )}
          </div>
          {jobMessage && (
            <div style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "6px",
              fontSize: "0.8rem",
              fontWeight: 500,
              marginBottom: "0.5rem",
              background: jobMessage.type === "success" ? "#dcfce7" : "#fee2e2",
              color: jobMessage.type === "success" ? "#166534" : "#991b1b",
            }}>
              {jobMessage.text}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.5rem" }}>
            <StatCard label="Pending" value={data.jobs.pending} accentColor="#f59e0b" />
            <StatCard label="Running" value={data.jobs.running} accentColor="var(--primary, #3b82f6)" />
            <StatCard label="Completed 24h" value={data.jobs.completed_24h} accentColor="#10b981" />
            <StatCard label="Failed 24h" value={data.jobs.failed_24h} accentColor={data.jobs.failed_24h > 0 ? "#ef4444" : undefined} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Section 4: Quick Links
// ============================================================================

function QuickLinksSection() {
  const links = [
    { label: "Source Confidence", href: "/admin/source-confidence", icon: "shield" },
    { label: "Households", href: "/admin/data-engine/households", icon: "users" },
    { label: "Known Organizations", href: "/admin/known-organizations", icon: "building" },
    { label: "Matching Rules", href: "/api/admin/data-engine/stats", icon: "git-branch" },
    { label: "Identity Health", href: "/admin/identity-health", icon: "heart-pulse" },
    { label: "Orphan Places", href: "/admin/orphan-places", icon: "map-pin-off" },
  ];

  return (
    <section>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "0 0 0.75rem", color: "var(--text-secondary)" }}>
        ADVANCED
      </h2>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
              padding: "0.4rem 0.75rem",
              borderRadius: "6px",
              border: "1px solid var(--card-border)",
              background: "var(--surface-raised, var(--card-bg))",
              color: "var(--text-secondary)",
              fontSize: "0.8rem",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            <Icon name={link.icon} size={14} />
            {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function DataHubPage() {
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <div>
          <h1 style={{ margin: "0 0 0.25rem" }}>Data Hub</h1>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            Data operations, review queues, pipeline health
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button variant="primary" icon="upload" onClick={() => setUploadOpen(true)}>
            Upload ClinicHQ
          </Button>
          <Link href="/admin/vh-upload">
            <Button variant="outline" icon="upload">
              Upload VH
            </Button>
          </Link>
        </div>
      </div>

      {/* Health Banner */}
      <div style={{ marginBottom: "1.5rem" }}>
        <HealthBanner />
      </div>

      {/* Sections — each loads independently */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        <NeedsAttentionSection />
        <DataSourcesSection />
        <PipelineHealthSection />
        <QuickLinksSection />
      </div>

      {/* ClinicHQ Upload Modal */}
      <ClinicHQUploadModal
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => setUploadOpen(false)}
      />
    </div>
  );
}
