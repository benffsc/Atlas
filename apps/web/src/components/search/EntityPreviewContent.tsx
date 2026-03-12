"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api-client";
import { formatPhone, formatRelativeTime, formatDateLocal } from "@/lib/formatters";
import { formatPlaceKind, formatRole } from "@/lib/display-labels";
import { CatHealthBadges, buildHealthFlags, PlaceRiskBadges, PersonStatusBadges } from "@/components/badges";

// --- Shared interfaces ---

export interface CatDetail {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  primary_color: string | null;
  identifiers: Array<{ id_type: string; id_value: string }>;
  owners: Array<{ person_id: string; display_name: string; relationship_type: string }>;
  places: Array<{ place_id: string; display_name: string }>;
  last_appointment_date?: string | null;
  first_appointment_date?: string | null;
  total_appointments?: number;
  tests?: Array<{ test_type?: string; disease_key?: string; disease_display_name?: string; result?: string; disease_badge_color?: string; short_code?: string }>;
  // Health fields (FFS-427)
  is_deceased?: boolean | null;
  age_group?: string | null;
  weight_lbs?: number | null;
  vitals?: Array<{ weight_lbs?: number | null; is_pregnant?: boolean | null; is_lactating?: boolean | null }>;
  conditions?: Array<{ condition_type: string; severity?: string | null; resolved_at?: string | null }>;
}

export interface PersonDetail {
  person_id: string;
  display_name: string;
  identifiers: Array<{ id_type: string; id_value: string }>;
  cats: Array<{ cat_id: string; display_name: string; relationship_type: string }>;
  places: Array<{ place_id: string; display_name: string; role: string }>;
  cat_count?: number;
  place_count?: number;
  last_appointment_date?: string | null;
  entity_type?: string | null;
  // Status fields (FFS-436)
  do_not_contact?: boolean;
  primary_role?: string | null;
  trapper_type?: string | null;
}

export interface PlaceDetail {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  cats: Array<{ cat_id: string; display_name: string }>;
  people: Array<{ person_id: string; display_name: string; role: string }>;
  cat_count?: number;
  person_count?: number;
  last_appointment_date?: string | null;
  active_request_count?: number;
  // Risk fields (FFS-432)
  watch_list?: boolean;
  disease_badges?: Array<{ disease_key: string; short_code: string; color: string; status: string; positive_cat_count?: number }>;
}

export interface RequestDetail {
  request_id: string;
  status: string;
  priority: string | null;
  summary: string | null;
  place_name: string | null;
  requester_name: string | null;
  estimated_cat_count: number | null;
  total_cats_reported: number | null;
  created_at: string;
  resolved_at: string | null;
}

export type EntityType = "cat" | "person" | "place" | "request";
export type EntityDetail = CatDetail | PersonDetail | PlaceDetail | RequestDetail;

// Label formatting imported from @/lib/display-labels

// --- Data fetching hook ---

export function useEntityDetail(entityType: EntityType | null, entityId: string | null) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entityType || !entityId) {
      setDetail(null);
      return;
    }

    setLoading(true);
    setDetail(null);

    const endpoint =
      entityType === "cat" ? "cats" :
      entityType === "person" ? "people" :
      entityType === "place" ? "places" :
      "requests";

    fetchApi<EntityDetail>(`/api/${endpoint}/${entityId}`)
      .then((data) => setDetail(data))
      .catch(() => { /* best-effort preview */ })
      .finally(() => setLoading(false));
  }, [entityType, entityId]);

  return { detail, loading };
}

// --- Render component ---

interface EntityPreviewContentProps {
  entityType: EntityType;
  detail: EntityDetail | null;
  loading: boolean;
}

