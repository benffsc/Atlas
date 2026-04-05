"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { fetchApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { StatCard } from "@/components/ui/StatCard";
import { TabBar, TabPanel } from "@/components/ui/TabBar";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SkeletonStats, SkeletonTable } from "@/components/feedback/Skeleton";

// --- Types ---

interface WaiverStats {
  total_waivers: number;
  parsed_count: number;
  matched_count: number;
  ocr_pending: number;
  ocr_extracted: number;
  ocr_failed: number;
  review_pending: number;
  review_approved: number;
  review_rejected: number;
  enriched_count: number;
}

interface WaiverRow {
  waiver_id: string;
  file_upload_id: string | null;
  original_filename: string | null;
  parsed_last_name: string | null;
  parsed_description: string | null;
  parsed_last4_chip: string | null;
  parsed_date: string | null;
  matched_appointment_id: string | null;
  matched_cat_id: string | null;
  match_method: string | null;
  match_confidence: number | null;
  cat_name: string | null;
  microchip: string | null;
  client_name: string | null;
  ocr_status: string;
  review_status: string;
  enrichment_status: string;
  created_at: string;
}

interface UploadProcessResult {
  upload_id: string;
  waiver_id: string | null;
  filename: string;
  parsed: boolean;
  matched: boolean;
  error?: string;
  parsed_data?: {
    lastName: string;
    description: string;
    last4Chip: string;
    date: string;
  };
  match_data?: {
    appointment_id: string;
    cat_id: string | null;
    cat_name: string | null;
    microchip: string | null;
    client_name: string | null;
    appointment_date: string;
    match_method: string;
    confidence: number;
  };
}

// --- Status Badge ---

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: "rgba(107, 114, 128, 0.1)", color: "#6b7280", label: "Pending" },
  extracting: { bg: "rgba(59, 130, 246, 0.1)", color: "var(--primary, #2563eb)", label: "Extracting" },
  extracted: { bg: "rgba(16, 185, 129, 0.1)", color: "#059669", label: "Extracted" },
  failed: { bg: "rgba(239, 68, 68, 0.1)", color: "#dc2626", label: "Failed" },
  approved: { bg: "rgba(16, 185, 129, 0.1)", color: "#059669", label: "Approved" },
  corrected: { bg: "rgba(245, 158, 11, 0.1)", color: "#d97706", label: "Corrected" },
  rejected: { bg: "rgba(239, 68, 68, 0.1)", color: "#dc2626", label: "Rejected" },
  skipped: { bg: "rgba(107, 114, 128, 0.1)", color: "#6b7280", label: "Skipped" },
  applied: { bg: "rgba(16, 185, 129, 0.1)", color: "#059669", label: "Applied" },
  partial: { bg: "rgba(245, 158, 11, 0.1)", color: "#d97706", label: "Partial" },
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

// --- Upload Steps ---

const WAIVER_STEPS = ["upload", "parse", "match", "done"] as const;
const WAIVER_STEP_LABELS = ["Upload PDFs", "Parse Filenames", "Match Chips", "Done"];

