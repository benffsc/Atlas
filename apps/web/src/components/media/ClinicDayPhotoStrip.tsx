"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/Button";

/**
 * ClinicDayPhotoStrip — Batch photo upload with anchor-based grouping
 *
 * Photos from clinic day come in a rough pattern:
 *   [cat photo(s)] [microchip photo?] [waiver]
 * But this isn't guaranteed — transfers/wellness may just have cat + waiver,
 * and camera vs phone photos may be mixed.
 *
 * Strategy: Use WAIVERS as safe anchor points (printed clinic_day_number).
 * - Photos before a waiver belong to that waiver's cat
 * - User can add/move dividers to correct grouping
 * - Each group maps to a master list entry by line_number
 *
 * The component works in 3 phases:
 * 1. DROP — User drops all photos for the day
 * 2. GROUP — Photos shown in strip, user marks waivers/adds dividers
 * 3. LINK — Each group gets assigned to a clinic_day_entry line number
 */

interface PhotoFile {
  file: File;
  preview: string;
  type: "cat" | "microchip" | "waiver" | "unknown";
}

export interface PhotoGroup {
  id: string;
  photos: PhotoFile[];
  entryLineNumber: number | null;
  label: string;
}

interface ClinicDayPhotoStripProps {
  clinicDate: string;
  entryCount: number;
  onUpload: (groups: PhotoGroup[]) => Promise<void>;
  uploading?: boolean;
}