export function EntityPreviewContent({ entityType, detail, loading }: EntityPreviewContentProps) {
  if (loading) {
    return <div style={{ color: "var(--muted)", textAlign: "center", padding: "1rem" }}>Loading...</div>;
  }

  if (!detail) {
    return <div style={{ color: "var(--muted)", textAlign: "center", padding: "1rem" }}>No data</div>;
  }

  switch (entityType) {
    case "cat":
      return <CatPreview cat={detail as CatDetail} />;
    case "person":
      return <PersonPreview person={detail as PersonDetail} />;
    case "place":
      return <PlacePreview place={detail as PlaceDetail} />;
    case "request":
      return <RequestPreview request={detail as RequestDetail} />;
  }
}

// --- Individual renderers ---

function CatPreview({ cat }: { cat: CatDetail }) {
  return (
    <>
      <PreviewHeader icon="🐱" name={cat.display_name} />
      <div style={{ marginBottom: "0.5rem" }}>
        {cat.breed && <PreviewRow label="Breed" value={cat.breed} />}
        {cat.sex && (
          <PreviewRow
            label="Sex"
            value={`${cat.sex}${cat.altered_status ? ` (${cat.altered_status})` : ""}`}
          />
        )}
        {cat.identifiers?.length > 0 && (
          <PreviewRow
            label="Microchip"
            value={cat.identifiers.find((i) => i.id_type === "microchip")?.id_value || "\u2014"}
          />
        )}
      </div>
      {/* Activity & medical signals */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginBottom: "0.5rem" }}>
        {cat.altered_status && (
          <PreviewPill
            label={cat.altered_status === "altered" ? "Altered" : "Unaltered"}
            color={cat.altered_status === "altered" ? "var(--success-text)" : "var(--warning-text)"}
            bg={cat.altered_status === "altered" ? "var(--success-bg)" : "var(--warning-bg)"}
          />
        )}
      </div>
      {/* Health badges */}
      {(() => {
        const latestVital = cat.vitals?.[0];
        const flags = buildHealthFlags({
          diseases: cat.tests?.map((t) => ({
            disease_key: t.disease_key || t.test_type || "",
            short_code: t.short_code || t.disease_key || t.test_type,
            display_name: t.disease_display_name,
            color: t.disease_badge_color,
            result: t.result || "",
          })),
          isPregnant: latestVital?.is_pregnant ?? false,
          isLactating: latestVital?.is_lactating ?? false,
          conditions: cat.conditions?.filter((c) => !c.resolved_at) ?? [],
          ageGroup: cat.age_group,
          weightLbs: cat.weight_lbs ?? latestVital?.weight_lbs,
        });
        return (flags.length > 0 || cat.is_deceased) ? (
          <div style={{ marginBottom: "0.5rem" }}>
            <CatHealthBadges healthFlags={flags} isDeceased={cat.is_deceased ?? false} maxInline={4} />
          </div>
        ) : null;
      })()}
      {(cat.total_appointments || cat.last_appointment_date) && (
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          {cat.total_appointments ? `${cat.total_appointments} clinic visit${cat.total_appointments !== 1 ? "s" : ""}` : ""}
          {cat.last_appointment_date && (
            <>{cat.total_appointments ? " \u00B7 " : ""}Last: {formatDateLocal(cat.last_appointment_date)}</>
          )}
        </div>
      )}
      {cat.owners?.length > 0 && (
        <PreviewSection title={`Related People (${cat.owners.length})`}>
          {cat.owners.slice(0, 3).map((o) => (
            <PreviewLink key={o.person_id}>{o.display_name}</PreviewLink>
          ))}
          {cat.owners.length > 3 && <PreviewMore count={cat.owners.length - 3} />}
        </PreviewSection>
      )}
      {cat.places?.length > 0 && (
        <PreviewSection title={`Locations (${cat.places.length})`}>
          {cat.places.slice(0, 2).map((p) => (
            <PreviewLink key={p.place_id}>{p.display_name}</PreviewLink>
          ))}
        </PreviewSection>
      )}
    </>
  );
}

