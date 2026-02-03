"use client";

import { useState, useEffect, useCallback } from "react";
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

interface MediaGalleryProps {
  entityType: "cat" | "place" | "request" | "person";
  entityId: string;
  allowUpload?: boolean;
  maxDisplay?: number;
  showCatDescription?: boolean;
  defaultMediaType?: string;
  allowedMediaTypes?: string[];
  includeRelated?: boolean;
  // New props for grouping
  showGrouping?: boolean;
  defaultToGroupView?: boolean;
  availableCats?: Cat[];
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
  showGrouping = false,
  defaultToGroupView = false,
  availableCats = [],
}: MediaGalleryProps) {
  const [media, setMedia] = useState<ExtendedMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
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
  const displayMedia = maxDisplay ? media.slice(0, maxDisplay) : media;
  const hasMore = maxDisplay && media.length > maxDisplay;

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
                <span>+</span> Add Photo{showGrouping ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Upload form */}
      {showUploader && (
        <div style={{ marginBottom: "1rem" }}>
          <MediaUploader
            entityType={entityType}
            entityId={entityId}
            onUploadComplete={handleUploadComplete}
            onCancel={() => setShowUploader(false)}
            showCatDescription={showCatDescription || entityType === "request"}
            defaultMediaType={defaultMediaType || (entityType === "cat" ? "cat_photo" : "site_photo")}
            allowedMediaTypes={allowedMediaTypes || ["cat_photo", "site_photo", "evidence"]}
            // New props for batch upload when grouping is enabled
            allowMultiple={showGrouping}
            showConfidenceSelector={showGrouping && entityType === "request"}
            autoGroupMultiple={showGrouping}
          />
        </div>
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
            </div>
          ))}
        </div>
      )}

      {/* Show more link */}
      {hasMore && viewMode === "grid" && (
        <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
          <button
            onClick={() => {
              // Could expand to show all, or navigate to a media page
              // For now, just show all by removing maxDisplay limit
            }}
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
