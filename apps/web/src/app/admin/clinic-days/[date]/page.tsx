"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { TabBar } from "@/components/ui/TabBar";
import { SkeletonText } from "@/components/feedback/Skeleton";
import { useToast } from "@/components/feedback/Toast";
import { fetchApi, postApi } from "@/lib/api-client";
import {
  ClinicDayPhotoStrip,
  type PhotoGroup,
} from "@/components/media/ClinicDayPhotoStrip";

// ── Types ──────────────────────────────────────────────────────────────

interface CDSMethodBreakdown {
  sql_owner_name: number;
  sql_cat_name: number;
  sql_sex: number;
  sql_cardinality: number;
  waiver_bridge: number;
  weight_disambiguation: number;
  composite: number;
  constraint_propagation: number;
  cds_suggestion: number;
  manual: number;
}

interface StatusData {
  date: string;
  clinic_day_id: string | null;
  master_list: {
    status: "imported" | "missing";
    entry_count: number;
    with_weight: number;
    with_cat_name: number;
    with_trapper: number;
  };
  clinichq: {
    status: "available" | "pending";
    appointment_count: number;
    with_cat: number;
    with_microchip: number;
    with_owner: number;
  };
  photos: {
    count: number;
    cats_with_photos: number;
  };
  waivers: {
    count: number;
    matched: number;
  };
  matching: {
    total_entries: number;
    matched: number;
    unmatched: number;
    by_confidence: {
      high: number;
      medium: number;
      low: number;
      manual: number;
    };
    coverage_pct: number;
  };
  readiness: {
    has_master_list: boolean;
    has_clinichq: boolean;
    has_photos: boolean;
    has_waivers: boolean;
    can_rematch: boolean;
  };
  ground_truth: {
    master_list_is_authority: boolean;
    authoritative_count: number;
    appointments_matched: number;
    orphaned_appointments: number;
    discrepancy: number;
    likely_duplicates: boolean;
  };
  cds?: {
    latest_run: {
      run_id: string;
      triggered_by: string;
      started_at: string;
      completed_at: string | null;
      matched_before: number;
      matched_after: number;
      has_waivers: boolean;
      has_weights: boolean;
    } | null;
    pending_suggestions: number;
    method_breakdown: CDSMethodBreakdown;
  };
}

interface EntryRow {
  entry_id: string;
  line_number: number;
  raw_client_name: string | null;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  female_count: number;
  male_count: number;
  weight_lbs: number | null;
  match_confidence: string | null;
  match_score: number | null;
  matched_appointment_id: string | null;
  matched_cat_name: string | null;
  matched_microchip: string | null;
  matched_cat_weight: number | null;
  is_recheck: boolean;
  cds_method: string | null;
  cds_llm_reasoning: string | null;
}

// ── Page ───────────────────────────────────────────────────────────────