function WaiverStepper({ phase }: { phase: "idle" | "uploading" | "processing" | "done" | "error" }) {
  const phaseMap: Record<string, number> = { idle: -1, uploading: 0, processing: 1, done: 3, error: -1 };
  const activeIdx = phaseMap[phase] ?? -1;
  const isError = phase === "error";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "center", margin: "1rem 0" }}>
      {WAIVER_STEPS.map((step, idx) => {
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
                {WAIVER_STEP_LABELS[idx]}
              </div>
            </div>
            {idx < WAIVER_STEPS.length - 1 && (
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

// --- Match Result Card ---

function MatchResultCard({ result }: { result: UploadProcessResult }) {
  const isMatched = result.matched && result.match_data;
  const isParsed = result.parsed;

  return (
    <div style={{
      padding: "0.75rem 1rem",
      background: "var(--card-bg)",
      border: `1px solid ${isMatched ? "rgba(16, 185, 129, 0.3)" : isParsed ? "rgba(245, 158, 11, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
      borderRadius: "8px",
      marginBottom: "0.5rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
        <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
          {result.filename}
        </div>
        <span style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: "9999px",
          fontSize: "0.65rem",
          fontWeight: 600,
          background: isMatched ? "rgba(16, 185, 129, 0.1)" : isParsed ? "rgba(245, 158, 11, 0.1)" : "rgba(239, 68, 68, 0.1)",
          color: isMatched ? "#059669" : isParsed ? "#d97706" : "#dc2626",
        }}>
          {isMatched ? "Matched" : isParsed ? "Parsed (no match)" : "Parse failed"}
        </span>
      </div>

      {isParsed && result.parsed_data && (
        <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.25rem" }}>
          {result.parsed_data.lastName} | {result.parsed_data.description} | Chip ...{result.parsed_data.last4Chip} | {result.parsed_data.date}
        </div>
      )}

      {isMatched && result.match_data && (
        <div style={{ fontSize: "0.8rem", color: "#059669" }}>
          {result.match_data.cat_name || "Unknown cat"} ({result.match_data.microchip}) &mdash; {result.match_data.client_name || "Unknown client"}
          <span style={{ marginLeft: "8px", opacity: 0.7 }}>
            {Math.round((result.match_data.confidence || 0) * 100)}% confidence
          </span>
        </div>
      )}

      {result.error && !isParsed && (
        <div style={{ fontSize: "0.8rem", color: "#dc2626" }}>{result.error}</div>
      )}
    </div>
  );
}

// --- Upload Tab ---

function UploadTab({ onRefresh, waivers }: { onRefresh: () => void; waivers: WaiverRow[] }) {
  const { addToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing" | "done" | "error">("idle");
  const [results, setResults] = useState<UploadProcessResult[]>([]);

  const isWorking = phase === "uploading" || phase === "processing";

  const handleUpload = async (files: FileList) => {
    setPhase("uploading");
    setResults([]);

    try {
      // Step 1: Upload all PDFs
      const uploadIds: string[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("source_system", "clinic_waiver");
        formData.append("source_table", "waiver_scan");

        const uploadRes = await fetch("/api/ingest/upload", { method: "POST", body: formData });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.data?.upload_id) {
          throw new Error(`Upload failed for ${file.name}: ${uploadData.error?.message || "Unknown error"}`);
        }
        uploadIds.push(uploadData.data.upload_id);
      }

      // Step 2: Process all waivers (parse + match)
      setPhase("processing");
      const processRes = await fetch("/api/ingest/process-waiver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_ids: uploadIds }),
      });
      const processData = await processRes.json();
      if (!processRes.ok) {
        throw new Error(processData.error?.message || "Processing failed");
      }

      const data = processData.data || processData;
      setResults(data.results || []);
      setPhase("done");

      const matched = data.matched || 0;
      const total = data.total || 0;
      addToast({
        type: matched > 0 ? "success" : "info",
        message: `Processed ${total} waiver${total !== 1 ? "s" : ""}: ${matched} matched to appointments`,
      });
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
        accept=".pdf"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) handleUpload(files);
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
            {phase === "done" ? "Upload more waivers" : "Click to upload scanned waiver PDFs"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Accepts multiple .pdf files. Filenames should follow: LastName Description Last4Chip M.D.YY.pdf
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
          <WaiverStepper phase={phase} />
          <div style={{ textAlign: "center", fontSize: "0.85rem", color: "var(--muted)" }}>
            {phase === "uploading" ? "Uploading PDFs..." : "Parsing filenames and matching to appointments..."}
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ marginBottom: "0.75rem" }}>Upload Results</h3>
          {results.map((r) => (
            <MatchResultCard key={r.upload_id} result={r} />
          ))}
        </div>
      )}

      {/* Recent waivers table */}
      {waivers.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ marginBottom: "0.75rem" }}>Recent Waivers</h3>
          <div style={{ background: "var(--card-bg)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--section-bg)" }}>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "left", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>File</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "left", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Parsed</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Match</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>OCR</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "center", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Review</th>
                  <th style={{ padding: "0.6rem 1rem", textAlign: "right", borderBottom: "1px solid var(--border)", fontSize: "0.8rem", fontWeight: 500 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {waivers.map((w) => (
                  <tr key={w.waiver_id}>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", fontSize: "0.8rem" }}>
                      <div>{w.original_filename || "Unknown"}</div>
                      {w.cat_name && (
                        <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                          {w.cat_name} ({w.microchip ? `...${w.microchip.slice(-4)}` : "no chip"})
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", fontSize: "0.8rem" }}>
                      {w.parsed_last_name ? (
                        <span style={{ color: "var(--foreground)" }}>
                          {w.parsed_last_name} ...{w.parsed_last4_chip}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                      {w.matched_appointment_id ? (
                        <span style={{ color: "#059669", fontWeight: 600, fontSize: "0.75rem" }}>
                          {w.match_confidence ? `${Math.round(Number(w.match_confidence) * 100)}%` : "Yes"}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                      <StatusBadge status={w.ocr_status} />
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                      <StatusBadge status={w.review_status} />
                    </td>
                    <td style={{ padding: "0.6rem 1rem", borderBottom: "1px solid var(--border)", textAlign: "right", fontSize: "0.8rem", color: "var(--muted)" }}>
                      {w.parsed_date
                        ? new Date(w.parsed_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                        : new Date(w.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
        <div style={{ fontWeight: 600, marginBottom: "0.75rem" }}>Waiver Filename Format</div>
        <div style={{ fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.8 }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            Scan waiver PDFs and name them using this pattern:
          </p>
          <code style={{
            display: "block",
            padding: "8px 12px",
            background: "var(--section-bg)",
            borderRadius: "4px",
            fontSize: "0.8rem",
            marginBottom: "0.75rem",
          }}>
            LastName Description Last4Chip M.D.YY.pdf
          </code>
          <p style={{ margin: "0 0 0.25rem", fontSize: "0.8rem" }}>Examples:</p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
            <li><code>Martinez DSH Black 2107 3.4.26.pdf</code></li>
            <li><code>Smith Tabby F 8834 12.15.25.pdf</code></li>
            <li><code>O&apos;Brien Orange M 1122 1.20.26.pdf</code></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// --- Stats Tab ---

function StatsTab({ stats }: { stats: WaiverStats }) {
  const matchRate = stats.total_waivers > 0
    ? Math.round((stats.matched_count / stats.total_waivers) * 100)
    : 0;
  const ocrRate = stats.total_waivers > 0
    ? Math.round((stats.ocr_extracted / stats.total_waivers) * 100)
    : 0;
  const reviewRate = stats.ocr_extracted > 0
    ? Math.round((stats.review_approved / stats.ocr_extracted) * 100)
    : 0;

  if (stats.total_waivers === 0) {
    return (
      <EmptyState
        title="No waivers uploaded yet"
        description="Upload scanned waiver PDFs on the Upload tab to start building enrichment data."
      />
    );
  }

  return (
    <div>
      {/* Pipeline overview */}
      <h3 style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Pipeline Overview
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <StatCard label="Total Waivers" value={stats.total_waivers} accentColor="#6b7280" />
        <StatCard label="Parsed" value={stats.parsed_count} accentColor="#3b82f6" />
        <StatCard label="Matched" value={`${stats.matched_count} (${matchRate}%)`} accentColor="#059669" />
        <StatCard label="Enriched" value={stats.enriched_count} accentColor="#8b5cf6" />
      </div>

      {/* OCR status */}
      <h3 style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        OCR Extraction
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <StatCard label="Pending" value={stats.ocr_pending} accentColor="#6b7280" />
        <StatCard label="Extracted" value={`${stats.ocr_extracted} (${ocrRate}%)`} accentColor="#059669" />
        <StatCard label="Failed" value={stats.ocr_failed} accentColor="#dc2626" />
      </div>

      {/* Review status */}
      <h3 style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Staff Review
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
        <StatCard label="Awaiting Review" value={stats.review_pending} accentColor="#f59e0b" />
        <StatCard label="Approved" value={`${stats.review_approved} (${reviewRate}%)`} accentColor="#059669" />
        <StatCard label="Rejected" value={stats.review_rejected} accentColor="#dc2626" />
      </div>
    </div>
  );
}

// --- Review Tab (placeholder for Phase 3) ---

function ReviewTab({ waivers }: { waivers: WaiverRow[] }) {
  const reviewable = waivers.filter((w) => w.ocr_status === "extracted" && w.review_status === "pending");

  if (reviewable.length === 0) {
    return (
      <EmptyState
        title="No waivers ready for review"
        description="Waivers need OCR extraction before they can be reviewed. Upload waivers and run OCR first."
      />
    );
  }

  return (
    <EmptyState
      title={`${reviewable.length} waiver${reviewable.length !== 1 ? "s" : ""} ready for review`}
      description="Review UI coming in Phase 3. Run OCR on matched waivers, then approve extracted data here."
    />
  );
}

// --- Page Content ---

function WaiverDashboardContent() {
  const [activeTab, setActiveTab] = useState("upload");
  const [stats, setStats] = useState<WaiverStats | null>(null);
  const [waivers, setWaivers] = useState<WaiverRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await fetchApi<{
        waivers: WaiverRow[];
        stats: WaiverStats;
      }>("/api/admin/waivers?limit=50");
      setWaivers(data.waivers || []);
      setStats(data.stats || null);
    } catch {
      setWaivers([]);
      setStats(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const tabs = [
    { id: "upload", label: "Upload" },
    { id: "review", label: `Review${stats && stats.review_pending > 0 ? ` (${stats.review_pending})` : ""}` },
    { id: "stats", label: "Stats" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Clinic Waivers</h1>
          <p className="text-muted" style={{ margin: "4px 0 0" }}>
            Upload scanned waiver PDFs to enrich Atlas with medication, vitals, and surgery data
          </p>
        </div>
      </div>

      {/* Tabs */}
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {loading ? (
        <div>
          <SkeletonStats count={4} />
          <div style={{ marginTop: "1rem" }}><SkeletonTable rows={3} columns={5} /></div>
        </div>
      ) : (
        <>
          <TabPanel tabId="upload" activeTab={activeTab}>
            <UploadTab onRefresh={fetchData} waivers={waivers} />
          </TabPanel>

          <TabPanel tabId="review" activeTab={activeTab}>
            <ReviewTab waivers={waivers} />
          </TabPanel>

          <TabPanel tabId="stats" activeTab={activeTab}>
            {stats ? (
              <StatsTab stats={stats} />
            ) : (
              <EmptyState title="No data available" description="Unable to load waiver stats." />
            )}
          </TabPanel>
        </>
      )}
    </div>
  );
}

export default function WaiversPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}><SkeletonStats count={4} /><SkeletonTable rows={3} columns={5} /></div>}>
      <WaiverDashboardContent />
    </Suspense>
  );
}
