"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { MediaUploader, MediaItem } from "./MediaUploader";
import { MediaLightbox } from "./MediaLightbox";
import { PhotoGroupingPanel } from "./PhotoGroupingPanel";

interface Cat {
  cat_id: string;
  display_name: string;
}

interface ExtendedMediaItem extends MediaItem {
  cat_identification_confidence?: string;
  photo_group_id?: string;
  linked_cat_id?: string;
  cross_ref_source?: string | null;
}

interface EntitySummary {
  name?: string;
  details?: string[];
  imageUrl?: string;
}

interface MediaGalleryProps {
  entityType: "cat" | "place" | "request" | "person";
  entityId: string;
  allowUpload?: boolean;
  maxDisplay?: number;
  showCatDescription?: boolean;
  defaultMediaType?: string;
  allowedMediaTypes?: string[];
  includeRelated?: boolean;
  entitySummary?: EntitySummary;
  // New props for grouping
  showGrouping?: boolean;
  defaultToGroupView?: boolean;
  availableCats?: Cat[];
  onClinicDayNumber?: (appointmentId: string, num: number) => void;
  appointmentOptions?: Array<{ appointment_id: string; appointment_date: string }>;
}

export function MediaGallery({
  entityType,
  entityId,
  allowUpload = true,
  maxDisplay,
  showCatDescription = false,
  defaultMediaType,
  allowedMediaTypes,
  includeRelated = false,
  entitySummary,
  showGrouping = false,
  defaultToGroupView = false,
  availableCats = [],
  onClinicDayNumber,
  appointmentOptions,
}: MediaGalleryProps) {
  const [media, setMedia] = useState<ExtendedMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "groups">(
    defaultToGroupView && showGrouping ? "groups" : "grid"
  );

  // Fetch media for this entity
  const fetchMedia = useCallback(async () => {
    if (!entityId) return;

    setLoading(true);
    setError(null);

    try {
      let url: string;
      if (includeRelated) {
        // Use unified endpoint with cross-referencing
        const paramKey = entityType === "person" ? "person_id" : entityType === "cat" ? "cat_id" : entityType === "place" ? "place_id" : "request_id";
        url = `/api/media?${paramKey}=${entityId}&include_related=true`;
      } else {
        // Use entity-specific endpoint (backward compatible)
        const pathSegment = entityType === "person" ? "people" : `${entityType}s`;
        url = `/api/${pathSegment}/${entityId}/media`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch media");
      }
      const data = await response.json();
      setMedia(data.media || []);
    } catch (err) {
      console.error("Error fetching media:", err);
      setError("Failed to load photos");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, includeRelated]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  // Handle upload complete
  const handleUploadComplete = (newMedia: MediaItem | MediaItem[]) => {
    if (Array.isArray(newMedia)) {
      setMedia((prev) => [...newMedia, ...prev]);
    } else {
      setMedia((prev) => [newMedia, ...prev]);
    }
    setShowUploader(false);
  };

  // Set a photo as the main/hero photo
  const handleSetHero = useCallback(async (mediaId: string) => {
    try {
      const res = await fetch(`/api/media/${mediaId}/hero`, { method: "PATCH" });
      if (res.ok) {
        // Re-fetch to get updated sort order
        fetchMedia();
        setLightboxIndex(null);
      }
    } catch (err) {
      console.error("Error setting hero:", err);
    }
  }, [fetchMedia]);

  // Determine which media to display
  const effectiveMax = expanded ? undefined : maxDisplay;
  const displayMedia = effectiveMax ? media.slice(0, effectiveMax) : media;
  const hasMore = !expanded && maxDisplay && media.length > maxDisplay;
  const hiddenCount = hasMore ? media.length - (maxDisplay || 0) : 0;

  // Get media type label
  const getMediaTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      cat_photo: "Cat",
      site_photo: "Site",
      evidence: "Evidence",
      document: "Doc",
      other: "Other",
    };
    return labels[type] || type;
  };

  // Get confidence color
  const getConfidenceColor = (confidence: string | undefined) => {
    const colors: Record<string, string> = {
      confirmed: "#198754",
      likely: "#0d6efd",
      uncertain: "#ffc107",
      unidentified: "#6c757d",
    };
    return colors[confidence || "unidentified"] || "#6c757d";
  };

  if (loading) {
    return (
      <div style={{ padding: "1rem", textAlign: "center", color: "#6c757d" }}>
        Loading photos...
      </div>
    );
  }

  return (
    <div>
      {/* Header with Add Photo button and view toggle */}
      {(allowUpload || showGrouping) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <span style={{ fontWeight: 500, color: "#495057" }}>
            {media.length} {media.length === 1 ? "Photo" : "Photos"}
          </span>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {/* View mode toggle */}
            {showGrouping && media.length > 0 && (
              <div style={{
                display: "flex",
                background: "#e9ecef",
                borderRadius: "4px",
                padding: "2px",
              }}>
                <button
                  onClick={() => setViewMode("grid")}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem",
                    background: viewMode === "grid" ? "white" : "transparent",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                    color: viewMode === "grid" ? "#495057" : "#6c757d",
                  }}
                >
                  Grid
                </button>
                <button
                  onClick={() => setViewMode("groups")}
                  style={{
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem",
                    background: viewMode === "groups" ? "white" : "transparent",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                    color: viewMode === "groups" ? "#495057" : "#6c757d",
                  }}
                >
                  Groups
                </button>
              </div>
            )}
            {/* Add Photo button */}
            {allowUpload && (
              <button
                onClick={() => setShowUploader(true)}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.875rem",
                  background: "#0d6efd",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem",
                }}
              >
                <span>+</span> Add Photos
              </button>
            )}
          </div>
        </div>
      )}

      {/* Upload modal (portaled to body to escape CSS containment) */}
      {showUploader && createPortal(
        <div
          onClick={() => setShowUploader(false)}
          style={{
            position: "fixed",
            inset: "0",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: "2rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card-bg, white)",
              borderRadius: "12px",
              width: "100%",
              maxWidth: entitySummary ? "720px" : "520px",
              maxHeight: "90vh",
              overflow: "auto",
              display: "flex",
              gap: "0",
            }}
          >
            {/* Entity summary sidebar */}
            {entitySummary && (
              <div style={{
                width: "200px",
                minWidth: "200px",
                padding: "1.5rem",
                borderRight: "1px solid var(--border, #dee2e6)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}>
                {(entitySummary.imageUrl || media[0]?.storage_path) && (
                  <img
                    src={entitySummary.imageUrl || media[0]?.storage_path}
                    alt={entitySummary.name || ""}
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      objectFit: "cover",
                      borderRadius: "8px",
                      background: "#e9ecef",
                    }}
                  />
                )}
                {entitySummary.name && (
                  <div style={{ fontWeight: 600, fontSize: "1rem" }}>
                    {entitySummary.name}
                  </div>
                )}
                {entitySummary.details?.map((detail, i) => (
                  <div key={i} style={{ fontSize: "0.8rem", color: "var(--text-muted, #6c757d)" }}>
                    {detail}
                  </div>
                ))}
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted, #6c757d)", marginTop: "auto" }}>
                  {media.length} photo{media.length !== 1 ? "s" : ""} uploaded
                </div>
              </div>
            )}
            {/* Uploader */}
            <div style={{ flex: 1, padding: "1.5rem", minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Upload Photos</h3>
                <button
                  onClick={() => setShowUploader(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "1.5rem",
                    cursor: "pointer",
                    color: "var(--text-muted, #6c757d)",
                    lineHeight: 1,
                    padding: "0 0.25rem",
                  }}
                >
                  &times;
                </button>
              </div>
              <MediaUploader
                entityType={entityType}
                entityId={entityId}
                onUploadComplete={handleUploadComplete}
                onCancel={() => setShowUploader(false)}
                showCatDescription={showCatDescription || entityType === "request"}
                defaultMediaType={defaultMediaType || (entityType === "cat" ? "cat_photo" : "site_photo")}
                allowedMediaTypes={allowedMediaTypes || ["cat_photo", "site_photo", "evidence"]}
                allowMultiple={true}
                showConfidenceSelector={showGrouping && entityType === "request"}
                autoGroupMultiple={showGrouping}
                onClinicDayNumber={onClinicDayNumber}
                appointmentOptions={appointmentOptions}
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Error state */}
      {error && (
        <div style={{
          padding: "0.5rem",
          background: "#f8d7da",
          color: "#842029",
          borderRadius: "4px",
          fontSize: "0.875rem",
          marginBottom: "0.5rem",
        }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!showUploader && media.length === 0 && (
        <div
          onClick={() => allowUpload && setShowUploader(true)}
          style={{
            padding: "2rem",
            textAlign: "center",
            background: "#f8f9fa",
            borderRadius: "8px",
            border: "2px dashed #dee2e6",
            cursor: allowUpload ? "pointer" : "default",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📷</div>
          <div style={{ color: "#6c757d" }}>
            {allowUpload
              ? showGrouping
                ? "Click to add photos"
                : "Click to add first photo"
              : "No photos yet"}
          </div>
          {allowUpload && (
            <div style={{ fontSize: "0.75rem", color: "#adb5bd", marginTop: "0.25rem" }}>
              {showGrouping
                ? "Select multiple photos to group as same cat"
                : "or paste from clipboard (Cmd+V)"}
            </div>
          )}
        </div>
      )}

      {/* Photo grouping panel (when in groups view) */}
      {viewMode === "groups" && showGrouping && media.length > 0 && (
        <PhotoGroupingPanel
          requestId={entityId}
          media={media.map((m) => ({
            media_id: m.media_id,
            storage_path: m.storage_path,
            original_filename: m.original_filename,
            cat_description: m.cat_description,
            cat_identification_confidence: m.cat_identification_confidence || null,
            linked_cat_id: m.linked_cat_id || null,
            photo_group_id: m.photo_group_id || null,
          }))}
          onMediaUpdated={fetchMedia}
          availableCats={availableCats}
        />
      )}

      {/* Photo grid (when in grid view or grouping not enabled) */}
      {(viewMode === "grid" || !showGrouping) && displayMedia.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: "0.5rem",
        }}>
          {displayMedia.map((item, index) => (
            <div
              key={item.media_id}
              onClick={() => setLightboxIndex(index)}
              style={{
                position: "relative",
                aspectRatio: "1",
                borderRadius: "8px",
                overflow: "hidden",
                cursor: "pointer",
                background: "#e9ecef",
              }}
            >
              <img
                src={item.storage_path}
                alt={item.caption || item.original_filename}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
                loading="lazy"
              />
              {/* Media type badge */}
              <div style={{
                position: "absolute",
                top: "4px",
                left: "4px",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}>
                <span style={{
                  padding: "2px 6px",
                  background: "rgba(0,0,0,0.6)",
                  color: "white",
                  fontSize: "0.625rem",
                  borderRadius: "4px",
                  textTransform: "uppercase",
                }}>
                  {getMediaTypeLabel(item.media_type)}
                </span>
                {item.cross_ref_source && (
                  <span
                    style={{
                      padding: "2px 5px",
                      background: "rgba(0,0,0,0.5)",
                      color: "rgba(255,255,255,0.85)",
                      fontSize: "0.55rem",
                      borderRadius: "3px",
                      fontStyle: "italic",
                      width: "fit-content",
                    }}
                    title={`From linked ${item.cross_ref_source}`}
                  >
                    via {item.cross_ref_source}
                  </span>
                )}
              </div>
              {/* Confidence indicator (when grouping enabled) */}
              {showGrouping && (
                <div
                  style={{
                    position: "absolute",
                    top: "4px",
                    right: "4px",
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: getConfidenceColor(item.cat_identification_confidence),
                    border: "1px solid white",
                  }}
                  title={item.cat_identification_confidence || "unidentified"}
                />
              )}
              {/* Linked cat indicator */}
              {item.linked_cat_id && (
                <div style={{
                  position: "absolute",
                  top: "4px",
                  right: showGrouping ? "20px" : "4px",
                  padding: "2px 4px",
                  background: "#198754",
                  color: "white",
                  fontSize: "0.5rem",
                  borderRadius: "3px",
                }}>
                  Linked
                </div>
              )}
              {/* Cat description if present */}
              {item.cat_description && (
                <div style={{
                  position: "absolute",
                  bottom: "0",
                  left: "0",
                  right: "0",
                  padding: "4px 6px",
                  background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                  color: "white",
                  fontSize: "0.625rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {item.cat_description}
                </div>
              )}
              {/* Hero badge */}
              {item.is_hero && !showGrouping && (
                <div style={{
                  position: "absolute",
                  top: "4px",
                  right: "4px",
                  background: "rgba(0,0,0,0.6)",
                  color: "#ffc107",
                  fontSize: "0.75rem",
                  padding: "2px 5px",
                  borderRadius: "4px",
                  lineHeight: 1,
                }}>
                  ★
                </div>
              )}
              {/* "+N more" badge on last visible photo (only in multi-photo grids, not single profile photos) */}
              {hasMore && index === displayMedia.length - 1 && displayMedia.length > 1 && (
                <div style={{
                  position: "absolute",
                  bottom: "4px",
                  right: "4px",
                  background: "rgba(0,0,0,0.7)",
                  color: "white",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  lineHeight: 1.4,
                }}>
                  +{hiddenCount}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Show more / show less */}
      {hasMore && viewMode === "grid" && (
        <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
          <button
            onClick={() => setExpanded(true)}
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.75rem",
              background: "none",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              color: "#0d6efd",
              cursor: "pointer",
            }}
          >
            View all {media.length} photos
          </button>
        </div>
      )}
      {expanded && maxDisplay && media.length > maxDisplay && viewMode === "grid" && (
        <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
          <button
            onClick={() => setExpanded(false)}
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.75rem",
              background: "none",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              color: "#6c757d",
              cursor: "pointer",
            }}
          >
            Show less
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <MediaLightbox
          media={media}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onSetHero={handleSetHero}
        />
      )}
    </div>
  );
}
