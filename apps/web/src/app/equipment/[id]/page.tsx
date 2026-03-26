"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { fetchApi, postApi } from "@/lib/api-client";
import { useToast } from "@/components/feedback/Toast";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { useNavigationContext } from "@/hooks/useNavigationContext";
import { TabBar } from "@/components/ui/TabBar";
import { StatCard } from "@/components/ui/StatCard";
import { getLabel } from "@/lib/form-options";
import { EQUIPMENT_CUSTODY_STATUS_OPTIONS, EQUIPMENT_CONDITION_OPTIONS, EQUIPMENT_EVENT_TYPE_OPTIONS, EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS } from "@/lib/form-options";
import type { VEquipmentInventoryRow, EquipmentEventRow } from "@/lib/types/view-contracts";
import { getCustodyStyle, getEventStyle } from "@/lib/equipment-styles";

export default function EquipmentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { success, error: showError } = useToast();
  const { breadcrumbs } = useNavigationContext("Equipment");

  const [equipment, setEquipment] = useState<(VEquipmentInventoryRow & { recent_events?: EquipmentEventRow[] }) | null>(null);
  const [events, setEvents] = useState<EquipmentEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const fetchDetail = useCallback(async () => {
    try {
      const data = await fetchApi<VEquipmentInventoryRow & { recent_events?: EquipmentEventRow[] }>(
        `/api/equipment/${id}`
      );
      setEquipment(data);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to load equipment");
    } finally {
      setLoading(false);
    }
  }, [id, showError]);

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const data = await fetchApi<{ events: EquipmentEventRow[] }>(
        `/api/equipment/${id}/events?limit=100`
      );
      setEvents(data.events || []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    if (activeTab === "history") {
      fetchEvents();
    }
  }, [activeTab, fetchEvents]);

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </div>
    );
  }

  if (!equipment) {
    return (
      <div style={{ padding: "2rem" }}>
        <Breadcrumbs items={breadcrumbs} />
        <h1 style={{ fontSize: "1.25rem", marginTop: "1rem" }}>Equipment Not Found</h1>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "900px" }}>
      <Breadcrumbs items={[{ label: "Equipment", href: "/equipment" }, { label: equipment.display_name }]} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: "1rem", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
            {equipment.display_name}
          </h1>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            {equipment.type_display_name || equipment.legacy_type}
            {equipment.barcode && (
              <span style={{ marginLeft: "0.5rem", fontFamily: "monospace" }}>#{equipment.barcode}</span>
            )}
          </div>
        </div>
        <span style={{
          padding: "0.25rem 0.75rem",
          borderRadius: "20px",
          fontSize: "0.8rem",
          fontWeight: 600,
          background: getCustodyStyle(equipment.custody_status).bg,
          color: getCustodyStyle(equipment.custody_status).text,
        }}>
          {getLabel(EQUIPMENT_CUSTODY_STATUS_OPTIONS, equipment.custody_status)}
        </span>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <StatCard label="Condition" value={getLabel(EQUIPMENT_CONDITION_OPTIONS, equipment.condition_status)} />
        <StatCard label="Total Checkouts" value={equipment.total_checkouts} />
        {equipment.days_checked_out != null && (
          <StatCard label="Days Out" value={equipment.days_checked_out} valueColor={equipment.days_checked_out > 14 ? "var(--danger-text)" : undefined} />
        )}
        {equipment.custodian_name && (
          <StatCard label="Custodian" value={equipment.custodian_name} />
        )}
        {equipment.functional_status === "needs_repair" && (
          <StatCard label="Functional" value="Needs Repair" valueColor="var(--danger-text)" />
        )}
      </div>

      <TabBar
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "history", label: "Event History", count: equipment.recent_events?.length },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div style={{ marginTop: "1rem" }}>
        {activeTab === "overview" && (
          <div className="card" style={{ padding: "1rem" }}>
            {/* Photo display */}
            {equipment.photo_url && (
              <div style={{ marginBottom: "1.25rem", textAlign: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={equipment.photo_url}
                  alt={equipment.display_name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "300px",
                    borderRadius: "8px",
                    objectFit: "contain",
                    background: "var(--muted-bg)",
                  }}
                />
              </div>
            )}

            <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.75rem" }}>Equipment Details</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.85rem" }}>
              <DetailRow label="Type" value={equipment.type_display_name || equipment.legacy_type} />
              <DetailRow label="Category" value={equipment.type_category || "—"} />
              <DetailRow label="Barcode" value={equipment.barcode || "—"} mono />
              <DetailRow label="Serial Number" value={equipment.serial_number || "—"} />
              <DetailRow label="Manufacturer" value={equipment.manufacturer || "—"} />
              <DetailRow label="Model" value={equipment.model || "—"} />
              {equipment.item_type && <DetailRow label="Item Type" value={equipment.item_type} />}
              {equipment.size && <DetailRow label="Size" value={equipment.size} />}
              {equipment.functional_status && (
                <DetailRow
                  label="Functional Status"
                  value={getLabel(EQUIPMENT_FUNCTIONAL_STATUS_OPTIONS, equipment.functional_status)}
                />
              )}
              <DetailRow label="Source" value={equipment.source_system} />
              <DetailRow label="Created" value={new Date(equipment.created_at).toLocaleDateString()} />
            </div>

            {/* Barcode image */}
            {equipment.barcode_image_url && (
              <>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginTop: "1.25rem", marginBottom: "0.75rem" }}>Barcode Label</h3>
                <div style={{ textAlign: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={equipment.barcode_image_url}
                    alt={`Barcode for ${equipment.barcode || equipment.display_name}`}
                    style={{
                      maxWidth: "200px",
                      borderRadius: "4px",
                      border: "1px solid var(--border)",
                    }}
                  />
                </div>
              </>
            )}

            {(equipment.custodian_name || equipment.current_holder_name) && (
              <>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginTop: "1.25rem", marginBottom: "0.75rem" }}>Current Custody</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.85rem" }}>
                  <DetailRow label="Custodian" value={equipment.custodian_name || equipment.current_holder_name || "—"} />
                  <DetailRow label="Location" value={equipment.current_place_address || "—"} />
                  <DetailRow label="Due Date" value={
                    (equipment.current_due_date || equipment.expected_return_date)
                      ? new Date(equipment.current_due_date || equipment.expected_return_date!).toLocaleDateString()
                      : "—"
                  } />
                </div>
              </>
            )}

            {equipment.notes && (
              <>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginTop: "1.25rem", marginBottom: "0.5rem" }}>Notes</h3>
                <div style={{ fontSize: "0.85rem", padding: "0.5rem", background: "var(--muted-bg)", borderRadius: "6px", whiteSpace: "pre-wrap" }}>
                  {equipment.notes}
                </div>
              </>
            )}

            {/* Recent Events */}
            {equipment.recent_events && equipment.recent_events.length > 0 && (
              <>
                <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginTop: "1.25rem", marginBottom: "0.75rem" }}>Recent Activity</h3>
                <EventList events={equipment.recent_events} />
              </>
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div className="card" style={{ padding: "1rem" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.75rem" }}>
              Full Event History ({events.length})
            </h3>
            {eventsLoading ? (
              <p style={{ color: "var(--muted)" }}>Loading events...</p>
            ) : events.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No events recorded.</p>
            ) : (
              <EventList events={events} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", marginBottom: "0.125rem" }}>{label}</div>
      <div style={{ fontFamily: mono ? "monospace" : undefined }}>{value}</div>
    </div>
  );
}

function EventList({ events }: { events: EquipmentEventRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {events.map((ev) => {
        const evStyle = getEventStyle(ev.event_type);
        return (
        <div
          key={ev.event_id}
          style={{
            padding: "0.5rem 0.75rem",
            borderRadius: "6px",
            borderLeft: `3px solid ${evStyle.border}`,
            background: "var(--muted-bg)",
            fontSize: "0.8rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, color: evStyle.text }}>
              {getLabel(EQUIPMENT_EVENT_TYPE_OPTIONS, ev.event_type)}
            </span>
            <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
              {new Date(ev.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          {ev.custodian_name && (
            <div style={{ marginTop: "0.125rem" }}>
              {ev.event_type === "check_out" ? "To: " : ev.event_type === "check_in" ? "From: " : ""}
              <span style={{ fontWeight: 500 }}>{ev.custodian_name}</span>
            </div>
          )}
          {ev.place_address && (
            <div style={{ color: "var(--muted)" }}>{ev.place_address}</div>
          )}
          {(ev.condition_before || ev.condition_after) && (
            <div style={{ color: "var(--muted)" }}>
              Condition: {ev.condition_before || "?"} → {ev.condition_after || "?"}
            </div>
          )}
          {ev.notes && (
            <div style={{ color: "var(--muted)", marginTop: "0.125rem" }}>{ev.notes}</div>
          )}
          {ev.source_system !== "atlas_ui" && (
            <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "0.125rem" }}>
              Source: {ev.source_system}
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}
