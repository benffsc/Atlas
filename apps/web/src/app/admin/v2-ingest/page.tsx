"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchApi } from "@/lib/api-client";

// ============================================================================
// Types
// ============================================================================

type FileType = "cat_info" | "owner_info" | "appointment_info";

interface ProcessingStats {
  total: number;
  sourceInserted: number;
  sourceSkipped: number;
  opsInserted: number;
  personsCreated: number;
  personsMatched: number;
  pseudoProfiles: number;
  catsCreated: number;
  catsMatched: number;
  placesCreated: number;
  placesMatched: number;
  errors: number;
  ownerChangesDetected?: number;
  ownerChangesAuto?: number;
  ownerChangesQueued?: number;
  files?: {
    cat_info: number;
    owner_info: number;
    appointment_info: number;
  };
}

interface ProcessResult {
  success: boolean;
  message: string;
  stats: ProcessingStats;
  dryRun: boolean;
  elapsedMs: number;
}

interface ProgressUpdate {
  phase: string;
  current: number;
  total: number;
  message: string;
  stats?: Partial<ProcessingStats> & {
    opsInserted?: number;
    lastError?: string | null;
  };
}

interface V2Stats {
  source: { clinichq_raw: number };
  ops: { appointments: number; clinic_accounts: number };
  sot: { people: number; cats: number; places: number };
  resolution: Record<string, number>;
}

// Pipeline event for the live feed
interface PipelineEvent {
  id: number;
  timestamp: Date;
  type: "info" | "success" | "warning" | "error" | "milestone";
  message: string;
  icon?: string;
}

// Pipeline stage definition
interface PipelineStage {
  id: string;
  label: string;
  icon: string;
  status: "pending" | "active" | "completed" | "error";
  startTime?: Date;
  endTime?: Date;
  metrics?: { label: string; value: number }[];
}

const FILE_TYPES: { key: FileType; label: string; description: string; icon: string }[] = [
  { key: "cat_info", label: "Cat Info", description: "Microchips, names, sex, breed", icon: "🐱" },
  { key: "owner_info", label: "Owner Info", description: "Contact details, addresses", icon: "👤" },
  { key: "appointment_info", label: "Appointments", description: "Procedures, dates, services", icon: "📅" },
];

const INITIAL_STAGES: PipelineStage[] = [
  { id: "upload", label: "Upload", icon: "📤", status: "pending" },
  { id: "parse", label: "Parse Files", icon: "📄", status: "pending" },
  { id: "stage", label: "Stage Records", icon: "📥", status: "pending" },
  { id: "cats", label: "Process Cats", icon: "🐱", status: "pending" },
  { id: "owners", label: "Process Owners", icon: "👤", status: "pending" },
  { id: "appointments", label: "Appointments", icon: "📅", status: "pending" },
  { id: "linking", label: "Entity Linking", icon: "🔗", status: "pending" },
  { id: "detection", label: "Change Detection", icon: "🔍", status: "pending" },
  { id: "complete", label: "Complete", icon: "✅", status: "pending" },
];

// ============================================================================
// Animated Counter Component
// ============================================================================

