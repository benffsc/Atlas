"use client";

import { useState } from "react";
import { MediaItem } from "./MediaUploader";

interface HeroMedia extends MediaItem {
  is_hero?: boolean;
}

interface HeroGalleryProps {
  media: HeroMedia[];
  onSetHero?: (mediaId: string) => void;
  onViewAll?: () => void;
}

export function HeroGallery({ media, onSetHero, onViewAll }: HeroGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (media.length === 0) {
    return (
      <div
        style={{
          border: "2px dashed var(--border)",
          borderRadius: "12px",
          padding: "2rem",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📷</div>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>No photos yet</p>
        <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem" }}>
          Upload photos in the Media tab
        </p>
      </div>
    );
  }

  // Hero is the first is_hero item, or first item
  const heroItem = media.find((m) => m.is_hero) || media[0];
  const thumbnails = media.filter((m) => m.media_id !== heroItem.media_id).slice(0, 3);
  const remainingCount = media.length - 1 - thumbnails.length;

  const getImageUrl = (item: MediaItem) => {
    if (item.storage_path.startsWith("http")) return item.storage_path;
    return `/api/media/${item.media_id}/file`;
  };

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: thumbnails.length > 0 ? "3fr 2fr" : "1fr",
          gap: "4px",
          borderRadius: "12px",
          overflow: "hidden",
          maxHeight: "320px",
        }}
      >
        {/* Hero Image */}
        <div
          style={{
            position: "relative",
            cursor: "pointer",
            gridRow: thumbnails.length > 1 ? "1 / -1" : undefined,
          }}
          onClick={() => setLightboxIndex(media.indexOf(heroItem))}
        >
          <img
            src={getImageUrl(heroItem)}
            alt={heroItem.caption || "Main photo"}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              minHeight: "200px",
              maxHeight: "320px",
            }}
          />
          {heroItem.is_hero && (
            <div
              style={{
                position: "absolute",
                top: "8px",
                left: "8px",
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                padding: "2px 8px",
                borderRadius: "4px",
                fontSize: "0.7rem",
              }}
            >
              Main Photo
            </div>
          )}
        </div>

        {/* Thumbnail Grid */}
        {thumbnails.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateRows: `repeat(${Math.min(thumbnails.length, 2)}, 1fr)`,
              gap: "4px",
            }}
          >
            {thumbnails.map((item, i) => (
              <div
                key={item.media_id}
                style={{ position: "relative", cursor: "pointer", overflow: "hidden" }}
                onClick={() => setLightboxIndex(media.indexOf(item))}
              >
                <img
                  src={getImageUrl(item)}
                  alt={item.caption || `Photo ${i + 2}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                {/* "+N more" overlay on last thumbnail */}
                {i === thumbnails.length - 1 && remainingCount > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(0,0,0,0.5)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: "1.25rem",
                      fontWeight: 600,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewAll?.();
                    }}
                  >
                    +{remainingCount} more
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View All / Set Hero controls */}
      {media.length > 1 && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", justifyContent: "flex-end" }}>
          {onViewAll && (
            <button
              onClick={onViewAll}
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.8rem",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                cursor: "pointer",
                color: "var(--text-muted)",
              }}
            >
              View all {media.length} photos
            </button>
          )}
        </div>
      )}

      {/* Inline Lightbox */}
      {lightboxIndex !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.9)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setLightboxIndex(null)}
        >
          <img
            src={getImageUrl(media[lightboxIndex])}
            alt={media[lightboxIndex].caption || "Photo"}
            style={{
              maxWidth: "90vw",
              maxHeight: "80vh",
              objectFit: "contain",
              borderRadius: "8px",
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              marginTop: "1rem",
              alignItems: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxIndex(Math.max(0, lightboxIndex - 1))}
              disabled={lightboxIndex === 0}
              style={{
                padding: "0.5rem 1rem",
                background: "rgba(255,255,255,0.2)",
                border: "none",
                borderRadius: "6px",
                color: "#fff",
                cursor: lightboxIndex === 0 ? "not-allowed" : "pointer",
              }}
            >
              Prev
            </button>
            <span style={{ color: "#fff", fontSize: "0.9rem" }}>
              {lightboxIndex + 1} / {media.length}
            </span>
            <button
              onClick={() => setLightboxIndex(Math.min(media.length - 1, lightboxIndex + 1))}
              disabled={lightboxIndex === media.length - 1}
              style={{
                padding: "0.5rem 1rem",
                background: "rgba(255,255,255,0.2)",
                border: "none",
                borderRadius: "6px",
                color: "#fff",
                cursor: lightboxIndex === media.length - 1 ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
            {onSetHero && (
              <button
                onClick={() => {
                  onSetHero(media[lightboxIndex].media_id);
                  setLightboxIndex(null);
                }}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#0d6efd",
                  border: "none",
                  borderRadius: "6px",
                  color: "#fff",
                  cursor: "pointer",
                  marginLeft: "1rem",
                }}
              >
                Set as Main Photo
              </button>
            )}
            <button
              onClick={() => setLightboxIndex(null)}
              style={{
                padding: "0.5rem 1rem",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: "6px",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
