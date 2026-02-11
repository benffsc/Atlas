"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ClinicHQUploadModal from "@/components/ClinicHQUploadModal";

// ============================================================================
// Types
// ============================================================================

interface HealthData {
  status: string;
  health: {
    total_decisions: number;
    pending_reviews: number;
    total_households: number;
    active_rules: number;
    avg_processing_ms: number;
    decisions_24h: number;
    status: string;
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
}

interface SourceStatus {
  last_sync: string | null;
  records_24h: number;
  total_records: number;
  status: "active" | "ok" | "warning" | "stale" | "never";
  sync_type: "file_upload" | "api_cron" | "api_manual";
  description: string;
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
}

interface RuleEffectiveness {
  rule_name: string;
  is_active: boolean;
  total_matches: number;
  avg_score: number;
}

// ============================================================================
// Tab Components
// ============================================================================

function ReviewQueueTab({ data }: { data: QueueSummary | null }) {
  const [activeSubTab, setActiveSubTab] = useState<"identity" | "places" | "quality" | "ai">("identity");

  if (!data) {
    return <p className="text-muted">Loading review queues...</p>;
  }

  const subTabs = [
    { id: "identity" as const, label: "Identity", count: data.identity.total },
    { id: "places" as const, label: "Places", count: data.places.total },
    { id: "quality" as const, label: "Quality", count: data.quality.total },
    { id: "ai" as const, label: "AI-Parsed", count: data.ai_parsed.total },
  ];

  return (
    <div>
      {/* Sub-tabs with counts */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: activeSubTab === tab.id ? "2px solid #3b82f6" : "1px solid #e5e7eb",
              background: activeSubTab === tab.id ? "#eff6ff" : "white",
              cursor: "pointer",
              fontWeight: activeSubTab === tab.id ? 600 : 400,
            }}
          >
            {tab.label}
            <span
              style={{
                marginLeft: "0.5rem",
                padding: "0.15rem 0.5rem",
                borderRadius: "9999px",
                background: tab.count > 0 ? "#fef3c7" : "#f3f4f6",
                color: tab.count > 0 ? "#92400e" : "#6b7280",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Identity sub-tab content */}
      {activeSubTab === "identity" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <StatCard
              label="Tier 1: Email Match"
              value={data.identity.tier1_email}
              href="/admin/person-dedup?tier=1"
              color="#3b82f6"
            />
            <StatCard
              label="Tier 2: Phone + Name"
              value={data.identity.tier2_phone_name}
              href="/admin/person-dedup?tier=2"
              color="#8b5cf6"
            />
            <StatCard
              label="Tier 3: Phone Only"
              value={data.identity.tier3_phone_only}
              href="/admin/person-dedup?tier=3"
              color="#f59e0b"
            />
            <StatCard
              label="Tier 4: Name + Address"
              value={data.identity.tier4_name_address}
              href="/admin/merge-review"
              color="#ef4444"
            />
            <StatCard
              label="Tier 5: Name Only"
              value={data.identity.tier5_name_only}
              href="/admin/person-dedup?tier=5"
              color="#6b7280"
            />
            <StatCard
              label="Data Engine Pending"
              value={data.identity.data_engine_pending}
              href="/admin/data-engine/review"
              color="#10b981"
            />
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <Link href="/admin/person-dedup" className="btn btn-primary">
              Review Person Duplicates
            </Link>
            <Link href="/admin/merge-review" className="btn btn-secondary">
              Same-Name-Same-Address Queue
            </Link>
          </div>
        </div>
      )}

      {/* Places sub-tab content */}
      {activeSubTab === "places" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <StatCard
              label="Close Similar"
              value={data.places.close_similar}
              href="/admin/place-dedup?type=similar"
              color="#3b82f6"
            />
            <StatCard
              label="Close Different"
              value={data.places.close_different}
              href="/admin/place-dedup?type=different"
              color="#f59e0b"
            />
          </div>
          <Link href="/admin/place-dedup" className="btn btn-primary">
            Review Place Duplicates
          </Link>
        </div>
      )}

