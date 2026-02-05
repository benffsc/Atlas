"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import EntityPreview from "@/components/EntityPreview";
import { GroupedSearchResult } from "@/components/GroupedSearchResult";
import { formatPhone } from "@/lib/formatters";

interface SearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string | null;
  match_strength: string;
  match_reason: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface GroupedResult {
  display_name: string;
  entity_type: string;
  records: SearchResult[];
  record_count: number;
  best_score: number;
  best_match_reason: string;
  best_match_strength: string;
  subtitles: string[];
}

interface DeepSearchResult {
  source_table: string;
  source_row_id: string;
  match_field: string;
  match_value: string;
  snippet: Record<string, unknown>;
  score: number;
}

interface IntakeResult {
  record_type: string;
  record_id: string;
  display_name: string;
  subtitle: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  submitted_at: string | null;
  status: string | null;
  score: number;
  metadata: Record<string, unknown>;
}

interface SubmissionResult {
  submission_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  cats_address: string | null;
  cats_city: string | null;
  status: string;
  triage_category: string | null;
  submitted_at: string;
  match_type: string;
}

interface RequestResult {
  request_id: string;
  display_name: string;
  status: string;
  priority: string;
  place_address: string | null;
  requester_name: string | null;
  estimated_cat_count: number | null;
  created_at: string;
  match_type: string;
}

interface SearchResponse {
  query: string;
  mode: string;
  results: SearchResult[];
  grouped_results?: GroupedResult[];
  possible_matches?: SearchResult[];
  grouped_possible?: GroupedResult[];
  intake_records?: IntakeResult[];
  submissions?: SubmissionResult[];
  requests?: RequestResult[];
  counts_by_type?: Record<string, number>;
  total: number;
  timing_ms: number;
}

interface DeepSearchResponse {
  query: string;
  mode: string;
  results: DeepSearchResult[];
  total: number;
  timing_ms: number;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialQuery = searchParams.get("q") || "";
  const initialType = searchParams.get("type") || "";
  const initialMode = searchParams.get("mode") || "canonical";

  const [query, setQuery] = useState(initialQuery);
  const [entityType, setEntityType] = useState(initialType);
  const [mode, setMode] = useState(initialMode);
  const [data, setData] = useState<SearchResponse | DeepSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [groupedView, setGroupedView] = useState(true); // Default to grouped view
  const pageSize = 25;

