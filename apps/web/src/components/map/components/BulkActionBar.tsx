"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { MAP_Z_INDEX } from "@/lib/design-tokens";

interface Trapper {
  person_id: string;
  display_name: string;
  trapper_type: string;
  availability_status: string;
}

interface BulkActionBarProps {
  selectedPlaceIds: Set<string>;
  onClear: () => void;
  /** Map from place_id → request_ids at that place */
  placeRequestMap: Map<string, string[]>;
}

export function BulkActionBar({ selectedPlaceIds, onClear, placeRequestMap }: BulkActionBarProps) {
  const { addToast } = useToast();
  const [showTrapperPicker, setShowTrapperPicker] = useState(false);
  const [trappers, setTrappers] = useState<Trapper[]>([]);
  const [loadingTrappers, setLoadingTrappers] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const count = selectedPlaceIds.size;

  // Gather all request IDs from selected places
  const requestIds: string[] = [];
  for (const placeId of selectedPlaceIds) {
    const rids = placeRequestMap.get(placeId);
    if (rids) requestIds.push(...rids);
  }

  // Fetch trappers when picker opens
  useEffect(() => {
    if (!showTrapperPicker || trappers.length > 0) return;
    setLoadingTrappers(true);
    fetchApi<{ trappers?: Trapper[] }>("/api/trappers?status=active&limit=50")
      .then(data => setTrappers(data.trappers || []))
      .catch(() => addToast({ type: "error", message: "Failed to load trappers" }))
      .finally(() => setLoadingTrappers(false));
  }, [showTrapperPicker, trappers.length, addToast]);

  const handleAssign = useCallback(async (trapperId: string, trapperName: string) => {
    if (requestIds.length === 0) {
      addToast({ type: "warning", message: "No active requests at selected places" });
      return;
    }
    setAssigning(true);
    try {
      const data = await postApi<{ summary: { assigned: number; already_assigned: number } }>(
        "/api/requests/bulk-assign",
        { request_ids: requestIds, trapper_id: trapperId }
      );
      const { assigned, already_assigned } = data.summary;
      addToast({
        type: "success",
        message: `Assigned ${trapperName} to ${assigned} request${assigned !== 1 ? "s" : ""}${already_assigned > 0 ? ` (${already_assigned} already assigned)` : ""}`,
      });
      setShowTrapperPicker(false);
      onClear();
    } catch {
      addToast({ type: "error", message: "Failed to assign trapper" });
    }
    setAssigning(false);
  }, [requestIds, addToast, onClear]);

  if (count === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 80,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: MAP_Z_INDEX.controls + 5,
        background: "var(--background, #fff)",
        borderRadius: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 14 }}>
        {count} place{count !== 1 ? "s" : ""} selected
      </span>

      {requestIds.length > 0 && (
        <button
          onClick={() => setShowTrapperPicker(!showTrapperPicker)}
          disabled={assigning}
          style={{
            padding: "6px 14px",
            background: "var(--primary, #3b82f6)",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {assigning ? "Assigning..." : "Assign Trapper"}
        </button>
      )}

      <button
        onClick={onClear}
        style={{
          padding: "6px 12px",
          background: "none",
          border: "1px solid var(--border, #e5e7eb)",
          borderRadius: 8,
          fontSize: 13,
          cursor: "pointer",
          color: "var(--text-secondary)",
        }}
      >
        Clear
      </button>

      {/* Trapper picker dropdown */}
      {showTrapperPicker && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginBottom: 8,
            background: "var(--background, #fff)",
            borderRadius: 12,
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            width: 280,
            maxHeight: 300,
            overflowY: "auto",
          }}
        >
          <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
            Select Trapper ({requestIds.length} request{requestIds.length !== 1 ? "s" : ""})
          </div>
          {loadingTrappers ? (
            <div style={{ padding: 16, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>Loading...</div>
          ) : trappers.length === 0 ? (
            <div style={{ padding: 16, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>No active trappers</div>
          ) : (
            trappers.map(t => (
              <button
                key={t.person_id}
                onClick={() => handleAssign(t.person_id, t.display_name)}
                disabled={assigning}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px 14px",
                  background: "none",
                  border: "none",
                  borderBottom: "1px solid var(--border-default)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 13,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
              >
                <div style={{ fontWeight: 500 }}>{t.display_name}</div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                  {t.trapper_type} · {t.availability_status}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
