"use client";

import { useState, useEffect, useRef } from "react";

interface EntityPreviewProps {
  entityType: "cat" | "person" | "place";
  entityId: string;
  children: React.ReactNode;
}

interface CatDetail {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  primary_color: string | null;
  identifiers: Array<{ id_type: string; id_value: string }>;
  owners: Array<{ person_id: string; display_name: string; relationship_type: string }>;
  places: Array<{ place_id: string; display_name: string }>;
}

interface PersonDetail {
  person_id: string;
  display_name: string;
  identifiers: Array<{ id_type: string; id_value: string }>;
  cats: Array<{ cat_id: string; display_name: string; relationship_type: string }>;
  places: Array<{ place_id: string; display_name: string; role: string }>;
}

interface PlaceDetail {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  locality: string | null;
  cats: Array<{ cat_id: string; display_name: string }>;
  people: Array<{ person_id: string; display_name: string; role: string }>;
}

type EntityDetail = CatDetail | PersonDetail | PlaceDetail;

export default function EntityPreview({ entityType, entityId, children }: EntityPreviewProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isHovering && !detail && !loading) {
      setLoading(true);
      const endpoint = entityType === "cat" ? "cats" : entityType === "person" ? "people" : "places";
      fetch(`/api/${endpoint}/${entityId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setDetail(data);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [isHovering, detail, loading, entityType, entityId]);

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition({
          top: rect.bottom + window.scrollY + 8,
          left: Math.max(8, rect.left + window.scrollX),
        });
      }
      setIsHovering(true);
    }, 300); // 300ms delay before showing
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsHovering(false);
  };

  const renderCatPreview = (cat: CatDetail) => (
    <>
      <div className="preview-header">
        <span className="preview-icon">🐱</span>
        <strong>{cat.display_name}</strong>
      </div>
      <div className="preview-details">
        {cat.breed && <div className="preview-row"><span className="preview-label">Breed:</span> {cat.breed}</div>}
        {cat.sex && <div className="preview-row"><span className="preview-label">Sex:</span> {cat.sex} {cat.altered_status && `(${cat.altered_status})`}</div>}
        {cat.identifiers?.length > 0 && (
          <div className="preview-row">
            <span className="preview-label">Microchip:</span>{" "}
            {cat.identifiers.find((i) => i.id_type === "microchip")?.id_value || "—"}
          </div>
        )}
      </div>
      {cat.owners?.length > 0 && (
        <div className="preview-section">
          <div className="preview-section-title">Related People ({cat.owners.length})</div>
          {cat.owners.slice(0, 3).map((o) => (
            <div key={o.person_id} className="preview-link">{o.display_name}</div>
          ))}
          {cat.owners.length > 3 && <div className="preview-more">+{cat.owners.length - 3} more</div>}
        </div>
      )}
      {cat.places?.length > 0 && (
        <div className="preview-section">
          <div className="preview-section-title">Locations ({cat.places.length})</div>
          {cat.places.slice(0, 2).map((p) => (
            <div key={p.place_id} className="preview-link">{p.display_name}</div>
          ))}
        </div>
      )}
    </>
  );

  const renderPersonPreview = (person: PersonDetail) => (
    <>
      <div className="preview-header">
        <span className="preview-icon">👤</span>
        <strong>{person.display_name}</strong>
      </div>
      <div className="preview-details">
        {person.identifiers?.length > 0 && (
          <>
            {person.identifiers.find((i) => i.id_type === "email") && (
              <div className="preview-row">
                <span className="preview-label">Email:</span>{" "}
                {person.identifiers.find((i) => i.id_type === "email")?.id_value}
              </div>
            )}
            {person.identifiers.find((i) => i.id_type === "phone") && (
              <div className="preview-row">
                <span className="preview-label">Phone:</span>{" "}
                {person.identifiers.find((i) => i.id_type === "phone")?.id_value}
              </div>
            )}
          </>
        )}
      </div>
      {person.cats?.length > 0 && (
        <div className="preview-section">
          <div className="preview-section-title">Related Cats ({person.cats.length})</div>
          {person.cats.slice(0, 4).map((c) => (
            <div key={c.cat_id} className="preview-link">
              🐱 {c.display_name}
              <span className="preview-badge">{c.relationship_type}</span>
            </div>
          ))}
          {person.cats.length > 4 && <div className="preview-more">+{person.cats.length - 4} more</div>}
        </div>
      )}
      {person.places?.length > 0 && (
        <div className="preview-section">
          <div className="preview-section-title">Locations ({person.places.length})</div>
          {person.places.slice(0, 2).map((p) => (
            <div key={p.place_id} className="preview-link">📍 {p.display_name}</div>
          ))}
        </div>
      )}
    </>
  );

  const renderPlacePreview = (place: PlaceDetail) => (
    <>
      <div className="preview-header">
        <span className="preview-icon">📍</span>
        <strong>{place.display_name}</strong>
      </div>
      <div className="preview-details">
        {place.formatted_address && (
          <div className="preview-row">{place.formatted_address}</div>
        )}
        {place.place_kind && (
          <div className="preview-row">
            <span className="preview-label">Type:</span> {place.place_kind}
          </div>
        )}
      </div>
      {place.cats?.length > 0 && (
        <div className="preview-section">
          <div className="preview-section-title">Related Cats ({place.cats.length})</div>
          {place.cats.slice(0, 4).map((c) => (
            <div key={c.cat_id} className="preview-link">🐱 {c.display_name}</div>
          ))}
          {place.cats.length > 4 && <div className="preview-more">+{place.cats.length - 4} more</div>}
        </div>
      )}
      {place.people?.length > 0 && (
        <div className="preview-section">
          <div className="preview-section-title">Related People ({place.people.length})</div>
          {place.people.slice(0, 3).map((p) => (
            <div key={p.person_id} className="preview-link">
              👤 {p.display_name}
              <span className="preview-badge">{p.role}</span>
            </div>
          ))}
          {place.people.length > 3 && <div className="preview-more">+{place.people.length - 3} more</div>}
        </div>
      )}
    </>
  );

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ display: "inline" }}
    >
      {children}

      {isHovering && position && (
        <div
          className="entity-preview-popup"
          style={{
            position: "absolute",
            top: position.top,
            left: position.left,
            zIndex: 1000,
          }}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={handleMouseLeave}
        >
          {loading ? (
            <div className="preview-loading">Loading...</div>
          ) : detail ? (
            entityType === "cat" ? renderCatPreview(detail as CatDetail) :
            entityType === "person" ? renderPersonPreview(detail as PersonDetail) :
            renderPlacePreview(detail as PlaceDetail)
          ) : (
            <div className="preview-loading">No data</div>
          )}
        </div>
      )}

      <style jsx>{`
        .entity-preview-popup {
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
          padding: 0.75rem;
          min-width: 280px;
          max-width: 360px;
          font-size: 0.875rem;
        }

        .preview-loading {
          color: var(--muted);
          text-align: center;
          padding: 1rem;
        }

        .preview-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--border);
        }

        .preview-icon {
          font-size: 1rem;
        }

        .preview-details {
          margin-bottom: 0.5rem;
        }

        .preview-row {
          margin: 0.25rem 0;
          color: var(--foreground);
        }

        .preview-label {
          color: var(--muted);
          font-size: 0.75rem;
        }

        .preview-section {
          margin-top: 0.5rem;
          padding-top: 0.5rem;
          border-top: 1px solid var(--border);
        }

        .preview-section-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted);
          margin-bottom: 0.25rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .preview-link {
          padding: 0.125rem 0;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .preview-badge {
          font-size: 0.625rem;
          padding: 0.125rem 0.25rem;
          background: color-mix(in srgb, var(--primary) 15%, transparent);
          color: var(--primary);
          border-radius: 3px;
          margin-left: auto;
        }

        .preview-more {
          font-size: 0.75rem;
          color: var(--muted);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