export function ClinicDayPhotoStrip({
  clinicDate,
  entryCount,
  onUpload,
  uploading = false,
}: ClinicDayPhotoStripProps) {
  const [phase, setPhase] = useState<"drop" | "group" | "link">("drop");
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [groups, setGroups] = useState<PhotoGroup[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Phase 1: Drop ──────────────────────────────────────────────────

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) =>
      f.type.startsWith("image/") || f.name.toLowerCase().endsWith(".heic")
    );

    if (files.length === 0) return;

    // Sort by name (preserves camera roll order: IMG_0001, IMG_0002, etc.)
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const newPhotos: PhotoFile[] = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: "unknown" as const,
    }));

    setPhotos((prev) => [...prev, ...newPhotos]);
    if (phase === "drop") setPhase("group");
  }, [phase]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  // ── Phase 2: Group ─────────────────────────────────────────────────

  const togglePhotoType = (index: number) => {
    setPhotos((prev) => {
      const updated = [...prev];
      const current = updated[index].type;
      // Cycle: unknown → cat → waiver → microchip → unknown
      const cycle: PhotoFile["type"][] = ["unknown", "cat", "waiver", "microchip"];
      const nextIdx = (cycle.indexOf(current) + 1) % cycle.length;
      updated[index] = { ...updated[index], type: cycle[nextIdx] };
      return updated;
    });
  };

  const autoGroupByWaivers = useCallback(() => {
    // Find waiver indices — these are our anchor points
    const waiverIndices: number[] = [];
    photos.forEach((p, i) => {
      if (p.type === "waiver") waiverIndices.push(i);
    });

    const newGroups: PhotoGroup[] = [];

    if (waiverIndices.length === 0) {
      // No waivers marked — put everything in one group
      newGroups.push({
        id: `group-0`,
        photos: [...photos],
        entryLineNumber: null,
        label: `All photos (${photos.length})`,
      });
    } else {
      // Group photos BACKWARDS from each waiver
      // The waiver is the END of a group, preceding photos are that cat's photos
      let lastEnd = 0;
      waiverIndices.forEach((waiverIdx, groupIdx) => {
        const start = lastEnd;
        const end = waiverIdx + 1; // include the waiver
        const groupPhotos = photos.slice(start, end);
        newGroups.push({
          id: `group-${groupIdx}`,
          photos: groupPhotos,
          entryLineNumber: groupIdx + 1, // Auto-assign sequential line numbers
          label: `Cat #${groupIdx + 1} (${groupPhotos.length} photos)`,
        });
        lastEnd = end;
      });

      // Remaining photos after last waiver (phone photos, extras)
      if (lastEnd < photos.length) {
        const remaining = photos.slice(lastEnd);
        newGroups.push({
          id: `group-remaining`,
          photos: remaining,
          entryLineNumber: null,
          label: `Unassigned (${remaining.length} photos)`,
        });
      }
    }

    setGroups(newGroups);
    setPhase("link");
  }, [photos]);

  // Manual split: add divider at a photo index
  const addDividerAt = useCallback(
    (photoIndex: number) => {
      // Just mark the photo as a divider point (waiver)
      setPhotos((prev) => {
        const updated = [...prev];
        updated[photoIndex] = { ...updated[photoIndex], type: "waiver" };
        return updated;
      });
    },
    []
  );

  // ── Phase 3: Link ──────────────────────────────────────────────────

  const updateGroupLineNumber = (groupId: string, lineNumber: number | null) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, entryLineNumber: lineNumber } : g
      )
    );
  };

  const handleUpload = async () => {
    await onUpload(groups);
  };

  // ── Type badge colors ──────────────────────────────────────────────

  const typeBadge = (type: PhotoFile["type"]) => {
    const styles: Record<string, { bg: string; color: string; label: string }> = {
      cat: { bg: "var(--primary-bg)", color: "var(--primary)", label: "Cat" },
      waiver: { bg: "var(--warning-bg)", color: "var(--warning-text)", label: "Waiver" },
      microchip: { bg: "var(--success-bg)", color: "var(--success-text)", label: "Chip" },
      unknown: { bg: "var(--section-bg)", color: "var(--muted)", label: "?" },
    };
    return styles[type] || styles.unknown;
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div>
      {/* Phase 1: Drop zone */}
      {phase === "drop" && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? "var(--primary)" : "var(--card-border)"}`,
            borderRadius: "12px",
            padding: "48px 24px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "var(--primary-bg)" : "var(--section-bg)",
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "12px", opacity: 0.5 }}>
            {dragOver ? "+" : ""}
          </div>
          <div style={{ fontWeight: 600, marginBottom: "8px" }}>
            Drop all clinic day photos here
          </div>
          <div style={{ color: "var(--muted)", fontSize: "0.85rem", maxWidth: "400px", margin: "0 auto" }}>
            Camera photos, phone photos, waivers — drop them all.
            They&apos;ll be sorted by filename and you can group them by cat.
          </div>
          <div style={{
            marginTop: "16px",
            fontSize: "0.8rem",
            color: "var(--muted)",
            padding: "8px 16px",
            background: "var(--card-bg)",
            borderRadius: "6px",
            display: "inline-block",
          }}>
            Or click to browse files
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.heic"
            style={{ display: "none" }}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* Phase 2: Group — filmstrip with type tagging */}
      {phase === "group" && (
        <div>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}>
            <div>
              <h4 style={{ margin: 0 }}>
                {photos.length} photos loaded
              </h4>
              <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                Click photos to mark as Cat / Waiver / Chip. Waivers become group boundaries.
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  // Add more photos
                  fileInputRef.current?.click();
                }}
              >
                + Add More
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={autoGroupByWaivers}
              >
                Group by Waivers ({photos.filter((p) => p.type === "waiver").length} marked)
              </Button>
            </div>
          </div>

          {/* Filmstrip */}
          <div style={{
            display: "flex",
            gap: "4px",
            overflowX: "auto",
            padding: "8px 0",
            WebkitOverflowScrolling: "touch",
          }}>
            {photos.map((photo, idx) => {
              const badge = typeBadge(photo.type);
              return (
                <div
                  key={idx}
                  style={{
                    flexShrink: 0,
                    width: "100px",
                    position: "relative",
                    cursor: "pointer",
                  }}
                >
                  {/* Thumbnail */}
                  <div
                    onClick={() => togglePhotoType(idx)}
                    style={{
                      width: "100px",
                      height: "100px",
                      borderRadius: "6px",
                      background: `url(${photo.preview}) center/cover`,
                      border: photo.type === "waiver"
                        ? "3px solid var(--warning-text)"
                        : photo.type === "cat"
                        ? "2px solid var(--primary)"
                        : "1px solid var(--card-border)",
                    }}
                  />
                  {/* Type badge */}
                  <div style={{
                    position: "absolute",
                    bottom: "22px",
                    left: "4px",
                    padding: "1px 6px",
                    borderRadius: "4px",
                    fontSize: "0.65rem",
                    fontWeight: 600,
                    background: badge.bg,
                    color: badge.color,
                  }}>
                    {badge.label}
                  </div>
                  {/* Filename */}
                  <div style={{
                    fontSize: "0.6rem",
                    color: "var(--muted)",
                    textAlign: "center",
                    marginTop: "2px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {photo.file.name}
                  </div>
                  {/* Divider button between photos */}
                  {idx < photos.length - 1 && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        addDividerAt(idx);
                      }}
                      title="Mark as group boundary"
                      style={{
                        position: "absolute",
                        right: "-6px",
                        top: "30px",
                        width: "12px",
                        height: "40px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        zIndex: 1,
                        color: "var(--muted)",
                        fontSize: "0.7rem",
                        opacity: 0.4,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
                    >
                      |
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{
            marginTop: "12px",
            padding: "12px",
            background: "var(--section-bg)",
            borderRadius: "8px",
            fontSize: "0.8rem",
            color: "var(--muted)",
          }}>
            <strong>Tip:</strong> Mark waiver photos first (they have printed clinic numbers).
            Each waiver becomes the END of a photo group — photos before it belong to that cat.
            Phone photos added after camera photos go into &quot;Unassigned&quot; for manual linking.
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.heic"
            style={{ display: "none" }}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* Phase 3: Link — assign groups to entries */}
      {phase === "link" && (
        <div>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}>
            <div>
              <h4 style={{ margin: 0 }}>
                {groups.length} groups ready
              </h4>
              <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                Assign each group to a master list entry number, then upload.
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setGroups([]);
                  setPhase("group");
                }}
              >
                Back to Grouping
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleUpload}
                loading={uploading}
              >
                Upload {groups.reduce((sum, g) => sum + g.photos.length, 0)} Photos
              </Button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {groups.map((group) => (
              <div
                key={group.id}
                style={{
                  border: "1px solid var(--card-border)",
                  borderRadius: "8px",
                  padding: "12px",
                  background: "var(--card-bg)",
                }}
              >
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}>
                  <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                    {group.label}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <label style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                      Entry #
                    </label>
                    <select
                      value={group.entryLineNumber ?? ""}
                      onChange={(e) =>
                        updateGroupLineNumber(
                          group.id,
                          e.target.value ? parseInt(e.target.value) : null
                        )
                      }
                      style={{
                        padding: "4px 8px",
                        border: "1px solid var(--card-border)",
                        borderRadius: "4px",
                        background: "var(--section-bg)",
                        color: "var(--foreground)",
                        fontSize: "0.85rem",
                        width: "80px",
                      }}
                    >
                      <option value="">--</option>
                      {Array.from({ length: entryCount }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          #{i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Group photo strip */}
                <div style={{
                  display: "flex",
                  gap: "4px",
                  overflowX: "auto",
                }}>
                  {group.photos.map((photo, pIdx) => {
                    const badge = typeBadge(photo.type);
                    return (
                      <div key={pIdx} style={{ flexShrink: 0, position: "relative" }}>
                        <div
                          style={{
                            width: "72px",
                            height: "72px",
                            borderRadius: "4px",
                            background: `url(${photo.preview}) center/cover`,
                            border: photo.type === "waiver"
                              ? "2px solid var(--warning-text)"
                              : "1px solid var(--card-border)",
                          }}
                        />
                        <div style={{
                          position: "absolute",
                          bottom: "2px",
                          left: "2px",
                          padding: "0 4px",
                          borderRadius: "3px",
                          fontSize: "0.55rem",
                          fontWeight: 600,
                          background: badge.bg,
                          color: badge.color,
                        }}>
                          {badge.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