  const search = useCallback(async () => {
    if (!query.trim()) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set("q", query);
    if (entityType) params.set("type", entityType);
    params.set("mode", mode);
    params.set("limit", "50");

    try {
      const response = await fetch(`/api/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Search failed");
      }
      const result = await response.json();
      setData(result);

      // Update URL without reloading
      const urlParams = new URLSearchParams();
      urlParams.set("q", query);
      if (entityType) urlParams.set("type", entityType);
      if (mode !== "canonical") urlParams.set("mode", mode);
      router.replace(`/search?${urlParams.toString()}`, { scroll: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [query, entityType, mode, router]);

  useEffect(() => {
    if (initialQuery) {
      search();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search();
  };

  const getEntityLink = (result: SearchResult) => {
    switch (result.entity_type) {
      case "cat":
        return `/cats/${result.entity_id}`;
      case "person":
        return `/people/${result.entity_id}`;
      case "place":
        return `/places/${result.entity_id}`;
      default:
        return null;
    }
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case "cat": return "🐱";
      case "person": return "👤";
      case "place": return "📍";
      default: return "•";
    }
  };

  const getMatchBadgeClass = (strength: string) => {
    switch (strength) {
      case "strong": return "badge badge-primary";
      case "medium": return "badge";
      default: return "badge";
    }
  };

  const isCanonicalResponse = (d: SearchResponse | DeepSearchResponse): d is SearchResponse => {
    return d.mode === "canonical";
  };

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem" }}>Search</h1>

      <form onSubmit={handleSubmit} className="filters">
        <input
          type="text"
          placeholder="Search cats, people, places..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: "300px" }}
          autoFocus
        />
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="cat">Cats</option>
          <option value="person">People</option>
          <option value="place">Places</option>
          <option value="submission">Submissions</option>
          <option value="request">Requests</option>
        </select>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="canonical">Canonical</option>
          <option value="deep">Deep (Raw)</option>
        </select>
        <button type="submit">Search</button>
        {mode === "canonical" && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "1rem", fontSize: "0.85rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={groupedView}
              onChange={(e) => setGroupedView(e.target.checked)}
              style={{ width: "16px", height: "16px" }}
            />
            Group duplicates
          </label>
        )}
      </form>

      {loading && <div className="loading">Searching...</div>}

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!loading && !error && data && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <p className="text-muted text-sm">
              Found {data.total} result{data.total !== 1 ? "s" : ""} for &ldquo;{data.query}&rdquo;
              {data.timing_ms && <span> ({data.timing_ms}ms)</span>}
            </p>
            {isCanonicalResponse(data) && data.counts_by_type && (
              <div style={{ display: "flex", gap: "0.75rem" }}>
                {Object.entries(data.counts_by_type).map(([type, count]) => (
                  <span key={type} className="text-sm text-muted">
                    {getEntityIcon(type)} {count}
                  </span>
                ))}
              </div>
            )}
          </div>

          {mode === "canonical" && isCanonicalResponse(data) && (
            <>
              {data.results.length === 0 && (!data.possible_matches || data.possible_matches.length === 0) ? (
                <div className="empty">No results found</div>
              ) : (
                <>
                  {data.results.length > 0 && (
                    <div className="results-section">
                      {/* Grouped view */}
                      {groupedView && data.grouped_results && data.grouped_results.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          {data.grouped_results.map((group) => (
                            <GroupedSearchResult
                              key={`group-${group.entity_type}-${group.display_name}`}
                              group={group}
                            />
                          ))}
                        </div>
                      ) : (
                        /* Flat view (original) */
                        data.results.map((result) => {
                          const link = getEntityLink(result);
                          return (
                            <div key={`${result.entity_type}-${result.entity_id}`} className="search-result">
                              <div className="search-result-header">
                                <span className="text-sm">{getEntityIcon(result.entity_type)}</span>
                                <span className={getMatchBadgeClass(result.match_strength)}>
                                  {result.match_strength}
                                </span>
                                {link ? (
                                  <EntityPreview
                                    entityType={result.entity_type as "cat" | "person" | "place"}
                                    entityId={result.entity_id}
                                  >
                                    <a href={link} className="search-result-title">
                                      {result.display_name}
                                    </a>
                                  </EntityPreview>
                                ) : (
                                  <span className="search-result-title">
                                    {result.display_name}
                                  </span>
                                )}
                              </div>
                              {result.subtitle && (
                                <div className="search-result-subtitle">{result.subtitle}</div>
                              )}
                              <div className="search-result-match">
                                Matched: {result.match_reason.replace(/_/g, " ")} (score: {result.score})
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {data.possible_matches && data.possible_matches.length > 0 && (
                    <div className="results-section" style={{ marginTop: "2rem" }}>
                      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--muted)" }}>
                        Possible Matches
                      </h2>
                      <p className="text-sm text-muted mb-4">
                        No exact matches found. Showing similar results.
                      </p>
                      {/* Grouped view for possible matches */}
                      {groupedView && data.grouped_possible && data.grouped_possible.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          {data.grouped_possible.map((group) => (
                            <GroupedSearchResult
                              key={`possible-group-${group.entity_type}-${group.display_name}`}
                              group={group}
                            />
                          ))}
                        </div>
                      ) : (
                        /* Flat view */
                        data.possible_matches.map((result) => {
                          const link = getEntityLink(result);
                          return (
                            <div key={`possible-${result.entity_type}-${result.entity_id}`} className="search-result">
                              <div className="search-result-header">
                                <span className="text-sm">{getEntityIcon(result.entity_type)}</span>
                                <span className="badge">weak</span>
                                {link ? (
                                  <EntityPreview
                                    entityType={result.entity_type as "cat" | "person" | "place"}
                                    entityId={result.entity_id}
                                  >
                                    <a href={link} className="search-result-title">
                                      {result.display_name}
                                    </a>
                                  </EntityPreview>
                                ) : (
                                  <span className="search-result-title">
                                    {result.display_name}
                                  </span>
                                )}
                              </div>
                              {result.subtitle && (
                                <div className="search-result-subtitle">{result.subtitle}</div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}

                  {data.intake_records && data.intake_records.length > 0 && (
                    <div className="results-section" style={{ marginTop: "2rem" }}>
                      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--muted)" }}>
                        Unlinked Records
                      </h2>
                      <p className="text-sm text-muted mb-4">
                        Raw intake records that need review. These may contain typos or incomplete data.
                      </p>
                      {data.intake_records.map((record) => (
                        <div key={`intake-${record.record_type}-${record.record_id}`} className="search-result" style={{ borderLeft: "3px solid var(--muted)" }}>
                          <div className="search-result-header">
                            <span className="badge" style={{ background: "#f0ad4e", color: "#000" }}>
                              {record.record_type === "appointment_request" ? "Appt Request" : "Trapping Request"}
                            </span>
                            <span className="search-result-title">
                              {record.display_name}
                            </span>
                          </div>
                          <div className="search-result-subtitle">
                            {record.address && <div>{record.address}</div>}
                            {(record.phone || record.email) && (
                              <div style={{ marginTop: "0.25rem" }}>
                                {record.phone && <span>{formatPhone(record.phone)}</span>}
                                {record.phone && record.email && <span> &bull; </span>}
                                {record.email && <span>{record.email}</span>}
                              </div>
                            )}
                          </div>
                          <div className="search-result-match">
                            {record.status && <span>Status: {record.status} &bull; </span>}
                            {record.submitted_at && (
                              <span>Submitted: {new Date(record.submitted_at).toLocaleDateString()}</span>
                            )}
                            <span> (score: {record.score})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Submissions section */}
                  {data.submissions && data.submissions.length > 0 && (
                    <div className="results-section" style={{ marginTop: "2rem" }}>
                      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--muted)" }}>
                        Intake Submissions ({data.submissions.length})
                      </h2>
                      {data.submissions.map((sub) => (
                        <div key={`sub-${sub.submission_id}`} className="search-result" style={{ borderLeft: "3px solid #17a2b8" }}>
                          <div className="search-result-header">
                            <span className="badge" style={{ background: sub.status === "new" ? "#0d6efd" : sub.status === "reviewed" ? "#198754" : "#6c757d", color: "#fff" }}>
                              {sub.status}
                            </span>
                            {sub.triage_category && (
                              <span className="badge" style={{ marginLeft: "0.25rem" }}>
                                {sub.triage_category.replace(/_/g, " ")}
                              </span>
                            )}
                            <a href={`/intake/queue/${sub.submission_id}`} className="search-result-title">
                              {sub.display_name}
                            </a>
                          </div>
                          <div className="search-result-subtitle">
                            {sub.cats_address && <div>{sub.cats_address}{sub.cats_city ? `, ${sub.cats_city}` : ""}</div>}
                            {(sub.phone || sub.email) && (
                              <div style={{ marginTop: "0.25rem" }}>
                                {sub.phone && <span>{formatPhone(sub.phone)}</span>}
                                {sub.phone && sub.email && <span> &bull; </span>}
                                {sub.email && <span>{sub.email}</span>}
                              </div>
                            )}
                          </div>
                          <div className="search-result-match">
                            Submitted: {new Date(sub.submitted_at).toLocaleDateString()}
                            <span className="text-muted"> &bull; matched on: {sub.match_type.replace(/_/g, " ")}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Requests section */}
                  {data.requests && data.requests.length > 0 && (
                    <div className="results-section" style={{ marginTop: "2rem" }}>
                      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem", color: "var(--muted)" }}>
                        Trapping Requests ({data.requests.length})
                      </h2>
                      {data.requests.map((req) => (
                        <div key={`req-${req.request_id}`} className="search-result" style={{ borderLeft: "3px solid #6f42c1" }}>
                          <div className="search-result-header">
                            <span className="badge" style={{
                              background: req.status === "new" ? "#0d6efd" :
                                         req.status === "scheduled" ? "#198754" :
                                         req.status === "in_progress" ? "#fd7e14" :
                                         req.status === "completed" ? "#20c997" : "#6c757d",
                              color: ["in_progress", "completed"].includes(req.status) ? "#000" : "#fff"
                            }}>
                              {req.status.replace(/_/g, " ")}
                            </span>
                            <span className="badge" style={{
                              marginLeft: "0.25rem",
                              background: req.priority === "urgent" ? "#dc3545" :
                                         req.priority === "high" ? "#fd7e14" : "#6c757d",
                              color: req.priority === "high" ? "#000" : "#fff"
                            }}>
                              {req.priority}
                            </span>
                            <a href={`/requests/${req.request_id}`} className="search-result-title">
                              {req.display_name}
                            </a>
                          </div>
                          <div className="search-result-subtitle">
                            {req.place_address && <div>{req.place_address}</div>}
                            {req.requester_name && (
                              <div style={{ marginTop: "0.25rem" }}>
                                Requester: {req.requester_name}
                                {req.estimated_cat_count && <span> &bull; ~{req.estimated_cat_count} cats</span>}
                              </div>
                            )}
                          </div>
                          <div className="search-result-match">
                            Created: {new Date(req.created_at).toLocaleDateString()}
                            <span className="text-muted"> &bull; matched on: {req.match_type.replace(/_/g, " ")}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {mode === "deep" && !isCanonicalResponse(data) && (
            <>
              {data.results.length === 0 ? (
                <div className="empty">No raw/staged records found</div>
              ) : (
                <div className="results-section">
                  <p className="text-sm text-muted mb-4">
                    Showing raw/staged data from source systems.
                  </p>
                  {data.results.map((result, idx) => (
                    <div key={`deep-${result.source_table}-${result.source_row_id}-${idx}`} className="search-result">
                      <div className="search-result-header">
                        <span className="badge">{result.source_table}</span>
                        <span className="search-result-title">
                          {result.match_value}
                        </span>
                      </div>
                      <div className="search-result-subtitle">
                        Matched on: {result.match_field}
                      </div>
                      <div className="search-result-snippet">
                        <pre style={{ fontSize: "0.75rem", margin: "0.5rem 0", padding: "0.5rem", background: "var(--border)", borderRadius: "4px", overflow: "auto" }}>
                          {JSON.stringify(result.snippet, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {!loading && !error && !data && (
        <div className="empty">
          Enter a search term to find cats, people, and places
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="loading">Loading...</div>}>
      <SearchContent />
    </Suspense>
  );
}
