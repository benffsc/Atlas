"use client";

import { formatPhone, formatRelativeTime, formatDateLocal, getActivityColor } from "@/lib/formatters";
import { formatPlaceKind, formatRole, formatStatus } from "@/lib/display-labels";
import { CatHealthBadges, buildHealthFlags, PlaceRiskBadges, PersonStatusBadges } from "@/components/badges";
import { SkeletonList } from "@/components/feedback/Skeleton";

// Re-export types and hook from canonical location for backwards compatibility
export { useEntityDetail } from "@/hooks/useEntityDetail";
export type { EntityType, EntityDetail, CatDetail, PersonDetail, PlaceDetail, RequestDetail } from "@/hooks/useEntityDetail";

import type { EntityType, EntityDetail, CatDetail, PersonDetail, PlaceDetail, RequestDetail } from "@/hooks/useEntityDetail";

// --- Render component ---

interface EntityPreviewContentProps {
  entityType: EntityType;
  detail: EntityDetail | null;
  loading: boolean;
}

export function EntityPreviewContent({ entityType, detail, loading }: EntityPreviewContentProps) {
  if (loading) {
    return <div style={{ padding: "1rem" }}><SkeletonList items={4} /></div>;
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
  const lastApptColor = getActivityColor(cat.last_appointment_date);

  return (
    <>
      <PreviewHeader icon="🐱" name={cat.display_name} />
      {/* Deceased banner */}
      {cat.is_deceased && (
        <div style={{
          padding: "0.25rem 0.5rem",
          marginBottom: "0.5rem",
          borderRadius: "4px",
          fontSize: "0.75rem",
          fontWeight: 600,
          background: "var(--error-bg, #fef2f2)",
          color: "var(--error-text, #dc2626)",
          textAlign: "center",
        }}>
          Deceased
        </div>
      )}
      <div style={{ marginBottom: "0.5rem" }}>
        {cat.breed && <PreviewRow label="Breed" value={cat.breed} />}
        {cat.sex && (
          <PreviewRow
            label="Sex"
            value={`${cat.sex}${cat.altered_status ? ` (${cat.altered_status})` : ""}`}
          />
        )}
        {cat.primary_color && <PreviewRow label="Color" value={cat.primary_color} />}
        {cat.age_group && <PreviewRow label="Age" value={cat.age_group} />}
        {cat.weight_lbs != null && <PreviewRow label="Weight" value={`${cat.weight_lbs} lbs`} />}
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
        return flags.length > 0 ? (
          <div style={{ marginBottom: "0.5rem" }}>
            <CatHealthBadges healthFlags={flags} isDeceased={false} maxInline={4} />
          </div>
        ) : null;
      })()}
      {(cat.total_appointments || cat.last_appointment_date) && (
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          {cat.total_appointments ? `${cat.total_appointments} clinic visit${cat.total_appointments !== 1 ? "s" : ""}` : ""}
          {cat.last_appointment_date && (
            <>{cat.total_appointments ? " \u00B7 " : ""}Last: <span style={{ color: lastApptColor || "var(--muted)" }}>{formatRelativeTime(cat.last_appointment_date)}</span></>
          )}
        </div>
      )}
      {/* Origin place */}
      {cat.places?.length > 0 && cat.places[0].formatted_address && (
        <PreviewRow label="Origin" value={cat.places[0].formatted_address} />
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
        {person.primary_address && (
          <PreviewRow label="Address" value={person.primary_address} />
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
        {person.is_verified && (
          <PreviewPill label="Verified" color="var(--success-text)" bg="var(--success-bg)" />
        )}
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
              {c.display_name}
            </PreviewLink>
          ))}
          {person.cats.length > 4 && <PreviewMore count={person.cats.length - 4} />}
        </PreviewSection>
      )}
      {person.places?.length > 0 && (
        <PreviewSection title={`Locations (${person.places.length})`}>
          {person.places.slice(0, 2).map((p) => (
            <PreviewLink key={p.place_id}>{p.display_name}</PreviewLink>
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
  const actColor = getActivityColor(place.last_appointment_date);
  if (rel) activityParts.push(`Last: ${rel}`);

  // Alteration stats
  const alteredCount = place.total_altered_count ?? 0;
  const colonySize = place.colony_size ?? 0;

  return (
    <>
      <PreviewHeader icon="📍" name={place.display_name} />
      <div style={{ marginBottom: "0.5rem" }}>
        {place.formatted_address && <PreviewRow value={place.formatted_address} />}
        {place.place_kind && <PreviewRow label="Type" value={formatPlaceKind(place.place_kind)} />}
        {place.locality && <PreviewRow label="Locality" value={place.locality} />}
      </div>
      {/* Alteration stats */}
      {alteredCount > 0 && colonySize > 0 && (
        <div style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          marginBottom: "0.5rem",
          color: alteredCount / colonySize >= 0.8 ? "var(--success-text)" : alteredCount / colonySize >= 0.5 ? "var(--warning-text)" : "var(--error-text, #dc2626)",
        }}>
          {alteredCount}/{colonySize} altered ({Math.round((alteredCount / colonySize) * 100)}%)
        </div>
      )}
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
        <div style={{ fontSize: "0.75rem", color: actColor || "var(--muted)", marginBottom: "0.5rem" }}>
          {activityParts.join(" \u00B7 ")}
        </div>
      )}
      {place.cats?.length > 0 && (
        <PreviewSection title={`Related Cats (${place.cats.length})`}>
          {place.cats.slice(0, 4).map((c) => (
            <PreviewLink key={c.cat_id}>{c.display_name}</PreviewLink>
          ))}
          {place.cats.length > 4 && <PreviewMore count={place.cats.length - 4} />}
        </PreviewSection>
      )}
      {place.people?.length > 0 && (
        <PreviewSection title={`Related People (${place.people.length})`}>
          {place.people.slice(0, 3).map((p) => (
            <PreviewLink key={p.person_id} badge={formatRole(p.role)}>
              {p.display_name}
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

  const priorityColor: Record<string, string> = {
    high: "#dc2626",
    medium: "#f59e0b",
    low: "#6b7280",
  };

  // Days open calculation
  const createdDate = new Date(request.created_at);
  const endDate = request.resolved_at ? new Date(request.resolved_at) : new Date();
  const daysOpen = Math.max(0, Math.floor((endDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)));

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
          {formatStatus(request.status)}
        </span>
        {request.priority && (
          <span style={{
            padding: "0.125rem 0.5rem",
            borderRadius: "4px",
            fontSize: "0.7rem",
            fontWeight: 600,
            color: "#fff",
            background: priorityColor[request.priority] || "var(--muted)",
          }}>
            {request.priority.charAt(0).toUpperCase() + request.priority.slice(1)}
          </span>
        )}
      </div>
      <div style={{ marginBottom: "0.5rem" }}>
        {request.place_name && <PreviewRow label="Location" value={request.place_name} />}
        {request.place_address && <PreviewRow label="Address" value={request.place_address} />}
        {request.requester_name && <PreviewRow label="Requester" value={request.requester_name} />}
        {request.primary_trapper_name && <PreviewRow label="Trapper" value={request.primary_trapper_name} />}
        {request.estimated_cat_count != null && (
          <PreviewRow label="Cats Needing TNR" value={String(request.estimated_cat_count)} />
        )}
        {request.linked_cat_count != null && request.linked_cat_count > 0 && (
          <PreviewRow label="Linked Cats" value={String(request.linked_cat_count)} />
        )}
        <PreviewRow label="Created" value={new Date(request.created_at).toLocaleDateString()} />
        <PreviewRow label={request.resolved_at ? "Duration" : "Days Open"} value={`${daysOpen}d`} />
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
