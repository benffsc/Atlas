"use client";

import { useState, useEffect, useCallback } from "react";
import { MediaItem } from "./MediaUploader";

interface MediaLightboxProps {
  media: MediaItem[];
  initialIndex: number;
  onClose: () => void;
  onSetHero?: (mediaId: string) => void;
}

export function MediaLightbox({ media, initialIndex, onClose, onSetHero }: MediaLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const currentMedia = media[currentIndex];

  // Navigate to previous image
  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : media.length - 1));
  }, [media.length]);

  // Navigate to next image
  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < media.length - 1 ? prev + 1 : 0));
  }, [media.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          goToPrevious();
          break;
        case "ArrowRight":
          goToNext();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, goToPrevious, goToNext]);

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (!currentMedia) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.9)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: "1rem",
          right: "1rem",
          background: "none",
          border: "none",
          color: "white",
          fontSize: "2rem",
          cursor: "pointer",
          padding: "0.5rem",
          lineHeight: 1,
          zIndex: 10001,
        }}
        aria-label="Close"
      >
        &times;
      </button>

      {/* Counter */}
      <div style={{
        position: "absolute",
        top: "1rem",
        left: "1rem",
        color: "white",
        fontSize: "0.875rem",
        zIndex: 10001,
      }}>
        {currentIndex + 1} / {media.length}
      </div>

      {/* Previous button */}
      {media.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToPrevious();
          }}
          style={{
            position: "absolute",
            left: "1rem",
            top: "50%",
            transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.2)",
            border: "none",
            color: "white",
            fontSize: "2rem",
            cursor: "pointer",
            padding: "1rem 1.5rem",
            borderRadius: "4px",
            zIndex: 10001,
          }}
          aria-label="Previous"
        >
          &lsaquo;
        </button>
      )}

      {/* Next button */}
      {media.length > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goToNext();
          }}
          style={{
            position: "absolute",
            right: "1rem",
            top: "50%",
            transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.2)",
            border: "none",
            color: "white",
            fontSize: "2rem",
            cursor: "pointer",
            padding: "1rem 1.5rem",
            borderRadius: "4px",
            zIndex: 10001,
          }}
          aria-label="Next"
        >
          &rsaquo;
        </button>
      )}

      {/* Image container */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "90vw",
          maxHeight: "80vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src={currentMedia.storage_path}
          alt={currentMedia.caption || currentMedia.original_filename}
          style={{
            maxWidth: "100%",
            maxHeight: "80vh",
            objectFit: "contain",
            borderRadius: "4px",
          }}
        />
      </div>

      {/* Caption and metadata */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          bottom: "0",
          left: "0",
          right: "0",
          padding: "1rem",
          background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
          color: "white",
          textAlign: "center",
        }}
      >
        {currentMedia.caption && (
          <div style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
            {currentMedia.caption}
          </div>
        )}
        {currentMedia.cat_description && (
          <div style={{ fontSize: "0.875rem", color: "#ffc107", marginBottom: "0.25rem" }}>
            Cat: {currentMedia.cat_description}
          </div>
        )}
        <div style={{ fontSize: "0.75rem", color: "#adb5bd" }}>
          {currentMedia.original_filename} &bull; {formatDate(currentMedia.uploaded_at)}
          {currentMedia.uploaded_by && ` &bull; by ${currentMedia.uploaded_by}`}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", justifyContent: "center" }}>
          {onSetHero && media.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSetHero(currentMedia.media_id);
              }}
              style={{
                padding: "0.25rem 0.75rem",
                background: "#0d6efd",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Set as Main Photo
            </button>
          )}
          <a
            href={currentMedia.storage_path}
            download={currentMedia.original_filename}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: "0.25rem 0.75rem",
              background: "rgba(255,255,255,0.2)",
              color: "white",
              textDecoration: "none",
              borderRadius: "4px",
              fontSize: "0.75rem",
            }}
          >
            Download
          </a>
        </div>
      </div>
    </div>
  );
}