function AnimatedCounter({ value, duration = 500 }: { value: number; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValue = useRef(0);

  useEffect(() => {
    if (value === previousValue.current) return;

    const startValue = previousValue.current;
    const endValue = value;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = Math.round(startValue + (endValue - startValue) * eased);
      setDisplayValue(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        previousValue.current = endValue;
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration]);

  return <span>{displayValue.toLocaleString()}</span>;
}

// ============================================================================
// Pipeline Stage Component
// ============================================================================

function PipelineStageCard({ stage, isFirst, isLast }: { stage: PipelineStage; isFirst: boolean; isLast: boolean }) {
  const statusColors = {
    pending: { bg: "#f1f5f9", border: "#e2e8f0", text: "#64748b", dot: "#94a3b8" },
    active: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8", dot: "#3b82f6" },
    completed: { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d", dot: "#22c55e" },
    error: { bg: "#fef2f2", border: "#fecaca", text: "#dc2626", dot: "#ef4444" },
  };

  const colors = statusColors[stage.status];

  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0.5rem 0.75rem",
          background: colors.bg,
          border: `2px solid ${colors.border}`,
          borderRadius: "0.5rem",
          minWidth: "70px",
          transition: "all 0.3s ease",
          position: "relative",
        }}
      >
        {/* Pulsing indicator for active */}
        {stage.status === "active" && (
          <div
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              width: "12px",
              height: "12px",
              background: colors.dot,
              borderRadius: "50%",
              animation: "pulse 1.5s infinite",
            }}
          />
        )}

        <span style={{ fontSize: "1.25rem", marginBottom: "0.25rem" }}>
          {stage.status === "completed" ? "✓" : stage.status === "error" ? "✕" : stage.icon}
        </span>
        <span style={{ fontSize: "0.65rem", fontWeight: 600, color: colors.text, textAlign: "center" }}>
          {stage.label}
        </span>

        {/* Duration badge */}
        {stage.startTime && stage.endTime && (
          <span style={{
            fontSize: "0.55rem",
            color: colors.text,
            opacity: 0.7,
            marginTop: "0.125rem",
          }}>
            {((stage.endTime.getTime() - stage.startTime.getTime()) / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Connector line */}
      {!isLast && (
        <div style={{
          width: "20px",
          height: "2px",
          background: stage.status === "completed" ? "#22c55e" : "#e2e8f0",
          transition: "background 0.3s ease",
        }} />
      )}
    </div>
  );
}

// ============================================================================
// Event Feed Component
// ============================================================================

function EventFeed({ events, maxVisible = 8 }: { events: PipelineEvent[]; maxVisible?: number }) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events]);

  const iconMap = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
    milestone: "🎯",
  };

  const colorMap = {
    info: "#64748b",
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    milestone: "#8b5cf6",
  };

  const visibleEvents = events.slice(-maxVisible);

  return (
    <div
      ref={feedRef}
      style={{
        maxHeight: "220px",
        overflowY: "auto",
        background: "#0f172a",
        borderRadius: "0.5rem",
        padding: "0.75rem",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "0.75rem",
      }}
    >
      {visibleEvents.length === 0 ? (
        <div style={{ color: "#64748b", textAlign: "center", padding: "1rem" }}>
          Waiting for pipeline to start...
        </div>
      ) : (
        visibleEvents.map((event, idx) => (
          <div
            key={event.id}
            style={{
              display: "flex",
              gap: "0.5rem",
              padding: "0.375rem 0",
              borderBottom: idx < visibleEvents.length - 1 ? "1px solid #1e293b" : "none",
              animation: idx === visibleEvents.length - 1 ? "fadeIn 0.3s ease" : undefined,
            }}
          >
            <span style={{ opacity: 0.5, color: "#64748b", whiteSpace: "nowrap" }}>
              {event.timestamp.toLocaleTimeString("en-US", { hour12: false })}
            </span>
            <span>{event.icon || iconMap[event.type]}</span>
            <span style={{ color: colorMap[event.type], flex: 1 }}>
              {event.message}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ============================================================================
// Metric Card Component
// ============================================================================

function MetricCard({
  label,
  value,
  icon,
  color = "#3b82f6",
  subtitle,
  animate = true,
}: {
  label: string;
  value: number;
  icon: string;
  color?: string;
  subtitle?: string;
  animate?: boolean;
}) {
  return (
    <div style={{
      padding: "0.75rem 1rem",
      background: "white",
      borderRadius: "0.5rem",
      border: "1px solid #e5e7eb",
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
    }}>
      <div style={{
        width: "36px",
        height: "36px",
        borderRadius: "0.375rem",
        background: `${color}15`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.125rem",
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: "1.25rem", fontWeight: 700, color }}>
          {animate ? <AnimatedCounter value={value} /> : value.toLocaleString()}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
          {label}
          {subtitle && <span style={{ opacity: 0.7 }}> • {subtitle}</span>}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function V2IngestPage() {
  const [files, setFiles] = useState<Record<FileType, File | null>>({
    cat_info: null,
    owner_info: null,
    appointment_info: null,
  });
  const [dryRun, setDryRun] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [v2Stats, setV2Stats] = useState<V2Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);

  // Pipeline visualization state
  const [stages, setStages] = useState<PipelineStage[]>(INITIAL_STAGES);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [liveMetrics, setLiveMetrics] = useState({
    cats: 0,
    people: 0,
    places: 0,
    appointments: 0,
    ownerChanges: 0,
  });
  const eventIdRef = useRef(0);

  const fileInputRefs = useRef<Record<FileType, HTMLInputElement | null>>({
    cat_info: null,
    owner_info: null,
    appointment_info: null,
  });
  const abortControllerRef = useRef<AbortController | null>(null);

  // Add event to feed
  const addEvent = useCallback((type: PipelineEvent["type"], message: string, icon?: string) => {
    eventIdRef.current++;
    setEvents(prev => [...prev, {
      id: eventIdRef.current,
      timestamp: new Date(),
      type,
      message,
      icon,
    }]);
  }, []);

  // Update stage status
  const updateStage = useCallback((stageId: string, updates: Partial<PipelineStage>) => {
    setStages(prev => prev.map(s =>
      s.id === stageId ? { ...s, ...updates } : s
    ));
  }, []);

  // Reset pipeline state
  const resetPipeline = useCallback(() => {
    setStages(INITIAL_STAGES);
    setEvents([]);
    setLiveMetrics({ cats: 0, people: 0, places: 0, appointments: 0, ownerChanges: 0 });
    eventIdRef.current = 0;
  }, []);

  // Load V2 stats on mount
  useEffect(() => {
    loadV2Stats();
  }, []);

  const loadV2Stats = async () => {
    setLoadingStats(true);
    try {
      const data = await fetchApi<V2Stats>("/api/v2/stats");
      setV2Stats(data);
    } catch (err) {
      console.error("Failed to load V2 stats:", err);
    } finally {
      setLoadingStats(false);
    }
  };

  // Handle file selection
  const handleFileChange = (fileType: FileType, file: File | null) => {
    setFiles((prev) => ({ ...prev, [fileType]: file }));
    setResult(null);
    setError(null);
  };

  // Handle file drop
  const handleDrop = (fileType: FileType, e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && (droppedFile.name.endsWith(".xlsx") || droppedFile.name.endsWith(".xls") || droppedFile.name.endsWith(".csv"))) {
      handleFileChange(fileType, droppedFile);
    } else {
      setError("Please drop an Excel file (.xlsx, .xls) or CSV file");
    }
  };

  const filesUploaded = Object.values(files).filter(Boolean).length;
  const isComplete = filesUploaded === 3;

  // Cancel processing
  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setProcessing(false);
    setProgress(null);
    setError("Processing cancelled by user");
    addEvent("warning", "Pipeline cancelled by user");
  };

  // Map SSE phase to stage
  const phaseToStage = (phase: string): string => {
    const mapping: Record<string, string> = {
      uploading: "upload",
      parsing: "parse",
      staging: "stage",
      "processing_cats": "cats",
      "processing_owners": "owners",
      "processing_appointments": "appointments",
      "entity_linking": "linking",
      "change_detection": "detection",
      complete: "complete",
    };
    return mapping[phase] || phase;
  };

  // Process all files with streaming progress
  const handleProcess = async () => {
    if (!isComplete) return;

    // Reset state
    abortControllerRef.current = new AbortController();
    resetPipeline();
    setProcessing(true);
    setError(null);
    setResult(null);
    setProgress({ phase: "uploading", current: 0, total: 100, message: "Preparing upload..." });

    // Start pipeline
    addEvent("milestone", `Starting ${dryRun ? "DRY RUN" : "LIVE"} pipeline`, "🚀");
    updateStage("upload", { status: "active", startTime: new Date() });

    try {
      const formData = new FormData();
      formData.append("cat_info", files.cat_info!);
      formData.append("owner_info", files.owner_info!);
      formData.append("appointment_info", files.appointment_info!);
      formData.append("dryRun", String(dryRun));
      formData.append("stream", "true");

      addEvent("info", `Uploading ${files.cat_info!.name}, ${files.owner_info!.name}, ${files.appointment_info!.name}`);

      const res = await fetch("/api/v2/ingest/clinichq", {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Processing failed");
      }

      updateStage("upload", { status: "completed", endTime: new Date() });
      addEvent("success", "Files uploaded successfully");

      // Handle SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let currentStage = "parse";
      let lastPhase = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "progress") {
                setProgress({
                  phase: data.phase,
                  current: data.current,
                  total: data.total,
                  message: data.message,
                  stats: data.stats,
                });

                // Update live metrics
                if (data.stats) {
                  setLiveMetrics({
                    cats: (data.stats.catsCreated || 0) + (data.stats.catsMatched || 0),
                    people: (data.stats.personsCreated || 0) + (data.stats.personsMatched || 0),
                    places: (data.stats.placesCreated || 0) + (data.stats.placesMatched || 0),
                    appointments: data.stats.opsInserted || 0,
                    ownerChanges: data.stats.ownerChangesDetected || 0,
                  });
                }

                // Track phase changes for stage visualization
                const stageId = phaseToStage(data.phase);
                if (data.phase !== lastPhase && stageId !== currentStage) {
                  // Complete previous stage
                  updateStage(currentStage, { status: "completed", endTime: new Date() });
                  // Start new stage
                  updateStage(stageId, { status: "active", startTime: new Date() });
                  currentStage = stageId;

                  // Add event for significant stages
                  if (stageId === "cats") addEvent("info", "Processing cat records...", "🐱");
                  if (stageId === "owners") addEvent("info", "Resolving owner identities...", "👤");
                  if (stageId === "appointments") addEvent("info", "Creating appointments...", "📅");
                  if (stageId === "linking") addEvent("info", "Running entity linking...", "🔗");
                  if (stageId === "detection") addEvent("info", "Analyzing owner changes...", "🔍");
                }
                lastPhase = data.phase;

                // Log important events
                if (data.stats?.lastError) {
                  addEvent("error", data.stats.lastError);
                }

                // Milestone events for significant counts
                if (data.stats?.catsCreated && data.stats.catsCreated > 0 && data.stats.catsCreated % 100 === 0) {
                  addEvent("success", `${data.stats.catsCreated} new cats created`);
                }
                if (data.stats?.personsCreated && data.stats.personsCreated > 0 && data.stats.personsCreated % 50 === 0) {
                  addEvent("success", `${data.stats.personsCreated} new people created`);
                }
              } else if (data.type === "complete") {
                // Mark remaining stages as completed
                setStages(prev => prev.map(s =>
                  s.status === "pending" || s.status === "active"
                    ? { ...s, status: "completed", endTime: new Date() }
                    : s
                ));

                addEvent("milestone", `Pipeline complete in ${(data.elapsedMs / 1000).toFixed(1)}s`, "🎉");

                // Final summary events
                if (data.stats?.catsCreated > 0) {
                  addEvent("success", `Created ${data.stats.catsCreated} new cats, matched ${data.stats.catsMatched}`);
                }
                if (data.stats?.personsCreated > 0) {
                  addEvent("success", `Created ${data.stats.personsCreated} new people, matched ${data.stats.personsMatched}`);
                }
                if (data.stats?.ownerChangesDetected > 0) {
                  addEvent("warning", `${data.stats.ownerChangesDetected} owner changes need review`);
                }
                if (data.stats?.errors > 0) {
                  addEvent("error", `${data.stats.errors} records had errors`);
                }

                setResult(data);
                setProgress(null);

                if (!dryRun) {
                  await loadV2Stats();
                }
              } else if (data.type === "error") {
                addEvent("error", data.error);
                throw new Error(data.error);
              }
            } catch (parseErr) {
              console.error("Failed to parse SSE message:", parseErr);
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Processing cancelled by user");
      } else {
        const errorMsg = err instanceof Error ? err.message : "Processing failed";
        addEvent("error", errorMsg);
        setError(errorMsg);

        // Mark current stage as error
        setStages(prev => prev.map(s =>
          s.status === "active" ? { ...s, status: "error" } : s
        ));
      }
      setProgress(null);
    } finally {
      setProcessing(false);
      abortControllerRef.current = null;
    }
  };

  // Reset state
  const handleReset = () => {
    setFiles({ cat_info: null, owner_info: null, appointment_info: null });
    setResult(null);
    setError(null);
    setProgress(null);
    resetPipeline();
    FILE_TYPES.forEach((ft) => {
      if (fileInputRefs.current[ft.key]) {
        fileInputRefs.current[ft.key]!.value = "";
      }
    });
  };

  return (
    <div style={{ padding: "1.5rem 2rem", maxWidth: "1200px", margin: "0 auto" }}>
      {/* CSS for animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.75rem" }}>📊</span>
            ClinicHQ Data Pipeline
          </h1>
          <p style={{ color: "#64748b", marginTop: "0.25rem", fontSize: "0.875rem" }}>
            Upload and process ClinicHQ exports through the Atlas data pipeline
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={loadV2Stats}
            disabled={loadingStats}
            style={{
              padding: "0.5rem 0.75rem",
              fontSize: "0.75rem",
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: "0.375rem",
              cursor: loadingStats ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
            }}
          >
            {loadingStats ? "⏳" : "🔄"} Refresh Stats
          </button>
          <Link
            href="/admin/owner-changes"
            style={{
              padding: "0.5rem 0.75rem",
              fontSize: "0.75rem",
              background: "#fef3c7",
              border: "1px solid #fcd34d",
              borderRadius: "0.375rem",
              textDecoration: "none",
              color: "#92400e",
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
            }}
          >
            🔍 Owner Changes
          </Link>
        </div>
      </div>

      {/* Database Stats Bar */}
      {v2Stats && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}>
          <MetricCard label="People" value={v2Stats.sot.people} icon="👤" color="#8b5cf6" animate={false} />
          <MetricCard label="Cats" value={v2Stats.sot.cats} icon="🐱" color="#f59e0b" animate={false} />
          <MetricCard label="Places" value={v2Stats.sot.places} icon="📍" color="#22c55e" animate={false} />
          <MetricCard label="Appointments" value={v2Stats.ops.appointments} icon="📅" color="#3b82f6" animate={false} />
          <MetricCard label="Clinic Accounts" value={v2Stats.ops.clinic_accounts} icon="🏥" color="#64748b" animate={false} />
        </div>
      )}

      {/* File Upload Cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "1rem",
        marginBottom: "1.5rem",
      }}>
        {FILE_TYPES.map((ft) => (
          <div
            key={ft.key}
            onDrop={(e) => handleDrop(ft.key, e)}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => !processing && fileInputRefs.current[ft.key]?.click()}
            style={{
              border: files[ft.key] ? "2px solid #22c55e" : "2px dashed #d1d5db",
              borderRadius: "0.75rem",
              padding: "1.25rem 1rem",
              textAlign: "center",
              background: files[ft.key] ? "#f0fdf4" : "white",
              cursor: processing ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
              opacity: processing ? 0.7 : 1,
            }}
          >
            <input
              ref={(el) => { fileInputRefs.current[ft.key] = el; }}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFileChange(ft.key, e.target.files?.[0] || null)}
              style={{ display: "none" }}
              disabled={processing}
            />

            <div style={{
              fontSize: "2rem",
              marginBottom: "0.5rem",
              filter: files[ft.key] ? "none" : "grayscale(0.5)",
            }}>
              {files[ft.key] ? "✅" : ft.icon}
            </div>
            <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.125rem", color: files[ft.key] ? "#15803d" : "#374151" }}>
              {ft.label}
            </div>
            <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.5rem" }}>
              {files[ft.key] ? files[ft.key]!.name : ft.description}
            </div>
            {files[ft.key] && !processing && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFileChange(ft.key, null);
                  if (fileInputRefs.current[ft.key]) {
                    fileInputRefs.current[ft.key]!.value = "";
                  }
                }}
                style={{
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.65rem",
                  background: "white",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.25rem",
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Controls Bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        marginBottom: "1.5rem",
        padding: "0.75rem 1rem",
        background: "#f8fafc",
        borderRadius: "0.5rem",
        border: "1px solid #e5e7eb",
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={processing}
            style={{ width: "16px", height: "16px" }}
          />
          <span style={{ fontSize: "0.875rem" }}>
            <strong>Dry Run</strong>
            <span style={{ color: "#64748b", marginLeft: "0.25rem" }}>— Parse and validate only</span>
          </span>
        </label>

        <div style={{ flex: 1 }} />

        <span style={{
          fontSize: "0.75rem",
          padding: "0.25rem 0.5rem",
          borderRadius: "0.25rem",
          background: isComplete ? "#dcfce7" : "#fef3c7",
          color: isComplete ? "#15803d" : "#92400e",
          fontWeight: 500,
        }}>
          {filesUploaded}/3 files selected
        </span>

        {!processing ? (
          <>
            <button
              onClick={handleProcess}
              disabled={!isComplete}
              style={{
                padding: "0.5rem 1.5rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                background: !isComplete ? "#d1d5db" : dryRun ? "#f59e0b" : "#3b82f6",
                color: "white",
                border: "none",
                borderRadius: "0.5rem",
                cursor: !isComplete ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              {dryRun ? "🧪 Run Dry Run" : "🚀 Process Data"}
            </button>
            {(result || events.length > 0) && (
              <button
                onClick={handleReset}
                style={{
                  padding: "0.5rem 1rem",
                  fontSize: "0.875rem",
                  background: "white",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.5rem",
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
            )}
          </>
        ) : (
          <button
            onClick={handleCancel}
            style={{
              padding: "0.5rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              background: "#ef4444",
              color: "white",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            ⏹ Cancel
          </button>
        )}
      </div>

      {/* Pipeline Visualization - Only show during/after processing */}
      {(processing || result || events.length > 0) && (
        <div style={{
          marginBottom: "1.5rem",
          padding: "1.25rem",
          background: "#f8fafc",
          borderRadius: "0.75rem",
          border: "1px solid #e5e7eb",
        }}>
          {/* Pipeline Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {processing && <span style={{ animation: "pulse 1.5s infinite" }}>⚡</span>}
              Pipeline Status
            </h3>
            {progress && (
              <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                {progress.message}
              </span>
            )}
          </div>

          {/* Stage Cards */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "0.75rem 0",
            overflowX: "auto",
            gap: "0",
            marginBottom: "1rem",
          }}>
            {stages.map((stage, idx) => (
              <PipelineStageCard
                key={stage.id}
                stage={stage}
                isFirst={idx === 0}
                isLast={idx === stages.length - 1}
              />
            ))}
          </div>

          {/* Overall Progress Bar */}
          {progress && progress.total > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{
                height: "6px",
                background: "#e5e7eb",
                borderRadius: "3px",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${(progress.current / progress.total) * 100}%`,
                  background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                  borderRadius: "3px",
                  transition: "width 0.3s ease",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#64748b", marginTop: "0.25rem" }}>
                <span>{progress.current.toLocaleString()} / {progress.total.toLocaleString()} records</span>
                <span>{Math.round((progress.current / progress.total) * 100)}%</span>
              </div>
            </div>
          )}

          {/* Live Metrics Grid */}
          {(processing || result) && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: "0.75rem",
              marginBottom: "1rem",
            }}>
              <MetricCard label="Cats" value={liveMetrics.cats} icon="🐱" color="#f59e0b" />
              <MetricCard label="People" value={liveMetrics.people} icon="👤" color="#8b5cf6" />
              <MetricCard label="Places" value={liveMetrics.places} icon="📍" color="#22c55e" />
              <MetricCard label="Appointments" value={liveMetrics.appointments} icon="📅" color="#3b82f6" />
              <MetricCard
                label="Owner Changes"
                value={liveMetrics.ownerChanges}
                icon="🔍"
                color={liveMetrics.ownerChanges > 0 ? "#f59e0b" : "#64748b"}
              />
            </div>
          )}

          {/* Event Feed */}
          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
              📋 Event Log
            </div>
            <EventFeed events={events} />
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div style={{
          padding: "1rem",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "0.5rem",
          color: "#dc2626",
          marginBottom: "1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}>
          <span style={{ fontSize: "1.25rem" }}>❌</span>
          <div>
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}

      {/* Results Summary */}
      {result && (
        <div style={{
          padding: "1.5rem",
          background: result.success ? "#f0fdf4" : "#fef3c7",
          border: `1px solid ${result.success ? "#bbf7d0" : "#fde68a"}`,
          borderRadius: "0.75rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span style={{ fontSize: "2rem" }}>{result.success ? "🎉" : "⚠️"}</span>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
                  {result.dryRun ? "Dry Run Complete" : "Processing Complete"}
                </h3>
                <p style={{ margin: 0, color: "#64748b", fontSize: "0.875rem" }}>
                  {result.message} • {(result.elapsedMs / 1000).toFixed(2)}s
                </p>
              </div>
            </div>
            <span style={{
              padding: "0.25rem 0.75rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: result.dryRun ? "#fef3c7" : "#dcfce7",
              color: result.dryRun ? "#92400e" : "#15803d",
              borderRadius: "9999px",
            }}>
              {result.dryRun ? "🧪 DRY RUN" : "✅ LIVE"}
            </span>
          </div>

          {/* Detailed Stats Grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1rem",
            fontSize: "0.875rem",
          }}>
            <div style={{ padding: "1rem", background: "white", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "#3b82f6", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                📥 Layer 1: Source
              </div>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <div>Total Records: <strong>{result.stats.total.toLocaleString()}</strong></div>
                <div>New: <strong>{result.stats.sourceInserted.toLocaleString()}</strong></div>
                <div>Unchanged: <strong>{result.stats.sourceSkipped.toLocaleString()}</strong></div>
              </div>
            </div>

            <div style={{ padding: "1rem", background: "white", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "#f59e0b", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                ⚙️ Layer 2: Operations
              </div>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <div>Appointments: <strong>{result.stats.opsInserted.toLocaleString()}</strong></div>
                <div>Pseudo-Profiles: <strong>{result.stats.pseudoProfiles.toLocaleString()}</strong></div>
              </div>
            </div>

            <div style={{ padding: "1rem", background: "white", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.5rem", color: "#22c55e", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                ✨ Layer 3: SOT
              </div>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <div>People: <strong>{result.stats.personsCreated}</strong> new, <strong>{result.stats.personsMatched}</strong> matched</div>
                <div>Cats: <strong>{result.stats.catsCreated}</strong> new, <strong>{result.stats.catsMatched}</strong> matched</div>
                <div>Places: <strong>{result.stats.placesCreated}</strong> new, <strong>{result.stats.placesMatched}</strong> matched</div>
              </div>
            </div>
          </div>

          {/* Owner Changes Alert */}
          {(result.stats.ownerChangesDetected || 0) > 0 && (
            <div style={{
              marginTop: "1rem",
              padding: "1rem",
              background: "#fef3c7",
              border: "1px solid #fcd34d",
              borderRadius: "0.5rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "1.5rem" }}>🔍</span>
                <div>
                  <div style={{ fontWeight: 600, color: "#92400e" }}>
                    {result.stats.ownerChangesDetected} Owner Change{result.stats.ownerChangesDetected !== 1 ? "s" : ""} Detected
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#a16207" }}>
                    {result.stats.ownerChangesAuto || 0} auto-processed • {result.stats.ownerChangesQueued || 0} need review
                  </div>
                </div>
              </div>
              <Link
                href="/admin/owner-changes"
                style={{
                  padding: "0.5rem 1rem",
                  background: "#f59e0b",
                  color: "white",
                  borderRadius: "0.375rem",
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                }}
              >
                Review Changes →
              </Link>
            </div>
          )}

          {/* Errors */}
          {result.stats.errors > 0 && (
            <div style={{
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              background: "#fef2f2",
              borderRadius: "0.5rem",
              color: "#dc2626",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}>
              <span>⚠️</span>
              <strong>{result.stats.errors}</strong> records had processing errors
            </div>
          )}
        </div>
      )}

      {/* Help Panel */}
      <div style={{
        marginTop: "2rem",
        padding: "1rem 1.25rem",
        background: "#f8fafc",
        borderRadius: "0.5rem",
        border: "1px solid #e5e7eb",
      }}>
        <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.875rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.375rem" }}>
          💡 How it works
        </h4>
        <div style={{ fontSize: "0.8rem", color: "#64748b", lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            <strong>Upload →</strong> Select 3 ClinicHQ exports (Cat Info, Owner Info, Appointments).
          </p>
          <p style={{ margin: "0 0 0.5rem" }}>
            <strong>Parse →</strong> Files are parsed and staged for processing.
          </p>
          <p style={{ margin: "0 0 0.5rem" }}>
            <strong>Process →</strong> Records flow through the 3-layer architecture: Source (raw) → OPS (operational) → SOT (canonical entities).
          </p>
          <p style={{ margin: 0 }}>
            <strong>Detect →</strong> Owner changes are analyzed and queued for review if contact info differs from existing records.
          </p>
        </div>
      </div>
    </div>
  );
}