export default function ClinicDayHubPage() {
  const { date } = useParams<{ date: string }>();
  const router = useRouter();
  const { addToast } = useToast();

  const [status, setStatus] = useState<StatusData | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"status" | "roster" | "photos">("status");

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rematch state
  const [rematching, setRematching] = useState(false);

  // CDS review state
  const [reviewingEntry, setReviewingEntry] = useState<string | null>(null);

  // Photo upload state
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  // MIG_3050: Inline data quality health badge
  const [health, setHealth] = useState<{
    overall: "pass" | "warn" | "fail";
    checks: Array<{
      check_name: string;
      status: string;
      value: number;
      detail: string;
    }>;
    summary: { pass: number; warn: number; fail: number };
  } | null>(null);

  // ── Data loading ─────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    try {
      const data = await fetchApi<StatusData>(
        `/api/admin/clinic-days/${date}/status`
      );
      setStatus(data);
    } catch {
      // Status not available — fresh day
      setStatus(null);
    }
  }, [date]);

  const loadEntries = useCallback(async () => {
    try {
      const data = await fetchApi<{ entries: EntryRow[] }>(
        `/api/admin/clinic-days/${date}/entries`
      );
      setEntries(data.entries || []);
    } catch {
      setEntries([]);
    }
  }, [date]);

  // MIG_3050: Load inline health badge (silent failure if migration not applied)
  const loadHealth = useCallback(async () => {
    try {
      const data = await fetchApi<{
        overall: "pass" | "warn" | "fail";
        checks: Array<{
          check_name: string;
          status: string;
          value: number;
          detail: string;
        }>;
        summary: { pass: number; warn: number; fail: number };
      }>(`/api/admin/clinic-days/${date}/health`);
      setHealth(data);
    } catch {
      setHealth(null);
    }
  }, [date]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadStatus(), loadEntries(), loadHealth()]).finally(() =>
      setLoading(false)
    );
  }, [loadStatus, loadEntries, loadHealth]);

  // ── Actions ──────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const response = await fetch(`/api/admin/clinic-days/${date}/import`, {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message || "Import failed");
      }
      const data = result.data || result;
      addToast({
        type: "success",
        message: `Imported ${data.imported} entries, ${data.matched} matched${data.composite_matching?.newly_matched ? `, +${data.composite_matching.newly_matched} composite` : ""}`,
      });
      setImportFile(null);
      // Reload status + entries
      await Promise.all([loadStatus(), loadEntries()]);
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Import failed",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleRematch = async () => {
    setRematching(true);
    try {
      const data = await postApi<{
        before: { matched: number; unmatched: number };
        after: { matched: number; unmatched: number; manual: number };
        phases: Array<{ phase: string; matched: number }>;
      }>(`/api/admin/clinic-days/${date}/rematch`, {});
      addToast({
        type: "success",
        message: `CDS: ${data.before.matched} → ${data.after.matched} matched (${data.after.unmatched} remaining)`,
      });
      await Promise.all([loadStatus(), loadEntries()]);
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Rematch failed",
      });
    } finally {
      setRematching(false);
    }
  };

  const handleCDSReview = async (entryId: string, action: "accept" | "reject") => {
    setReviewingEntry(entryId);
    try {
      await postApi(`/api/admin/clinic-days/${date}/cds/review`, {
        entry_id: entryId,
        action,
      });
      addToast({
        type: "success",
        message: `Suggestion ${action}ed`,
      });
      await Promise.all([loadStatus(), loadEntries()]);
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Review failed",
      });
    } finally {
      setReviewingEntry(null);
    }
  };

  const handlePhotoUpload = async (groups: PhotoGroup[]) => {
    setUploadingPhotos(true);
    try {
      const formData = new FormData();

      // Flatten all photos with group mapping
      const groupMappings: Array<{
        indices: number[];
        entry_line_number: number | null;
        photo_type: string;
      }> = [];
      let globalIndex = 0;

      for (const group of groups) {
        const indices: number[] = [];
        for (const photo of group.photos) {
          formData.append("files[]", photo.file);
          indices.push(globalIndex);
          globalIndex++;
        }
        groupMappings.push({
          indices,
          entry_line_number: group.entryLineNumber,
          photo_type: "cat", // Default; waiver type handled by backend
        });
      }

      formData.append("groups", JSON.stringify(groupMappings));

      const response = await fetch(`/api/admin/clinic-days/${date}/photos`, {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message || "Upload failed");
      }
      const data = result.data || result;
      addToast({
        type: "success",
        message: `Uploaded ${data.uploaded} photos (${data.linked_to_cats} linked, ${data.unlinked} unlinked)`,
      });
      await loadStatus();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Photo upload failed",
      });
    } finally {
      setUploadingPhotos(false);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────

  const formatDate = (d: string) => {
    const [y, m, day] = d.split("-");
    const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(day));
    return dt.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const confidenceBadge = (conf: string | null) => {
    const styles: Record<string, { bg: string; color: string }> = {
      high: { bg: "var(--success-bg)", color: "var(--success-text)" },
      medium: { bg: "var(--warning-bg)", color: "var(--warning-text)" },
      low: { bg: "var(--danger-bg)", color: "var(--danger-text)" },
      manual: { bg: "var(--primary-bg)", color: "var(--primary)" },
    };
    const s = styles[conf || ""] || { bg: "var(--section-bg)", color: "var(--muted)" };
    return s;
  };

  // ── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
        <SkeletonText lines={6} />
      </div>
    );
  }

  const r = status?.readiness;

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: "24px",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
            <button
              onClick={() => router.push("/admin/clinic-days")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--muted)",
                fontSize: "0.85rem",
                padding: 0,
              }}
            >
              Clinic Days
            </button>
            <span style={{ color: "var(--muted)" }}>/</span>
          </div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>
            {formatDate(date)}
          </h1>
        </div>

        {/* Quick actions */}
        <div style={{ display: "flex", gap: "8px" }}>
          {r?.can_rematch && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRematch}
              loading={rematching}
            >
              Re-match
            </Button>
          )}
        </div>
      </div>

      {/* MIG_3050: Inline data quality health badge */}
      {health && (health.summary.warn > 0 || health.summary.fail > 0) && (
        <div
          style={{
            marginBottom: "16px",
            padding: "12px 16px",
            borderRadius: "8px",
            background:
              health.overall === "fail"
                ? "#fef2f2"
                : "#fef3c7",
            border: `1px solid ${
              health.overall === "fail" ? "#ef4444" : "#f59e0b"
            }`,
            color:
              health.overall === "fail" ? "#991b1b" : "#92400e",
            fontSize: "0.9rem",
          }}
          title="Data quality checks for this clinic date"
        >
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>
            Data Quality:{" "}
            {health.summary.fail > 0 && `${health.summary.fail} fail · `}
            {health.summary.warn > 0 && `${health.summary.warn} warn · `}
            {health.summary.pass} pass
          </div>
          <ul style={{ margin: "4px 0 0 1.25rem", padding: 0 }}>
            {health.checks
              .filter((c) => c.status !== "pass")
              .map((c) => (
                <li key={c.check_name} style={{ fontSize: "0.85rem" }}>
                  <strong>{c.check_name}</strong> ({c.value}) — {c.detail}
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Status lanes */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "12px",
        marginBottom: "24px",
      }}>
        {/* Master List */}
        <StatusLane
          title="Master List"
          status={r?.has_master_list ? "ready" : "missing"}
          primary={
            r?.has_master_list
              ? `${status?.master_list.entry_count} entries`
              : "Not imported"
          }
          secondary={
            r?.has_master_list
              ? `${status?.master_list.with_weight} with weight`
              : undefined
          }
        />

        {/* ClinicHQ */}
        <StatusLane
          title="ClinicHQ Data"
          status={
            status?.ground_truth.likely_duplicates
              ? "partial"
              : r?.has_clinichq
              ? "ready"
              : "pending"
          }
          primary={
            r?.has_clinichq
              ? `${status?.clinichq.appointment_count} appointments`
              : "Not yet received"
          }
          secondary={
            status?.ground_truth.likely_duplicates
              ? `${status.ground_truth.discrepancy} likely duplicates`
              : r?.has_clinichq
              ? `${status?.clinichq.with_microchip} with chip`
              : "Arrives after clinic"
          }
        />

        {/* Photos */}
        <StatusLane
          title="Photos"
          status={r?.has_photos ? "ready" : "missing"}
          primary={
            r?.has_photos
              ? `${status?.photos.count} photos`
              : "No photos yet"
          }
          secondary={
            r?.has_photos
              ? `${status?.photos.cats_with_photos} cats covered`
              : undefined
          }
        />

        {/* CDS / Matching */}
        <StatusLane
          title="CDS"
          status={
            !r?.has_master_list
              ? "pending"
              : (status?.cds?.pending_suggestions ?? 0) > 0
              ? "partial"
              : (status?.matching.coverage_pct ?? 0) >= 90
              ? "ready"
              : (status?.matching.coverage_pct ?? 0) >= 50
              ? "partial"
              : "missing"
          }
          primary={
            r?.has_master_list
              ? `${status?.matching.coverage_pct}% matched`
              : "Awaiting data"
          }
          secondary={
            (status?.cds?.pending_suggestions ?? 0) > 0
              ? `${status!.cds!.pending_suggestions} suggestions pending`
              : status?.matching.unmatched
              ? `${status.matching.unmatched} unmatched`
              : undefined
          }
        />
      </div>

      {/* Tabs */}
      <TabBar
        tabs={[
          { id: "status", label: "Overview" },
          { id: "roster", label: `Roster (${status?.master_list.entry_count ?? 0})` },
          { id: "photos", label: `Photos (${status?.photos.count ?? 0})` },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as typeof activeTab)}
      />

      <div style={{ marginTop: "16px" }}>
        {/* Overview Tab */}
        {activeTab === "status" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Import master list (if missing) */}
            {!r?.has_master_list && (
              <div className="card" style={{ borderLeft: "3px solid var(--warning-text)" }}>
                <h3 style={{ marginTop: 0, marginBottom: "8px" }}>
                  Import Master List
                </h3>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "12px" }}>
                  Upload the Excel/CSV master list for this clinic day. This creates skeleton entries
                  that will auto-match when ClinicHQ data arrives.
                </p>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    style={{
                      flex: 1,
                      padding: "8px",
                      border: "1px solid var(--card-border)",
                      borderRadius: "6px",
                      background: "var(--section-bg)",
                      color: "var(--foreground)",
                    }}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleImport}
                    loading={importing}
                    disabled={!importFile}
                  >
                    Import
                  </Button>
                </div>
              </div>
            )}

            {/* ClinicHQ pending notice */}
            {r?.has_master_list && !r?.has_clinichq && (
              <div className="card" style={{
                borderLeft: "3px solid var(--info-text)",
                background: "var(--section-bg)",
              }}>
                <h3 style={{ marginTop: 0, marginBottom: "4px", fontSize: "0.95rem" }}>
                  Waiting for ClinicHQ Data
                </h3>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                  {status?.master_list.entry_count} master list entries are ready.
                  When ClinicHQ data is uploaded, matching will run automatically.
                  You can still upload photos now — they&apos;ll link when cats are matched.
                </p>
              </div>
            )}

            {/* Ground truth analysis */}
            {status?.ground_truth.master_list_is_authority && r?.has_clinichq && (
              <div className="card" style={{
                borderLeft: `3px solid ${
                  status.ground_truth.likely_duplicates
                    ? "var(--warning-text)"
                    : status.ground_truth.discrepancy === 0
                    ? "var(--success-text)"
                    : "var(--info-text)"
                }`,
              }}>
                <h3 style={{ marginTop: 0, marginBottom: "8px", fontSize: "0.95rem" }}>
                  Ground Truth: Master List vs ClinicHQ
                </h3>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "16px",
                  marginBottom: status.ground_truth.likely_duplicates ? "12px" : 0,
                }}>
                  <div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                      {status.ground_truth.authoritative_count}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                      Master List (authority)
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                      {status.ground_truth.appointments_matched}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                      Matched to entries
                    </div>
                  </div>
                  <div>
                    <div style={{
                      fontSize: "1.25rem",
                      fontWeight: 700,
                      color: status.ground_truth.orphaned_appointments > 0
                        ? "var(--warning-text)"
                        : "var(--foreground)",
                    }}>
                      {status.ground_truth.orphaned_appointments}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                      Orphaned appointments
                    </div>
                  </div>
                </div>
                {status.ground_truth.likely_duplicates && (
                  <div style={{
                    padding: "8px 12px",
                    background: "var(--warning-bg)",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    color: "var(--warning-text)",
                  }}>
                    ClinicHQ has {status.ground_truth.discrepancy} more appointment{status.ground_truth.discrepancy !== 1 ? "s" : ""} than
                    the master list. {status.ground_truth.orphaned_appointments} appointment{status.ground_truth.orphaned_appointments !== 1 ? "s" : ""} have
                    no master list match — likely duplicates in ClinicHQ data.
                  </div>
                )}
              </div>
            )}

            {/* Matching details */}
            {r?.has_master_list && (status?.matching.total_entries ?? 0) > 0 && (
              <div className="card">
                <h3 style={{ marginTop: 0, marginBottom: "12px" }}>Match Coverage</h3>
                {/* Progress bar */}
                <div style={{
                  height: "8px",
                  background: "var(--section-bg)",
                  borderRadius: "4px",
                  overflow: "hidden",
                  marginBottom: "12px",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${status?.matching.coverage_pct ?? 0}%`,
                    background: (status?.matching.coverage_pct ?? 0) >= 90
                      ? "var(--success-text)"
                      : (status?.matching.coverage_pct ?? 0) >= 50
                      ? "var(--warning-text)"
                      : "var(--danger-text)",
                    borderRadius: "4px",
                    transition: "width 0.3s ease",
                  }} />
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "12px",
                  fontSize: "0.85rem",
                }}>
                  <div>
                    <div style={{ color: "var(--success-text)", fontWeight: 600 }}>
                      {status?.matching.by_confidence.high ?? 0}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>High</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--warning-text)", fontWeight: 600 }}>
                      {status?.matching.by_confidence.medium ?? 0}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>Medium</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--danger-text)", fontWeight: 600 }}>
                      {status?.matching.by_confidence.low ?? 0}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>Low</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--primary)", fontWeight: 600 }}>
                      {status?.matching.by_confidence.manual ?? 0}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>Manual</div>
                  </div>
                </div>
              </div>
            )}

            {/* CDS Suggestions (pending review) */}
            {(status?.cds?.pending_suggestions ?? 0) > 0 && (
              <div className="card" style={{ borderLeft: "3px solid var(--warning-text)" }}>
                <h3 style={{ marginTop: 0, marginBottom: "12px", fontSize: "0.95rem" }}>
                  CDS Suggestions ({status!.cds!.pending_suggestions} pending review)
                </h3>
                <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginBottom: "12px" }}>
                  The CDS pipeline found probable matches but needs staff confirmation (Manual &gt; AI).
                </p>
                {entries
                  .filter((e) => e.cds_method === "cds_suggestion")
                  .map((entry) => (
                    <div
                      key={entry.entry_id}
                      style={{
                        padding: "10px 12px",
                        background: "var(--section-bg)",
                        borderRadius: "6px",
                        marginBottom: "8px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>
                          #{entry.line_number} &ldquo;{entry.parsed_owner_name || "?"}&rdquo;{" "}
                          {entry.female_count > 0 ? "F" : "M"}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                          → {entry.matched_cat_name || "Unknown"}
                          {entry.matched_microchip && (
                            <span style={{ fontFamily: "monospace" }}>
                              {" "}(chip ...{entry.matched_microchip.slice(-4)})
                            </span>
                          )}
                          {entry.matched_cat_weight != null && (
                            <span>, {entry.matched_cat_weight} lbs</span>
                          )}
                        </div>
                        {entry.cds_llm_reasoning && (
                          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "4px" }}>
                            Reason: {entry.cds_llm_reasoning}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleCDSReview(entry.entry_id, "accept")}
                          loading={reviewingEntry === entry.entry_id}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCDSReview(entry.entry_id, "reject")}
                          loading={reviewingEntry === entry.entry_id}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* CDS method breakdown */}
            {status?.cds?.latest_run && (
              <div className="card">
                <h3 style={{ marginTop: 0, marginBottom: "12px", fontSize: "0.95rem" }}>
                  CDS Pipeline Breakdown
                </h3>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: "8px",
                  fontSize: "0.8rem",
                }}>
                  {([
                    ["SQL", (status.cds.method_breakdown.sql_owner_name ?? 0) +
                            (status.cds.method_breakdown.sql_cat_name ?? 0) +
                            (status.cds.method_breakdown.sql_sex ?? 0) +
                            (status.cds.method_breakdown.sql_cardinality ?? 0), "var(--success-text)"],
                    ["Waiver", status.cds.method_breakdown.waiver_bridge ?? 0, "var(--info-text)"],
                    ["Weight", status.cds.method_breakdown.weight_disambiguation ?? 0, "var(--info-text)"],
                    ["Composite", status.cds.method_breakdown.composite ?? 0, "var(--warning-text)"],
                    ["Constraint", status.cds.method_breakdown.constraint_propagation ?? 0, "var(--info-text)"],
                  ] as [string, number, string][]).map(([label, count, color]) => (
                    <div key={label} style={{ textAlign: "center" }}>
                      <div style={{ fontWeight: 600, color }}>{count}</div>
                      <div style={{ color: "var(--muted)", fontSize: "0.7rem" }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Waiver stats */}
            {(status?.waivers.count ?? 0) > 0 && (
              <div className="card">
                <h3 style={{ marginTop: 0, marginBottom: "8px" }}>Waivers</h3>
                <div style={{ fontSize: "0.9rem" }}>
                  <span style={{ fontWeight: 600 }}>{status?.waivers.matched}</span>
                  <span style={{ color: "var(--muted)" }}>
                    {" "}/ {status?.waivers.count} matched to appointments
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Roster Tab */}
        {activeTab === "roster" && (
          <div className="card" style={{ overflow: "auto" }}>
            {entries.length === 0 ? (
              <div style={{
                textAlign: "center",
                padding: "48px 24px",
                color: "var(--muted)",
              }}>
                <div style={{ fontSize: "1.2rem", marginBottom: "8px" }}>
                  No entries yet
                </div>
                <p style={{ fontSize: "0.85rem" }}>
                  Import a master list from the Overview tab to see the roster.
                </p>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--card-border)" }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>Client / Cat</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Sex</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Wt</th>
                    <th style={thStyle}>Match</th>
                    <th style={thStyle}>Method</th>
                    <th style={thStyle}>Matched Cat</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const badge = confidenceBadge(entry.match_confidence);
                    return (
                      <tr
                        key={entry.entry_id}
                        style={{
                          borderBottom: "1px solid var(--card-border)",
                          background: entry.is_recheck ? "var(--section-bg)" : undefined,
                        }}
                      >
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 600, fontFamily: "monospace" }}>
                            {entry.line_number}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 500 }}>
                            {entry.parsed_owner_name || entry.raw_client_name || "—"}
                          </div>
                          {entry.parsed_cat_name && (
                            <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                              &ldquo;{entry.parsed_cat_name}&rdquo;
                            </div>
                          )}
                          {entry.is_recheck && (
                            <span style={{
                              fontSize: "0.65rem",
                              padding: "1px 4px",
                              borderRadius: "3px",
                              background: "var(--info-bg)",
                              color: "var(--info-text)",
                            }}>
                              recheck
                            </span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {entry.female_count > 0 && (
                            <span style={{ color: "var(--danger-text)" }}>F</span>
                          )}
                          {entry.male_count > 0 && (
                            <span style={{ color: "var(--info-text)" }}>M</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", fontFamily: "monospace" }}>
                          {entry.weight_lbs != null
                            ? `${entry.weight_lbs}`
                            : <span style={{ color: "var(--muted)" }}>—</span>
                          }
                        </td>
                        <td style={tdStyle}>
                          {entry.match_confidence ? (
                            <span style={{
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontSize: "0.7rem",
                              fontWeight: 600,
                              background: badge.bg,
                              color: badge.color,
                            }}>
                              {entry.match_confidence}
                              {entry.match_score != null && (
                                <span style={{ opacity: 0.7 }}>
                                  {" "}{(entry.match_score * 100).toFixed(0)}%
                                </span>
                              )}
                            </span>
                          ) : (
                            <span style={{
                              color: "var(--muted)",
                              fontSize: "0.75rem",
                            }}>
                              unmatched
                            </span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {entry.cds_method && (
                            <CDSMethodBadge method={entry.cds_method} />
                          )}
                        </td>
                        <td style={tdStyle}>
                          {entry.matched_cat_name ? (
                            <div>
                              <span>{entry.matched_cat_name}</span>
                              {entry.matched_microchip && (
                                <div style={{
                                  fontSize: "0.7rem",
                                  color: "var(--muted)",
                                  fontFamily: "monospace",
                                }}>
                                  {entry.matched_microchip}
                                </div>
                              )}
                            </div>
                          ) : entry.matched_appointment_id ? (
                            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                              Appointment linked (no cat yet)
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Photos Tab */}
        {activeTab === "photos" && (
          <div className="card">
            <ClinicDayPhotoStrip
              clinicDate={date}
              entryCount={status?.master_list.entry_count ?? 0}
              onUpload={handlePhotoUpload}
              uploading={uploadingPhotos}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function StatusLane({
  title,
  status,
  primary,
  secondary,
}: {
  title: string;
  status: "ready" | "partial" | "pending" | "missing";
  primary: string;
  secondary?: string;
}) {
  const statusStyles: Record<string, { border: string; dot: string }> = {
    ready: { border: "var(--success-text)", dot: "var(--success-text)" },
    partial: { border: "var(--warning-text)", dot: "var(--warning-text)" },
    pending: { border: "var(--info-text)", dot: "var(--info-text)" },
    missing: { border: "var(--card-border)", dot: "var(--muted)" },
  };
  const s = statusStyles[status];

  return (
    <div style={{
      padding: "12px 16px",
      border: `1px solid var(--card-border)`,
      borderTop: `3px solid ${s.border}`,
      borderRadius: "8px",
      background: "var(--card-bg)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        marginBottom: "6px",
      }}>
        <div style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: s.dot,
        }} />
        <span style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}>
          {title}
        </span>
      </div>
      <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
        {primary}
      </div>
      {secondary && (
        <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "2px" }}>
          {secondary}
        </div>
      )}
    </div>
  );
}

function CDSMethodBadge({ method }: { method: string }) {
  const methodConfig: Record<string, { label: string; bg: string; color: string }> = {
    sql_owner_name: { label: "SQL:name", bg: "var(--success-bg)", color: "var(--success-text)" },
    sql_cat_name: { label: "SQL:cat", bg: "var(--success-bg)", color: "var(--success-text)" },
    sql_sex: { label: "SQL:sex", bg: "var(--success-bg)", color: "var(--success-text)" },
    sql_cardinality: { label: "SQL:card", bg: "var(--success-bg)", color: "var(--success-text)" },
    manual: { label: "manual", bg: "var(--primary-bg)", color: "var(--primary)" },
    waiver_bridge: { label: "waiver", bg: "var(--info-bg)", color: "var(--info-text)" },
    constraint_propagation: { label: "constraint", bg: "var(--info-bg)", color: "var(--info-text)" },
    weight_disambiguation: { label: "weight", bg: "var(--warning-bg)", color: "var(--warning-text)" },
    composite: { label: "composite", bg: "var(--warning-bg)", color: "var(--warning-text)" },
    cds_suggestion: { label: "suggestion", bg: "#fff3e0", color: "#e65100" },
  };

  const cfg = methodConfig[method] || { label: method, bg: "var(--section-bg)", color: "var(--muted)" };

  return (
    <span style={{
      padding: "2px 5px",
      borderRadius: "3px",
      fontSize: "0.65rem",
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.color,
      whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  verticalAlign: "top",
};
