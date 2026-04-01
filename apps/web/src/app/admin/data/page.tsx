"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TabBar } from "@/components/ui/TabBar";
import { StatCard } from "@/components/ui/StatCard";
import { SkeletonTable } from "@/components/feedback/Skeleton";
import { useToast } from "@/components/feedback/Toast";

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
  const [activeSubTab, setActiveSubTab] = useState<"identity" | "places" | "quality" | "ai" | "owner">("identity");

  if (!data) {
    return <p className="text-muted">Loading review queues...</p>;
  }

  const subTabs = [
    { id: "identity" as const, label: "Identity", count: data.identity.total },
    { id: "places" as const, label: "Places", count: data.places.total },
    { id: "quality" as const, label: "Quality", count: data.quality.total },
    { id: "ai" as const, label: "AI-Parsed", count: data.ai_parsed.total },
    { id: "owner" as const, label: "Owner Changes", count: data.owner_changes?.total || 0, highlight: true },
  ];

  return (
    <div>
      {/* Sub-tabs with counts */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {subTabs.map((tab) => {
          const isHighlight = "highlight" in tab && tab.highlight && tab.count > 0;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: activeSubTab === tab.id
                  ? "2px solid #3b82f6"
                  : isHighlight
                    ? "2px solid #f59e0b"
                    : "1px solid #e5e7eb",
                background: activeSubTab === tab.id
                  ? "#eff6ff"
                  : isHighlight
                    ? "#fffbeb"
                    : "white",
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
                  background: isHighlight ? "#fef3c7" : tab.count > 0 ? "#fef3c7" : "#f3f4f6",
                  color: isHighlight ? "#d97706" : tab.count > 0 ? "#92400e" : "#6b7280",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Identity sub-tab content */}
      {activeSubTab === "identity" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <StatCard
              label="Tier 1: Email Match"
              value={data.identity.tier1_email}
              href="/admin/person-dedup?tier=1"
              accentColor="var(--primary, #3b82f6)"
            />
            <StatCard
              label="Tier 2: Phone + Name"
              value={data.identity.tier2_phone_name}
              href="/admin/person-dedup?tier=2"
              accentColor="#8b5cf6"
            />
            <StatCard
              label="Tier 3: Phone Only"
              value={data.identity.tier3_phone_only}
              href="/admin/person-dedup?tier=3"
              accentColor="#f59e0b"
            />
            <StatCard
              label="Tier 4: Name + Address"
              value={data.identity.tier4_name_address}
              href="/admin/merge-review"
              accentColor="#ef4444"
            />
            <StatCard
              label="Tier 5: Name Only"
              value={data.identity.tier5_name_only}
              href="/admin/person-dedup?tier=5"
              accentColor="#6b7280"
            />
            <StatCard
              label="Data Engine Pending"
              value={data.identity.data_engine_pending}
              href="/admin/data-engine/review"
              accentColor="#10b981"
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
              accentColor="var(--primary, #3b82f6)"
            />
            <StatCard
              label="Close Different"
              value={data.places.close_different}
              href="/admin/place-dedup?type=different"
              accentColor="#f59e0b"
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
              accentColor="#ef4444"
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
              accentColor="#10b981"
            />
            <StatCard
              label="Reproduction Data"
              value={data.ai_parsed.reproduction}
              href="/admin/beacon/reproduction"
              accentColor="#8b5cf6"
            />
            <StatCard
              label="Mortality Data"
              value={data.ai_parsed.mortality}
              href="/admin/beacon/mortality"
              accentColor="#6b7280"
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

      {/* Owner Changes sub-tab content (MIG_2504) */}
      {activeSubTab === "owner" && (
        <div>
          {data.owner_changes?.total === 0 ? (
            <div style={{
              padding: "2rem",
              textAlign: "center",
              background: "var(--success-bg)",
              borderRadius: "0.5rem",
              border: "1px solid var(--success-border)",
            }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>No pending reviews</div>
              <p style={{ color: "#6b7280", margin: 0 }}>All owner changes have been resolved</p>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
                <StatCard
                  label="Ownership Transfers"
                  value={data.owner_changes?.transfers || 0}
                  href="/admin/owner-changes?type=transfer"
                  accentColor="#dc2626"
                />
                <StatCard
                  label="Household Changes"
                  value={data.owner_changes?.household || 0}
                  href="/admin/owner-changes?type=household"
                  accentColor="#f59e0b"
                />
                <StatCard
                  label="Total Pending"
                  value={data.owner_changes?.total || 0}
                  href="/admin/owner-changes"
                  accentColor="var(--primary, #3b82f6)"
                />
              </div>
              <div style={{
                padding: "0.75rem 1rem",
                background: "#fef3c7",
                borderRadius: "0.375rem",
                border: "1px solid #fcd34d",
                marginBottom: "1rem",
                fontSize: "0.875rem",
              }}>
                <strong>What to review:</strong> When ClinicHQ account names change (e.g., "Jill Manning" → "Kathleen Sartori"),
                review whether it's the same person updating their info or a different person taking over cat care.
              </div>
            </>
          )}
          <Link href="/admin/owner-changes" className="btn btn-primary">
            Review Owner Changes
          </Link>
        </div>
      )}
    </div>
  );
}

function ProcessingTab({ data, onRefresh }: { data: ProcessingStats | null; onRefresh?: () => void }) {
  const { addToast } = useToast();
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
        addToast({ type: "success", message: result.message });
        onRefresh?.();
      } else {
        addToast({ type: "error", message: result.error || "Failed to start jobs" });
      }
    } catch (err) {
      addToast({ type: "error", message: "Failed to start jobs" });
    } finally {
      setRunningJobs(false);
    }
  };

  // Source display config
  const sourceConfig: Record<string, { color: string; label: string; syncLabel: string }> = {
    clinichq: { color: "#2563eb", label: "ClinicHQ", syncLabel: "File Upload" },
    shelterluv: { color: "#10b981", label: "ShelterLuv", syncLabel: "API Cron" },
    airtable: { color: "#f59e0b", label: "Airtable", syncLabel: "Legacy" },
    volunteerhub: { color: "#8b5cf6", label: "VolunteerHub", syncLabel: "API Cron + Manual Upload" },
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
              {(isFileUpload && key === "clinichq") && (
                <Link
                  href="/admin/data?tab=processing"
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.6rem 1rem",
                    background: config.color,
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    textAlign: "center",
                    textDecoration: "none",
                  }}
                >
                  Upload Data →
                </Link>
              )}

              {/* Manual upload for VolunteerHub (fallback when API is down) */}
              {key === "volunteerhub" && (
                <Link
                  href="/admin/data?tab=processing&source=volunteerhub"
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "0.6rem 1rem",
                    background: config.color,
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    textAlign: "center",
                    textDecoration: "none",
                    marginTop: "0.5rem",
                  }}
                >
                  Upload Excel Export →
                </Link>
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
        <StatCard label="Appointments Linked" value={data.entity_linking.appointments_linked} accentColor="var(--primary, #3b82f6)" />
        <StatCard label="Cats Linked" value={data.entity_linking.cats_linked} accentColor="#10b981" />
        <StatCard label="Places Inferred" value={data.entity_linking.places_inferred} accentColor="#8b5cf6" />
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
        <StatCard label="Pending" value={data.jobs.pending} accentColor="#f59e0b" />
        <StatCard label="Running" value={data.jobs.running} accentColor="var(--primary, #3b82f6)" />
        <StatCard label="Completed (24h)" value={data.jobs.completed_24h} accentColor="#10b981" />
        <StatCard label="Failed (24h)" value={data.jobs.failed_24h} accentColor="#ef4444" />
      </div>
    </div>
  );
}

