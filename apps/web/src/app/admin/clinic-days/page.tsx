"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";
import { SkeletonText } from "@/components/feedback/Skeleton";
import { BatchEvidenceUpload } from "@/components/clinic/BatchEvidenceUpload";

// ── Types ──────────────────────────────────────────────────────────────

interface ClinicDay {
  clinic_day_id: string;
  clinic_date: string;
  clinic_type: string;
  total_cats: number;
  total_females: number;
  total_males: number;
}

interface RosterEntry {
  line_number: number;
  entry_id: string;
  parsed_owner_name: string | null;
  parsed_cat_name: string | null;
  raw_client_name: string | null;
  match_confidence: string | null;
  cancellation_reason: string | null;
  appointment_id: string | null;
  cat_id: string | null;
  cat_name: string | null;
  microchip: string | null;
  cat_sex: string | null;
  cat_color: string | null;
  cat_breed: string | null;
  weight_lbs: number | null;
  clinic_day_number: number | null;
  appointment_number: string | null;
  client_name: string | null;
  client_address: string | null;
  photo_count: number;
  has_hero: boolean;
  photo_url: string | null;
  waiver_id: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

const CLINIC_TYPES: Record<string, { label: string; color: string; bg: string }> = {
  regular: { label: "Regular", color: "var(--primary)", bg: "var(--primary-bg)" },
  weekday_clinic: { label: "Weekday", color: "var(--primary)", bg: "var(--primary-bg)" },
  sunday_clinic: { label: "Sunday", color: "var(--info-text)", bg: "var(--info-bg)" },
  tame_only: { label: "Tame Only", color: "var(--warning-text)", bg: "var(--warning-bg)" },
  mass_trapping: { label: "Mass Trapping", color: "var(--success-text)", bg: "var(--success-bg)" },
  emergency: { label: "Emergency", color: "var(--danger-text)", bg: "var(--danger-bg)" },
  mobile: { label: "Mobile", color: "var(--info-text)", bg: "var(--info-bg)" },
};
const DEFAULT_TYPE = { label: "Clinic", color: "var(--muted)", bg: "var(--section-bg)" };

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// ── Page ───────────────────────────────────────────────────────────────

export default function ClinicDaysPage() {
  // Date selection
  const [clinicDays, setClinicDays] = useState<ClinicDay[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Roster
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [unlinkedCats, setUnlinkedCats] = useState<Array<{
    cat_id: string; cat_name: string | null; microchip: string | null;
    cat_sex: string | null; cat_color: string | null; cat_breed: string | null;
    appointment_number: string | null; client_name: string | null;
    clinic_day_number: number | null; photo_url: string | null; photo_count: number;
  }>>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterSearch, setRosterSearch] = useState("");

  // Drawer
  const [drawerEntry, setDrawerEntry] = useState<RosterEntry | null>(null);

  // Photo upload modal
  const [uploadTarget, setUploadTarget] = useState<RosterEntry | null>(null);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Admin actions
  const [showAdmin, setShowAdmin] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [rematching, setRematching] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { addToast } = useToast();

  // ── Load clinic days list ──────────────────────────────────────────

  useEffect(() => {
    fetchApi<{ clinic_days: ClinicDay[] }>("/api/admin/clinic-days?limit=60")
      .then((data) => {
        const days = data.clinic_days || [];
        setClinicDays(days);
        // Auto-select most recent
        if (days.length > 0 && !selectedDate) {
          setSelectedDate(days[0].clinic_date.split("T")[0]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── Load roster when date changes ──────────────────────────────────

  useEffect(() => {
    if (!selectedDate) return;
    setRosterLoading(true);
    setRoster([]);
    setDrawerEntry(null);
    setRosterSearch("");
    fetchApi<{ roster: RosterEntry[]; unlinked: typeof unlinkedCats }>(`/api/admin/clinic-days/${selectedDate}/roster`)
      .then((data) => {
        setRoster(data.roster || []);
        setUnlinkedCats(data.unlinked || []);
        setRosterLoading(false);
      })
      .catch(() => setRosterLoading(false));
  }, [selectedDate]);

  // ── Photo upload ───────────────────────────────────────────────────

  const uploadPhotos = useCallback(async (files: File[], entry: RosterEntry) => {
    if (!entry.cat_id) {
      addToast({ type: "error", message: "No cat linked — can't upload" });
      return;
    }
    setUploading(true);
    let count = 0;
    let lastError = "";
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("entity_type", "cat");
        fd.append("entity_id", entry.cat_id);
        fd.append("media_type", "cat_photo");
        fd.append("cat_identification_confidence", "confirmed");
        fd.append("caption", `Clinic ${selectedDate} #${entry.clinic_day_number || entry.line_number}`);
        const r = await fetch("/api/media/upload", { method: "POST", body: fd });
        if (r.ok) {
          count++;
        } else {
          const err = await r.json().catch(() => ({ error: { message: r.statusText } }));
          lastError = err?.error?.message || err?.message || r.statusText;
          console.error("[upload] Failed:", lastError);
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Upload failed";
        console.error("[upload] Exception:", lastError);
      }
    }
    if (count > 0) {
      addToast({ type: "success", message: `${count} photo${count > 1 ? "s" : ""} uploaded` });
      // Refresh roster to update photo counts
      try {
        const data = await fetchApi<{ roster: RosterEntry[] }>(`/api/admin/clinic-days/${selectedDate}/roster`);
        setRoster(data.roster || []);
      } catch { /* non-fatal */ }
    } else if (lastError) {
      addToast({ type: "error", message: `Upload failed: ${lastError}` });
    }
    setUploading(false);
    setUploadTarget(null);
    setStagedFiles([]);
  }, [selectedDate, addToast]);

  // Paste support — stages files into modal
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!uploadTarget) return;
      const files: File[] = [];
      for (const item of Array.from(e.clipboardData?.items || [])) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        setStagedFiles(prev => [...prev, ...files]);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [uploadTarget]);

  // ── Admin: Sync master list from SharePoint ─────────────────────

  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (!selectedDate) return;
    setSyncing(true);
    try {
      // Trigger the SharePoint master list sync cron
      const resp = await fetch("/api/cron/sharepoint-master-list-sync", {
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET || ""}` },
      });
      const data = await resp.json();
      const d = data.data || data;
      const imported = d?.stats?.imported ?? 0;
      const skipped = d?.stats?.skippedExisting ?? 0;
      addToast({ type: "success", message: `Sync complete: ${imported} new, ${skipped} already synced` });
      // Reload roster
      const r = await fetchApi<{ roster: RosterEntry[] }>(`/api/admin/clinic-days/${selectedDate}/roster`);
      setRoster(r.roster || []);
    } catch (err) {
      addToast({ type: "error", message: err instanceof Error ? err.message : "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  // ── Admin: Manual import (fallback) ────────────────────────────

  const handleImport = async () => {
    if (!importFile || !selectedDate) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const response = await fetch(`/api/admin/clinic-days/${selectedDate}/import`, {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Import failed");
      const data = result.data || result;
      addToast({ type: "success", message: `Imported ${data.imported} entries, ${data.matched} matched` });
      setImportFile(null);
      // Reload roster
      const r = await fetchApi<{ roster: RosterEntry[] }>(`/api/admin/clinic-days/${selectedDate}/roster`);
      setRoster(r.roster || []);
    } catch (err) {
      addToast({ type: "error", message: err instanceof Error ? err.message : "Import failed" });
    } finally {
      setImporting(false);
    }
  };

  // ── Admin: Re-run CDS matching ─────────────────────────────────

  const handleRematch = async () => {
    if (!selectedDate) return;
    setRematching(true);
    try {
      const data = await postApi<{
        before: { matched: number; unmatched: number };
        after: { matched: number; unmatched: number };
      }>(`/api/admin/clinic-days/${selectedDate}/rematch`, {});
      addToast({ type: "success", message: `CDS: ${data.before?.matched ?? "?"} → ${data.after?.matched ?? "?"} matched` });
      const r = await fetchApi<{ roster: RosterEntry[] }>(`/api/admin/clinic-days/${selectedDate}/roster`);
      setRoster(r.roster || []);
    } catch (err) {
      addToast({ type: "error", message: err instanceof Error ? err.message : "Rematch failed" });
    } finally {
      setRematching(false);
    }
  };

  // ── Filter roster ──────────────────────────────────────────────────

  const activeEntries = roster.filter(e => !e.cancellation_reason);
  const cancelledEntries = roster.filter(e => e.cancellation_reason);

  const filtered = activeEntries.filter(e => {
    if (!rosterSearch) return true;
    const q = rosterSearch.toLowerCase().replace(/^#/, "");
    return (
      String(e.clinic_day_number || e.line_number).includes(q) ||
      (e.cat_name || "").toLowerCase().includes(q) ||
      (e.parsed_cat_name || "").toLowerCase().includes(q) ||
      (e.parsed_owner_name || "").toLowerCase().includes(q) ||
      (e.client_name || "").toLowerCase().includes(q) ||
      (e.client_address || "").toLowerCase().includes(q) ||
      (e.microchip || "").includes(q) ||
      (e.appointment_number || "").toLowerCase().includes(q) ||
      (e.cat_color || "").toLowerCase().includes(q) ||
      (e.cat_breed || "").toLowerCase().includes(q) ||
      (e.raw_client_name || "").toLowerCase().includes(q)
    );
  });

  const selectedDay = clinicDays.find(d => d.clinic_date.startsWith(selectedDate));
  const typeConfig = selectedDay ? (CLINIC_TYPES[selectedDay.clinic_type] || DEFAULT_TYPE) : null;

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
        <SkeletonText lines={8} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "16px 20px" }}>

      {/* ── Header: date strip ── */}
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "1.3rem", margin: "0 0 12px 0" }}>Clinic Days</h1>

        {/* Horizontal scrollable date chips */}
        <div style={{
          display: "flex",
          gap: "6px",
          overflowX: "auto",
          paddingBottom: "8px",
          WebkitOverflowScrolling: "touch",
        }}>
          {clinicDays.slice(0, 30).map(day => {
            const dt = day.clinic_date.split("T")[0];
            const isSelected = dt === selectedDate;
            const tc = CLINIC_TYPES[day.clinic_type] || DEFAULT_TYPE;
            return (
              <button
                key={day.clinic_day_id}
                onClick={() => setSelectedDate(dt)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  fontSize: "0.8rem",
                  fontWeight: isSelected ? 600 : 400,
                  background: isSelected ? "var(--primary)" : "var(--card-bg)",
                  color: isSelected ? "#fff" : "var(--foreground)",
                  border: `1px solid ${isSelected ? "var(--primary)" : "var(--card-border)"}`,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  textAlign: "center",
                  minWidth: "90px",
                  transition: "all 0.15s",
                }}
              >
                <div>{formatDate(dt)}</div>
                <div style={{
                  fontSize: "0.7rem",
                  opacity: isSelected ? 0.85 : 0.6,
                  marginTop: "2px",
                }}>
                  {day.total_cats} cats
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Selected day header ── */}
      {selectedDate && (
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          flexWrap: "wrap",
          gap: "8px",
        }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>
              {formatDateLong(selectedDate)}
              {typeConfig && typeConfig.label !== "Weekday" && typeConfig.label !== "Regular" && (
                <span style={{
                  marginLeft: "8px",
                  padding: "2px 8px",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  borderRadius: "4px",
                  background: typeConfig.bg,
                  color: typeConfig.color,
                }}>
                  {typeConfig.label}
                </span>
              )}
            </h2>
            {selectedDay && (
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "2px" }}>
                {selectedDay.total_cats} cats · {selectedDay.total_females}F / {selectedDay.total_males}M
              </div>
            )}
          </div>

          {/* Admin toggle */}
          <button
            onClick={() => setShowAdmin(!showAdmin)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: "0.75rem",
              color: showAdmin ? "var(--primary)" : "var(--muted)",
              padding: "6px 10px",
              borderRadius: "6px",
              border: `1px solid ${showAdmin ? "var(--primary)" : "var(--card-border)"}`,
              background: showAdmin ? "var(--primary-bg)" : "transparent",
            }}
          >
            Admin Tools {showAdmin ? "▾" : "▸"}
          </button>
        </div>
      )}

      {/* ── Admin tools (collapsible) ── */}
      {showAdmin && selectedDate && (
        <div style={{
          background: "var(--section-bg)",
          borderRadius: "10px",
          padding: "14px",
          marginBottom: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}>
          {/* Sync + CDS row */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <Button size="sm" onClick={handleSync} loading={syncing}>
              Sync from SharePoint
            </Button>
            <Button size="sm" variant="secondary" onClick={handleRematch} loading={rematching}>
              Re-match CDS
            </Button>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)", marginLeft: "auto" }}>
              {activeEntries.length > 0
                ? `${activeEntries.filter(e => e.cat_id).length}/${activeEntries.length} matched`
                : "No roster data"}
            </span>
          </div>

          {/* Manual import (fallback) */}
          <details>
            <summary style={{ fontSize: "0.75rem", color: "var(--muted)", cursor: "pointer" }}>
              Manual file import (if SharePoint sync missed a file)
            </summary>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                style={{ fontSize: "0.8rem", flex: 1 }}
              />
              <Button size="sm" onClick={handleImport} loading={importing} disabled={!importFile}>
                Import
              </Button>
            </div>
          </details>

          {/* Bulk Photo Upload */}
          <div>
            <details>
              <summary style={{ fontSize: "0.8rem", fontWeight: 500, cursor: "pointer" }}>
                Bulk Photo Upload (drag folder of clinic day photos)
              </summary>
              <div style={{ marginTop: "8px" }}>
                <BatchEvidenceUpload
                  clinicDate={selectedDate}
                  onUploadComplete={() => {
                    // Refresh roster photo counts
                    fetchApi<{ roster: RosterEntry[] }>(`/api/admin/clinic-days/${selectedDate}/roster`)
                      .then(d => setRoster(d.roster || []));
                  }}
                  onClassifyComplete={() => {
                    fetchApi<{ roster: RosterEntry[] }>(`/api/admin/clinic-days/${selectedDate}/roster`)
                      .then(d => setRoster(d.roster || []));
                  }}
                />
              </div>
            </details>
          </div>
        </div>
      )}

      {/* ── Search bar (sticky) ── */}
      {roster.length > 0 && (
        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--background)",
          paddingBottom: "8px",
          paddingTop: "4px",
        }}>
          <input
            type="text"
            placeholder="Search #, name, chip, owner, address, color..."
            value={rosterSearch}
            onChange={(e) => setRosterSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: "8px",
              border: "1px solid var(--card-border)",
              fontSize: "0.9rem",
              background: "var(--card-bg)",
            }}
          />

          {/* (upload hint removed — modal handles it) */}
        </div>
      )}

      {/* ── Loading state ── */}
      {rosterLoading && (
        <div style={{ padding: "24px" }}>
          <SkeletonText lines={6} />
        </div>
      )}

      {/* ── Empty state ── */}
      {!rosterLoading && selectedDate && roster.length === 0 && (
        <div style={{
          textAlign: "center",
          padding: "48px 24px",
          color: "var(--muted)",
          background: "var(--card-bg)",
          borderRadius: "12px",
          border: "1px solid var(--card-border)",
        }}>
          <div style={{ fontSize: "1.1rem", marginBottom: "8px" }}>No roster data</div>
          <p style={{ fontSize: "0.85rem" }}>
            Import a master list or wait for ClinicHQ data to sync.
          </p>
          <a
            href={`/admin/clinic-days/${selectedDate}`}
            style={{ color: "var(--primary)", fontSize: "0.85rem" }}
          >
            Go to clinic day details to import →
          </a>
        </div>
      )}

      {/* ── Roster grid ── */}
      {filtered.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "8px",
        }}>
          {filtered.map(entry => {
            const isTarget = uploadTarget?.entry_id === entry.entry_id;
            return (
              <div
                key={entry.entry_id}
                onClick={() => setDrawerEntry(entry)}
                style={{
                  borderRadius: "10px",
                  background: isTarget ? "var(--primary-bg)" : "var(--card-bg)",
                  border: `1px solid ${isTarget ? "var(--primary)" : "var(--card-border)"}`,
                  borderTop: `3px solid ${entry.cat_id ? "var(--success-text)" : "var(--warning-text)"}`,
                  cursor: "pointer",
                  overflow: "hidden",
                  transition: "box-shadow 0.15s",
                }}
              >
                {/* Photo + CDN overlay */}
                <div style={{
                  height: "120px",
                  background: entry.photo_url ? `url(${entry.photo_url}) center/cover` : "var(--section-bg)",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  padding: "8px",
                  position: "relative",
                }}>
                  {/* CDN badge */}
                  <span style={{
                    fontWeight: 700,
                    fontFamily: "monospace",
                    fontSize: "1.1rem",
                    background: "rgba(0,0,0,0.65)",
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: "6px",
                  }}>
                    #{entry.clinic_day_number || entry.line_number}
                  </span>

                  {/* Upload button */}
                  {entry.cat_id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadTarget(entry);
                        setStagedFiles([]);
                        fileInputRef.current?.click();
                      }}
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        padding: "4px 8px",
                        borderRadius: "6px",
                        fontSize: "0.9rem",
                        background: isTarget ? "var(--primary)" : "rgba(255,255,255,0.85)",
                        color: isTarget ? "#fff" : "var(--foreground)",
                      }}
                      title="Upload photo"
                    >
                      📷{entry.photo_count > 0 ? ` ${entry.photo_count}` : ""}
                    </button>
                  )}

                  {/* No photo placeholder */}
                  {!entry.photo_url && (
                    <div style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--muted)",
                      fontSize: "2rem",
                      opacity: 0.3,
                      pointerEvents: "none",
                    }}>
                      🐱
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontWeight: 500, fontSize: "0.85rem", marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.cat_name || entry.parsed_cat_name || entry.parsed_owner_name || "Unknown"}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[
                      entry.cat_sex === "Female" ? "F" : entry.cat_sex === "Male" ? "M" : null,
                      entry.weight_lbs ? `${entry.weight_lbs}lbs` : null,
                      entry.cat_color,
                      entry.microchip ? `...${entry.microchip.slice(-4)}` : null,
                    ].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.client_name || entry.parsed_owner_name || ""}
                    </span>
                    {entry.waiver_id && (
                      <span title="Waiver linked" style={{ opacity: 0.5 }}>📄</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Cancelled entries (collapsed) ── */}
      {cancelledEntries.length > 0 && (
        <details style={{ marginTop: "12px" }}>
          <summary style={{
            fontSize: "0.8rem",
            color: "var(--muted)",
            cursor: "pointer",
            padding: "6px 0",
          }}>
            {cancelledEntries.length} cancelled/excluded
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px", opacity: 0.5 }}>
            {cancelledEntries.map(e => (
              <div key={e.entry_id} style={{
                display: "flex", gap: "8px", padding: "6px 12px",
                fontSize: "0.8rem", background: "var(--section-bg)", borderRadius: "6px",
              }}>
                <span style={{ fontFamily: "monospace", minWidth: "28px" }}>#{e.line_number}</span>
                <span style={{ flex: 1 }}>{e.parsed_owner_name || "Unknown"}</span>
                <span style={{ fontSize: "0.7rem" }}>{e.cancellation_reason?.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Unlinked cats (appointments without ML entry) ── */}
      {unlinkedCats.length > 0 && (
        <details style={{ marginTop: "12px" }}>
          <summary style={{
            fontSize: "0.8rem",
            color: "var(--warning-text)",
            cursor: "pointer",
            padding: "6px 0",
            fontWeight: 500,
          }}>
            {unlinkedCats.length} cats without master list entry
          </summary>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "6px",
            marginTop: "8px",
          }}>
            {unlinkedCats.map(cat => (
              <div key={cat.cat_id} style={{
                borderRadius: "8px",
                background: "var(--card-bg)",
                border: "1px solid var(--card-border)",
                borderTop: "3px solid var(--warning-text)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "80px",
                  background: cat.photo_url ? `url(${cat.photo_url}) center/cover` : "var(--section-bg)",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  padding: "6px",
                }}>
                  {cat.clinic_day_number && (
                    <span style={{
                      fontFamily: "monospace", fontWeight: 700, fontSize: "0.9rem",
                      background: "rgba(0,0,0,0.65)", color: "#fff",
                      padding: "2px 6px", borderRadius: "4px",
                    }}>
                      #{cat.clinic_day_number}
                    </span>
                  )}
                  {cat.appointment_number && (
                    <span style={{
                      fontSize: "0.65rem", background: "rgba(0,0,0,0.5)", color: "#fff",
                      padding: "2px 6px", borderRadius: "4px",
                    }}>
                      {cat.appointment_number}
                    </span>
                  )}
                </div>
                <div style={{ padding: "6px 8px" }}>
                  <div style={{ fontWeight: 500, fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cat.cat_name || "Unknown"}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "var(--muted)" }}>
                    {[cat.cat_sex === "Female" ? "F" : cat.cat_sex === "Male" ? "M" : null, cat.cat_color, cat.microchip ? `...${cat.microchip.slice(-4)}` : null].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cat.client_name || ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Hidden file input (stages files) ── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            setStagedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
            e.target.value = "";
          }
        }}
      />

      {/* ── Cat detail drawer ── */}
      {drawerEntry && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={() => setDrawerEntry(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)" }} />
          <div style={{
            position: "relative",
            width: "min(420px, 90vw)",
            height: "100%",
            background: "var(--background)",
            boxShadow: "var(--shadow-lg, -4px 0 20px rgba(0,0,0,0.15))",
            overflowY: "auto",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}>
            {/* Drawer header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
                #{drawerEntry.clinic_day_number || drawerEntry.line_number}
              </h2>
              <button onClick={() => setDrawerEntry(null)} style={{ all: "unset", cursor: "pointer", fontSize: "1.2rem", padding: "4px" }}>✕</button>
            </div>

            {/* Cat info */}
            <div style={{ background: "var(--section-bg)", borderRadius: "8px", padding: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "1rem", marginBottom: "4px" }}>
                {drawerEntry.cat_name || drawerEntry.parsed_cat_name || "Unknown Cat"}
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "4px" }}>
                <div>
                  {drawerEntry.cat_sex || "Sex unknown"}
                  {drawerEntry.weight_lbs && ` · ${drawerEntry.weight_lbs} lbs`}
                </div>
                {drawerEntry.microchip && (
                  <div style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>Chip: {drawerEntry.microchip}</div>
                )}
              </div>
            </div>

            {/* Appointment info */}
            <div>
              <h3 style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Appointment
              </h3>
              <div style={{ fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "5px" }}>
                {drawerEntry.appointment_number && <div><strong>Appt #:</strong> {drawerEntry.appointment_number}</div>}
                <div><strong>Booked as:</strong> {drawerEntry.client_name || drawerEntry.parsed_owner_name || "—"}</div>
                {drawerEntry.client_address && <div><strong>Address:</strong> {drawerEntry.client_address}</div>}
                <div><strong>ML Line:</strong> #{drawerEntry.line_number}{drawerEntry.clinic_day_number ? ` (CDN #${drawerEntry.clinic_day_number})` : ""}</div>
                <div><strong>Match:</strong> {drawerEntry.match_confidence || "unmatched"}</div>
                <div><strong>Photos:</strong> {drawerEntry.photo_count}{drawerEntry.has_hero ? " (hero set)" : ""}</div>
              </div>
            </div>

            {/* Waiver PDF preview */}
            {drawerEntry.waiver_id && (
              <div>
                <h3 style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Waiver
                </h3>
                <iframe
                  src={`/api/waivers/${drawerEntry.waiver_id}/pdf`}
                  style={{
                    width: "100%",
                    height: "300px",
                    borderRadius: "8px",
                    border: "1px solid var(--card-border)",
                  }}
                  title="Waiver PDF"
                />
              </div>
            )}

            {/* Upload section */}
            {drawerEntry.cat_id && (
              <div>
                <h3 style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Upload Photo
                </h3>
                <Button
                  onClick={() => {
                    setUploadTarget(drawerEntry);
                    setStagedFiles([]);
                  }}
                >
                  Choose or Paste Photo
                </Button>
                <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "4px" }}>
                  Opens upload dialog — choose file, drag & drop, or paste from clipboard
                </p>
              </div>
            )}

            {/* Link to full profile */}
            {drawerEntry.cat_id && (
              <a
                href={`/cats/${drawerEntry.cat_id}`}
                target="_blank"
                rel="noopener"
                style={{ fontSize: "0.8rem", color: "var(--primary)", textDecoration: "underline" }}
              >
                Open full cat profile →
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Upload staging modal ── */}
      {uploadTarget && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 2000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div
            onClick={() => { if (!uploading) { setUploadTarget(null); setStagedFiles([]); } }}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }}
          />
          <div style={{
            position: "relative",
            background: "var(--background)",
            borderRadius: "12px",
            padding: "20px",
            width: "min(480px, 90vw)",
            maxHeight: "80vh",
            overflowY: "auto",
            boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
          }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "1rem" }}>
              Upload to #{uploadTarget.clinic_day_number || uploadTarget.line_number}{" "}
              <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                {uploadTarget.cat_name || uploadTarget.parsed_cat_name || ""}
              </span>
            </h3>

            {/* Staged image previews */}
            {stagedFiles.length > 0 && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                gap: "8px",
                marginBottom: "12px",
              }}>
                {stagedFiles.map((file, i) => (
                  <div key={i} style={{ position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      style={{
                        width: "100%",
                        height: "100px",
                        objectFit: "cover",
                        borderRadius: "6px",
                        border: "1px solid var(--card-border)",
                      }}
                    />
                    {!uploading && (
                      <button
                        onClick={() => setStagedFiles(prev => prev.filter((_, j) => j !== i))}
                        style={{
                          position: "absolute", top: "4px", right: "4px",
                          all: "unset", cursor: "pointer",
                          background: "rgba(0,0,0,0.6)", color: "#fff",
                          width: "20px", height: "20px", borderRadius: "50%",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "0.7rem",
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Drop zone */}
            {!uploading && (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
                  if (files.length > 0) setStagedFiles(prev => [...prev, ...files]);
                }}
                style={{
                  border: "2px dashed var(--card-border)",
                  borderRadius: "8px",
                  padding: "20px",
                  textAlign: "center",
                  cursor: "pointer",
                  color: "var(--muted)",
                  fontSize: "0.85rem",
                  marginBottom: "12px",
                }}
              >
                Click to choose, drag & drop, or paste (Ctrl+V)
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              {!uploading && (
                <Button variant="secondary" onClick={() => { setUploadTarget(null); setStagedFiles([]); }}>
                  Cancel
                </Button>
              )}
              <Button
                onClick={() => {
                  if (stagedFiles.length > 0 && uploadTarget) {
                    uploadPhotos(stagedFiles, uploadTarget);
                    setStagedFiles([]);
                  }
                }}
                loading={uploading}
                disabled={stagedFiles.length === 0}
              >
                {uploading ? "Uploading..." : `Upload ${stagedFiles.length} photo${stagedFiles.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
