"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface Cat {
  cat_id: string;
  cat_name: string;
  relationship_type: string;
  confidence: string;
  source_system: string;
}

interface Place {
  place_id: string;
  place_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  role: string;
  confidence: number;
}

interface PersonRelationship {
  person_id: string;
  person_name: string;
  relationship_type: string;
  relationship_label: string;
  confidence: number;
}

interface PersonDetail {
  person_id: string;
  display_name: string;
  merged_into_person_id: string | null;
  created_at: string;
  updated_at: string;
  cats: Cat[] | null;
  places: Place[] | null;
  person_relationships: PersonRelationship[] | null;
  cat_count: number;
  place_count: number;
}

export default function PersonDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchPerson = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/people/${id}`);
        if (response.status === 404) {
          setError("Person not found");
          return;
        }
        if (!response.ok) {
          throw new Error("Failed to fetch person details");
        }
        const result: PersonDetail = await response.json();
        setPerson(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchPerson();
  }, [id]);

  if (loading) {
    return <div className="loading">Loading person details...</div>;
  }

  if (error) {
    return (
      <div>
        <a href="/people">&larr; Back to people</a>
        <div className="empty" style={{ color: "red", marginTop: "2rem" }}>
          {error}
        </div>
      </div>
    );
  }

  if (!person) {
    return <div className="empty">Person not found</div>;
  }

  return (
    <div>
      <a href="/people">&larr; Back to people</a>

      <div className="detail-header" style={{ marginTop: "1rem" }}>
        <h1>{person.display_name}</h1>
        <p className="text-muted text-sm">
          ID: {person.person_id}
        </p>
      </div>

      <div className="detail-section">
        <h2>Summary</h2>
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Cats</span>
            <span className="detail-value">{person.cat_count}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Places</span>
            <span className="detail-value">{person.place_count}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Created</span>
            <span className="detail-value">
              {new Date(person.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>

      {person.cats && person.cats.length > 0 && (
        <div className="detail-section">
          <h2>Cats</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Relationship</th>
                  <th>Confidence</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {person.cats.map((cat) => (
                  <tr key={cat.cat_id}>
                    <td>
                      <a href={`/cats/${cat.cat_id}`}>{cat.cat_name}</a>
                    </td>
                    <td>
                      <span className="badge">{cat.relationship_type}</span>
                    </td>
                    <td>{cat.confidence}</td>
                    <td className="text-sm text-muted">{cat.source_system}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {person.places && person.places.length > 0 && (
        <div className="detail-section">
          <h2>Places</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {person.places.map((place) => (
                  <tr key={place.place_id}>
                    <td>
                      <a href={`/places/${place.place_id}`}>{place.place_name}</a>
                      {place.formatted_address && (
                        <div className="text-sm text-muted">{place.formatted_address}</div>
                      )}
                    </td>
                    <td>
                      {place.place_kind && (
                        <span className="badge badge-primary">{place.place_kind}</span>
                      )}
                    </td>
                    <td>{place.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {person.person_relationships && person.person_relationships.length > 0 && (
        <div className="detail-section">
          <h2>Related People</h2>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Relationship</th>
                </tr>
              </thead>
              <tbody>
                {person.person_relationships.map((rel) => (
                  <tr key={rel.person_id}>
                    <td>
                      <a href={`/people/${rel.person_id}`}>{rel.person_name}</a>
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
    </div>
  );
}
