"use client";

import { useState, useEffect, useCallback } from "react";

interface MediaItem {
  media_id: string;
  storage_path: string;
  original_filename: string;
  cat_description: string | null;
  cat_identification_confidence: string | null;
  linked_cat_id: string | null;
  photo_group_id: string | null;
}

interface PhotoGroup {
  collection_id: string;
  group_name: string;
  group_description: string | null;
  photo_count: number;
  media_ids: string[];
  storage_paths: string[];
  cat_description: string | null;
  max_confidence: string | null;
  linked_cat_id: string | null;
}

interface Cat {
  cat_id: string;
  display_name: string;
}

interface PhotoGroupingPanelProps {
  requestId: string;
  media: MediaItem[];
  onMediaUpdated?: () => void;
  availableCats?: Cat[];
}

type ConfidenceLevel = "confirmed" | "likely" | "uncertain" | "unidentified";

const confidenceColors: Record<ConfidenceLevel, string> = {
  confirmed: "#198754",
  likely: "#0d6efd",
  uncertain: "#ffc107",
  unidentified: "#6c757d",
};

export function PhotoGroupingPanel({
  requestId,
  media,
  onMediaUpdated,
  availableCats = [],
}: PhotoGroupingPanelProps) {
  const [groups, setGroups] = useState<PhotoGroup[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [draggedMediaId, setDraggedMediaId] = useState<string | null>(null);
  const [identifyingGroup, setIdentifyingGroup] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string>("");
  const [selectedConfidence, setSelectedConfidence] = useState<ConfidenceLevel>("confirmed");

  // Fetch groups
  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch(`/api/media/group?request_id=${requestId}`);
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups || []);
      }
    } catch (err) {
      console.error("Error fetching groups:", err);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // Get ungrouped media
  const ungroupedMedia = media.filter((m) => !m.photo_group_id);

  // Get media for a specific group
  const getGroupMedia = (groupId: string) => {
    return media.filter((m) => m.photo_group_id === groupId);
  };

  // Toggle media selection
  const toggleMediaSelection = (mediaId: string) => {
    setSelectedMediaIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(mediaId)) {
        newSet.delete(mediaId);
      } else {
        newSet.add(mediaId);
      }
      return newSet;
    });
  };

  // Create a new group from selected media
  const createGroupFromSelection = async () => {
    if (selectedMediaIds.size === 0 || !newGroupName.trim()) return;

    setCreatingGroup(true);
    setError(null);

    try {
      const response = await fetch("/api/media/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          name: newGroupName.trim(),
          media_ids: Array.from(selectedMediaIds),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create group");
      }

      setNewGroupName("");
      setSelectedMediaIds(new Set());
      await fetchGroups();
      onMediaUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setCreatingGroup(false);
    }
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, mediaId: string) => {
    setDraggedMediaId(mediaId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", mediaId);
  };

  // Handle drag over
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  // Handle drop on a group
  const handleDropOnGroup = async (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault();
    const mediaId = e.dataTransfer.getData("text/plain");
    setDraggedMediaId(null);

    if (!mediaId) return;

    try {
      if (groupId) {
        // Add to group
        await fetch("/api/media/group", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collection_id: groupId,
            add_media_ids: [mediaId],
          }),
        });
      } else {
        // Remove from current group (move to ungrouped)
        const currentMedia = media.find((m) => m.media_id === mediaId);
        if (currentMedia?.photo_group_id) {
          await fetch("/api/media/group", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              collection_id: currentMedia.photo_group_id,
              remove_media_ids: [mediaId],
            }),
          });
        }
      }

      await fetchGroups();
      onMediaUpdated?.();
    } catch (err) {
      console.error("Error moving media:", err);
    }
  };

  // Identify a group with a cat
  const identifyGroup = async (groupId: string) => {
    if (!selectedCatId) return;

    try {
      // Get first media in group
      const groupMedia = getGroupMedia(groupId);
      if (groupMedia.length === 0) return;

      const response = await fetch(`/api/media/${groupMedia[0].media_id}/identify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cat_id: selectedCatId,
          confidence: selectedConfidence,
          apply_to_group: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to identify group");
      }

      setIdentifyingGroup(null);
      setSelectedCatId("");
      await fetchGroups();
      onMediaUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to identify group");
    }
  };

  // Delete a group
  const deleteGroup = async (groupId: string) => {
    if (!confirm("Delete this group? Photos will be moved to ungrouped.")) return;

    try {
      const response = await fetch(`/api/media/group?collection_id=${groupId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete group");
      }

      await fetchGroups();
      onMediaUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete group");
    }
  };

  // Render a photo thumbnail
  const renderPhotoThumbnail = (m: MediaItem, inGroup: boolean = false) => {
    const isSelected = selectedMediaIds.has(m.media_id);
    const confidence = (m.cat_identification_confidence || "unidentified") as ConfidenceLevel;

    return (
      <div
        key={m.media_id}
        draggable
        onDragStart={(e) => handleDragStart(e, m.media_id)}
        onClick={() => !inGroup && toggleMediaSelection(m.media_id)}
        style={{
          position: "relative",
          borderRadius: "4px",
          overflow: "hidden",
          border: isSelected ? "3px solid #0d6efd" : "1px solid #dee2e6",
          background: "#fff",
          cursor: inGroup ? "grab" : "pointer",
          opacity: draggedMediaId === m.media_id ? 0.5 : 1,
        }}
      >
        <img
          src={m.storage_path}
          alt={m.original_filename}
          style={{
            width: "100%",
            height: "80px",
            objectFit: "cover",
          }}
        />
        {/* Confidence indicator */}
        <div
          style={{
            position: "absolute",
            top: "4px",
            left: "4px",
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            background: confidenceColors[confidence],
            border: "1px solid white",
          }}
          title={confidence}
        />
        {/* Linked cat indicator */}
        {m.linked_cat_id && (
          <div
            style={{
              position: "absolute",
              bottom: "0",
              left: "0",
              right: "0",
              background: "rgba(25, 135, 84, 0.9)",
              color: "white",
              fontSize: "0.6rem",
              padding: "2px",
              textAlign: "center",
            }}
          >
            Linked
          </div>
        )}
        {/* Selection checkbox for ungrouped */}
        {!inGroup && (
          <div
            style={{
              position: "absolute",
              top: "4px",
              right: "4px",
              width: "20px",
              height: "20px",
              borderRadius: "4px",
              background: isSelected ? "#0d6efd" : "rgba(255,255,255,0.9)",
              border: "1px solid #dee2e6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: isSelected ? "white" : "transparent",
              fontSize: "0.75rem",
            }}
          >
            {isSelected ? "✓" : ""}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div style={{ padding: "1rem", textAlign: "center" }}>Loading...</div>;
  }

  return (
    <div style={{ padding: "1rem" }}>
      {error && (
        <div
          style={{
            padding: "0.5rem",
            marginBottom: "1rem",
            background: "#f8d7da",
            color: "#842029",
            borderRadius: "4px",
            fontSize: "0.875rem",
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              float: "right",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            x
          </button>
        </div>
      )}

      {/* Create group from selection */}
      {selectedMediaIds.size > 0 && (
        <div
          style={{
            padding: "0.75rem",
            marginBottom: "1rem",
            background: "#e7f1ff",
            borderRadius: "4px",
            border: "1px solid #b6d4fe",
          }}
        >
          <div style={{ marginBottom: "0.5rem", fontWeight: 500 }}>
            {selectedMediaIds.size} photo{selectedMediaIds.size !== 1 ? "s" : ""} selected
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name (e.g., 'Orange tabby')"
              style={{
                flex: 1,
                padding: "0.375rem 0.5rem",
                border: "1px solid #dee2e6",
                borderRadius: "4px",
                fontSize: "0.875rem",
              }}
            />
            <button
              onClick={createGroupFromSelection}
              disabled={!newGroupName.trim() || creatingGroup}
              style={{
                padding: "0.375rem 0.75rem",
                background: newGroupName.trim() ? "#0d6efd" : "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: newGroupName.trim() ? "pointer" : "not-allowed",
                fontSize: "0.875rem",
              }}
            >
              {creatingGroup ? "Creating..." : "Create Group"}
            </button>
            <button
              onClick={() => setSelectedMediaIds(new Set())}
              style={{
                padding: "0.375rem 0.75rem",
                background: "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Photo groups */}
      {groups.map((group) => {
        const groupMedia = getGroupMedia(group.collection_id);
        const linkedCat = availableCats.find((c) => c.cat_id === group.linked_cat_id);

        return (
          <div
            key={group.collection_id}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropOnGroup(e, group.collection_id)}
            style={{
              marginBottom: "1rem",
              padding: "0.75rem",
              background: "#f8f9fa",
              borderRadius: "8px",
              border: "1px solid #dee2e6",
            }}
          >
            {/* Group header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.5rem",
              }}
            >
              <div>
                <span style={{ fontWeight: 600 }}>{group.group_name}</span>
                <span
                  style={{ marginLeft: "0.5rem", fontSize: "0.875rem", color: "#6c757d" }}
                >
                  ({groupMedia.length} photo{groupMedia.length !== 1 ? "s" : ""})
                </span>
                {linkedCat && (
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      padding: "0.125rem 0.5rem",
                      background: "#198754",
                      color: "white",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                    }}
                  >
                    {linkedCat.display_name}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                {!linkedCat && availableCats.length > 0 && (
                  <button
                    onClick={() =>
                      setIdentifyingGroup(
                        identifyingGroup === group.collection_id ? null : group.collection_id
                      )
                    }
                    style={{
                      padding: "0.25rem 0.5rem",
                      background: identifyingGroup === group.collection_id ? "#0d6efd" : "#e9ecef",
                      color: identifyingGroup === group.collection_id ? "white" : "#495057",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                    }}
                  >
                    Link to Cat
                  </button>
                )}
                <button
                  onClick={() => deleteGroup(group.collection_id)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    background: "#dc3545",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Identify panel */}
            {identifyingGroup === group.collection_id && (
              <div
                style={{
                  padding: "0.5rem",
                  marginBottom: "0.5rem",
                  background: "#fff",
                  borderRadius: "4px",
                  border: "1px solid #dee2e6",
                }}
              >
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <select
                    value={selectedCatId}
                    onChange={(e) => setSelectedCatId(e.target.value)}
                    style={{
                      padding: "0.25rem 0.5rem",
                      border: "1px solid #dee2e6",
                      borderRadius: "4px",
                      fontSize: "0.875rem",
                    }}
                  >
                    <option value="">Select cat...</option>
                    {availableCats.map((cat) => (
                      <option key={cat.cat_id} value={cat.cat_id}>
                        {cat.display_name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedConfidence}
                    onChange={(e) => setSelectedConfidence(e.target.value as ConfidenceLevel)}
                    style={{
                      padding: "0.25rem 0.5rem",
                      border: "1px solid #dee2e6",
                      borderRadius: "4px",
                      fontSize: "0.875rem",
                    }}
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="likely">Likely</option>
                    <option value="uncertain">Uncertain</option>
                  </select>
                  <button
                    onClick={() => identifyGroup(group.collection_id)}
                    disabled={!selectedCatId}
                    style={{
                      padding: "0.25rem 0.5rem",
                      background: selectedCatId ? "#198754" : "#6c757d",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: selectedCatId ? "pointer" : "not-allowed",
                      fontSize: "0.875rem",
                    }}
                  >
                    Link All
                  </button>
                </div>
              </div>
            )}

            {/* Group photos */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                gap: "0.5rem",
              }}
            >
              {groupMedia.map((m) => renderPhotoThumbnail(m, true))}
            </div>
          </div>
        );
      })}

      {/* Ungrouped photos */}
      {ungroupedMedia.length > 0 && (
        <div
          onDragOver={handleDragOver}
          onDrop={(e) => handleDropOnGroup(e, null)}
          style={{
            padding: "0.75rem",
            background: "#fff",
            borderRadius: "8px",
            border: "2px dashed #dee2e6",
          }}
        >
          <div
            style={{
              marginBottom: "0.5rem",
              fontWeight: 500,
              color: "#6c757d",
            }}
          >
            Ungrouped Photos ({ungroupedMedia.length})
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
              gap: "0.5rem",
            }}
          >
            {ungroupedMedia.map((m) => renderPhotoThumbnail(m, false))}
          </div>
          <div
            style={{
              marginTop: "0.5rem",
              fontSize: "0.75rem",
              color: "#6c757d",
            }}
          >
            Click photos to select, then create a group. Drag photos between groups.
          </div>
        </div>
      )}

      {/* Empty state */}
      {media.length === 0 && (
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            color: "#6c757d",
          }}
        >
          No photos uploaded yet
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          marginTop: "1rem",
          padding: "0.5rem",
          background: "#f8f9fa",
          borderRadius: "4px",
          fontSize: "0.75rem",
          color: "#6c757d",
        }}
      >
        <strong>Confidence:</strong>
        {Object.entries(confidenceColors).map(([level, color]) => (
          <span key={level} style={{ marginLeft: "0.75rem" }}>
            <span
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: color,
                marginRight: "0.25rem",
                verticalAlign: "middle",
              }}
            />
            {level}
          </span>
        ))}
      </div>
    </div>
  );
}
