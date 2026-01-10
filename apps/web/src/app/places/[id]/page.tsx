"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface Cat {
  cat_id: string;
  cat_name: string;
  relationship_type: string;
  confidence: string;
}

interface Person {
  person_id: string;
  person_name: string;
  role: string;
  confidence: number;
}

interface PlaceRelationship {
  place_id: string;
  place_name: string;
  relationship_type: string;
  relationship_label: string;
}

interface PlaceDetail {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  is_address_backed: boolean;
  has_cat_activity: boolean;
  locality: string | null;
  postal_code: string | null;
  state_province: string | null;
  coordinates: { lat: number; lng: number } | null;
  created_at: string;
  updated_at: string;
  cats: Cat[] | null;
  people: Person[] | null;
  place_relationships: PlaceRelationship[] | null;
  cat_count: number;
  person_count: number;
}

export default function PlaceDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [place, setPlace] = useState<PlaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchPlace = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/places/${id}`);
        if (response.status === 404) {
          setError("Place not found");
          return;
        }
        if (!response.ok) {
          throw new Error("Failed to fetch place details");
        }
        const result: PlaceDetail = await response.json();
        setPlace(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchPlace();
  }, [id]);

  if (loading) {
    return <div className="loading">Loading place details...</div>;
  }

  if (error) {
    return (
      <div>
        <a href="/places">&larr; Back to places</a>
        <div className="empty" style={{ color: "red", marginTop: "2rem" }}>
          {error}
        </div>
      </div>
    );
  }

  if (!place) {
    return <div className="empty">Place not found</div>;
  }

  return (
    <div>
      <a href="/places">&larr; Back to places</a>

      <div className="detail-header" style={{ marginTop: "1rem" }}>
        <h1>{place.display_name}</h1>
        {place.formatted_address && (
          <p className="text-muted">{place.formatted_address}</p>
        )}
        <p className="text-muted text-sm" style={{ marginTop: "0.5rem" }}>
          ID: {place.place_id}
        </p>
      </div>

      <div className="detail-section">
        <h2>Details</h2>
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Type</span>
            <span className="detail-value">
              {place.place_kind ? (
                <span className="badge badge-primary">{place.place_kind}</span>
              ) : (
                "Unknown"
              )}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Locality</span>
            <span className="detail-value">{place.locality || "Unknown"}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Postal Code</span>
            <span className="detail-value">{place.postal_code || "Unknown"}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Cat Activity</span>
            <span className="detail-value">
              {place.has_cat_activity ? "Yes" : "No"}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Cats</span>
            <span className="detail-value">{place.cat_count}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">People</span>
            <span className="detail-value">{place.person_count}</span>
          </div>
          {place.coordinates && (
            <div className="detail-item">
              <span className="detail-label">Coordinates</span>
              <span className="detail-value">
                {place.coordinates.lat.toFixed(6)}, {place.coordinates.lng.toFixed(6)}
              </span>
            </div>
          )}
        </div>
      </div>

      {place.cats && place.cats.length > 0 && (
        <div className="detail-section">
          <h2>Cats</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Relationship</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {place.cats.map((cat) => (
                  <tr key={cat.cat_id}>
                    <td>
                      <a href={`/cats/${cat.cat_id}`}>{cat.cat_name}</a>
                    </td>
                    <td>
                      <span className="badge">{cat.relationship_type}</span>
                    </td>
                    <td>{cat.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {place.people && place.people.length > 0 && (
        <div className="detail-section">
          <h2>People</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {place.people.map((person) => (
                  <tr key={person.person_id}>
                    <td>
                      <a href={`/people/${person.person_id}`}>{person.person_name}</a>
                    </td>
                    <td>
                      <span className="badge">{person.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {place.place_relationships && place.place_relationships.length > 0 && (
        <div className="detail-section">
          <h2>Related Places</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Relationship</th>
                </tr>
              </thead>
              <tbody>
                {place.place_relationships.map((rel) => (
                  <tr key={rel.place_id}>
                    <td>
                      <a href={`/places/${rel.place_id}`}>{rel.place_name}</a>
                    </td>
                    <td>
                      <span className="badge">{rel.relationship_label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="detail-section">
        <h2>Metadata</h2>
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Created</span>
            <span className="detail-value">
              {new Date(place.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Updated</span>
            <span className="detail-value">
              {new Date(place.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
