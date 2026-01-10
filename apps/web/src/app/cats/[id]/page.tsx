"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface Owner {
  person_id: string;
  display_name: string;
  role: string;
}

interface Place {
  place_id: string;
  label: string;
  place_kind: string | null;
  role: string;
}

interface Identifier {
  type: string;
  value: string;
  source: string | null;
}

interface CatDetail {
  cat_id: string;
  display_name: string;
  sex: string | null;
  altered_status: string | null;
  breed: string | null;
  color: string | null;
  coat_pattern: string | null;
  microchip: string | null;
  notes: string | null;
  identifiers: Identifier[];
  owners: Owner[];
  places: Place[];
  created_at: string;
  updated_at: string;
}

export default function CatDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [cat, setCat] = useState<CatDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchCat = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/cats/${id}`);
        if (response.status === 404) {
          setError("Cat not found");
          return;
        }
        if (!response.ok) {
          throw new Error("Failed to fetch cat details");
        }
        const result: CatDetail = await response.json();
        setCat(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchCat();
  }, [id]);

  if (loading) {
    return <div className="loading">Loading cat details...</div>;
  }

  if (error) {
    return (
      <div>
        <a href="/cats">&larr; Back to cats</a>
        <div className="empty" style={{ color: "red", marginTop: "2rem" }}>
          {error}
        </div>
      </div>
    );
  }

  if (!cat) {
    return <div className="empty">Cat not found</div>;
  }

  return (
    <div>
      <a href="/cats">&larr; Back to cats</a>

      <div className="detail-header" style={{ marginTop: "1rem" }}>
        <h1>{cat.display_name}</h1>
        <p className="text-muted text-sm">
          ID: {cat.cat_id}
        </p>
      </div>

      <div className="detail-section">
        <h2>Basic Information</h2>
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Sex</span>
            <span className="detail-value">{cat.sex || "Unknown"}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Altered Status</span>
            <span className="detail-value">{cat.altered_status || "Unknown"}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Breed</span>
            <span className="detail-value">{cat.breed || "Unknown"}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Color</span>
            <span className="detail-value">{cat.color || "Unknown"}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Coat Pattern</span>
            <span className="detail-value">{cat.coat_pattern || "Unknown"}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Microchip</span>
            <span className="detail-value">{cat.microchip || "None"}</span>
          </div>
        </div>
      </div>

      {cat.notes && (
        <div className="detail-section">
          <h2>Notes</h2>
          <p>{cat.notes}</p>
        </div>
      )}

      {cat.identifiers && cat.identifiers.length > 0 && (
        <div className="detail-section">
          <h2>Identifiers</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {cat.identifiers.map((ident, idx) => (
                  <tr key={idx}>
                    <td>{ident.type}</td>
                    <td>{ident.value}</td>
                    <td>{ident.source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cat.owners && cat.owners.length > 0 && (
        <div className="detail-section">
          <h2>Owners</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {cat.owners.map((owner) => (
                  <tr key={owner.person_id}>
                    <td>
                      <a href={`/people/${owner.person_id}`}>{owner.display_name}</a>
                    </td>
                    <td>
                      <span className="badge">{owner.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cat.places && cat.places.length > 0 && (
        <div className="detail-section">
          <h2>Places</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Type</th>
                  <th>Relationship</th>
                </tr>
              </thead>
              <tbody>
                {cat.places.map((place) => (
                  <tr key={place.place_id}>
                    <td>
                      <a href={`/places/${place.place_id}`}>{place.label}</a>
                    </td>
                    <td>
                      <span className="badge badge-primary">
                        {place.place_kind || "place"}
                      </span>
                    </td>
                    <td>{place.role}</td>
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
              {new Date(cat.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Updated</span>
            <span className="detail-value">
              {new Date(cat.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
