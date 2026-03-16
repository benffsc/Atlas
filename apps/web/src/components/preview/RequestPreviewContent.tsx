"use client";

import { EntityPreviewPanel } from "./EntityPreviewPanel";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import { formatStatus } from "@/lib/display-labels";
import type { RequestDetail } from "@/hooks/useEntityDetail";

interface RequestPreviewContentProps {
  request: RequestDetail;
  onClose: () => void;
}

/**
 * Maps RequestDetail data to EntityPreviewPanel props.
 * Used in the split-view panel on the requests list page.
 */
export function RequestPreviewContent({ request, onClose }: RequestPreviewContentProps) {
  // Days open calculation
  const createdDate = new Date(request.created_at);
  const endDate = request.resolved_at ? new Date(request.resolved_at) : new Date();
  const daysOpen = Math.max(0, Math.floor((endDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)));

  const stats = [
    { label: "Est. Cats", value: request.estimated_cat_count ?? "\u2014" },
    { label: "Linked Cats", value: request.linked_cat_count ?? 0 },
    { label: request.resolved_at ? "Duration" : "Days Open", value: `${daysOpen}d`, color: !request.resolved_at && daysOpen > 30 ? "#dc2626" : undefined },
  ];

  const badges = (
    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
      <StatusBadge status={request.status} />
      {request.priority && <PriorityBadge priority={request.priority} />}
    </div>
  );

  const sections = [
    {
      id: "status",
      title: "Status",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          <DetailRow label="Status" value={formatStatus(request.status)} />
          {request.priority && <DetailRow label="Priority" value={request.priority.charAt(0).toUpperCase() + request.priority.slice(1)} />}
          {request.assignment_status && <DetailRow label="Assignment" value={request.assignment_status.replace(/_/g, " ")} />}
          <DetailRow label="Created" value={new Date(request.created_at).toLocaleDateString()} />
          {request.resolved_at && <DetailRow label="Resolved" value={new Date(request.resolved_at).toLocaleDateString()} />}
        </div>
      ),
    },
    {
      id: "location",
      title: "Location",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          {request.place_name && <DetailRow label="Place" value={request.place_name} />}
          {request.place_address && <DetailRow label="Address" value={request.place_address} />}
          {request.place_kind && <DetailRow label="Type" value={request.place_kind.replace(/_/g, " ")} />}
        </div>
      ),
    },
    {
      id: "people",
      title: "People",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
          {request.requester_name && <DetailRow label="Requester" value={request.requester_name} />}
          {request.primary_trapper_name && <DetailRow label="Trapper" value={request.primary_trapper_name} />}
        </div>
      ),
    },
  ];

  return (
    <EntityPreviewPanel
      title={request.summary || request.place_name || "Request"}
      detailHref={`/requests/${request.request_id}`}
      onClose={onClose}
      badges={badges}
      stats={stats}
      sections={sections}
    />
  );
}

// --- Shared sub-components ---

function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: 500, color: valueColor }}>{value}</span>
    </div>
  );
}