function PersonPreview({ person }: { person: PersonDetail }) {
  const activityParts: string[] = [];
  const catCount = person.cat_count ?? person.cats?.length ?? 0;
  const placeCount = person.place_count ?? person.places?.length ?? 0;
  if (catCount) activityParts.push(`${catCount} cats`);
  if (placeCount) activityParts.push(`${placeCount} places`);
  const rel = formatRelativeTime(person.last_appointment_date);
  if (rel) activityParts.push(`Last: ${rel}`);

  return (
    <>
      <PreviewHeader icon="👤" name={person.display_name} />
      <div style={{ marginBottom: "0.5rem" }}>
        {person.identifiers?.length > 0 && (
          <>
            {person.identifiers.find((i) => i.id_type === "email") && (
              <PreviewRow
                label="Email"
                value={person.identifiers.find((i) => i.id_type === "email")!.id_value}
              />
            )}
            {person.identifiers.find((i) => i.id_type === "phone") && (
              <PreviewRow
                label="Phone"
                value={formatPhone(person.identifiers.find((i) => i.id_type === "phone")!.id_value) || ""}
              />
            )}
          </>
        )}
      </div>
      {/* Status badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginBottom: "0.5rem" }}>
        <PersonStatusBadges
          primaryRole={person.primary_role}
          trapperType={person.trapper_type}
          doNotContact={person.do_not_contact}
          entityType={person.entity_type}
          catCount={person.cat_count}
          size="sm"
        />
      </div>
      {activityParts.length > 0 && (
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          {activityParts.join(" \u00B7 ")}
        </div>
      )}
      {person.cats?.length > 0 && (
        <PreviewSection title={`Related Cats (${person.cats.length})`}>
          {person.cats.slice(0, 4).map((c) => (
            <PreviewLink key={c.cat_id} badge={formatRole(c.relationship_type)}>
              🐱 {c.display_name}
            </PreviewLink>
          ))}
          {person.cats.length > 4 && <PreviewMore count={person.cats.length - 4} />}
        </PreviewSection>
      )}
      {person.places?.length > 0 && (
        <PreviewSection title={`Locations (${person.places.length})`}>
          {person.places.slice(0, 2).map((p) => (
            <PreviewLink key={p.place_id}>📍 {p.display_name}</PreviewLink>
          ))}
        </PreviewSection>
      )}
    </>
  );
}

function PlacePreview({ place }: { place: PlaceDetail }) {
  const activityParts: string[] = [];
  const catCount = place.cat_count ?? place.cats?.length ?? 0;
  const personCount = place.person_count ?? place.people?.length ?? 0;
  if (catCount) activityParts.push(`${catCount} cats`);
  if (personCount) activityParts.push(`${personCount} people`);
  const rel = formatRelativeTime(place.last_appointment_date);
  if (rel) activityParts.push(`Last: ${rel}`);

  return (
    <>
      <PreviewHeader icon="📍" name={place.display_name} />
      <div style={{ marginBottom: "0.5rem" }}>
        {place.formatted_address && <PreviewRow value={place.formatted_address} />}
        {place.place_kind && <PreviewRow label="Type" value={formatPlaceKind(place.place_kind)} />}
      </div>
      {/* Risk badges */}
      {(place.disease_badges?.length || place.watch_list || (place.active_request_count ?? 0) > 0) ? (
        <div style={{ marginBottom: "0.5rem" }}>
          <PlaceRiskBadges
            diseaseFlags={place.disease_badges?.map((d) => ({
              disease_key: d.disease_key,
              short_code: d.short_code,
              status: d.status,
              color: d.color,
              positive_cat_count: d.positive_cat_count,
            }))}
            watchList={place.watch_list}
            activeRequestCount={place.active_request_count}
          />
        </div>
      ) : null}
      {activityParts.length > 0 && (
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          {activityParts.join(" \u00B7 ")}
        </div>
      )}
      {place.cats?.length > 0 && (
        <PreviewSection title={`Related Cats (${place.cats.length})`}>
          {place.cats.slice(0, 4).map((c) => (
            <PreviewLink key={c.cat_id}>🐱 {c.display_name}</PreviewLink>
          ))}
          {place.cats.length > 4 && <PreviewMore count={place.cats.length - 4} />}
        </PreviewSection>
      )}
      {place.people?.length > 0 && (
        <PreviewSection title={`Related People (${place.people.length})`}>
          {place.people.slice(0, 3).map((p) => (
            <PreviewLink key={p.person_id} badge={formatRole(p.role)}>
              👤 {p.display_name}
            </PreviewLink>
          ))}
          {place.people.length > 3 && <PreviewMore count={place.people.length - 3} />}
        </PreviewSection>
      )}
    </>
  );
}

