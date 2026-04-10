"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { StatCard } from "@/components/ui/StatCard";
import { TabBar, TabPanel } from "@/components/ui/TabBar";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SkeletonStats, SkeletonTable } from "@/components/feedback/Skeleton";

// --- Types ---

interface VhPopulation {
  total_volunteers: number;
  approved_active: number;
  applicants: number;
  lapsed: number;
  active_trappers: number;
  active_fosters: number;
  active_caretakers: number;
  active_staff: number;
  matched_volunteers: number;
  unmatched_volunteers: number;
}

interface HoursGroup {
  group_name: string;
  total_hours: number;
  volunteer_count: number;
}

interface TopVolunteer {
  display_name: string;
  total_hours: number;
  event_count: number;
}

interface VhStats {
  population: VhPopulation;
  hours_by_group: HoursGroup[];
  top_volunteers: TopVolunteer[];
  recent_changes: { joined_last_30d: number; left_last_30d: number };
  hours_totals: { total_hours: number; hours_last_90d: number; total_events: number };
  last_sync: string | null;
  event_sync: { last_sync_at: string | null; records_synced: number };
  // Legacy compat
  total_volunteers: number;
  active_volunteers: number;
  matched_volunteers: number;
  trappers: number;
  fosters: number;
}

interface UploadResult {
  total: number;
  inserted: number;
  updated: number;
  matched: number;
  errors: number;
  errorDetails?: string[];
}

interface RecentUpload {
  upload_id: string;
  filename: string;
  status: string;
  records_found: number | null;
  records_processed: number | null;
  records_errors: number | null;
  created_at: string;
}

// --- Status styles ---

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  processed: { bg: "rgba(16, 185, 129, 0.1)", color: "#059669", label: "Processed" },
  completed: { bg: "rgba(16, 185, 129, 0.1)", color: "#059669", label: "Completed" },
  failed: { bg: "rgba(239, 68, 68, 0.1)", color: "#dc2626", label: "Failed" },
  processing: { bg: "rgba(59, 130, 246, 0.1)", color: "var(--primary, #2563eb)", label: "Processing" },
  pending: { bg: "rgba(107, 114, 128, 0.1)", color: "#6b7280", label: "Pending" },
  uploaded: { bg: "rgba(107, 114, 128, 0.1)", color: "#6b7280", label: "Uploaded" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: "9999px",
      fontSize: "0.7rem",
      fontWeight: 600,
      background: style.bg,
      color: style.color,
    }}>
      {style.label}
    </span>
  );
}

// --- Processing Steps ---

const UPLOAD_STEPS = ["upload", "parse", "match", "done"] as const;
const UPLOAD_STEP_LABELS = ["Upload", "Parse Excel", "Match People", "Done"];

