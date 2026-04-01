import { formatRelativeTime } from "@/lib/formatters";
import type { AtlasPin } from "@/components/map/types";

interface MapInfoWindowContentProps {
  pin: AtlasPin;
  onOpenDetails: (placeId: string) => void;
  onStreetView?: (coords: { lat: number; lng: number; address: string }) => void;
}

/**
 * InfoWindow popup content for map pins.
 * Two variants: compact (reference pins) and rich (active pins).
 */
export function MapInfoWindowContent({ pin, onOpenDetails, onStreetView }: MapInfoWindowContentProps) {
  const isReference = pin.pin_tier === "reference" || pin.pin_style === "reference";

  if (isReference) {
    return <ReferencePopup pin={pin} onOpenDetails={onOpenDetails} />;
  }

  return <ActivePopup pin={pin} onOpenDetails={onOpenDetails} onStreetView={onStreetView} />;
}

// ── Reference pin popup (compact but useful) ──────────────────────────────

function ReferencePopup({ pin, onOpenDetails }: { pin: AtlasPin; onOpenDetails: (id: string) => void }) {
  return (
    <div style={{ minWidth: 220, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
        {pin.display_name || pin.address}
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
        {pin.service_zone || "Unknown zone"}
        {pin.place_kind ? ` · ${pin.place_kind.replace(/_/g, " ")}` : ""}
      </div>

      {/* Stats row */}
      {(pin.cat_count > 0 || pin.request_count > 0 || pin.person_count > 0 || pin.total_altered > 0) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {pin.cat_count > 0 && (
            <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
              {pin.cat_count} cat{pin.cat_count !== 1 ? "s" : ""}
            </span>
          )}
          {pin.total_altered > 0 && (
            <span style={{ background: "#dcfce7", padding: "2px 8px", borderRadius: 10, fontSize: 11, color: "#16a34a" }}>
              {pin.total_altered} altered
            </span>
          )}
          {pin.request_count > 0 && (
            <span style={{ background: pin.active_request_count > 0 ? "#fef2f2" : "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11, color: pin.active_request_count > 0 ? "#dc2626" : undefined }}>
              {pin.request_count} request{pin.request_count !== 1 ? "s" : ""}
            </span>
          )}
          {pin.person_count > 0 && (
            <span style={{ background: "#f3f4f6", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>
              {pin.person_count} people
            </span>
          )}
        </div>
      )}

      {pin.last_alteration_at && (
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>
          Last TNR: {formatRelativeTime(pin.last_alteration_at)}
        </div>
      )}

      {pin.google_summaries?.length > 0 && (
        <div style={{ fontSize: 12, color: "#374151", marginBottom: 8, fontStyle: "italic", maxHeight: 40, overflow: "hidden", textOverflow: "ellipsis" }}>
          &ldquo;{pin.google_summaries[0].summary.slice(0, 120)}{pin.google_summaries[0].summary.length > 120 ? "..." : ""}&rdquo;
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => onOpenDetails(pin.id)}
          style={{ flex: 1, padding: "6px 12px", background: "#3b82f6", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
        >
          Details
        </button>
        <a
          href={`/places/${pin.id}`}
          target="_blank"
          style={{ padding: "6px 12px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, textDecoration: "none" }}
        >
          Open Page
        </a>
      </div>
    </div>
  );
}

// ── Active pin popup (rich) ───────────────────────────────────────────────

function ActivePopup({
  pin,
  onOpenDetails,
  onStreetView,
}: {
  pin: AtlasPin;
  onOpenDetails: (id: string) => void;
  onStreetView?: (coords: { lat: number; lng: number; address: string }) => void;
}) {
  return (
    <div style={{ minWidth: 280, maxWidth: 340, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{pin.address}</div>
        {pin.disease_risk && (
          <span style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "2px 8px", borderRadius: 10, color: "#dc2626", fontWeight: 600, fontSize: 10, whiteSpace: "nowrap", flexShrink: 0 }}>
            Disease Risk
          </span>
        )}
        {pin.watch_list && !pin.disease_risk && (
          <span style={{ background: "#f5f3ff", border: "1px solid #c4b5fd", padding: "2px 8px", borderRadius: 10, color: "#7c3aed", fontWeight: 600, fontSize: 10, whiteSpace: "nowrap", flexShrink: 0 }}>
            Watch List
          </span>
        )}
      </div>
      {/* Subtitle */}
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 10 }}>
        {[pin.service_zone, pin.place_kind?.replace(/_/g, " ")].filter(Boolean).join(" · ") || "Unknown zone"}
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
        <div style={{ background: "#f3f4f6", padding: "6px 4px", borderRadius: 6, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{pin.cat_count}</div>
          <div style={{ fontSize: 9, color: "#6b7280" }}>Cats</div>
        </div>
        <div style={{ background: "#f3f4f6", padding: "6px 4px", borderRadius: 6, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{pin.total_altered}</div>
          <div style={{ fontSize: 9, color: "#6b7280" }}>Altered</div>
        </div>
        <div style={{ background: pin.active_request_count > 0 ? "#fef2f2" : "#f3f4f6", padding: "6px 4px", borderRadius: 6, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: pin.active_request_count > 0 ? "#dc2626" : undefined }}>
            {pin.active_request_count > 0 ? `${pin.active_request_count}/${pin.request_count}` : pin.request_count}
          </div>
          <div style={{ fontSize: 9, color: "#6b7280" }}>{pin.active_request_count > 0 ? "Active/Total" : "Requests"}</div>
        </div>
      </div>

      {/* Last TNR subtitle */}
      {pin.last_alteration_at && (
        <div style={{ fontSize: 11, color: "#6b7280", textAlign: "center", marginBottom: 8 }}>
          Last TNR: {formatRelativeTime(pin.last_alteration_at)}
        </div>
      )}

      {/* Alert banners */}
      {pin.disease_risk && pin.disease_badges?.length > 0 && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "6px 8px", marginBottom: 6, borderRadius: 6, fontSize: 11, color: "#991b1b" }}>
          <strong>Disease Alert:</strong>{" "}
          {pin.disease_badges.map(b =>
            `${b.short_code}${b.positive_cats ? ` (${b.positive_cats} cat${b.positive_cats > 1 ? "s" : ""})` : ""}`
          ).join(", ")}
        </div>
      )}
      {pin.watch_list && pin.disease_risk_notes && (
        <div style={{ background: "#f5f3ff", border: "1px solid #c4b5fd", padding: "6px 8px", marginBottom: 6, borderRadius: 6, fontSize: 11, color: "#5b21b6" }}>
          <strong>Watch List:</strong> {pin.disease_risk_notes}
        </div>
      )}
      {pin.needs_trapper_count > 0 && (
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", padding: "6px 8px", marginBottom: 6, borderRadius: 6, fontSize: 11, color: "#c2410c" }}>
          {pin.needs_trapper_count} request{pin.needs_trapper_count > 1 ? "s" : ""} need{pin.needs_trapper_count === 1 ? "s" : ""} trapper
        </div>
      )}

      {/* People (compact, with role badges) */}
      {pin.people?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>People</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {pin.people.slice(0, 4).map((p: { name: string; roles: string[]; is_staff: boolean }, i: number) => (
              <span key={i} style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                background: p.is_staff ? "#eef2ff" : "#f3f4f6",
                padding: "2px 8px", borderRadius: 10, fontSize: 11,
                color: p.is_staff ? "#4338ca" : "#374151",
              }}>
                {p.name}
                {p.roles?.[0] && (
                  <span style={{ fontSize: 9, color: "#6b7280" }}>[{p.roles[0]}]</span>
                )}
              </span>
            ))}
            {pin.people.length > 4 && (
              <span style={{ fontSize: 11, color: "#6b7280", padding: "2px 4px" }}>
                +{pin.people.length - 4} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => onOpenDetails(pin.id)}
          style={{ flex: 1, padding: "7px 10px", background: "#3b82f6", color: "white", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
        >
          Details
        </button>
        {onStreetView && (
          <button
            onClick={() => onStreetView({ lat: pin.lat, lng: pin.lng, address: pin.address })}
            style={{ padding: "7px 10px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer" }}
          >
            Street View
          </button>
        )}
        <a
          href={`/places/${pin.id}`}
          target="_blank"
          style={{ padding: "7px 10px", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, textAlign: "center", textDecoration: "none" }}
        >
          Open Page
        </a>
      </div>
    </div>
  );
}
