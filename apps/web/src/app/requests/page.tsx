"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import { formatDateLocal, formatRelativeTime, getActivityColor } from "@/lib/formatters";
import { StatusBadge, PriorityBadge } from "@/components/badges";
import { KanbanBoard, KanbanBoardMobile } from "@/components/common";
import { StatusSegmentedControl } from "@/components/ui/StatusSegmentedControl";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useRequestCounts } from "@/hooks/useRequestCounts";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { COLORS, TYPOGRAPHY, SPACING, BORDERS, TRANSITIONS, getStatusColor } from "@/lib/design-tokens";
import { getOutcomeLabel, getOutcomeColor } from "@/lib/request-status";
import { useTriageFlags } from "@/hooks/useTriageFlags";
import { SKELETON_LINE, SKELETON_BLOCK, FLEX_BETWEEN } from "./styles";
import { SkeletonStats, SkeletonList } from "@/components/feedback/Skeleton";
import { EmptyState, EmptyFilteredResults } from "@/components/feedback/EmptyState";
import { ListDetailLayout } from "@/components/layouts/ListDetailLayout";
import { RequestDetailShell } from "@/components/request/RequestDetailShell";
import { Icon } from "@/components/ui/Icon";
import { TnrProgressBar } from "@/components/ui/TnrProgressBar";
import { EntityPreviewModal } from "@/components/search/EntityPreviewModal";
import { FilterBar, FilterChip, SearchInput, FilterDivider, ActiveFilterTags } from "@/components/filters";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";

interface Request {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  scheduled_date: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  source_created_at: string | null; // Original Airtable date for legacy data
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  requester_name: string | null;
  latitude: number | null;
  longitude: number | null;
  is_legacy_request: boolean;
  // SC_001: Data quality columns
  active_trapper_count: number;
  place_has_location: boolean;
  data_quality_flags: string[];
  // SC_002: Trapper visibility columns
  no_trapper_reason: string | null;
  primary_trapper_name: string | null;
  // SC_004: Assignment status (maintained field)
  assignment_status: string;
  // Map preview caching (MIG_2470)
  map_preview_url: string | null;
  map_preview_updated_at: string | null;
  // MIG_2522: Requestor intelligence
  requester_role_at_submission: string | null;
  requester_is_site_contact: boolean | null;
  site_contact_name: string | null;
  // MIG_2580: Archive
  is_archived: boolean;
  // FFS-155: Resolution outcome
  resolution_outcome: string | null;
}


function ColonySizeBadge({ count }: { count: number | null }) {
  const catCount = count ?? 0;
  let style: { bg: string; color: string; label: string };

  if (catCount >= 20) {
    style = { bg: COLORS.errorDark, color: COLORS.white, label: `${catCount}+ cats` };
  } else if (catCount >= 7) {
    style = { bg: COLORS.warning, color: COLORS.black, label: `${catCount} cats` };
  } else if (catCount >= 2) {
    style = { bg: COLORS.primary, color: COLORS.white, label: `${catCount} cats` };
  } else {
    style = { bg: COLORS.gray500, color: COLORS.white, label: catCount ? `${catCount} cat` : "?" };
  }

  return (
    <span
      className="badge"
      style={{ background: style.bg, color: style.color, fontSize: TYPOGRAPHY.size.xs }}
    >
      {style.label}
    </span>
  );
}

