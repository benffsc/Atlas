"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { useNavigationContext } from "@/hooks/useNavigationContext";
import { SkeletonStats, SkeletonList } from "@/components/feedback/Skeleton";
import { ErrorState } from "@/components/feedback/EmptyState";
import { StatusBadge } from "@/components/badges";
import { Icon } from "@/components/ui/Icon";
import { TabBar, TabPanel } from "@/components/ui";
import { fetchApi } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/formatters";
import { formatPhone } from "@/lib/formatters";

// ── Types ──

interface ColonyDetail {
  colony_id: string;
  colony_name: string;
  status: string;
  notes: string | null;
  place_count: number;
  request_count: number;
  total_linked_cats: number;
  linked_community_cats: number;
  linked_community_altered: number;
  linked_community_unaltered: number;
  places: Array<{
    place_id: string;
    display_name: string | null;
    formatted_address: string;
    place_role: string;
    is_primary: boolean;
  }>;
  requests: Array<{
    request_id: string;
    requester_name: string | null;
    formatted_address: string;
    status: string;
    estimated_cat_count: number | null;
  }>;
}

interface ColonyPerson {
  person_id: string;
  display_name: string;
  primary_phone: string | null;
  primary_email: string | null;
  role_type: string;
  role_label: string;
  is_active: boolean;
}

interface TimelineEvent {
  id: string;
  event_date: string;
  event_type: "journal" | "ticket" | "request" | "appointment" | "observation";
  title: string;
  body: string | null;
  actor: string | null;
  source_label: string;
  tags: string[];
}

// ── Helpers ──

const EVENT_ICONS: Record<string, { icon: string; color: string }> = {
  journal: { icon: "pencil", color: "#6366f1" },
  ticket: { icon: "flag", color: "#f59e0b" },
  request: { icon: "clipboard-list", color: "#3b82f6" },
  appointment: { icon: "hospital", color: "#10b981" },
  observation: { icon: "eye", color: "#8b5cf6" },
};

function groupByMonth(events: TimelineEvent[]): Array<{ month: string; events: TimelineEvent[] }> {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const d = new Date(e.event_date);
    const key = d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return Array.from(groups.entries()).map(([month, events]) => ({ month, events }));
}

// ── Page ──

