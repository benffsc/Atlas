"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

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

interface DeepSearchResult {
  source_table: string;
  source_row_id: string;
  match_field: string;
  match_value: string;
  snippet: Record<string, unknown>;
  score: number;
}

interface SearchResponse {
  query: string;
  mode: string;
  results: SearchResult[];
  possible_matches?: SearchResult[];
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
        </select>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="canonical">Canonical</option>
          <option value="deep">Deep (Raw)</option>
        </select>
        <button type="submit">Search</button>
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
                      {data.results.map((result) => {
                        const link = getEntityLink(result);
                        return (
                          <div key={`${result.entity_type}-${result.entity_id}`} className="search-result">
                            <div className="search-result-header">
                              <span className="text-sm">{getEntityIcon(result.entity_type)}</span>
                              <span className={getMatchBadgeClass(result.match_strength)}>
                                {result.match_strength}
                              </span>
                              {link ? (
                                <a href={link} className="search-result-title">
                                  {result.display_name}
                                </a>
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
                      })}
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
                      {data.possible_matches.map((result) => {
                        const link = getEntityLink(result);
                        return (
                          <div key={`possible-${result.entity_type}-${result.entity_id}`} className="search-result">
                            <div className="search-result-header">
                              <span className="text-sm">{getEntityIcon(result.entity_type)}</span>
                              <span className="badge">weak</span>
                              {link ? (
                                <a href={link} className="search-result-title">
                                  {result.display_name}
                                </a>
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
                      })}
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