function DataQualityFlags({
  flags,
  requestId,
  onTrapperAction,
  actionMenuOpen,
  onToggleMenu,
}: {
  flags: string[];
  requestId?: string;
  onTrapperAction?: (requestId: string, reason: string) => void;
  actionMenuOpen?: boolean;
  onToggleMenu?: (requestId: string | null) => void;
}) {
  const { flagConfig: FLAG_CONFIG } = useTriageFlags();
  if (!flags || flags.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
      {flags.map((flag) => {
        const cfg = FLAG_CONFIG[flag] || { label: flag, bg: "#e5e7eb", color: "var(--text-secondary)" };
        const isClickable = flag === "no_trapper" && requestId && onTrapperAction;

        return (
          <span
            key={flag}
            style={{
              fontSize: "0.65rem",
              padding: "1px 6px",
              borderRadius: "4px",
              background: cfg.bg,
              color: cfg.color,
              fontWeight: 500,
              lineHeight: "1.4",
              cursor: isClickable ? "pointer" : undefined,
              position: isClickable ? "relative" : undefined,
            }}
            onClick={isClickable ? (e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleMenu?.(actionMenuOpen ? null : requestId);
            } : undefined}
          >
            {cfg.label}{isClickable ? " \u25BE" : ""}
            {isClickable && actionMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: "4px",
                  background: "var(--card-bg, #fff)",
                  border: "1px solid var(--border-default, #e5e7eb)",
                  borderRadius: "6px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  zIndex: 50,
                  minWidth: "160px",
                  overflow: "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => onTrapperAction(requestId, "client_trapping")}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    background: "transparent",
                    color: "var(--text-primary, #111)",
                    fontSize: "0.8rem",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #f3f4f6)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Client trapping
                </button>
                <button
                  onClick={() => onTrapperAction(requestId, "not_needed")}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    background: "transparent",
                    color: "var(--text-primary, #111)",
                    fontSize: "0.8rem",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #f3f4f6)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Not needed
                </button>
                <a
                  href={`/requests/${requestId}`}
                  style={{
                    display: "block",
                    padding: "8px 12px",
                    borderTop: "1px solid var(--border-default, #e5e7eb)",
                    color: "var(--primary, #0d6efd)",
                    fontSize: "0.8rem",
                    textDecoration: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-secondary, #f3f4f6)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  Assign trapper &rarr;
                </a>
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
}

interface DiseaseDetail {
  places: number;
  cats: number;
  nearest_meters: number;
}

interface NearbyData {
  count: number;
  requests: { count: number; by_size: { large: number; medium: number; small: number; tiny: number } };
  places: {
    count: number;
    by_style: { disease: number; watch_list: number; active: number };
    disease_detail?: Record<string, DiseaseDetail>;
    total_positive_cats?: number;
  };
}

// Disease display names for UI
const DISEASE_LABELS: Record<string, string> = {
  felv: "FeLV",
  fiv: "FIV",
  ringworm: "Ringworm",
  heartworm: "Heartworm",
  panleukopenia: "Panleuk",
};

// Map caching is handled by HTTP Cache-Control headers (stale-while-revalidate)
// This avoids sessionStorage limitations (no cross-tab sync, manual TTL management)

function RequestMapPreview({ requestId, latitude, longitude, address, cachedMapUrl }: {
  requestId: string;
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  cachedMapUrl?: string | null;
}) {
  const [mapUrl, setMapUrl] = useState<string | null>(cachedMapUrl || null);
  const [nearbyData, setNearbyData] = useState<NearbyData | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const fetchFreshMap = async () => {
    try {
      const data = await fetchApi<{
        map_url: string;
        nearby_count?: number;
        nearby_requests?: NearbyData["requests"];
        nearby_places?: NearbyData["places"];
      }>(`/api/requests/${requestId}/map?width=400&height=200&zoom=15&scale=2`);
      const nearby: NearbyData = {
        count: data.nearby_count || 0,
        requests: data.nearby_requests || { count: 0, by_size: { large: 0, medium: 0, small: 0, tiny: 0 } },
        places: data.nearby_places || { count: 0, by_style: { disease: 0, watch_list: 0, active: 0 } },
      };
      setMapUrl(data.map_url);
      setNearbyData(nearby);
    } catch (err) {
      console.error("Failed to fetch map:", err);
    }
  };

  useEffect(() => {
    // If we have a cached URL, use it immediately (already set in initial state)
    // Only fetch dynamically if no cached URL AND we have coordinates
    if (cachedMapUrl || !latitude || !longitude) return;
    fetchFreshMap();
  }, [requestId, latitude, longitude, cachedMapUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!latitude || !longitude) {
    return (
      <div
        style={{
          width: "100%",
          height: "180px",
          background: "linear-gradient(135deg, var(--card-border) 0%, var(--bg-secondary) 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px",
          color: "var(--text-muted)",
          fontSize: "0.75rem",
          padding: "12px",
          textAlign: "center",
        }}
      >
        <Icon name="map-pin" size={24} color="var(--text-muted)" />
        {address ? (
          <>
            <span style={{ fontWeight: 500, color: "var(--text-secondary)" }}>
              Pending geocode
            </span>
            <span style={{ fontSize: "0.7rem", marginTop: "4px", opacity: 0.8, maxWidth: "90%", overflow: "hidden", textOverflow: "ellipsis" }}>
              {address}
            </span>
          </>
        ) : (
          <span>No location set</span>
        )}
      </div>
    );
  }

  if (!mapUrl) {
    return (
      <div
        style={{
          width: "100%",
          height: "180px",
          background: "var(--card-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px",
        }}
      >
        <div className="loading-spinner" />
      </div>
    );
  }

  // Extract disease types present nearby (sorted by severity)
  const diseaseDetail = nearbyData?.places.disease_detail || {};
  const diseaseTypes = Object.keys(diseaseDetail).sort((a, b) => {
    // FeLV > FIV > others (severity order)
    const order: Record<string, number> = { felv: 0, fiv: 1, ringworm: 2, panleukopenia: 3, heartworm: 4 };
    return (order[a] ?? 99) - (order[b] ?? 99);
  });

  // Build tooltip with detailed breakdown (now shows cat counts per disease)
  const tooltipParts: string[] = [];
  if (diseaseTypes.length > 0) {
    const diseaseParts = diseaseTypes.map((key) => {
      const detail = diseaseDetail[key];
      const label = DISEASE_LABELS[key] || key;
      const nearest = detail.nearest_meters < 1000
        ? `${detail.nearest_meters}m`
        : `${(detail.nearest_meters / 1000).toFixed(1)}km`;
      return `${detail.cats} ${label} cat${detail.cats !== 1 ? "s" : ""} at ${detail.places} place${detail.places !== 1 ? "s" : ""} (nearest: ${nearest})`;
    });
    tooltipParts.push(diseaseParts.join("\n"));
  }
  if (nearbyData?.requests.count) {
    tooltipParts.push(`${nearbyData.requests.count} requests nearby`);
  }
  if (nearbyData?.places.by_style.watch_list) {
    tooltipParts.push(`${nearbyData.places.by_style.watch_list} watch list`);
  }
  const tooltip = tooltipParts.join("\n");

  // Badge text: show disease TYPES instead of confusing place counts
  // - FeLV only → "⚠ FeLV nearby"
  // - FeLV + FIV → "⚠ FeLV/FIV nearby"
  // - Multiple diseases (3+) → "⚠ Disease risk"
  // - No disease → "37 nearby"
  const hasDiseaseNearby = diseaseTypes.length > 0;
  const hasFelv = diseaseTypes.includes("felv");
  const hasFiv = diseaseTypes.includes("fiv");

  let badgeText: string | null = null;
  let isHighRisk = false;
  let isModerateRisk = false;

  if (hasDiseaseNearby) {
    isHighRisk = hasFelv; // FeLV is always high risk
    isModerateRisk = !hasFelv && hasFiv; // FIV without FeLV is moderate

    if (diseaseTypes.length === 1) {
      // Single disease type
      const label = DISEASE_LABELS[diseaseTypes[0]] || diseaseTypes[0];
      badgeText = `⚠ ${label} nearby · ${nearbyData?.places.count} places`;
    } else if (diseaseTypes.length === 2) {
      // Two disease types
      const labels = diseaseTypes.map((k) => DISEASE_LABELS[k] || k).join("/");
      badgeText = `⚠ ${labels} nearby · ${nearbyData?.places.count} places`;
    } else {
      // 3+ disease types
      badgeText = `⚠ Disease risk · ${nearbyData?.places.count} places`;
    }
  } else if (nearbyData?.count) {
    badgeText = `${nearbyData.count} nearby`;
  }

  return (
    <div style={{ position: "relative" }}>
      <img
        src={mapUrl}
        alt="Location map"
        style={{
          width: "100%",
          height: "180px",
          objectFit: "cover",
          borderRadius: "8px",
        }}
        onError={() => {
          // Cached URL expired/broken — fetch a fresh one (once)
          if (!imgFailed && latitude && longitude) {
            setImgFailed(true);
            setMapUrl(null);
            fetchFreshMap();
          }
        }}
      />
      {badgeText && (
        <div
          title={tooltip}
          style={{
            position: "absolute",
            bottom: "8px",
            right: "8px",
            background: isHighRisk
              ? "rgba(220, 38, 38, 0.95)"  // Red for FeLV (highly contagious)
              : isModerateRisk
                ? "rgba(234, 179, 8, 0.9)"  // Amber for FIV (less contagious)
                : hasDiseaseNearby
                  ? "rgba(202, 138, 4, 0.85)"  // Yellow for Ringworm/other
                  : "rgba(0,0,0,0.7)",         // Gray for no disease
            color: (isModerateRisk || (hasDiseaseNearby && !isHighRisk)) ? "#000" : "#fff",
            padding: "2px 8px",
            borderRadius: "4px",
            fontSize: "0.75rem",
            cursor: "help",
          }}
        >
          {badgeText}
        </div>
      )}
    </div>
  );
}

function RequestCard({ request, onTrapperAction, actionMenuId, onToggleMenu, onCardClick }: {
  request: Request;
  onTrapperAction?: (requestId: string, reason: string) => void;
  actionMenuId?: string | null;
  onToggleMenu?: (id: string | null) => void;
  onCardClick?: (requestId: string) => void;
}) {
  // Age warning border for open requests
  const createdDate = new Date(request.source_created_at || request.created_at);
  const daysOpen = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
  const ageBorderColor = !['completed','cancelled','partial'].includes(request.status) && daysOpen > 60 ? COLORS.errorDark : !['completed','cancelled','partial'].includes(request.status) && daysOpen > 30 ? COLORS.warningDark : undefined;

  return (
    <div
      className="card"
      role="link"
      tabIndex={0}
      onClick={(e) => {
        // Don't navigate if clicking interactive elements (buttons, links, inputs)
        const target = e.target as HTMLElement;
        if (target.closest("button, a, input, select, [role=menu]")) return;
        if (onCardClick) {
          onCardClick(request.request_id);
        } else {
          window.location.href = `/requests/${request.request_id}`;
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (onCardClick) {
            onCardClick(request.request_id);
          } else {
            window.location.href = `/requests/${request.request_id}`;
          }
        }
      }}
      style={{
        border: "1px solid var(--card-border)",
        borderRadius: "12px",
        overflow: "hidden",
        transition: "transform 0.15s, box-shadow 0.15s",
        cursor: "pointer",
        borderLeft: ageBorderColor ? `4px solid ${ageBorderColor}` : undefined,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
        {/* Map Preview */}
        <RequestMapPreview
          requestId={request.request_id}
          latitude={request.latitude}
          longitude={request.longitude}
          address={request.place_address}
          cachedMapUrl={request.map_preview_url}
        />

        {/* Card Content */}
        <div style={{ padding: "12px" }}>
          {/* Status & Priority Row */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
            <StatusBadge status={request.status} />
            {request.resolution_outcome ? (() => {
              const oc = getOutcomeColor(request.resolution_outcome!);
              return (
                <span className="badge" style={{ background: oc.bg, color: oc.color, border: `1px solid ${oc.border}`, fontSize: TYPOGRAPHY.size['2xs'] }}>
                  {getOutcomeLabel(request.resolution_outcome!)}
                </span>
              );
            })() : (
              request.is_legacy_request && ["completed", "cancelled", "partial"].includes(request.status) && (
                <span className="badge" style={{ background: "var(--bg-secondary)", color: "#6b7280", border: "1px solid var(--border-light)", fontSize: TYPOGRAPHY.size['2xs'] }}>
                  Legacy
                </span>
              )
            )}
            <PriorityBadge priority={request.priority} />
            <ColonySizeBadge count={request.estimated_cat_count} />
            {request.has_kittens && (
              <span
                className="badge"
                style={{ background: COLORS.warning, color: COLORS.black, fontSize: TYPOGRAPHY.size['2xs'] }}
              >
                +kittens
              </span>
            )}
            {request.is_archived && (
              <span
                className="badge"
                style={{ background: COLORS.gray500, color: COLORS.white, fontSize: TYPOGRAPHY.size['2xs'] }}
              >
                Archived
              </span>
            )}
          </div>

          {/* Data Quality Flags */}
          <DataQualityFlags
            flags={request.data_quality_flags}
            requestId={request.request_id}
            onTrapperAction={onTrapperAction}
            actionMenuOpen={actionMenuId === request.request_id}
            onToggleMenu={onToggleMenu}
          />

          {/* Summary */}
          <div
            style={{
              fontWeight: 600,
              fontSize: "1rem",
              marginBottom: "4px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {request.summary || "Untitled Request"}
          </div>

          {/* Location */}
          {request.place_name && (
            <div
              style={{
                fontSize: "0.875rem",
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {request.place_name}
              {request.place_city && ` • ${request.place_city}`}
            </div>
          )}

          {/* Trapper */}
          {request.primary_trapper_name && (
            <div
              style={{
                fontSize: "0.75rem",
                color: COLORS.successDark,
                marginTop: "4px",
              }}
            >
              Trapper: {request.primary_trapper_name}
              {request.active_trapper_count > 1 && ` +${request.active_trapper_count - 1}`}
            </div>
          )}

          {/* Contacts Row - shows requestor and site contact */}
          <div
            style={{
              fontSize: "0.75rem",
              marginTop: "8px",
              padding: "6px 8px",
              background: "var(--muted-bg)",
              borderRadius: "6px",
            }}
          >
            {/* Requestor */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ color: COLORS.primary, fontWeight: 500 }}>Requestor:</span>
              <span style={{ color: "var(--text-secondary)" }}>
                {request.requester_name || "Unknown"}
              </span>
              {request.requester_role_at_submission && request.requester_role_at_submission !== "unknown" && (
                <span style={{
                  fontSize: "0.6rem",
                  padding: "1px 4px",
                  background: request.requester_role_at_submission.includes("trapper") ? COLORS.warningLight : COLORS.infoLight,
                  color: request.requester_role_at_submission.includes("trapper") ? COLORS.warningDark : COLORS.primaryDark,
                  borderRadius: "3px",
                  fontWeight: 500,
                }}>
                  {request.requester_role_at_submission.replace(/_/g, " ").replace("ffsc ", "").toUpperCase()}
                </span>
              )}
            </div>
            {/* Site Contact - only if different from requester */}
            {request.site_contact_name && !request.requester_is_site_contact && (
              <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                <span style={{ color: COLORS.success, fontWeight: 500 }}>Site:</span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {request.site_contact_name}
                </span>
              </div>
            )}
            {/* Warning when trapper is requestor but no site contact */}
            {!request.site_contact_name && !request.requester_is_site_contact && request.requester_role_at_submission?.includes("trapper") && (
              <div style={{ color: COLORS.warningDark, fontSize: "0.65rem", marginTop: "2px" }}>
                Site contact needed
              </div>
            )}
          </div>

          {/* Date & Last Activity */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              marginTop: "4px",
            }}
          >
            <span>{formatDateLocal(request.source_created_at || request.created_at)}</span>
            {request.updated_at && request.updated_at.slice(0,10) !== request.created_at.slice(0,10) && (
              <span style={{ color: getActivityColor(request.updated_at) || "var(--text-muted)" }}>
                Activity {formatRelativeTime(request.updated_at)}
              </span>
            )}
          </div>

          {/* TNR Progress mini-bar */}
          {request.estimated_cat_count != null && request.estimated_cat_count > 0 && (
            <div style={{ marginTop: "6px" }}>
              <TnrProgressBar fixed={0} total={null} remaining={request.estimated_cat_count} compact />
            </div>
          )}
        </div>
    </div>
  );
}

const SORT_MAP: Record<string, { by: string; order: string }> = {
  status: { by: "status", order: "asc" },
  newest: { by: "created", order: "desc" },
  oldest: { by: "created", order: "asc" },
  priority: { by: "priority", order: "asc" },
};

// Status grouping configuration for visual display
const STATUS_GROUPS = [
  { status: "new", label: "New", color: COLORS.primary, bgColor: COLORS.primaryLight, description: "Awaiting initial review" },
  { status: "working", label: "Working", color: COLORS.warning, bgColor: COLORS.warningLight, description: "Actively being handled" },
  { status: "paused", label: "Paused", color: "#ec4899", bgColor: "#fdf2f8", description: "On hold" },
  { status: "completed", label: "Completed", color: COLORS.success, bgColor: COLORS.successLight, description: "Finished" },
] as const;

// Helper to normalize legacy statuses to primary statuses for grouping
function getPrimaryStatus(status: string): string {
  const mapping: Record<string, string> = {
    triaged: "new",
    scheduled: "working",
    in_progress: "working",
    active: "working",
    on_hold: "paused",
    cancelled: "completed",
    partial: "completed",
    redirected: "completed",
    handed_off: "completed",
  };
  return mapping[status] || status;
}

function StatusGroupedCards({
  requests,
  onTrapperAction,
  actionMenuId,
  onToggleMenu,
  showCompleted = false,
  onCardClick,
}: {
  requests: Request[];
  onTrapperAction?: (requestId: string, reason: string) => void;
  actionMenuId?: string | null;
  onToggleMenu?: (id: string | null) => void;
  showCompleted?: boolean;
  onCardClick?: (requestId: string) => void;
}) {
  const [completedExpanded, setCompletedExpanded] = useState(showCompleted);

  // Group requests by primary status
  const grouped = requests.reduce((acc, req) => {
    const primaryStatus = getPrimaryStatus(req.status);
    if (!acc[primaryStatus]) acc[primaryStatus] = [];
    acc[primaryStatus].push(req);
    return acc;
  }, {} as Record<string, Request[]>);

  // Active statuses (always show)
  const activeGroups = STATUS_GROUPS.filter(g => g.status !== "completed");
  // Completed group (collapsible)
  const completedGroup = STATUS_GROUPS.find(g => g.status === "completed")!;
  const completedRequests = grouped["completed"] || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Active status groups */}
      {activeGroups.map((group) => {
        const groupRequests = grouped[group.status] || [];
        if (groupRequests.length === 0) return null;

        return (
          <div key={group.status}>
            {/* Status header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginBottom: "0.75rem",
                padding: "0.5rem 0.75rem",
                background: group.bgColor,
                borderRadius: "8px",
                borderLeft: `4px solid ${group.color}`,
              }}
            >
              <span
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 600,
                  color: group.color,
                }}
              >
                {group.label}
              </span>
              <span
                style={{
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  padding: "0.15rem 0.5rem",
                  background: group.color,
                  color: "white",
                  borderRadius: "12px",
                }}
              >
                {groupRequests.length}
              </span>
              <span style={{ fontSize: "0.8rem", color: COLORS.gray500 }}>
                {group.description}
              </span>
            </div>

            {/* Cards grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(max(var(--card-min-width, 240px), calc((100% - 3rem) / 5)), 1fr))",
                gap: "1rem",
              }}
            >
              {groupRequests.map((req) => (
                <RequestCard
                  key={req.request_id}
                  request={req}
                  onTrapperAction={onTrapperAction}
                  actionMenuId={actionMenuId}
                  onToggleMenu={onToggleMenu}
                  onCardClick={onCardClick}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Completed section (collapsible) */}
      {completedRequests.length > 0 && (
        <div>
          <button
            onClick={() => setCompletedExpanded(!completedExpanded)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              width: "100%",
              padding: "0.5rem 0.75rem",
              background: completedExpanded ? completedGroup.bgColor : COLORS.gray50,
              borderRadius: "8px",
              borderLeft: `4px solid ${completedExpanded ? completedGroup.color : COLORS.gray300}`,
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: "1rem", color: COLORS.gray500 }}>
              {completedExpanded ? "▼" : "▶"}
            </span>
            <span
              style={{
                fontSize: "1.1rem",
                fontWeight: 600,
                color: completedExpanded ? completedGroup.color : COLORS.gray500,
              }}
            >
              {completedGroup.label}
            </span>
            <span
              style={{
                fontSize: "0.9rem",
                fontWeight: 600,
                padding: "0.15rem 0.5rem",
                background: completedExpanded ? completedGroup.color : COLORS.gray400,
                color: "white",
                borderRadius: "12px",
              }}
            >
              {completedRequests.length}
            </span>
            <span style={{ fontSize: "0.8rem", color: COLORS.gray500 }}>
              {completedExpanded ? completedGroup.description : "Click to expand"}
            </span>
          </button>

          {completedExpanded && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(max(var(--card-min-width, 240px), calc((100% - 3rem) / 5)), 1fr))",
                gap: "1rem",
                marginTop: "0.75rem",
              }}
            >
              {completedRequests.map((req) => (
                <RequestCard
                  key={req.request_id}
                  request={req}
                  onTrapperAction={onTrapperAction}
                  actionMenuId={actionMenuId}
                  onToggleMenu={onToggleMenu}
                  onCardClick={onCardClick}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state for when all groups are empty — filter mismatch */}
      {Object.values(grouped).every(g => g.length === 0) && (
        <EmptyFilteredResults />
      )}
    </div>
  );
}

const FILTER_DEFAULTS = {
  status: "",
  trapper: "",
  priority: "",
  kittens: "",
  q: "",
  sort: "status",
  view: "cards",
  showArchived: "false",
  selected: "",
};

function RequestsPageContent() {
  const { addToast } = useToast();
  const { filters, setFilter, setFilters, clearFilters, isDefault } = useUrlFilters(FILTER_DEFAULTS);
  const isMobile = useIsMobile();

  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(filters.q);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Refetch when user returns to this page (back button, tab switch)
  useEffect(() => {
    const handleFocus = () => setRefreshTrigger((n) => n + 1);
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState<string>("");

  // Confirm dialogs
  const [showBulkStatusConfirm, setShowBulkStatusConfirm] = useState(false);
  const [showKanbanCompleteConfirm, setShowKanbanCompleteConfirm] = useState(false);
  const kanbanCompleteResolveRef = useRef<((result: boolean) => void) | null>(null);

  // Request counts for segmented control (FFS-166)
  const { counts: requestCounts } = useRequestCounts();

  // Panel preview (table/cards views)
  const isKanban = filters.view === "kanban";

  // Kanban modal preview (opens modal instead of panel)
  const [kanbanPreviewId, setKanbanPreviewId] = useState<string | null>(null);

  // Quick trapper action from badge popover on request cards
  const handleQuickTrapperAction = async (requestId: string, reason: string) => {
    try {
      await postApi(`/api/requests/${requestId}`, { no_trapper_reason: reason }, { method: "PATCH" });
      setActionMenuId(null);
      setRefreshTrigger((n) => n + 1);
      // Log to journal as system entry
      postApi("/api/journal", {
        request_id: requestId,
        entry_kind: "system",
        tags: ["trapper_action"],
        body: reason === "client_trapping"
          ? "Marked as client trapping (trapper not needed)"
          : reason === "not_needed"
          ? "Marked as trapper not needed"
          : `Trapper status updated: ${reason}`,
      }).catch(() => { /* fire-and-forget: journal audit logging */ });
    } catch (err) {
      console.error("Failed to update trapper reason:", err);
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === requests.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(requests.map((r) => r.request_id)));
    }
  };

  const handleBulkStatusUpdate = () => {
    if (selectedIds.size === 0 || !bulkStatusTarget) return;
    setShowBulkStatusConfirm(true);
  };

  const handleBulkStatusUpdateConfirm = async () => {
    setShowBulkStatusConfirm(false);
    setBulkUpdating(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        postApi(`/api/requests/${id}`, { status: bulkStatusTarget }, { method: "PATCH" })
      );
      await Promise.all(promises);
      setSelectedIds(new Set());
      setBulkStatusTarget("");
      // Refresh the list
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.trapper) params.set("trapper", filters.trapper);
      if (filters.q) params.set("q", filters.q);
      const sc = SORT_MAP[filters.sort] || SORT_MAP.status;
      params.set("sort_by", sc.by);
      params.set("sort_order", sc.order);
      params.set("limit", "100");
      const data = await fetchApi<{ requests: Request[] }>(`/api/requests?${params.toString()}`);
      setRequests(data.requests || []);
    } catch (err) {
      addToast({ type: "error", message: "Error updating requests" });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleExportSelected = () => {
    const selectedRequests = requests.filter((r) => selectedIds.has(r.request_id));
    const csv = [
      ["ID", "Status", "Priority", "Summary", "Location", "City", "Requester", "Cats", "Created"],
      ...selectedRequests.map((r) => [
        r.request_id,
        r.status,
        r.priority,
        r.summary || "",
        r.place_name || "",
        r.place_city || "",
        r.requester_name || "",
        r.estimated_cat_count?.toString() || "",
        r.source_created_at || r.created_at,
      ]),
    ]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `requests-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Auto-select card view on mobile
  useEffect(() => {
    if (isMobile && filters.view === "table") {
      setFilter("view", "cards");
    }
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fetchRequests = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.status) params.set("status", filters.status);
        if (filters.trapper) params.set("trapper", filters.trapper);
        if (filters.priority) params.set("priority", filters.priority);
        if (filters.kittens === "true") params.set("kittens", "true");
        if (filters.q) params.set("q", filters.q);
        if (filters.showArchived === "true") params.set("include_archived", "true");
        const sortConfig = SORT_MAP[filters.sort] || SORT_MAP.status;
        params.set("sort_by", sortConfig.by);
        params.set("sort_order", sortConfig.order);
        params.set("limit", "100");

        const data = await fetchApi<{ requests: Request[] }>(`/api/requests?${params.toString()}`);
        setRequests(data.requests || []);
      } catch (err) {
        console.error("Failed to fetch requests:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchRequests();
  }, [filters.status, filters.trapper, filters.priority, filters.kittens, filters.q, filters.sort, filters.showArchived, refreshTrigger]);

  const handleRowClick = (requestId: string) => {
    if (isKanban) {
      setKanbanPreviewId(requestId);
    } else {
      setFilter("selected", filters.selected === requestId ? "" : requestId);
    }
  };

  const panelContent = filters.selected && !isKanban ? (
    <RequestDetailShell
      id={filters.selected}
      mode="panel"
      onClose={() => setFilter("selected", "")}
      onRequestUpdated={() => setRefreshTrigger((n) => n + 1)}
    />
  ) : null;

  return (
    <ListDetailLayout
      isDetailOpen={!!filters.selected && !isKanban}
      detailPanel={panelContent}
      onDetailClose={() => setFilter("selected", "")}
    >
      <PageHeader
        title="Requests"
        actions={
          <>
            <Button variant="primary" size="sm" onClick={() => window.location.href = "/intake/call-sheet"}>
              Enter Call Sheet
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.location.href = "/requests/print"}>
              Print TNR Call Sheet
            </Button>
            <Button variant="primary" size="sm" icon="plus" onClick={() => window.location.href = "/requests/new"}>
              New Request
            </Button>
          </>
        }
      />

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <StatCard
          label="Total"
          value={requestCounts.new + requestCounts.working + requestCounts.paused + requestCounts.completed}
        />
        <StatCard
          label="Needs Trapper"
          value={requestCounts.needs_trapper}
          accentColor={requestCounts.needs_trapper > 0 ? "var(--warning, #f59e0b)" : undefined}
        />
        <StatCard
          label="Urgent"
          value={requestCounts.urgent}
          accentColor={requestCounts.urgent > 0 ? "var(--danger, #dc2626)" : undefined}
          valueColor={requestCounts.urgent > 0 ? "var(--danger, #dc2626)" : undefined}
        />
      </div>

      {/* Row 1: Status Segmented Control (FFS-166) */}
      <StatusSegmentedControl
        counts={requestCounts}
        activeStatus={filters.status}
        onStatusChange={(status) => setFilter("status", status)}
      />

      {/* Row 2: Search + Filter Chips + Sort + View Toggle */}
      <FilterBar>
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          onDebouncedChange={(v) => setFilter("q", v)}
          placeholder="Search..."
          size="sm"
        />
        <FilterDivider />
        <FilterChip
          label="Trapper"
          options={[
            { value: "pending", label: "Needs Trapper" },
            { value: "mine", label: "My Assigned" },
          ]}
          value={filters.trapper}
          onChange={(v) => setFilter("trapper", v)}
        />
        <FilterChip
          label="Priority"
          options={[{ value: "urgent", label: "Urgent" }]}
          value={filters.priority}
          onChange={(v) => setFilter("priority", v)}
        />
        <FilterChip
          label="Kittens"
          options={[{ value: "true", label: "Has Kittens" }]}
          value={filters.kittens}
          onChange={(v) => setFilter("kittens", v)}
        />
        <FilterChip
          label="Archived"
          options={[{ value: "true", label: "Show Archived" }]}
          value={filters.showArchived}
          onChange={(v) => setFilter("showArchived", v)}
        />
        <FilterDivider />
        {/* Sort Dropdown */}
        <select
          value={filters.sort}
          onChange={(e) => setFilter("sort", e.target.value)}
          style={{
            padding: "0.3rem 0.5rem",
            fontSize: "0.75rem",
            borderRadius: "9999px",
            border: "1px solid var(--border, #e5e7eb)",
            background: "var(--card-bg, #fff)",
            color: "var(--text-primary, #111827)",
            cursor: "pointer",
          }}
        >
          <option value="status">By Status</option>
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="priority">By Priority</option>
        </select>
        {/* View Toggle */}
        <div style={{ display: "flex", gap: "2px", marginLeft: "auto", flexShrink: 0 }}>
          <button
            onClick={() => setFilter("view", "cards")}
            style={{
              padding: "0.3rem 0.6rem",
              fontSize: "0.75rem",
              border: "1px solid var(--card-border)",
              borderRadius: "16px 0 0 16px",
              background: filters.view === "cards" ? "var(--foreground)" : "transparent",
              color: filters.view === "cards" ? "var(--background)" : "inherit",
              cursor: "pointer",
            }}
          >
            Cards
          </button>
          <button
            onClick={() => setFilter("view", "kanban")}
            style={{
              padding: "0.3rem 0.6rem",
              fontSize: "0.75rem",
              border: "1px solid var(--card-border)",
              borderLeft: "none",
              background: filters.view === "kanban" ? "var(--foreground)" : "transparent",
              color: filters.view === "kanban" ? "var(--background)" : "inherit",
              cursor: "pointer",
            }}
          >
            Kanban
          </button>
          <button
            onClick={() => setFilter("view", "table")}
            style={{
              padding: "0.3rem 0.6rem",
              fontSize: "0.75rem",
              border: "1px solid var(--card-border)",
              borderLeft: "none",
              borderRadius: "0 16px 16px 0",
              background: filters.view === "table" ? "var(--foreground)" : "transparent",
              color: filters.view === "table" ? "var(--background)" : "inherit",
              cursor: "pointer",
            }}
          >
            Table
          </button>
        </div>
      </FilterBar>

      <ActiveFilterTags
        filters={filters}
        defaults={FILTER_DEFAULTS}
        labels={{
          status: "Status",
          trapper: "Trapper",
          priority: "Priority",
          kittens: "Kittens",
        }}
        exclude={["q", "sort", "view", "selected", "showArchived"]}
        onRemove={(key) => setFilter(key as keyof typeof FILTER_DEFAULTS, FILTER_DEFAULTS[key as keyof typeof FILTER_DEFAULTS])}
        onClearAll={clearFilters}
      />

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: COLORS.primaryLight,
            borderRadius: "8px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontWeight: 500, color: COLORS.primaryDark }}>
            {selectedIds.size} request{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={bulkStatusTarget}
              onChange={(e) => setBulkStatusTarget(e.target.value)}
              style={{ minWidth: "140px", padding: "0.4rem 0.5rem", fontSize: "0.875rem" }}
            >
              <option value="">Change status to...</option>
              {/* Primary statuses (MIG_2530 simplified system) */}
              <option value="new">New</option>
              <option value="working">Working</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
            <button
              onClick={handleBulkStatusUpdate}
              disabled={!bulkStatusTarget || bulkUpdating}
              style={{
                padding: "0.4rem 0.75rem",
                border: "none",
                borderRadius: "6px",
                background: bulkStatusTarget ? COLORS.primaryHover : COLORS.gray400,
                color: "white",
                cursor: bulkStatusTarget && !bulkUpdating ? "pointer" : "not-allowed",
                fontSize: "0.875rem",
              }}
            >
              {bulkUpdating ? "Updating..." : "Apply"}
            </button>
            <button
              onClick={handleExportSelected}
              style={{
                padding: "0.4rem 0.75rem",
                border: `1px solid ${COLORS.primaryHover}`,
                borderRadius: "6px",
                background: "transparent",
                color: COLORS.primaryHover,
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Export CSV
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{
                padding: "0.4rem 0.75rem",
                border: `1px solid ${COLORS.gray500}`,
                borderRadius: "6px",
                background: "transparent",
                color: COLORS.gray500,
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Request list */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: SPACING.lg, marginTop: SPACING.lg }}>
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="card" style={{ padding: SPACING.md, borderRadius: BORDERS.radius.xl }}>
              <div style={{ ...SKELETON_BLOCK, height: '140px', marginBottom: SPACING.sm }} />
              <div style={{ ...SKELETON_LINE, width: '60%', marginBottom: SPACING.sm }} />
              <div style={{ ...SKELETON_LINE, width: '80%', marginBottom: SPACING.xs }} />
              <div style={{ ...SKELETON_LINE, width: '40%' }} />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No requests yet"
          description="Get started by creating your first trapping request — someone in the community needs help."
          action={{
            label: "+ Create your first request",
            onClick: () => { window.location.href = "/requests/new"; },
          }}
          size="lg"
        />
      ) : filters.view === "cards" ? (
        <StatusGroupedCards
          requests={requests}
          onTrapperAction={handleQuickTrapperAction}
          actionMenuId={actionMenuId}
          onToggleMenu={setActionMenuId}
          showCompleted={filters.status === "completed"}
          onCardClick={handleRowClick}
        />
      ) : filters.view === "kanban" ? (
        isMobile ? (
          <KanbanBoardMobile
            requests={requests}
            onStatusChange={async (requestId, newStatus) => {
              await postApi(`/api/requests/${requestId}`, { status: newStatus }, { method: "PATCH" });
              setRequests((prev) =>
                prev.map((r) =>
                  r.request_id === requestId ? { ...r, status: newStatus } : r
                )
              );
            }}
          />
        ) : (
          <KanbanBoard
            requests={requests}
            onBeforeDrop={(_itemId, _from, toStatus) => {
              if (toStatus === "completed") {
                return new Promise<boolean>((resolve) => {
                  kanbanCompleteResolveRef.current = resolve;
                  setShowKanbanCompleteConfirm(true);
                });
              }
              return true;
            }}
            onStatusChange={async (requestId, newStatus) => {
              await postApi(`/api/requests/${requestId}`, { status: newStatus }, { method: "PATCH" });
              // Targeted state update — don't refetch (destroys optimistic state)
              setRequests((prev) =>
                prev.map((r) =>
                  r.request_id === requestId ? { ...r, status: newStatus } : r
                )
              );
            }}
          />
        )
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: "40px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === requests.length && requests.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Type</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Location</th>
                <th>Title</th>
                <th>Cats</th>
                <th>Trapper</th>
                <th>Requester</th>
                <th>Flags</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req) => (
                <tr
                  key={req.request_id}
                  style={{
                    background: filters.selected === req.request_id ? "var(--section-bg, #f9fafb)" : selectedIds.has(req.request_id) ? COLORS.primaryLight : undefined,
                    cursor: "pointer",
                  }}
                  onClick={() => handleRowClick(req.request_id)}
                >
                  <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(req.request_id)}
                      onChange={() => toggleSelect(req.request_id)}
                    />
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: req.is_legacy_request ? COLORS.gray500 : COLORS.successDark,
                        color: COLORS.white,
                        fontSize: "0.7rem",
                      }}
                    >
                      {req.is_legacy_request ? "Legacy" : "Native"}
                    </span>
                  </td>
                  <td>
                    <a href={`/requests/${req.request_id}`} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      <StatusBadge status={req.status} />
                      {req.resolution_outcome ? (() => {
                        const oc = getOutcomeColor(req.resolution_outcome!);
                        return (
                          <span className="badge" style={{ background: oc.bg, color: oc.color, border: `1px solid ${oc.border}`, fontSize: "0.7rem" }}>
                            {getOutcomeLabel(req.resolution_outcome!)}
                          </span>
                        );
                      })() : (
                        req.is_legacy_request && ["completed", "cancelled", "partial"].includes(req.status) && (
                          <span className="badge" style={{ background: "var(--bg-secondary)", color: "#6b7280", border: "1px solid var(--border-light)", fontSize: "0.7rem" }}>
                            Legacy
                          </span>
                        )
                      )}
                    </a>
                  </td>
                  <td>
                    <PriorityBadge priority={req.priority} />
                  </td>
                  <td>
                    {req.place_name ? (
                      <div>
                        <div style={{ fontWeight: 500 }}>{req.place_name}</div>
                        {req.place_city && (
                          <div className="text-muted text-sm">{req.place_city}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted">No location</span>
                    )}
                  </td>
                  <td>
                    <a href={`/requests/${req.request_id}`}>
                      {req.summary || <span className="text-muted">No summary</span>}
                    </a>
                  </td>
                  <td className="text-sm">
                    {req.estimated_cat_count ?? "?"}
                    {req.has_kittens && (
                      <span style={{ marginLeft: "0.25rem", color: COLORS.warning }}>+kittens</span>
                    )}
                  </td>
                  <td className="text-sm">
                    {req.primary_trapper_name ? (
                      <div>
                        <span>{req.primary_trapper_name}</span>
                        {req.active_trapper_count > 1 && (
                          <span className="text-muted"> +{req.active_trapper_count - 1}</span>
                        )}
                      </div>
                    ) : req.no_trapper_reason === "client_trapping" ? (
                      <span style={{ color: COLORS.successDark, fontSize: "0.75rem" }}>Client</span>
                    ) : (
                      <span className="text-muted">--</span>
                    )}
                  </td>
                  <td>
                    {req.requester_name ? (
                      <span>{req.requester_name}</span>
                    ) : (
                      <span className="text-muted">Unknown</span>
                    )}
                  </td>
                  <td>
                    <DataQualityFlags
                      flags={req.data_quality_flags}
                      requestId={req.request_id}
                      onTrapperAction={handleQuickTrapperAction}
                      actionMenuOpen={actionMenuId === req.request_id}
                      onToggleMenu={setActionMenuId}
                    />
                  </td>
                  <td className="text-sm text-muted">
                    {formatDateLocal(req.source_created_at || req.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Click outside to close trapper action menu */}
      {actionMenuId && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 49 }}
          onClick={() => setActionMenuId(null)}
        />
      )}

      {/* Kanban view: modal preview instead of split panel */}
      <EntityPreviewModal
        isOpen={!!kanbanPreviewId}
        onClose={() => setKanbanPreviewId(null)}
        entityType="request"
        entityId={kanbanPreviewId}
      />

      {/* Confirm: bulk status update */}
      <ConfirmDialog
        open={showBulkStatusConfirm}
        title="Update Request Status"
        message={`Update ${selectedIds.size} requests to "${bulkStatusTarget.replace(/_/g, " ")}"?`}
        confirmLabel="Update"
        onConfirm={handleBulkStatusUpdateConfirm}
        onCancel={() => setShowBulkStatusConfirm(false)}
      />

      {/* Confirm: kanban drop to completed */}
      <ConfirmDialog
        open={showKanbanCompleteConfirm}
        title="Mark as Completed"
        message="Mark this request as completed? This is a terminal status."
        confirmLabel="Mark Completed"
        variant="danger"
        onConfirm={() => {
          setShowKanbanCompleteConfirm(false);
          kanbanCompleteResolveRef.current?.(true);
          kanbanCompleteResolveRef.current = null;
        }}
        onCancel={() => {
          setShowKanbanCompleteConfirm(false);
          kanbanCompleteResolveRef.current?.(false);
          kanbanCompleteResolveRef.current = null;
        }}
      />
    </ListDetailLayout>
  );
}

function RequestsLoadingSkeleton() {
  return (
    <div style={{ padding: "1rem 0" }}>
      <SkeletonStats count={4} />
      <div style={{ marginTop: "1.5rem" }}>
        <SkeletonList items={8} showAvatar={false} />
      </div>
    </div>
  );
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<RequestsLoadingSkeleton />}>
      <RequestsPageContent />
    </Suspense>
  );
}
