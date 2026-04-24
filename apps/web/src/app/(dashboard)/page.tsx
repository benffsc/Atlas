"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useMapData } from "@/hooks/useMapData";
import { fetchApi } from "@/lib/api-client";
import { KpiStrip, ActionPanel, DASHBOARD_LAYER_GROUPS, getDefaultEnabledLayers } from "@/components/dashboard";
import { ImpactSummary } from "@/components/dashboard/ImpactSummary";
import { YearlyImpactChart } from "@/components/dashboard/YearlyImpactChart";
import { InsightsFeed } from "@/components/dashboard/InsightsFeed";
import { LiveCounter } from "@/components/dashboard/LiveCounter";
import { usePermission } from "@/hooks/usePermission";
import type { DashboardMapPin, MapLayer } from "@/components/dashboard";
import { EntityPreviewModal } from "@/components/search/EntityPreviewModal";
import type { EntityType } from "@/hooks/useEntityDetail";

const DashboardMap = dynamic(
  () => import("@/components/dashboard/DashboardMap").then(m => ({ default: m.DashboardMap })),
  { ssr: false, loading: () => <div className="dashboard-map-skeleton"><span>Loading map...</span></div> }
);

interface ActiveRequest {
  request_id: string;
  status: string;
  priority: string;
  summary: string | null;
  place_name: string | null;
  place_address: string | null;
  place_city: string | null;
  requester_name: string | null;
  created_at: string;
  scheduled_date: string | null;
  estimated_cat_count: number | null;
  has_kittens: boolean;
  latitude: number | null;
  longitude: number | null;
  updated_at?: string;
}

interface IntakeSubmission {
  submission_id: string;
  submitted_at: string;
  submitter_name: string;
  email: string;
  phone: string | null;
  cats_address: string;
  cats_city: string | null;
  geo_formatted_address: string | null;
  submission_status: string | null;
  appointment_date: string | null;
  priority_override: string | null;
  triage_category: string | null;
  triage_score: number | null;
  cat_count_estimate: number | null;
  has_kittens: boolean | null;
  is_legacy: boolean;
  is_emergency: boolean;
  overdue: boolean;
  contact_attempt_count: number | null;
}

interface DashboardStats {
  active_requests: number;
  pending_intake: number;
  cats_this_month: number;
  cats_last_month: number;
  stale_requests: number;
  overdue_intake: number;
  unassigned_requests: number;
  needs_attention_total: number;
  requests_with_location: number;
  my_active_requests: number;
  person_dedup_pending: number;
  place_dedup_pending: number;
}

