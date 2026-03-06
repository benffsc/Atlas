"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useIsMobile } from "@/hooks/useIsMobile";
import { fetchApi } from "@/lib/api-client";
import { KpiStrip, ActionPanel } from "@/components/dashboard";
import type { DashboardMapPin } from "@/components/dashboard";
import { EntityPreviewModal } from "@/components/search/EntityPreviewModal";

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

export default function Home() {
  const isMobile = useIsMobile();
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [requests, setRequests] = useState<ActiveRequest[]>([]);
  const [intake, setIntake] = useState<IntakeSubmission[]>([]);
  const [mapPins, setMapPins] = useState<DashboardMapPin[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loadingIntake, setLoadingIntake] = useState(true);
  const [loadingMap, setLoadingMap] = useState(true);
  const [showMyRequests, setShowMyRequests] = useState(true);

  // Entity preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEntityId, setPreviewEntityId] = useState<string | null>(null);

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

    // Map pins (parallel, no auth dependency)
    fetchApi<{ pins: DashboardMapPin[] }>("/api/dashboard/map-pins")
      .then(data => setMapPins(data.pins || []))
      .catch(() => setMapPins([]))
      .finally(() => setLoadingMap(false));

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

  const handleRequestClick = (requestId: string) => {
    setPreviewEntityId(requestId);
    setPreviewOpen(true);
  };

  return (
    <div className="dashboard-command-center">
      {/* Header */}
      <div className="dashboard-greeting">
        <div>
          <h1>
            {staff
              ? `${getGreeting()}, ${getFirstName(staff.display_name)}`
              : "Dashboard"}
          </h1>
          <div className="date-line">{today}</div>
        </div>
        <a href="/requests/new" className="btn btn-primary" style={{ whiteSpace: "nowrap" }}>
          + New Request
        </a>
      </div>

      {/* KPI Cards */}
      <KpiStrip stats={stats} />

      {/* Split Layout: Action Panel + Map */}
      <div className="dashboard-split">
        <ActionPanel
          stats={stats}
          requests={requests}
          intake={intake}
          loadingRequests={loadingRequests}
          loadingIntake={loadingIntake}
          isAdmin={staff?.auth_role === "admin"}
          staffPersonId={staff?.person_id ?? null}
          showMyRequests={showMyRequests}
          onToggleMyRequests={() => setShowMyRequests(!showMyRequests)}
          onRequestClick={handleRequestClick}
        />

        {!isMobile ? (
          <DashboardMap
            pins={mapPins}
            onPinClick={handleRequestClick}
            loading={loadingMap}
          />
        ) : (
          <div className="dashboard-map-container">
            <DashboardMap
              pins={mapPins}
              onPinClick={handleRequestClick}
              loading={loadingMap}
            />
          </div>
        )}
      </div>

      {/* Entity Preview Modal */}
      <EntityPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        entityType="request"
        entityId={previewEntityId}
      />
    </div>
  );
}