function ConfigurationTab({ rules }: { rules: RuleEffectiveness[] }) {
  return (
    <div>
      {/* Matching Rules */}
      <h3 style={{ marginBottom: "1rem" }}>Matching Rules</h3>
      <div style={{ background: "var(--background)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden", marginBottom: "2rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--section-bg)" }}>
              <th style={{ padding: "0.75rem 1rem", textAlign: "left", borderBottom: "1px solid var(--border)" }}>Rule</th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)" }}>Status</th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)" }}>Matches</th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)" }}>Avg Score</th>
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
                  <td style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)" }}>{rule.rule_name}</td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)" }}>
                    <StatusBadge status={rule.is_active ? "active" : "inactive"} />
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                    {rule.total_matches.toLocaleString()}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)" }}>
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
        <StatCard label="Total Decisions" value={h.total_decisions} accentColor="var(--primary, #3b82f6)" />
        <StatCard label="Decisions (24h)" value={h.decisions_24h} accentColor="#10b981" />
        <StatCard label="Pending Reviews" value={h.pending_reviews} accentColor="#f59e0b" />
        <StatCard label="Total Households" value={h.total_households} accentColor="#8b5cf6" />
        <StatCard label="Active Rules" value={h.active_rules} accentColor="#6b7280" />
        <StatCard label="Avg Processing" value={`${h.avg_processing_ms}ms`} accentColor="var(--primary, #3b82f6)" />
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
      <TabBar
        tabs={tabs.map((t) => ({ id: t.id, label: t.label, count: t.count ?? undefined }))}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
      />

      {/* Tab Content */}
      <div style={{ background: "var(--bg-secondary, #f9fafb)", padding: "1.5rem", borderRadius: "8px", minHeight: "400px" }}>
        {loading ? (
          <div style={{ padding: "1rem 0" }}><SkeletonTable rows={5} columns={4} /></div>
        ) : (
          <>
            {activeTab === "review" && <ReviewQueueTab data={queueData} />}
            {activeTab === "processing" && <ProcessingTab data={processingData} onRefresh={fetchData} />}
            {activeTab === "config" && <ConfigurationTab rules={rulesData} />}
            {activeTab === "health" && <HealthTab health={healthData} />}
          </>
        )}
      </div>
    </div>
  );
}