export default function ColonyStoryPage() {
  const params = useParams();
  const id = params.id as string;

  const [colony, setColony] = useState<ColonyDetail | null>(null);
  const [people, setPeople] = useState<ColonyPerson[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("story");

  const colonyName = colony?.colony_name || "Colony";
  const { breadcrumbs } = useNavigationContext(colonyName);

  const fetchAll = useCallback(async () => {
    try {
      const [colonyData, peopleData, timelineData] = await Promise.all([
        fetchApi<ColonyDetail>(`/api/colonies/${id}`),
        fetchApi<{ people: ColonyPerson[] }>(`/api/colonies/${id}/people`).catch(() => ({ people: [] })),
        fetchApi<{ events: TimelineEvent[] }>(`/api/colonies/${id}/timeline`).catch(() => ({ events: [] })),
      ]);
      setColony(colonyData);
      setPeople(peopleData.people || []);
      setTimeline(timelineData.events || []);
    } catch {
      setError("Colony not found");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "1rem" }}>
        <Breadcrumbs items={breadcrumbs} />
        <SkeletonStats count={4} />
        <div style={{ marginTop: "1.5rem" }}><SkeletonList items={6} /></div>
      </div>
    );
  }

  if (error || !colony) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "1rem" }}>
        <Breadcrumbs items={breadcrumbs} />
        <ErrorState title={error || "Colony not found"} />
      </div>
    );
  }

  const activeRequests = colony.requests.filter(r => !["completed", "cancelled", "partial"].includes(r.status));
  const completedRequests = colony.requests.filter(r => ["completed", "cancelled", "partial"].includes(r.status));
  const alteredPct = colony.linked_community_cats > 0
    ? Math.round((colony.linked_community_altered / colony.linked_community_cats) * 100)
    : 0;
  const monthGroups = groupByMonth(timeline);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1rem" }}>
      <Breadcrumbs items={breadcrumbs} />

      {/* ═══ Hero ═══ */}
      <div className="card" style={{ padding: "1.25rem", marginTop: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <Icon name="landmark" size={20} />
          <h1 style={{ margin: 0, fontSize: "1.4rem" }}>{colony.colony_name}</h1>
          <StatusBadge status={colony.status} size="lg" />
        </div>
        {colony.notes && (
          <p style={{ margin: "0 0 0.75rem", color: "var(--muted)", fontSize: "0.9rem" }}>{colony.notes}</p>
        )}

        {/* Stats row — F-pattern: critical numbers at top */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.75rem" }}>
          <StatBox label="Addresses" value={colony.place_count} />
          <StatBox label="Cats" value={colony.linked_community_cats} />
          <StatBox label="Altered" value={`${alteredPct}%`} color={alteredPct >= 80 ? "var(--success-text)" : alteredPct >= 50 ? "var(--warning-text)" : "var(--error-text, #dc2626)"} />
          <StatBox label="Unaltered" value={colony.linked_community_unaltered} color={colony.linked_community_unaltered > 0 ? "var(--warning-text)" : undefined} />
          <StatBox label="Active Requests" value={activeRequests.length} color={activeRequests.length > 0 ? "var(--primary)" : undefined} />
          <StatBox label="Completed" value={completedRequests.length} />
        </div>
      </div>

      {/* ═══ Tabs ═══ */}
      <TabBar
        tabs={[
          { id: "story", label: "Story" },
          { id: "places", label: "Places", count: colony.place_count },
          { id: "people", label: "People", count: people.length },
          { id: "requests", label: "Requests", count: colony.requests.length },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* ─── Story Tab: Narrative Timeline ─── */}
      <TabPanel tabId="story" activeTab={activeTab}>
        {timeline.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
            <p>No activity recorded yet.</p>
            <p style={{ fontSize: "0.85rem" }}>Journal entries, clinic visits, and field intel will appear here as a timeline.</p>
          </div>
        ) : (
          <div style={{ position: "relative", paddingLeft: "24px" }}>
            {/* Vertical timeline line */}
            <div style={{ position: "absolute", left: "11px", top: "8px", bottom: "8px", width: "2px", background: "var(--border, #e5e7eb)" }} />

            {monthGroups.map((group) => (
              <div key={group.month}>
                {/* Month header */}
                <div style={{
                  position: "relative", zIndex: 1,
                  fontSize: "0.75rem", fontWeight: 700, color: "var(--muted)",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                  margin: "1.25rem 0 0.5rem 0",
                  background: "var(--background)", display: "inline-block", paddingRight: "0.5rem",
                }}>
                  {group.month}
                </div>

                {group.events.map((event) => {
                  const iconDef = EVENT_ICONS[event.event_type] || EVENT_ICONS.journal;
                  return <TimelineEventRow key={`${event.event_type}-${event.id}`} event={event} iconDef={iconDef} />;
                })}
              </div>
            ))}
          </div>
        )}
      </TabPanel>

      {/* ─── Places Tab ─── */}
      <TabPanel tabId="places" activeTab={activeTab}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {colony.places.map((place) => (
            <a key={place.place_id} href={`/places/${place.place_id}?from=colonies`}
               style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem", background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "8px", textDecoration: "none", color: "var(--foreground)" }}>
              <Icon name="map-pin" size={16} color="var(--primary)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{place.display_name || place.formatted_address}</div>
                {place.formatted_address && place.display_name && (
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{place.formatted_address}</div>
                )}
              </div>
              {place.is_primary && <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: "3px", background: "#059669", color: "#fff", fontWeight: 600 }}>PRIMARY</span>}
              {place.place_role !== "core_site" && (
                <span style={{ fontSize: "0.7rem", padding: "1px 6px", borderRadius: "3px", background: "var(--muted-bg)", color: "var(--text-muted)" }}>{place.place_role.replace(/_/g, " ")}</span>
              )}
            </a>
          ))}
        </div>
      </TabPanel>

      {/* ─── People Tab ─── */}
      <TabPanel tabId="people" activeTab={activeTab}>
        {people.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>No people linked yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {people.map((p) => (
              <a key={p.person_id} href={`/people/${p.person_id}?from=colonies`}
                 style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem", background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "8px", textDecoration: "none", color: "var(--foreground)" }}>
                <Icon name="user" size={16} color="var(--muted)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{p.display_name}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                    {[p.primary_phone && formatPhone(p.primary_phone), p.primary_email].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <span style={{ fontSize: "0.7rem", padding: "1px 6px", borderRadius: "3px", background: "var(--muted-bg)", color: "var(--text-muted)" }}>{p.role_label}</span>
                {!p.is_active && <span style={{ fontSize: "0.65rem", color: "var(--error-text, #dc2626)" }}>Ended</span>}
              </a>
            ))}
          </div>
        )}
      </TabPanel>

      {/* ─── Requests Tab ─── */}
      <TabPanel tabId="requests" activeTab={activeTab}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {colony.requests.map((r) => (
            <a key={r.request_id} href={`/requests/${r.request_id}?from=colonies`}
               style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem", background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "8px", textDecoration: "none", color: "var(--foreground)" }}>
              <StatusBadge status={r.status} size="sm" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{r.requester_name || r.formatted_address}</div>
                {r.estimated_cat_count && <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{r.estimated_cat_count} cats</span>}
              </div>
            </a>
          ))}
          {colony.requests.length === 0 && (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>No requests linked.</div>
          )}
        </div>
      </TabPanel>
    </div>
  );
}