function RequestPreview({ request }: { request: RequestDetail }) {
  const statusColor: Record<string, string> = {
    new: "var(--status-new)",
    triaged: "var(--status-triaged)",
    scheduled: "var(--status-scheduled)",
    in_progress: "var(--status-in-progress)",
    completed: "var(--status-completed)",
    cancelled: "var(--status-cancelled)",
    on_hold: "var(--status-on-hold)",
  };

  return (
    <>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        marginBottom: "0.5rem",
        paddingBottom: "0.5rem",
        borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: "1rem" }}>📋</span>
        <strong style={{ flex: 1 }}>{request.summary || request.place_name || "Request"}</strong>
        <span style={{
          padding: "0.125rem 0.5rem",
          borderRadius: "4px",
          fontSize: "0.7rem",
          fontWeight: 600,
          color: "#fff",
          background: statusColor[request.status] || "var(--muted)",
        }}>
          {formatRole(request.status)}
        </span>
      </div>
      <div style={{ marginBottom: "0.5rem" }}>
        {request.place_name && <PreviewRow label="Location" value={request.place_name} />}
        {request.requester_name && <PreviewRow label="Requester" value={request.requester_name} />}
        {request.estimated_cat_count != null && (
          <PreviewRow label="Cats Needing TNR" value={String(request.estimated_cat_count)} />
        )}
        {request.total_cats_reported != null && (
          <PreviewRow label="Total Cats" value={String(request.total_cats_reported)} />
        )}
        <PreviewRow label="Created" value={new Date(request.created_at).toLocaleDateString()} />
        {request.resolved_at && (
          <PreviewRow label="Resolved" value={new Date(request.resolved_at).toLocaleDateString()} />
        )}
      </div>
    </>
  );
}

// --- Shared sub-components ---

function PreviewHeader({ icon, name }: { icon: string; name: string }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      marginBottom: "0.5rem",
      paddingBottom: "0.5rem",
      borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ fontSize: "1rem" }}>{icon}</span>
      <strong>{name}</strong>
    </div>
  );
}

function PreviewRow({ label, value }: { label?: string; value: string }) {
  return (
    <div style={{ margin: "0.25rem 0", color: "var(--foreground)" }}>
      {label && <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>{label}: </span>}
      {value}
    </div>
  );
}

function PreviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
      <div style={{
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "var(--muted)",
        marginBottom: "0.25rem",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function PreviewLink({ children, badge }: { children: React.ReactNode; badge?: string }) {
  return (
    <div style={{ padding: "0.125rem 0", display: "flex", alignItems: "center", gap: "0.25rem" }}>
      {children}
      {badge && (
        <span style={{
          fontSize: "0.625rem",
          padding: "0.125rem 0.25rem",
          background: "color-mix(in srgb, var(--primary) 15%, transparent)",
          color: "var(--primary)",
          borderRadius: "3px",
          marginLeft: "auto",
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}

function PreviewMore({ count }: { count: number }) {
  return (
    <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
      +{count} more
    </div>
  );
}

function PreviewPill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      fontSize: "0.65rem",
      fontWeight: 600,
      padding: "0.125rem 0.375rem",
      borderRadius: "4px",
      color,
      background: bg,
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}