interface StaffInfo {
  staff_id: string;
  display_name: string;
  email: string;
  auth_role: string;
  person_id: string | null;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFirstName(displayName: string): string {
  return displayName.split(" ")[0] || displayName;
}

/** Map layer ID to the API layer parameter */
function layerToApiParam(enabledLayers: Record<string, boolean>): MapLayer | null {
  if (enabledLayers.requests_active) return "active";
  if (enabledLayers.requests_all) return "all";
  if (enabledLayers.requests_completed) return "completed";
  return null;
}

/** Parse layers param (comma-separated) into enabledLayers record */
function parseLayersParam(param: string | null): Record<string, boolean> | null {
  if (!param) return null;
  const ids = param.split(",").filter(Boolean);
  if (ids.length === 0) return null;
  // All known layer IDs from DASHBOARD_LAYER_GROUPS
  const knownIds = new Set(DASHBOARD_LAYER_GROUPS.flatMap(g => g.children.map(c => c.id)));
  const valid = ids.filter(id => knownIds.has(id));
  if (valid.length === 0) return null;
  const result: Record<string, boolean> = {};
  for (const id of Array.from(knownIds)) result[id] = false;
  for (const id of valid) result[id] = true;
  return result;
}

/** Serialize enabledLayers to comma-separated string, omitting if matches defaults */
function serializeLayers(enabledLayers: Record<string, boolean>): string | null {
  const defaults = getDefaultEnabledLayers();
  const currentKeys = Object.keys(enabledLayers).filter(k => enabledLayers[k]).sort();
  const defaultKeys = Object.keys(defaults).filter(k => defaults[k]).sort();
  if (currentKeys.join(",") === defaultKeys.join(",")) return null; // matches default, remove from URL
  if (currentKeys.length === 0) return "none";
  return currentKeys.join(",");
}

export default function Home() {
  return (
    <Suspense fallback={<div className="dashboard-command-center"><div className="dashboard-greeting"><h1>Dashboard</h1></div></div>}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const isMobile = useIsMobile();
  const isAdmin = usePermission("admin.access");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [requests, setRequests] = useState<ActiveRequest[]>([]);
  const [intake, setIntake] = useState<IntakeSubmission[]>([]);
  const [requestPins, setRequestPins] = useState<DashboardMapPin[]>([]);
  const [intakePins, setIntakePins] = useState<DashboardMapPin[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loadingIntake, setLoadingIntake] = useState(true);
  const [loadingMap, setLoadingMap] = useState(true);
  const [showMyRequests, setShowMyRequests] = useState(true);
  const [mapSearch, setMapSearch] = useState("");

  // Layer state — initialized from URL params, falls back to defaults
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>(() => {
    const fromUrl = parseLayersParam(searchParams.get("layers"));
    if (fromUrl) return fromUrl;
    if (searchParams.get("layers") === "none") {
      const all: Record<string, boolean> = {};
      for (const g of DASHBOARD_LAYER_GROUPS) for (const c of g.children) all[c.id] = false;
      return all;
    }
    return getDefaultEnabledLayers();
  });

  // Entity preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEntityType, setPreviewEntityType] = useState<EntityType | null>(null);
  const [previewEntityId, setPreviewEntityId] = useState<string | null>(null);

  // Sync layer state to URL params (shallow, no page reload)
  useEffect(() => {
    const serialized = serializeLayers(enabledLayers);
    const params = new URLSearchParams(searchParams.toString());
    if (serialized) {
      params.set("layers", serialized);
    } else {
      params.delete("layers");
    }
    const newUrl = params.toString() ? `${pathname}?${params}` : pathname;
    const currentUrl = searchParams.toString() ? `${pathname}?${searchParams}` : pathname;
    if (newUrl !== currentUrl) {
      router.replace(newUrl, { scroll: false });
    }
  }, [enabledLayers, pathname, router, searchParams]);

  // Determine if any atlas layer is enabled
  const atlasEnabled = enabledLayers.atlas_all || enabledLayers.atlas_disease || enabledLayers.atlas_watch;

  // County filter: "all" when Out of County toggle is on, "sonoma" otherwise
  const county = enabledLayers.out_of_county ? "all" : "sonoma";

  // Fetch atlas pins via useMapData (SWR cached, shared with full map)
  const { data: mapData } = useMapData({
    layers: ["atlas_pins"],
    enabled: atlasEnabled,
    county,
  });

  const atlasPins = useMemo(() => mapData?.atlas_pins || [], [mapData]);

  // Handle exclusive layer toggling (requests group is exclusive/radio)
  const handleToggleLayer = useCallback((layerId: string) => {
    setEnabledLayers(prev => {
      const next = { ...prev };

      // Find which group this layer belongs to
      const group = DASHBOARD_LAYER_GROUPS.find(g =>
        g.children.some(c => c.id === layerId)
      );

      if (group?.exclusive) {
        // Radio behavior: turn off siblings, toggle this one
        const wasOn = !!prev[layerId];
        for (const child of group.children) {
          next[child.id] = false;
        }
        // Only turn on if it wasn't already on (allow deselecting all)
        if (!wasOn) next[layerId] = true;
      } else {
        // Checkbox behavior
        next[layerId] = !prev[layerId];
      }

      return next;
    });
  }, []);

  // Fetch request pins when request layer changes
  const fetchRequestPins = useCallback((search: string) => {
    const apiLayer = layerToApiParam(enabledLayers);
    if (!apiLayer) {
      setRequestPins([]);
      return;
    }

    setLoadingMap(true);
    const params = new URLSearchParams({ layer: apiLayer, county });
    if (search) params.set("q", search);
    fetchApi<{ pins: DashboardMapPin[] }>(`/api/dashboard/map-pins?${params}`)
      .then(data => setRequestPins(data.pins || []))
      .catch(() => setRequestPins([]))
      .finally(() => setLoadingMap(false));
  }, [enabledLayers, county]);

  // Fetch intake pins when intake layer is enabled
  const fetchIntakePins = useCallback((search: string) => {
    if (!enabledLayers.intake_pending) {
      setIntakePins([]);
      return;
    }

    const params = new URLSearchParams({ layer: "intake", county });
    if (search) params.set("q", search);
    fetchApi<{ pins: DashboardMapPin[] }>(`/api/dashboard/map-pins?${params}`)
      .then(data => setIntakePins(data.pins || []))
      .catch(() => setIntakePins([]));
  }, [enabledLayers, county]);

  // Re-fetch pins when layers change
  useEffect(() => {
    fetchRequestPins(mapSearch);
  }, [fetchRequestPins, mapSearch]);

  useEffect(() => {
    fetchIntakePins(mapSearch);
  }, [fetchIntakePins, mapSearch]);

  // Fetch auth first, then dependent fetches
  useEffect(() => {
    let staffData: StaffInfo | null = null;

    fetchApi<{ authenticated: boolean; staff?: StaffInfo }>("/api/auth/me")
      .then(data => {
        if (data?.authenticated && data.staff) {
          staffData = data.staff;
          setStaff(data.staff);
        }
      })
      .catch(() => {})
      .finally(() => {
        // Active requests
        fetchApi<{ requests: ActiveRequest[] }>("/api/requests?limit=8")
          .then(data => {
            const active = (data.requests || []).filter(
              (r: ActiveRequest) => !["completed", "cancelled"].includes(r.status)
            );
            setRequests(active.slice(0, 6));
          })
          .catch(() => setRequests([]))
          .finally(() => setLoadingRequests(false));

        // Dashboard stats
        const statsUrl = staffData?.person_id
          ? `/api/dashboard/stats?staff_person_id=${staffData.person_id}`
          : "/api/dashboard/stats";
        fetchApi<DashboardStats>(statsUrl)
          .then(data => { if (data) setStats(data); })
          .catch(() => {});
      });

    // Recent intake (parallel, no auth dependency)
    fetchApi<{ submissions: IntakeSubmission[] }>("/api/intake/queue?mode=attention&limit=5")
      .then(data => setIntake((data.submissions || []).slice(0, 5)))
      .catch(() => setIntake([]))
      .finally(() => setLoadingIntake(false));
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const handlePinClick = (entityType: "request" | "place", entityId: string) => {
    setPreviewEntityType(entityType);
    setPreviewEntityId(entityId);
    setPreviewOpen(true);
  };

  // Also support legacy request click from action panel
  const handleRequestClick = (requestId: string) => {
    handlePinClick("request", requestId);
  };

  const handleMapSearch = (query: string) => {
    setMapSearch(query);
  };

  // Layer counts for the control badges
  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (requestPins.length > 0) {
      const activeLayer = layerToApiParam(enabledLayers);
      if (activeLayer) counts[`requests_${activeLayer}`] = requestPins.length;
    }
    if (intakePins.length > 0) counts.intake_pending = intakePins.length;
    if (atlasPins.length > 0) counts.atlas_all = atlasPins.length;
    return counts;
  }, [requestPins, intakePins, atlasPins, enabledLayers]);

  return (
    <div className="dashboard-command-center dashboard-scroll-layout">
      {/* ── Hero viewport — fills initial screen, scrolls away ── */}
      <section className="dashboard-hero">
        <div className="dashboard-hero__bg" />
        <div className="dashboard-hero__content">
          <div className="dashboard-hero__greeting">
            <h1>
              {staff
                ? `${getGreeting()}, ${getFirstName(staff.display_name)}`
                : "Beacon"}
            </h1>
            <p className="dashboard-tagline">A guiding light for humane cat population management</p>
            <LiveCounter />
            <div className="date-line">{today}</div>
          </div>

          {/* KPI cards overlaid on hero */}
          <div className="dashboard-hero__kpis">
            <KpiStrip stats={stats} />
          </div>
        </div>

        {/* Scroll hint */}
        <div className="dashboard-hero__scroll-hint" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </section>

      {/* ── Operational content — revealed on scroll ── */}
      <section className="dashboard-ops">
        {/* Impact section */}
        <InsightsFeed stats={stats} />
        <YearlyImpactChart />

        {/* Greeting + action cards (image 2 layout) */}
        <div className="dashboard-ops__greeting">
          <h2>
            {staff
              ? `${getGreeting()}, ${getFirstName(staff.display_name)}`
              : "Dashboard"}
          </h2>
          <div className="date-line">{today}</div>
        </div>

        {/* Action cards row */}
        <div className="dashboard-action-cards">
          <ActionPanel
            stats={stats}
            requests={requests}
            intake={intake}
            loadingRequests={loadingRequests}
            loadingIntake={loadingIntake}
            isAdmin={isAdmin}
            staffPersonId={staff?.person_id ?? null}
            showMyRequests={showMyRequests}
            onToggleMyRequests={() => setShowMyRequests(!showMyRequests)}
            onRequestClick={handleRequestClick}
          />
        </div>

        {/* Map section */}
        <div className="dashboard-split">
          {!isMobile ? (
            <DashboardMap
              requestPins={requestPins}
              intakePins={intakePins}
              atlasPins={atlasPins}
              enabledLayers={enabledLayers}
              onToggleLayer={handleToggleLayer}
              onPinClick={handlePinClick}
              onSearch={handleMapSearch}
              loading={loadingMap}
              layerCounts={layerCounts}
            />
          ) : (
            <div className="dashboard-map-container">
              <DashboardMap
                requestPins={requestPins}
                intakePins={intakePins}
                atlasPins={atlasPins}
                enabledLayers={enabledLayers}
                onToggleLayer={handleToggleLayer}
                onPinClick={handlePinClick}
                onSearch={handleMapSearch}
                loading={loadingMap}
                layerCounts={layerCounts}
              />
            </div>
          )}
        </div>
      </section>

      {/* Entity Preview Modal */}
      <EntityPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        entityType={previewEntityType}
        entityId={previewEntityId}
      />
    </div>
  );
}