function UploadStepper({ phase }: { phase: "idle" | "uploading" | "processing" | "done" | "error" }) {
  const phaseMap: Record<string, number> = { idle: -1, uploading: 0, processing: 1, done: 3, error: -1 };
  const activeIdx = phaseMap[phase] ?? -1;
  const isError = phase === "error";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "center", margin: "1rem 0" }}>
      {UPLOAD_STEPS.map((step, idx) => {
        const isDone = idx <= activeIdx && phase === "done";
        const isCurrent = idx === activeIdx && phase !== "done";
        return (
          <div key={step} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
              <div style={{
                width: "20px", height: "20px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.6rem", fontWeight: 700, color: "#fff",
                background: isError && isCurrent ? "#dc2626"
                  : isDone ? "#059669"
                  : isCurrent ? "var(--primary, #8b5cf6)"
                  : "var(--border, #d1d5db)",
                ...(isCurrent && !isError ? { boxShadow: "0 0 0 3px rgba(139, 92, 246, 0.2)" } : {}),
              }}>
                {isDone ? "\u2713" : isError && isCurrent ? "\u2717" : ""}
              </div>
              <div style={{
                fontSize: "0.6rem",
                color: isDone || isCurrent ? "var(--foreground)" : "var(--muted)",
                fontWeight: isCurrent ? 600 : 400,
                whiteSpace: "nowrap",
              }}>
                {UPLOAD_STEP_LABELS[idx]}
              </div>
            </div>
            {idx < UPLOAD_STEPS.length - 1 && (
              <div style={{
                width: "20px", height: "2px", marginBottom: "16px",
                background: idx < activeIdx || (phase === "done") ? "#059669" : "var(--border, #d1d5db)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Health Banner ---

function VhHealthBanner({ lastSync }: { lastSync: string | null }) {
  const hoursSinceSync = lastSync
    ? (Date.now() - new Date(lastSync).getTime()) / (1000 * 60 * 60)
    : null;

  const isStale = hoursSinceSync === null || hoursSinceSync > 48;
  const isVeryStale = hoursSinceSync === null || hoursSinceSync > 168;

  const bg = isVeryStale ? "rgba(239, 68, 68, 0.08)" : isStale ? "rgba(245, 158, 11, 0.08)" : "rgba(16, 185, 129, 0.08)";
  const borderColor = isVeryStale ? "rgba(239, 68, 68, 0.3)" : isStale ? "rgba(245, 158, 11, 0.3)" : "rgba(16, 185, 129, 0.3)";
  const icon = isVeryStale ? "\u2717" : isStale ? "\u26A0" : "\u2713";
  const text = hoursSinceSync === null
    ? "No VolunteerHub data synced yet"
    : isVeryStale
    ? `VH data is ${Math.round(hoursSinceSync / 24)} days old \u2014 API is down, upload a fresh export`
    : isStale
    ? `Last sync ${Math.round(hoursSinceSync)} hours ago \u2014 consider uploading a fresh export`
    : `VH data is current (synced ${Math.round(hoursSinceSync)} hours ago)`;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "8px",
      padding: "10px 16px", borderRadius: "8px",
      background: bg, border: `1px solid ${borderColor}`,
      marginBottom: "1.5rem", fontSize: "0.85rem",
    }}>
      <span style={{ fontSize: "1rem" }}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

// --- Tab: Overview ---

function OverviewTab({ stats }: { stats: VhStats }) {
  const { population, recent_changes } = stats;

  return (
    <div>
      {/* Row 1: Population */}
      <h3 style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Population
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <StatCard label="Approved" value={population.approved_active} accentColor="#059669" />
        <StatCard label="Applicants" value={population.applicants} accentColor="#6b7280" />
        <StatCard label="Lapsed" value={population.lapsed} accentColor="#f59e0b" />
        <StatCard label="Matched" value={population.matched_volunteers} accentColor="#8b5cf6" />
      </div>

      {/* Row 2: Roles */}
      <h3 style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Active Roles
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <StatCard label="Trappers" value={population.active_trappers} accentColor="#3b82f6" />
        <StatCard label="Fosters" value={population.active_fosters} accentColor="#ec4899" />
        <StatCard label="Caretakers" value={population.active_caretakers} accentColor="#14b8a6" />
        <StatCard label="Staff" value={population.active_staff} accentColor="#64748b" />
      </div>

      {/* Row 3: Recent changes */}
      <h3 style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Membership Changes (Last 30 Days)
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
        <StatCard label="Joined" value={recent_changes.joined_last_30d} accentColor="#059669" />
        <StatCard label="Left" value={recent_changes.left_last_30d} accentColor="#dc2626" />
      </div>
    </div>
  );
}

// --- Tab: Hours ---

function HoursTab({ stats }: { stats: VhStats }) {
  const { hours_by_group, top_volunteers, hours_totals, event_sync } = stats;
  const hasData = hours_by_group.length > 0 || top_volunteers.length > 0;

  if (!hasData && !event_sync.last_sync_at) {
    return (
      <EmptyState
        title="No event data yet"
        description="Event hours will appear after the next full sync (Sundays). The sync fetches all historical events from VolunteerHub and calculates hours per volunteer."
      />
    );
  }

  return (
    <div>
      {/* Headline stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <StatCard label="Total Hours (All Time)" value={Number(hours_totals.total_hours).toLocaleString()} accentColor="#8b5cf6" />
        <StatCard label="Hours (Last 90 Days)" value={Number(hours_totals.hours_last_90d).toLocaleString()} accentColor="#3b82f6" />
        <StatCard label="Events Synced" value={hours_totals.total_events} accentColor="#6b7280" />
      </div>

      {/* Hours by group */}
      {hours_by_group.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ marginBottom: "0.75rem" }}>Hours by Group</h3>
          <div style={{ background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--section-bg)" }}>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "left", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Group</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Hours</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Volunteers</th>
                </tr>
              </thead>
              <tbody>
                {hours_by_group.map((g) => (
                  <tr key={g.group_name}>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" }}>{g.group_name}</td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: "0.85rem", fontWeight: 600 }}>
                      {Number(g.total_hours).toLocaleString()}
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: "0.85rem" }}>
                      {g.volunteer_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top volunteers */}
      {top_volunteers.length > 0 && (
        <div>
          <h3 style={{ marginBottom: "0.75rem" }}>Top Volunteers (Last 90 Days)</h3>
          <div style={{ background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--section-bg)" }}>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "left", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Volunteer</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Hours</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Events</th>
                </tr>
              </thead>
              <tbody>
                {top_volunteers.map((v, i) => (
                  <tr key={i}>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" }}>{v.display_name}</td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: "0.85rem", fontWeight: 600 }}>
                      {Number(v.total_hours).toLocaleString()}
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: "0.85rem" }}>
                      {v.event_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Event sync info */}
      {event_sync.last_sync_at && (
        <div style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
          Last event sync: {new Date(event_sync.last_sync_at).toLocaleString()} ({event_sync.records_synced.toLocaleString()} events total)
        </div>
      )}
    </div>
  );
}

// --- Tab: Upload ---

function UploadTab({
  onRefresh,
  recentUploads,
}: {
  onRefresh: () => void;
  recentUploads: RecentUpload[];
}) {
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<UploadResult | null>(null);

  const isWorking = phase === "uploading" || phase === "processing";

  const handleUpload = async (file: File) => {
    setPhase("uploading");
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("source_system", "volunteerhub");
      formData.append("source_table", "users");

      const uploadRes = await fetch("/api/ingest/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok || !uploadData.data?.upload_id) {
        throw new Error(uploadData.error?.message || uploadData.message || "Upload failed");
      }

      setPhase("processing");
      const processRes = await fetch("/api/ingest/process-vh-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadData.data.upload_id }),
      });
      const processData = await processRes.json();
      if (!processRes.ok) {
        throw new Error(processData.error?.message || processData.message || "Processing failed");
      }

      const r = processData.data || processData;
      setResult({ total: r.total, inserted: r.inserted, updated: r.updated, matched: r.matched || 0, errors: r.errors, errorDetails: r.errorDetails });
      setPhase("done");
      addToast({ type: "success", message: `Done! ${r.total} volunteers: ${r.inserted} new, ${r.updated} updated` });
      onRefresh();
    } catch (err) {
      setPhase("error");
      addToast({ type: "error", message: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />

      {/* Upload zone */}
      {(phase === "idle" || phase === "done" || phase === "error") && !isWorking && (
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            padding: "2rem",
            background: "var(--card-bg)",
            border: "2px dashed var(--border)",
            borderRadius: "12px",
            textAlign: "center",
            cursor: "pointer",
            marginBottom: "1.5rem",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#8b5cf6"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
        >
          <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem", opacity: 0.4 }}>
            {phase === "done" ? "\u2713" : "\u2191"}
          </div>
          <div style={{ fontWeight: 600, color: "var(--foreground)", marginBottom: "0.25rem" }}>
            {phase === "done" ? "Upload another export" : "Click to upload VolunteerHub export"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Export &quot;ALL Users &amp; Fields&quot; from VH admin as .xlsx
          </div>
        </div>
      )}

      {/* Processing stepper */}
      {isWorking && (
        <div style={{
          padding: "2rem",
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          marginBottom: "1.5rem",
        }}>
          <UploadStepper phase={phase} />
          <div style={{ textAlign: "center", fontSize: "0.85rem", color: "var(--muted)" }}>
            {phase === "uploading" ? "Uploading file..." : "Processing 1,300+ volunteers \u2014 this may take a minute"}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          padding: "1.25rem",
          background: result.errors > 0 ? "rgba(245, 158, 11, 0.08)" : "rgba(16, 185, 129, 0.08)",
          border: `1px solid ${result.errors > 0 ? "rgba(245, 158, 11, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
          borderRadius: "8px",
          marginBottom: "1.5rem",
        }}>
          <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
            {result.errors > 0 ? "\u26A0 Import Complete (with warnings)" : "\u2713 Import Complete"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.5rem", fontSize: "0.85rem" }}>
            <div><strong>{result.total}</strong> total</div>
            <div style={{ color: "#059669" }}><strong>{result.inserted}</strong> new</div>
            <div><strong>{result.updated}</strong> updated</div>
            <div style={{ color: "#8b5cf6" }}><strong>{result.matched}</strong> matched</div>
            {result.errors > 0 && <div style={{ color: "#dc2626" }}><strong>{result.errors}</strong> errors</div>}
          </div>
          {result.errorDetails && result.errorDetails.length > 0 && (
            <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#dc2626", background: "rgba(239,68,68,0.05)", padding: "8px", borderRadius: "4px" }}>
              {result.errorDetails.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Upload History */}
      {recentUploads.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ marginBottom: "0.75rem" }}>Recent Uploads</h3>
          <div style={{ background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--section-bg)" }}>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "left", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>File</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Status</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Records</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentUploads.map((u) => (
                  <tr key={u.upload_id}>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", fontSize: "0.8rem" }}>
                      {u.filename || "VH Export"}
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                      <StatusBadge status={u.status} />
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: "0.8rem" }}>
                      {u.records_processed != null ? u.records_processed.toLocaleString() : "-"}
                      {u.records_errors != null && u.records_errors > 0 && (
                        <span style={{ color: "#dc2626", marginLeft: "4px" }}>({u.records_errors} err)</span>
                      )}
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: "0.8rem", color: "var(--muted)" }}>
                      {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div style={{
        padding: "1.25rem",
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
      }}>
        <div style={{ fontWeight: 600, marginBottom: "0.75rem" }}>How to export from VolunteerHub</div>
        <ol style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.8 }}>
          <li>Log into <a href="https://forgottenfelines.volunteerhub.com" target="_blank" rel="noopener noreferrer" style={{ color: "#8b5cf6" }}>forgottenfelines.volunteerhub.com</a></li>
          <li>Go to <strong>Reports</strong> &rarr; <strong>Users</strong></li>
          <li>Select <strong>ALL Users &amp; Fields</strong></li>
          <li>Click <strong>Export</strong> &rarr; choose <strong>.xlsx</strong></li>
          <li>Upload the file using the drop zone above</li>
        </ol>
        <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
          This is a manual fallback. When the VH API is restored, volunteers sync automatically every morning.
        </div>
      </div>
    </div>
  );
}

// --- Page Content ---

function VhDashboardContent() {
  const [activeTab, setActiveTab] = useState("overview");
  const [stats, setStats] = useState<VhStats | null>(null);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await fetchApi<VhStats>("/api/admin/vh-stats");
      setStats(data);
    } catch {
      setStats(null);
    }
    try {
      const uploads = await fetchApi<{ uploads: RecentUpload[] }>(
        "/api/ingest/uploads?source_system=volunteerhub&limit=5"
      );
      setRecentUploads(uploads.uploads || []);
    } catch {
      setRecentUploads([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "hours", label: "Hours" },
    { id: "upload", label: "Upload" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>VolunteerHub</h1>
          <p className="text-muted" style={{ margin: "4px 0 0" }}>
            Volunteer population, hours tracking, and manual sync
          </p>
        </div>
      </div>

      {/* Health banner */}
      <VhHealthBanner lastSync={stats?.last_sync || null} />

      {/* Tabs */}
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {loading ? (
        <div>
          <SkeletonStats count={4} />
          <div style={{ marginTop: "1rem" }}><SkeletonStats count={4} /></div>
        </div>
      ) : (
        <>
          <TabPanel tabId="overview" activeTab={activeTab}>
            {stats ? (
              <OverviewTab stats={stats} />
            ) : (
              <EmptyState title="No data available" description="Unable to load VH stats. Check database connection." />
            )}
          </TabPanel>

          <TabPanel tabId="hours" activeTab={activeTab}>
            {stats ? (
              <HoursTab stats={stats} />
            ) : (
              <EmptyState title="No data available" description="Unable to load VH stats." />
            )}
          </TabPanel>

          <TabPanel tabId="upload" activeTab={activeTab}>
            <UploadTab onRefresh={fetchData} recentUploads={recentUploads} />
          </TabPanel>
        </>
      )}
    </div>
  );
}

export default function VhUploadPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}><SkeletonStats count={4} /><SkeletonTable rows={3} columns={4} /></div>}>
      <VhDashboardContent />
    </Suspense>
  );
}