// ── Sub-components ──

function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "0.5rem", background: "var(--section-bg, #f9fafb)", borderRadius: "6px" }}>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: color || "var(--foreground)" }}>{value}</div>
      <div style={{ fontSize: "0.65rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
    </div>
  );
}

function TimelineEventRow({ event, iconDef }: { event: TimelineEvent; iconDef: { icon: string; color: string } }) {
  const [expanded, setExpanded] = useState(false);
  const hasBody = event.body && event.body.length > 0;
  const isLongBody = hasBody && event.body!.length > 120;
  const displayBody = expanded ? event.body : (isLongBody ? event.body!.slice(0, 120) + "…" : event.body);

  return (
    <div style={{ position: "relative", paddingBottom: "0.75rem" }}>
      {/* Dot on the timeline */}
      <div style={{
        position: "absolute", left: "-19px", top: "4px",
        width: "10px", height: "10px", borderRadius: "50%",
        background: iconDef.color, border: "2px solid var(--background)",
        zIndex: 1,
      }} />

      <div style={{ paddingLeft: "0.5rem" }}>
        {/* Title + date row */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <Icon name={iconDef.icon} size={13} color={iconDef.color} />
          <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{event.title}</span>
          <span style={{
            fontSize: "0.6rem", padding: "0 4px", borderRadius: "3px",
            background: "var(--muted-bg, #f3f4f6)", color: "var(--text-muted)",
          }}>
            {event.source_label}
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)", marginLeft: "auto" }}>
            {formatRelativeTime(event.event_date) || new Date(event.event_date).toLocaleDateString()}
          </span>
        </div>

        {/* Actor */}
        {event.actor && (
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.15rem" }}>
            {event.actor}
          </div>
        )}

        {/* Body — progressive disclosure */}
        {hasBody && (
          <div style={{
            fontSize: "0.8rem", color: "var(--foreground)", marginTop: "0.3rem",
            lineHeight: 1.4, whiteSpace: "pre-wrap",
          }}>
            {displayBody}
            {isLongBody && (
              <button
                onClick={() => setExpanded(!expanded)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--primary)", fontSize: "0.75rem", padding: "0 0.25rem",
                  fontWeight: 500,
                }}
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        {/* Tags */}
        {event.tags.length > 0 && (
          <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
            {event.tags.slice(0, 4).map(tag => (
              <span key={tag} style={{ fontSize: "0.6rem", padding: "0 4px", borderRadius: "3px", background: "var(--info-bg, #eff6ff)", color: "var(--info-text, #2563eb)" }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
