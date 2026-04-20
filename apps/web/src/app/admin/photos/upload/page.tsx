"use client";

import { useState, useRef } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Button } from "@/components/ui/Button";

/**
 * Photo Upload by Clinic Day Number
 *
 * Workflow:
 * 1. Pick a clinic date
 * 2. See the roster (ML entries matched to cats)
 * 3. Tap a row → upload photo(s) to that cat
 *
 * Designed for phone use during/after clinic day.
 */

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
  weight_lbs: number | null;
  clinic_day_number: number | null;
  photo_count: number;
  has_hero: boolean;
}

export default function PhotoUploadPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<RosterEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function loadRoster() {
    setLoading(true);
    setSelectedEntry(null);
    try {
      const data = await fetchApi(`/api/admin/clinic-days/${date}/roster`) as { roster: RosterEntry[] };
      setRoster(data.roster || []);
    } catch (err) {
      toast.error("Failed to load roster");
    } finally {
      setLoading(false);
    }
  }

  async function handlePhotoUpload(files: FileList) {
    if (!selectedEntry?.cat_id) {
      toast.error("No cat linked to this entry");
      return;
    }

    setUploading(true);
    let uploaded = 0;

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("entity_type", "cat");
        formData.append("entity_id", selectedEntry.cat_id);
        formData.append("media_type", "cat_photo");
        formData.append("cat_identification_confidence", "confirmed");
        formData.append("caption", `Clinic ${date} #${selectedEntry.clinic_day_number || selectedEntry.line_number}`);

        await fetch("/api/media/upload", {
          method: "POST",
          body: formData,
        });
        uploaded++;
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }

    if (uploaded > 0) {
      toast.success(`${uploaded} photo${uploaded > 1 ? "s" : ""} uploaded to #${selectedEntry.clinic_day_number || selectedEntry.line_number}`);
      // Refresh roster to update photo counts
      loadRoster();
    }
    setUploading(false);
    setSelectedEntry(null);
  }

  // Filter roster by search
  const filtered = roster.filter((entry) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const num = String(entry.clinic_day_number || entry.line_number);
    return (
      num.includes(q) ||
      (entry.parsed_owner_name || "").toLowerCase().includes(q) ||
      (entry.cat_name || "").toLowerCase().includes(q) ||
      (entry.parsed_cat_name || "").toLowerCase().includes(q) ||
      (entry.microchip || "").includes(q)
    );
  });

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "16px" }}>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "16px" }}>Photo Upload</h1>

      {/* Date picker + load */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid var(--card-border)",
            fontSize: "1rem",
          }}
        />
        <Button onClick={loadRoster} loading={loading}>
          Load Roster
        </Button>
      </div>

      {/* Search/filter */}
      {roster.length > 0 && (
        <input
          type="text"
          placeholder="Search by #, name, chip..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid var(--card-border)",
            marginBottom: "12px",
            fontSize: "0.9rem",
          }}
        />
      )}

      {/* Roster list */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {filtered.map((entry) => (
            <button
              key={entry.entry_id}
              onClick={() => {
                if (entry.cat_id) {
                  setSelectedEntry(entry);
                  fileInputRef.current?.click();
                } else {
                  toast.error("No cat linked — can't upload photo");
                }
              }}
              style={{
                all: "unset",
                cursor: entry.cat_id ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                borderRadius: "8px",
                background: selectedEntry?.entry_id === entry.entry_id
                  ? "var(--primary-bg)"
                  : entry.cancellation_reason
                  ? "var(--section-bg)"
                  : "var(--card-bg)",
                border: `1px solid ${entry.cat_id ? "var(--card-border)" : "var(--muted)"}`,
                opacity: entry.cancellation_reason ? 0.5 : 1,
                transition: "background 0.1s",
              }}
            >
              {/* Line number */}
              <span style={{
                fontWeight: 700,
                fontFamily: "monospace",
                fontSize: "1.1rem",
                minWidth: "32px",
                color: entry.cat_id ? "var(--foreground)" : "var(--muted)",
              }}>
                #{entry.clinic_day_number || entry.line_number}
              </span>

              {/* Cat info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 500 }}>
                  {entry.cat_name || entry.parsed_cat_name || entry.parsed_owner_name || "Unknown"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  {entry.cat_sex === "Female" ? "F" : entry.cat_sex === "Male" ? "M" : "?"}{" "}
                  {entry.weight_lbs ? `${entry.weight_lbs}lbs` : ""}{" "}
                  {entry.microchip ? `...${entry.microchip.slice(-4)}` : ""}
                  {entry.parsed_owner_name ? ` · ${entry.parsed_owner_name}` : ""}
                </div>
              </div>

              {/* Photo badge */}
              <span style={{
                fontSize: "0.75rem",
                padding: "2px 6px",
                borderRadius: "4px",
                background: entry.photo_count > 0 ? "var(--success-bg)" : "transparent",
                color: entry.photo_count > 0 ? "var(--success-text)" : "var(--muted)",
                border: entry.photo_count > 0 ? "none" : "1px solid var(--card-border)",
              }}>
                {entry.photo_count > 0 ? `${entry.photo_count} pic` : "no pic"}
              </span>
            </button>
          ))}
        </div>
      )}

      {roster.length > 0 && filtered.length === 0 && (
        <p style={{ color: "var(--muted)", textAlign: "center", padding: "20px" }}>
          No matches for &quot;{searchQuery}&quot;
        </p>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handlePhotoUpload(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {uploading && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            background: "var(--card-bg)",
            padding: "24px",
            borderRadius: "12px",
            fontSize: "1rem",
          }}>
            Uploading...
          </div>
        </div>
      )}
    </div>
  );
}