      {/* Quality sub-tab content */}
      {activeSubTab === "quality" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <StatCard
              label="Quality Issues"
              value={data.quality.total}
              href="/admin/data-quality/review"
              color="#ef4444"
            />
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <Link href="/admin/data-quality" className="btn btn-primary">
              Review Quality Issues
            </Link>
            <Link href="/admin/orphan-places" className="btn btn-secondary">
              Orphan Places
            </Link>
          </div>
        </div>
      )}

      {/* AI-Parsed sub-tab content */}
      {activeSubTab === "ai" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <StatCard
              label="Colony Estimates"
              value={data.ai_parsed.colony_estimates}
              href="/admin/beacon/colony-estimates"
              color="#10b981"
            />
            <StatCard
              label="Reproduction Data"
              value={data.ai_parsed.reproduction}
              href="/admin/beacon/reproduction"
              color="#8b5cf6"
            />
            <StatCard
              label="Mortality Data"
              value={data.ai_parsed.mortality}
              href="/admin/beacon/mortality"
              color="#6b7280"
            />
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <Link href="/admin/tippy-corrections" className="btn btn-primary">
              Tippy Corrections
            </Link>
            <Link href="/admin/classification-review" className="btn btn-secondary">
              AI Classification Review
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessingTab({ data, onOpenClinicHQ, onRefresh }: { data: ProcessingStats | null; onOpenClinicHQ?: () => void; onRefresh?: () => void }) {
  const [runningJobs, setRunningJobs] = useState(false);

  if (!data) {
    return <p className="text-muted">Loading processing status...</p>;
  }

  const handleRunJobs = async () => {
    setRunningJobs(true);
    try {
      const res = await fetch("/api/admin/data/processing", { method: "POST" });
      const result = await res.json();
      if (result.success) {
        alert(result.message);
        onRefresh?.();
      } else {
        alert(result.error || "Failed to start jobs");
      }
    } catch (err) {
      alert("Failed to start jobs");
    } finally {
      setRunningJobs(false);
    }
  };

  // Source display config
  const sourceConfig: Record<string, { color: string; label: string; syncLabel: string }> = {
    clinichq: { color: "#2563eb", label: "ClinicHQ", syncLabel: "File Upload" },
    shelterluv: { color: "#10b981", label: "ShelterLuv", syncLabel: "API Cron" },
    airtable: { color: "#f59e0b", label: "Airtable", syncLabel: "Legacy" },
    volunteerhub: { color: "#8b5cf6", label: "VolunteerHub", syncLabel: "API Cron" },
    petlink: { color: "#ec4899", label: "PetLink", syncLabel: "File Upload" },
  };

  return (
    <div>
      {/* Data Sources Overview */}
      <h3 style={{ marginBottom: "1rem" }}>Data Sources</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        {Object.entries(data.sources || {}).map(([key, source]) => {
          const config = sourceConfig[key] || { color: "#6b7280", label: key, syncLabel: "Unknown" };
          const isFileUpload = source.sync_type === "file_upload";

          return (
            <div
              key={key}
              style={{
                padding: "1.25rem",
                background: "var(--card-bg, white)",
                borderRadius: "8px",
                border: "1px solid var(--border, #e5e7eb)",
                borderLeft: `4px solid ${config.color}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                <div>
                  <strong style={{ fontSize: "1rem" }}>{config.label}</strong>
                  <div style={{ fontSize: "0.7rem", color: "var(--muted, #6b7280)", marginTop: "2px" }}>
                    {config.syncLabel}
                  </div>
                </div>
                <StatusBadge status={source.status} />
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--muted, #6b7280)", marginBottom: "0.75rem" }}>
                <div>Last sync: {source.last_sync ? new Date(source.last_sync).toLocaleDateString() : "Never"}</div>
                <div>{source.description}</div>
                {source.total_records > 0 && (
                  <div style={{ marginTop: "0.25rem" }}>Total: {source.total_records.toLocaleString()} records</div>
                )}
              </div>

              {/* PetLink warning */}
              {key === "petlink" && (
                <div style={{
                  fontSize: "0.7rem",
                  padding: "0.4rem 0.6rem",
                  background: "#fef3c7",
                  borderRadius: "4px",
                  marginBottom: "0.5rem",
                  color: "#92400e",
                }}>
                  ⚠️ Contains fabricated emails - filtered in matching
                </div>
              )}

              {/* Action button for file uploads */}
              {isFileUpload && key === "clinichq" && (
                <button
                  onClick={onOpenClinicHQ}
                  style={{
                    width: "100%",
                    padding: "0.6rem 1rem",
                    background: config.color,
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Upload Batch
                </button>
              )}

              {/* API cron status indicator */}
              {source.sync_type === "api_cron" && (
                <div style={{
                  fontSize: "0.7rem",
                  color: "var(--muted, #6b7280)",
                  padding: "0.4rem 0.6rem",
                  background: "var(--bg-secondary, #f3f4f6)",
                  borderRadius: "4px",
                  textAlign: "center",
                }}>
                  Automatic - No action needed
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Entity Linking */}
      <h3 style={{ marginBottom: "1rem" }}>Entity Linking Pipeline</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard label="Appointments Linked" value={data.entity_linking.appointments_linked} color="#3b82f6" />
        <StatCard label="Cats Linked" value={data.entity_linking.cats_linked} color="#10b981" />
        <StatCard label="Places Inferred" value={data.entity_linking.places_inferred} color="#8b5cf6" />
      </div>

      {/* Job Queue */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0 }}>Background Jobs</h3>
        {data.jobs.pending > 0 && (
          <button
            onClick={handleRunJobs}
            disabled={runningJobs}
            style={{
              padding: "0.5rem 1rem",
              background: runningJobs ? "var(--muted, #9ca3af)" : "#f59e0b",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "0.85rem",
              fontWeight: 500,
              cursor: runningJobs ? "not-allowed" : "pointer",
            }}
          >
            {runningJobs ? "Starting..." : `Run ${data.jobs.pending} Pending Jobs`}
          </button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem" }}>
        <StatCard label="Pending" value={data.jobs.pending} color="#f59e0b" />
        <StatCard label="Running" value={data.jobs.running} color="#3b82f6" />
        <StatCard label="Completed (24h)" value={data.jobs.completed_24h} color="#10b981" />
        <StatCard label="Failed (24h)" value={data.jobs.failed_24h} color="#ef4444" />
      </div>
    </div>
  );
}

function ConfigurationTab({ rules }: { rules: RuleEffectiveness[] }) {
  return (
    <div>
      {/* Matching Rules */}
      <h3 style={{ marginBottom: "1rem" }}>Matching Rules</h3>
      <div style={{ background: "white", borderRadius: "8px", border: "1px solid #e5e7eb", overflow: "hidden", marginBottom: "2rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={{ padding: "0.75rem 1rem", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Rule</th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid #e5e7eb" }}>Status</th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Matches</th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Avg Score</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: "2rem", textAlign: "center", color: "#6b7280" }}>
                  No matching rules configured
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.rule_name}>
                  <td style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #e5e7eb" }}>{rule.rule_name}</td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid #e5e7eb" }}>
                    <StatusBadge status={rule.is_active ? "active" : "inactive"} />
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>
                    {rule.total_matches.toLocaleString()}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>
                    {(rule.avg_score * 100).toFixed(0)}%
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Quick Links */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <Link href="/admin/source-confidence" className="btn btn-secondary">
          Source Confidence Levels
        </Link>
        <Link href="/admin/known-organizations" className="btn btn-secondary">
          Known Organizations
        </Link>
        <Link href="/admin/data-engine/households" className="btn btn-secondary">
          Households
        </Link>
      </div>
    </div>
  );
}

function HealthTab({ health }: { health: HealthData | null }) {
  if (!health) {
    return <p className="text-muted">Loading health metrics...</p>;
  }

  const h = health.health;

  return (
    <div>
      {/* Overall Status */}
      <div
        style={{
          padding: "1rem",
          background: h.status === "healthy" ? "#dcfce7" : "#fef3c7",
          borderRadius: "8px",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <span style={{ fontSize: "1.5rem" }}>{h.status === "healthy" ? "✓" : "⚠"}</span>
        <span style={{ fontWeight: 600 }}>
          Data Engine Status: {h.status.charAt(0).toUpperCase() + h.status.slice(1)}
        </span>
      </div>

      {/* Metrics Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard label="Total Decisions" value={h.total_decisions} color="#3b82f6" />
        <StatCard label="Decisions (24h)" value={h.decisions_24h} color="#10b981" />
        <StatCard label="Pending Reviews" value={h.pending_reviews} color="#f59e0b" />
        <StatCard label="Total Households" value={h.total_households} color="#8b5cf6" />
        <StatCard label="Active Rules" value={h.active_rules} color="#6b7280" />
        <StatCard label="Avg Processing" value={`${h.avg_processing_ms}ms`} color="#3b82f6" />
      </div>

      {/* Links */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <Link href="/api/health/data-engine" className="btn btn-secondary" target="_blank">
          Full Health JSON
        </Link>
        <Link href="/admin/identity-health" className="btn btn-secondary">
          Identity Resolution Health
        </Link>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function StatCard({
  label,
  value,
  href,
  color,
}: {
  label: string;
  value: number | string;
  href?: string;
  color: string;
}) {
  const content = (
    <div
      style={{
        padding: "1rem",
        background: "white",
        borderRadius: "8px",
        border: "1px solid #e5e7eb",
        borderLeft: `4px solid ${color}`,
        cursor: href ? "pointer" : "default",
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={(e) => href && (e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(0,0,0,0.1)")}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
    >
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{typeof value === "number" ? value.toLocaleString() : value}</div>
    </div>
  );

  return href ? <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>{content}</Link> : content;
}

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

// ============================================================================
// Main Page
// ============================================================================

type TabId = "review" | "processing" | "config" | "health";

const validTabs: TabId[] = ["review", "processing", "config", "health"];

// Wrapper component to handle Suspense boundary for useSearchParams
export default function DataHubPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}>Loading Data Hub...</div>}>
      <DataHubContent />
    </Suspense>
  );
}

function DataHubContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: TabId = tabParam && validTabs.includes(tabParam as TabId)
    ? (tabParam as TabId)
    : "review";

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showClinicHQModal, setShowClinicHQModal] = useState(false);

  // Data for each tab
  const [queueData, setQueueData] = useState<QueueSummary | null>(null);
  const [processingData, setProcessingData] = useState<ProcessingStats | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [rulesData, setRulesData] = useState<RuleEffectiveness[]>([]);

  // Sync tab with URL param
  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam as TabId)) {
      setActiveTab(tabParam as TabId);
    }
  }, [tabParam]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [queue, processing, health, stats] = await Promise.all([
        fetch("/api/admin/reviews/summary").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/admin/data/processing").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/health/data-engine").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/admin/data-engine/stats").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      // Only set data if it has the expected structure (not an error response)
      setQueueData(queue?.identity ? queue : null);
      setProcessingData(processing?.sources ? processing : null);
      setHealthData(health?.health ? health : null);
      setRulesData(stats?.rule_effectiveness || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const tabs = [
    { id: "review" as const, label: "Review Queue", count: queueData ? queueData.identity.total + queueData.places.total + queueData.quality.total + queueData.ai_parsed.total : 0 },
    { id: "processing" as const, label: "Processing", count: processingData?.jobs.pending || 0 },
    { id: "config" as const, label: "Configuration", count: rulesData.length },
    { id: "health" as const, label: "Health", count: null },
  ];

  if (error) {
    return (
      <div>
        <h1>Data Hub</h1>
        <div style={{ padding: "1rem", background: "#fef2f2", border: "1px solid #ef4444", borderRadius: "8px" }}>
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Data Hub</h1>
        {healthData && (
          <StatusBadge status={healthData.health.status} />
        )}
      </div>

      {/* Main Tabs */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.5rem", borderBottom: "1px solid #e5e7eb", paddingBottom: "0" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "0.75rem 1.25rem",
              border: "none",
              borderBottom: activeTab === tab.id ? "3px solid #3b82f6" : "3px solid transparent",
              background: "transparent",
              cursor: "pointer",
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? "#1d4ed8" : "#6b7280",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            {tab.label}
            {tab.count !== null && tab.count > 0 && (
              <span
                style={{
                  padding: "0.1rem 0.4rem",
                  borderRadius: "9999px",
                  background: activeTab === tab.id ? "#dbeafe" : "#f3f4f6",
                  color: activeTab === tab.id ? "#1d4ed8" : "#6b7280",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ background: "var(--bg-secondary, #f9fafb)", padding: "1.5rem", borderRadius: "8px", minHeight: "400px" }}>
        {loading ? (
          <p className="text-muted">Loading...</p>
        ) : (
          <>
            {activeTab === "review" && <ReviewQueueTab data={queueData} />}
            {activeTab === "processing" && <ProcessingTab data={processingData} onOpenClinicHQ={() => setShowClinicHQModal(true)} onRefresh={fetchData} />}
            {activeTab === "config" && <ConfigurationTab rules={rulesData} />}
            {activeTab === "health" && <HealthTab health={healthData} />}
          </>
        )}
      </div>

      {/* ClinicHQ Upload Modal */}
      <ClinicHQUploadModal
        isOpen={showClinicHQModal}
        onClose={() => setShowClinicHQModal(false)}
      />
    </div>
  );
}
